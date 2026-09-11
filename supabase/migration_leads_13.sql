-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 13 — Interações no Pipeline (chat de negociação por lead)
--
-- Aditivo. Reexecutável. Nada removido, nenhuma migration anterior alterada.
-- ============================================================================

create table if not exists interacoes (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references leads(id) on delete cascade,
  autor      text not null default '',
  texto      text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_interacoes_lead_id on interacoes(lead_id);

alter table interacoes enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'interacoes' and policyname = 'Allow all') then
    create policy "Allow all" on interacoes for all using (true) with check (true);
  end if;
end $$;

-- ============================================================================
-- FIM BLOCO 13 (migration)
-- ============================================================================
