-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 03B — Motor de Analise Digital V1 (migration aditiva)
--
-- Somente aditivo. Nao remove coluna, nao altera CHECK, nao cria Storage.
-- Reexecutavel com seguranca (IF NOT EXISTS).
-- ============================================================================

alter table digital_analyses
  add column if not exists metadata jsonb default '{}'::jsonb;

create index if not exists idx_digital_analyses_proposal_created
  on digital_analyses (proposal_id, created_at desc);

-- ============================================================================
-- FIM BLOCO 03B (migration)
-- ============================================================================
