-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 01 — Fundacao do modulo de Propostas Comerciais
-- Somente banco de dados + integridade. Sem UI, IA, PDF, pagamento, webhook.
--
-- Execucao: colar no Supabase SQL Editor e rodar.
-- Idempotente: usa IF NOT EXISTS / CREATE OR REPLACE. Nao apaga nada.
-- Nao contem comando destrutivo (nenhum DROP TABLE / DELETE / TRUNCATE / ALTER
-- de coluna existente). Nao toca em nenhuma tabela pre-existente do CRM.
--
-- Modelo:
--   leads (oportunidade comercial, ja existe)
--     -> proposals
--          -> proposal_versions   (historico, append-only)
--          -> digital_analyses    (pertence a proposta via proposal_id)
--          -> payments
--               -> webhook_events
--          -> onboardings
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Numeracao comercial legivel e sem colisao: PROP-<ano>-<sequencial 6 digitos>
-- Sequencia global (o ano no texto e cosmetico; o sequencial garante unicidade).
-- ----------------------------------------------------------------------------
create sequence if not exists proposal_number_seq start 1;

create or replace function gen_proposal_number()
returns text
language sql
volatile
as $$
  select 'PROP-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('proposal_number_seq')::text, 6, '0');
$$;

-- ----------------------------------------------------------------------------
-- Helper: manter updated_at automatico
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Helper: bloquear alteracao/remocao de versoes historicas (append-only)
-- ----------------------------------------------------------------------------
create or replace function block_proposal_version_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'proposal_versions e append-only: % nao permitido em versao historica', tg_op
    using errcode = 'check_violation';
end;
$$;

