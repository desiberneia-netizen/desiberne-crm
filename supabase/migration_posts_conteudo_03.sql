-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 16c — Data/hora pra postar + lembrete pop-up por post
--
-- Aditivo. Reexecutável. Nada removido, nenhuma migration anterior alterada.
-- ============================================================================

alter table posts_conteudo add column if not exists agendar_data date;
alter table posts_conteudo add column if not exists agendar_hora time;
alter table posts_conteudo add column if not exists lembrete boolean not null default false;

-- ============================================================================
-- FIM BLOCO 16c (migration)
-- ============================================================================
