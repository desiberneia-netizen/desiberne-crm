-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 04 — Fundacao comercial e versionavel da proposta
--
-- Somente aditivo em `proposals`. Reexecutavel. Nao remove nada, nao altera
-- tipo/CHECK existente, nao cria tabela nova. proposal_versions / digital_analyses
-- ficam intactos (o conteudo comercial versionado usa proposal_versions.content_snapshot
-- que ja existe).
--
-- Novos campos:
--   responsavel_id       -> ID do usuario responsavel comercial (auth.users)
--   recurring_period     -> periodicidade do valor recorrente (default "mensal")
--   commercial_content   -> narrativa voltada ao cliente (headline, subheadline,
--                           contexto, oportunidade, solucao, proximos_passos)
--                           — separada de negotiation_context (interno)
-- ============================================================================

alter table proposals
  add column if not exists responsavel_id uuid references auth.users(id) on delete set null;

alter table proposals
  add column if not exists recurring_period text default 'mensal';

alter table proposals
  add column if not exists commercial_content jsonb default '{}'::jsonb;

-- ============================================================================
-- FIM BLOCO 04 (migration)
-- ============================================================================
