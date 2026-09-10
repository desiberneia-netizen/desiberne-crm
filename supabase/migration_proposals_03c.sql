-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 03C — Revisao e aprovacao humana da analise digital
--
-- Somente aditivo. Reexecutavel. Nao remove nada, nao altera CHECK.
-- reviewed_by / reviewed_at / approved_at ja existem (BLOCO 01).
-- Aqui so falta guardar a observacao da revisao.
-- ============================================================================

alter table digital_analyses
  add column if not exists review_notes text;

-- ============================================================================
-- FIM BLOCO 03C (migration)
-- ============================================================================
