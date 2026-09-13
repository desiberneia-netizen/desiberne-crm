-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 14 — Valor de implementação (one-shot) separado da recorrência mensal
--
-- leads.valor já existia e continua sendo a recorrência mensal (não renomeado,
-- pra não quebrar telas/relatórios que já leem esse campo).
--
-- Aditivo. Reexecutável. Nada removido, nenhuma migration anterior alterada.
-- ============================================================================

alter table leads add column if not exists valor_implementacao numeric(12,2);

-- ============================================================================
-- FIM BLOCO 14 (migration)
-- ============================================================================
