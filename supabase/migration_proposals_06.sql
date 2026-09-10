-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 06 — Aprovação real da proposta pelo cliente (via página pública)
--
-- Somente aditivo em `proposals`. Reexecutável. Nada removido, nenhum CHECK
-- alterado (o status 'approved' já existe). payments/onboardings/webhook_events
-- NÃO são tocados — aprovação ≠ pagamento.
--
-- Campos:
--   approved_at              -> quando o cliente aprovou (evento público)
--   approved_version_number  -> qual proposal_versions.version_number foi aprovada
--                               (a página pública fica pinada nessa versão depois)
--   approved_ip              -> IP do request de aprovação (evidência mínima de auditoria)
--   approval_metadata        -> { user_agent, approved_via } — mínimo necessário
-- O public_token NÃO é re-armazenado aqui (já existe em proposals.public_token).
-- ============================================================================

alter table proposals add column if not exists approved_at timestamptz;
alter table proposals add column if not exists approved_version_number int;
alter table proposals add column if not exists approved_ip text;
alter table proposals add column if not exists approval_metadata jsonb default '{}'::jsonb;

-- ============================================================================
-- FIM BLOCO 06 (migration)
-- ============================================================================
