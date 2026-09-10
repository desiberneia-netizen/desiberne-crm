-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 02 — Migration aditiva em `proposals`
--
-- Objetivo: dar a `proposals` os campos comerciais mutaveis do RASCUNHO.
--   proposals          = estado atual/editavel da proposta (rascunho)
--   proposal_versions   = snapshots consolidados, append-only, imutaveis
--
-- Somente ADD COLUMN IF NOT EXISTS. Nao remove, renomeia nem altera coluna
-- existente. Nao mexe no restante do schema do BLOCO 01.
--
-- Tipos escolhidos para bater com proposal_versions:
--   implementation_value / recurring_value -> numeric(12,2)  (igual a proposal_versions)
--   scope / negotiation_context            -> jsonb          (igual a scope/conditions)
--
-- Execucao: Supabase SQL Editor. Rodar depois do BLOCO 01.
-- ============================================================================

alter table proposals add column if not exists implementation_value numeric(12,2);
alter table proposals add column if not exists recurring_value      numeric(12,2);
alter table proposals add column if not exists delivery_term        text;
alter table proposals add column if not exists commercial_notes     text;
alter table proposals add column if not exists scope                jsonb default '{}'::jsonb;
alter table proposals add column if not exists negotiation_context  jsonb default '{}'::jsonb;

-- Coerencia com proposal_versions (que ja tem check >= 0). Guarda contra re-run.
do $$
begin
  alter table proposals add constraint proposals_implementation_value_nonneg
    check (implementation_value is null or implementation_value >= 0);
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter table proposals add constraint proposals_recurring_value_nonneg
    check (recurring_value is null or recurring_value >= 0);
exception when duplicate_object then null;
end;
$$;

-- ============================================================================
-- FIM BLOCO 02 (migration)
-- ============================================================================
