-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 11 — Campos de prospecção na Carteira (site, instagram, prioridade)
--
-- Aditivo. Reexecutável. Nada removido, nenhuma migration anterior alterada.
-- ============================================================================

alter table leads add column if not exists site_url text;
alter table leads add column if not exists instagram text;
alter table leads add column if not exists prioridade text not null default 'Média';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_prioridade_check') then
    alter table leads add constraint leads_prioridade_check check (prioridade in ('Alta', 'Média', 'Baixa'));
  end if;
end $$;

-- ============================================================================
-- FIM BLOCO 11 (migration)
-- ============================================================================
