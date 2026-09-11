-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 10 — Carteira de clientes (import) + segmento livre
--
-- Aditivo. Reexecutável. Nada removido, nenhuma migration anterior alterada.
-- ============================================================================

-- Carteira: leads importados ficam aqui até alguém "assumir atendimento".
-- Lead criado manualmente continua indo direto pro Pipeline (default false).
alter table leads add column if not exists em_carteira boolean not null default false;
create index if not exists idx_leads_em_carteira on leads(em_carteira);

-- ============================================================================
-- FIM BLOCO 10 (migration)
-- ============================================================================
