-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 15 — Data de entrega da tarefa interna (pra filtrar "Entregue" por mês)
--
-- Aditivo. Reexecutável. Nada removido, nenhuma migration anterior alterada.
-- ============================================================================

alter table tarefas_internas add column if not exists entregue_em timestamptz;

-- ============================================================================
-- FIM BLOCO 15 (migration)
-- ============================================================================
