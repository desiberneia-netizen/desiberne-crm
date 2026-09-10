-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 09 — Narrativa com IA, imagem na proposta, recusa/renegociação
--
-- Aditivo em `proposals`. Reexecutável. Nada removido, nenhum CHECK alterado
-- (client_response fica sem CHECK pra não travar evolução: 'declined' |
-- 'changes_requested' | null). payments/onboardings/webhook_events intocadas.
-- ============================================================================

alter table proposals add column if not exists hero_image_url text;
alter table proposals add column if not exists client_response text;        -- declined | changes_requested | null
alter table proposals add column if not exists client_response_at timestamptz;
alter table proposals add column if not exists client_response_note text;

-- ============================================================================
-- FIM BLOCO 09 (migration)
-- ============================================================================
