-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 07 (fase manual) — Pagamento da proposta
--
-- Sem gateway ainda. Link de pagamento é colado manualmente na proposta;
-- a confirmação de "pago" é ação autenticada no CRM (não há webhook).
-- A tabela `payments` (BLOCO 01) já comporta o registro; aqui só faltam
-- 2 campos de rastro e a garantia de 1 pagamento pago por proposta.
--
-- Aditivo. Reexecutável. Nada removido, nenhum CHECK alterado.
-- `webhook_events` NÃO é tocada (entra na fase com gateway).
-- ============================================================================

alter table payments add column if not exists confirmed_by uuid references auth.users(id) on delete set null;
alter table payments add column if not exists proposal_version_number int;

-- 1 pagamento 'paid' por proposta (idempotência da confirmação)
create unique index if not exists uq_payments_proposal_paid
  on payments (proposal_id) where status = 'paid';

-- ============================================================================
-- FIM BLOCO 07 (migration — fase manual)
-- ============================================================================