-- ============================================================================
-- 1. proposals  (1 lead : N proposals)
-- ============================================================================
create table if not exists proposals (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references leads(id) on delete cascade,
  client_name       text not null,                       -- snapshot historico
  product_code      text not null default 'site_presenca_digital',
  proposal_number   text not null unique default gen_proposal_number(),
  title             text,
  status            text not null default 'draft'
                      check (status in ('draft','generated','sent','viewed',
                                        'approved','paid','expired','cancelled')),
  public_token      uuid unique,                          -- null ate ter URL publica; NAO sequencial
  public_url        text,
  pdf_url           text,
  payment_method    text,
  payment_link      text,
  valid_until       date,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_proposals_lead_id on proposals(lead_id);
create index if not exists idx_proposals_status  on proposals(status);

drop trigger if exists trg_proposals_updated_at on proposals;
create trigger trg_proposals_updated_at
  before update on proposals
  for each row execute function set_updated_at();

-- ============================================================================
-- 2. proposal_versions  (1 proposal : N versions, append-only)
--    Valores financeiros vivem AQUI (mudam entre versoes).
-- ============================================================================
create table if not exists proposal_versions (
  id                   uuid primary key default gen_random_uuid(),
  proposal_id          uuid not null references proposals(id) on delete cascade,
  version_number       int  not null check (version_number > 0),
  implementation_value numeric(12,2) check (implementation_value >= 0),
  recurring_value      numeric(12,2) check (recurring_value >= 0),
  scope                jsonb not null default '{}'::jsonb,
  conditions           jsonb not null default '{}'::jsonb,
  content_snapshot     jsonb not null default '{}'::jsonb,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (proposal_id, version_number)
);

create index if not exists idx_proposal_versions_proposal_id on proposal_versions(proposal_id);

drop trigger if exists trg_proposal_versions_no_mutate on proposal_versions;
create trigger trg_proposal_versions_no_mutate
  before update or delete on proposal_versions
  for each row execute function block_proposal_version_mutation();

-- ============================================================================
-- 3. digital_analyses  (pertence a 1 proposal via proposal_id)
--    Sem UNIQUE em proposal_id: permite re-rodar apos error/rejected.
--    Analise "corrente" = a mais recente por created_at.
-- ============================================================================
create table if not exists digital_analyses (
  id                uuid primary key default gen_random_uuid(),
  proposal_id       uuid not null references proposals(id) on delete cascade,
  lead_id           uuid references leads(id) on delete set null,
  analysis_status   text not null default 'pending'
                      check (analysis_status in ('pending','running','completed',
                                                 'under_review','approved','rejected','error')),
  company_presence  jsonb,
  google_presence   jsonb,
  website_presence  jsonb,
  social_presence   jsonb,
  reputation        jsonb,
  competitors       jsonb,
  market_context    jsonb,
  market_research   jsonb,
  opportunities     jsonb,
  recommendations   jsonb,
  sources           jsonb,
  confidence_score  numeric(5,2) check (confidence_score >= 0 and confidence_score <= 100),
  ai_model          text,
  ai_prompt_version text,
  reviewed_by       uuid references auth.users(id) on delete set null,
  reviewed_at       timestamptz,
  approved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_digital_analyses_proposal_id on digital_analyses(proposal_id);
create index if not exists idx_digital_analyses_lead_id     on digital_analyses(lead_id);
create index if not exists idx_digital_analyses_status      on digital_analyses(analysis_status);

drop trigger if exists trg_digital_analyses_updated_at on digital_analyses;
create trigger trg_digital_analyses_updated_at
  before update on digital_analyses
  for each row execute function set_updated_at();

-- ============================================================================
-- 4. payments  (pertence a proposal; lead_id tambem, por conveniencia)
--    Sem gateway neste bloco. payment != confirmacao.
-- ============================================================================
create table if not exists payments (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid not null references proposals(id) on delete cascade,
  lead_id        uuid references leads(id) on delete set null,
  provider       text,
  transaction_id text,
  amount         numeric(12,2) not null check (amount >= 0),
  payment_method text,
  status         text not null default 'pending'
                   check (status in ('pending','processing','paid','failed','refunded','cancelled')),
  payment_url    text,
  paid_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_payments_proposal_id on payments(proposal_id);
create index if not exists idx_payments_lead_id     on payments(lead_id);

-- transaction_id unico SOMENTE quando fornecido (varios NULL permitidos)
create unique index if not exists uq_payments_transaction_id
  on payments(transaction_id)
  where transaction_id is not null;

drop trigger if exists trg_payments_updated_at on payments;
create trigger trg_payments_updated_at
  before update on payments
  for each row execute function set_updated_at();

-- ============================================================================
-- 5. webhook_events  (auditoria de eventos de gateway; sem endpoint real)
--    Protecao contra duplicidade: (provider, event_id).
-- ============================================================================
create table if not exists webhook_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,
  event_id          text not null,
  event_type        text,
  transaction_id    text,
  proposal_id       uuid references proposals(id) on delete set null,
  payload           jsonb not null default '{}'::jsonb,
  processing_status text not null default 'pending'
                      check (processing_status in ('pending','processed','ignored','error')),
  processed_at      timestamptz,
  created_at        timestamptz not null default now(),
  unique (provider, event_id)
);

create index if not exists idx_webhook_events_transaction_id on webhook_events(transaction_id);
create index if not exists idx_webhook_events_proposal_id    on webhook_events(proposal_id);

-- ============================================================================
-- 6. onboardings  (so estrutura; sem automacao, checklist, notificacao)
--    1 onboarding por proposta.
-- ============================================================================
create table if not exists onboardings (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid not null unique references proposals(id) on delete cascade,
  lead_id      uuid references leads(id) on delete set null,
  client_name  text,
  status       text not null default 'pending'
                 check (status in ('pending','in_progress','completed','cancelled')),
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_onboardings_lead_id on onboardings(lead_id);

drop trigger if exists trg_onboardings_updated_at on onboardings;
create trigger trg_onboardings_updated_at
  before update on onboardings
  for each row execute function set_updated_at();

-- ============================================================================
-- RLS — acesso restrito a usuarios autenticados. Sem policy publica USING(true).
-- DELETE nao tem policy em nenhuma tabela => negado (integridade + nao-exposicao).
-- Granularidade por perfil (master/admin/vendedor/visualizador) fica pro bloco
-- de autorizacao/UI. Funcoes server-side com service_role ignoram RLS.
-- ============================================================================
alter table proposals         enable row level security;
alter table proposal_versions enable row level security;
alter table digital_analyses  enable row level security;
alter table payments          enable row level security;
alter table webhook_events    enable row level security;
alter table onboardings       enable row level security;

-- proposals
drop policy if exists proposals_auth_select on proposals;
drop policy if exists proposals_auth_insert on proposals;
drop policy if exists proposals_auth_update on proposals;
create policy proposals_auth_select on proposals for select using (auth.uid() is not null);
create policy proposals_auth_insert on proposals for insert with check (auth.uid() is not null);
create policy proposals_auth_update on proposals for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- proposal_versions
drop policy if exists proposal_versions_auth_select on proposal_versions;
drop policy if exists proposal_versions_auth_insert on proposal_versions;
drop policy if exists proposal_versions_auth_update on proposal_versions;
create policy proposal_versions_auth_select on proposal_versions for select using (auth.uid() is not null);
create policy proposal_versions_auth_insert on proposal_versions for insert with check (auth.uid() is not null);
create policy proposal_versions_auth_update on proposal_versions for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- digital_analyses
drop policy if exists digital_analyses_auth_select on digital_analyses;
drop policy if exists digital_analyses_auth_insert on digital_analyses;
drop policy if exists digital_analyses_auth_update on digital_analyses;
create policy digital_analyses_auth_select on digital_analyses for select using (auth.uid() is not null);
create policy digital_analyses_auth_insert on digital_analyses for insert with check (auth.uid() is not null);
create policy digital_analyses_auth_update on digital_analyses for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- payments
drop policy if exists payments_auth_select on payments;
drop policy if exists payments_auth_insert on payments;
drop policy if exists payments_auth_update on payments;
create policy payments_auth_select on payments for select using (auth.uid() is not null);
create policy payments_auth_insert on payments for insert with check (auth.uid() is not null);
create policy payments_auth_update on payments for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- webhook_events
drop policy if exists webhook_events_auth_select on webhook_events;
drop policy if exists webhook_events_auth_insert on webhook_events;
drop policy if exists webhook_events_auth_update on webhook_events;
create policy webhook_events_auth_select on webhook_events for select using (auth.uid() is not null);
create policy webhook_events_auth_insert on webhook_events for insert with check (auth.uid() is not null);
create policy webhook_events_auth_update on webhook_events for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- onboardings
drop policy if exists onboardings_auth_select on onboardings;
drop policy if exists onboardings_auth_insert on onboardings;
drop policy if exists onboardings_auth_update on onboardings;
create policy onboardings_auth_select on onboardings for select using (auth.uid() is not null);
create policy onboardings_auth_insert on onboardings for insert with check (auth.uid() is not null);
create policy onboardings_auth_update on onboardings for update using (auth.uid() is not null) with check (auth.uid() is not null);

-- ============================================================================
-- FIM DO BLOCO 01
-- ============================================================================
