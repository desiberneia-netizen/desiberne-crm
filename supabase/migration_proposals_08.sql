-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 08 — Onboarding pós-pagamento
--
-- A tabela `onboardings` (BLOCO 01) já comporta o fluxo:
--   proposal_id UNIQUE, status ('pending'/'in_progress'/'completed'/'cancelled'),
--   started_at, completed_at, lead_id, client_name.
-- Falta só onde guardar o formulário coletado e quem criou.
--
-- Aditivo. Reexecutável. Nada removido, nenhum CHECK alterado.
-- payments/webhook_events NÃO são tocadas.
-- ============================================================================

alter table onboardings add column if not exists data jsonb default '{}'::jsonb;
alter table onboardings add column if not exists created_by uuid references auth.users(id) on delete set null;

-- ============================================================================
-- FIM BLOCO 08 (migration)
-- ============================================================================
