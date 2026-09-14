-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 16b — Banco de Posts vira carrossel (múltiplas imagens por post)
--
-- imagem_url/imagem_path (bloco 16 original) ficam como estavam, sem uso daqui
-- pra frente — só não removidos pra não quebrar linha nenhuma já salva.
-- A partir de agora, a fonte da verdade das imagens é a coluna "imagens" (array).
--
-- Aditivo. Reexecutável. Nada removido, nenhuma migration anterior alterada.
-- ============================================================================

alter table posts_conteudo alter column imagem_url drop not null;
alter table posts_conteudo add column if not exists imagens jsonb not null default '[]'::jsonb;

-- Migra quem já tinha um post salvo com imagem única pro formato de array,
-- só na primeira vez (se "imagens" ainda estiver vazio e imagem_url existir).
update posts_conteudo
set imagens = jsonb_build_array(jsonb_build_object('url', imagem_url, 'path', imagem_path))
where imagens = '[]'::jsonb and imagem_url is not null;

-- ============================================================================
-- FIM BLOCO 16b (migration)
-- ============================================================================
