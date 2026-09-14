-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 17 — Status "Negociação Perdida" (sai do Pipeline, fica no modal Perdidos)
--
-- Aditivo. Reexecutável. Nada removido, nenhuma migration anterior alterada.
-- ============================================================================

alter table leads add column if not exists perdido_em timestamptz;

-- ============================================================================
-- FIM BLOCO 17 (migration)
-- ============================================================================
