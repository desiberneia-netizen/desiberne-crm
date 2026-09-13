-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 16 — Banco de Posts (quadrante minimalista na Início)
--
-- Guarda posts prontos pra publicar: imagem (upload no Storage) + legenda +
-- status (rascunho/pronto/postado). Compartilhado entre toda a equipe.
--
-- Aditivo. Reexecutável. Nada removido, nenhuma migration anterior alterada.
-- ============================================================================

create table if not exists posts_conteudo (
  id uuid primary key default gen_random_uuid(),
  imagem_url text not null,
  imagem_path text, -- caminho no Storage, guardado pra permitir apagar o arquivo depois se quiser
  legenda text not null default '',
  status text not null default 'rascunho' check (status in ('rascunho', 'pronto', 'postado')),
  criado_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_posts_conteudo_status on posts_conteudo(status);

drop trigger if exists trg_posts_conteudo_updated_at on posts_conteudo;
create trigger trg_posts_conteudo_updated_at
  before update on posts_conteudo
  for each row execute function set_updated_at();

alter table posts_conteudo enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'posts_conteudo' and policyname = 'Allow all') then
    create policy "Allow all" on posts_conteudo for all using (true) with check (true);
  end if;
end $$;

-- ============================================================================
-- STORAGE — bucket "posts-conteudo" precisa ser criado À MÃO no painel:
-- Supabase Dashboard → Storage → New bucket
--   Nome: posts-conteudo
--   Public bucket: LIGADO (pra pegar URL pública direto, sem assinatura)
--
-- Depois de criar o bucket, roda isso aqui pra liberar upload/leitura:
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'objects' and schemaname = 'storage' and policyname = 'posts-conteudo leitura publica') then
    create policy "posts-conteudo leitura publica" on storage.objects for select
      using (bucket_id = 'posts-conteudo');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and schemaname = 'storage' and policyname = 'posts-conteudo upload autenticado') then
    create policy "posts-conteudo upload autenticado" on storage.objects for insert
      with check (bucket_id = 'posts-conteudo' and auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'objects' and schemaname = 'storage' and policyname = 'posts-conteudo delete autenticado') then
    create policy "posts-conteudo delete autenticado" on storage.objects for delete
      using (bucket_id = 'posts-conteudo' and auth.role() = 'authenticated');
  end if;
end $$;

-- ============================================================================
-- FIM BLOCO 16 (migration)
-- ============================================================================
