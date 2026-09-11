-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 12 — Arquivar lead (fallback quando não dá pra excluir de verdade)
--
-- Lead com proposta comercial gerada não pode ser excluído fisicamente: a
-- tabela proposal_versions é append-only por design (BLOCO 01), pra manter
-- o histórico de propostas íntegro. Nesse caso o lead é arquivado em vez de
-- apagado — some das listas, mas o registro e o histórico ficam preservados.
--
-- Aditivo. Reexecutável. Nada removido, nenhuma migration anterior alterada.
-- ============================================================================

alter table leads add column if not exists arquivado boolean not null default false;
create index if not exists idx_leads_arquivado on leads(arquivado);

-- ============================================================================
-- FIM BLOCO 12 (migration)
-- ============================================================================
