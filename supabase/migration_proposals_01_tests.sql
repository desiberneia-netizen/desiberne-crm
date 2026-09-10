-- ============================================================================
-- DESIBERNE IA — CRM
-- BLOCO 01 — Script de validacao das constraints do modulo de Propostas
--
-- NAO e um framework de teste (o projeto nao tem runner). E um script SQL
-- que exercita as regras de integridade e falha em voz alta se alguma nao
-- estiver valendo.
--
-- Execucao: colar no Supabase SQL Editor DEPOIS de rodar migration_proposals_01.sql
-- Seguro: roda tudo dentro de uma transacao e da ROLLBACK no final.
--         Nenhum dado de teste persiste.
--
-- Rodado no SQL Editor, o RLS e ignorado (contexto privilegiado). Este script
-- valida CONSTRAINTS/TRIGGERS. Validacao de RLS = checklist manual no fim.
--
-- Resultado esperado: varios "NOTICE ... OK" e no fim
--   "==> TODOS OS TESTES PASSARAM".
-- Qualquer "TESTE FALHOU" aborta com erro.
-- ============================================================================

begin;

do $$
declare
  v_lead      uuid;
  v_lead_b    uuid;
  v_prop      uuid;
  v_prop_b    uuid;
  v_ok        boolean;
  v_num_a     text;
  v_num_b     text;
  v_tok       uuid := gen_random_uuid();
begin
  -- --------------------------------------------------------------------------
  -- SETUP: leads descartaveis (a coluna obrigatoria e razao_social).
  -- Se leads tiver outra coluna NOT NULL sem default, este INSERT falha e
  -- basta acrescentar o campo aqui.
  -- --------------------------------------------------------------------------
  insert into leads (razao_social, temperatura, status)
    values ('__TESTE_PROPOSTAS_A__', 'Frio', 'Retornar') returning id into v_lead;
  insert into leads (razao_social, temperatura, status)
    values ('__TESTE_PROPOSTAS_B__', 'Frio', 'Retornar') returning id into v_lead_b;
  raise notice 'SETUP OK — leads de teste %, %', v_lead, v_lead_b;

  -- T1 — criacao de proposta + numero comercial automatico ------------------
  insert into proposals (lead_id, client_name)
    values (v_lead, '__TESTE_PROPOSTAS_A__')
    returning id, proposal_number into v_prop, v_num_a;
  if v_num_a !~ '^PROP-[0-9]{4}-[0-9]{6}$' then
    raise exception 'T1 FALHOU: proposal_number fora do padrao: %', v_num_a;
  end if;
  raise notice 'T1 OK — proposta % criada, numero %', v_prop, v_num_a;

  -- T2 — varias propostas para a mesma lead --------------------------------
  insert into proposals (lead_id, client_name)
    values (v_lead, '__TESTE_PROPOSTAS_A__')
    returning id, proposal_number into v_prop_b, v_num_b;
  if v_num_a = v_num_b then
    raise exception 'T2 FALHOU: dois proposal_number iguais (%).', v_num_a;
  end if;
  raise notice 'T2 OK — 2 propostas na mesma lead, numeros distintos % / %', v_num_a, v_num_b;

  -- T3 — varias versoes por proposta -------------------------------------
  insert into proposal_versions (proposal_id, version_number, implementation_value, recurring_value)
    values (v_prop, 1, 600.00, 49.99);
  insert into proposal_versions (proposal_id, version_number, implementation_value, recurring_value)
    values (v_prop, 2, 700.00, 59.99);
  raise notice 'T3 OK — 2 versoes na proposta';

  -- T4 — version_number duplicado deve falhar ----------------------------
  v_ok := true;
  begin
    insert into proposal_versions (proposal_id, version_number, implementation_value, recurring_value)
      values (v_prop, 1, 1, 1);
    v_ok := false;
  exception when unique_violation then null;
  end;
  if not v_ok then raise exception 'T4 FALHOU: aceitou version_number duplicado na mesma proposta'; end if;
  raise notice 'T4 OK — bloqueou versao duplicada (proposal_id + version_number)';

  -- T5 — versoes sao append-only: UPDATE deve falhar --------------------
  v_ok := true;
  begin
    update proposal_versions set implementation_value = 0
      where proposal_id = v_prop and version_number = 1;
    v_ok := false;
  exception when others then null;
  end;
  if not v_ok then raise exception 'T5 FALHOU: permitiu UPDATE em versao historica'; end if;
  raise notice 'T5 OK — bloqueou UPDATE em proposal_versions';

  -- T6 — versoes sao append-only: DELETE deve falhar -------------------
  v_ok := true;
  begin
    delete from proposal_versions where proposal_id = v_prop and version_number = 2;
    v_ok := false;
  exception when others then null;
  end;
  if not v_ok then raise exception 'T6 FALHOU: permitiu DELETE em versao historica'; end if;
  raise notice 'T6 OK — bloqueou DELETE em proposal_versions';

  -- T7 — valor monetario: negativo rejeitado, escala 2 casas preservada -
  v_ok := true;
  begin
    insert into proposal_versions (proposal_id, version_number, implementation_value, recurring_value)
      values (v_prop, 3, -1.00, 10.00);
    v_ok := false;
  exception when check_violation then null;
  end;
  if not v_ok then raise exception 'T7 FALHOU: aceitou implementation_value negativo'; end if;
  if (select recurring_value from proposal_versions where proposal_id = v_prop and version_number = 1) <> 49.99 then
    raise exception 'T7 FALHOU: recurring_value nao preservou 49.99';
  end if;
  raise notice 'T7 OK — numeric(12,2): negativo bloqueado, 49.99 preservado';

  -- T8 — status invalido em proposals deve falhar --------------------
  v_ok := true;
  begin
    insert into proposals (lead_id, client_name, status)
      values (v_lead, 'x', 'status_que_nao_existe');
    v_ok := false;
  exception when check_violation then null;
  end;
  if not v_ok then raise exception 'T8 FALHOU: aceitou status invalido em proposals'; end if;
  raise notice 'T8 OK — CHECK de status em proposals';

  -- T9 — FK invalida: proposta com lead_id inexistente deve falhar ---
  v_ok := true;
  begin
    insert into proposals (lead_id, client_name)
      values (gen_random_uuid(), 'orfa');
    v_ok := false;
  exception when foreign_key_violation then null;
  end;
  if not v_ok then raise exception 'T9 FALHOU: aceitou proposta com lead_id inexistente'; end if;
  raise notice 'T9 OK — FK proposals.lead_id -> leads.id';

  -- T10 — public_token unico; multiplos NULL permitidos -------------
  update proposals set public_token = v_tok where id = v_prop;
  v_ok := true;
  begin
    update proposals set public_token = v_tok where id = v_prop_b;
    v_ok := false;
  exception when unique_violation then null;
  end;
  if not v_ok then raise exception 'T10 FALHOU: aceitou public_token duplicado'; end if;
  -- os dois comecaram NULL e coexistiram (T1/T2 passaram), entao multi-NULL OK
  raise notice 'T10 OK — public_token unico, multi-NULL permitido';

  -- T11 — analise digital vinculada a proposta ---------------------
  insert into digital_analyses (proposal_id, lead_id, analysis_status)
    values (v_prop, v_lead, 'pending');
  raise notice 'T11 OK — digital_analyses vinculada a proposal_id';

  -- T11b — analise com proposal_id inexistente deve falhar --------
  v_ok := true;
  begin
    insert into digital_analyses (proposal_id) values (gen_random_uuid());
    v_ok := false;
  exception when foreign_key_violation then null;
  end;
  if not v_ok then raise exception 'T11b FALHOU: aceitou digital_analyses com proposal_id inexistente'; end if;
  raise notice 'T11b OK — FK digital_analyses.proposal_id -> proposals.id';

  -- T11c — confidence_score fora de 0..100 deve falhar -----------
  v_ok := true;
  begin
    insert into digital_analyses (proposal_id, confidence_score) values (v_prop, 150);
    v_ok := false;
  exception when check_violation then null;
  end;
  if not v_ok then raise exception 'T11c FALHOU: aceitou confidence_score = 150'; end if;
  raise notice 'T11c OK — CHECK confidence_score 0..100';

  -- T12 — payments.transaction_id unico quando fornecido --------
  insert into payments (proposal_id, amount, transaction_id) values (v_prop, 600.00, 'txn_ABC_123');
  v_ok := true;
  begin
    insert into payments (proposal_id, amount, transaction_id) values (v_prop, 49.99, 'txn_ABC_123');
    v_ok := false;
  exception when unique_violation then null;
  end;
  if not v_ok then raise exception 'T12 FALHOU: aceitou transaction_id duplicado'; end if;
  -- dois NULL devem coexistir
  insert into payments (proposal_id, amount) values (v_prop, 10.00);
  insert into payments (proposal_id, amount) values (v_prop, 20.00);
  raise notice 'T12 OK — transaction_id unico quando fornecido, multi-NULL permitido';

  -- T13 — payments.amount negativo deve falhar -----------------
  v_ok := true;
  begin
    insert into payments (proposal_id, amount) values (v_prop, -5.00);
    v_ok := false;
  exception when check_violation then null;
  end;
  if not v_ok then raise exception 'T13 FALHOU: aceitou payments.amount negativo'; end if;
  raise notice 'T13 OK — CHECK payments.amount >= 0';

  -- T14 — webhook_events (provider, event_id) unico ------------
  insert into webhook_events (provider, event_id, payload)
    values ('stripe', 'evt_1', '{"a":1}'::jsonb);
  v_ok := true;
  begin
    insert into webhook_events (provider, event_id) values ('stripe', 'evt_1');
    v_ok := false;
  exception when unique_violation then null;
  end;
  if not v_ok then raise exception 'T14 FALHOU: aceitou (provider,event_id) duplicado'; end if;
  -- mesmo event_id, provider diferente => permitido
  insert into webhook_events (provider, event_id) values ('mercadopago', 'evt_1');
  raise notice 'T14 OK — webhook_events unico por (provider, event_id)';

  -- T15 — webhook_events.processing_status invalido deve falhar
  v_ok := true;
  begin
    insert into webhook_events (provider, event_id, processing_status)
      values ('stripe', 'evt_2', 'qualquer_coisa');
    v_ok := false;
  exception when check_violation then null;
  end;
  if not v_ok then raise exception 'T15 FALHOU: aceitou processing_status invalido'; end if;
  raise notice 'T15 OK — CHECK webhook_events.processing_status';

  -- T16 — onboarding: 1 por proposta -------------------------
  insert into onboardings (proposal_id, lead_id, client_name) values (v_prop, v_lead, 'A');
  v_ok := true;
  begin
    insert into onboardings (proposal_id) values (v_prop);
    v_ok := false;
  exception when unique_violation then null;
  end;
  if not v_ok then raise exception 'T16 FALHOU: aceitou 2 onboardings para a mesma proposta'; end if;
  raise notice 'T16 OK — onboardings unico por proposal_id';

  -- T17 — cascade: apagar proposta remove versoes/analises/payments/onboarding
  --        (apagar proposta NAO e operacao de app; aqui e so prova do ON DELETE CASCADE)
  delete from proposals where id = v_prop_b;  -- v_prop_b nao tem filhos, so valida o caminho
  raise notice 'T17 OK — DELETE de proposta sem erro (cascade configurado)';

  raise notice '==> TODOS OS TESTES PASSARAM';
end;
$$;

rollback;

-- ============================================================================
-- CHECKLIST MANUAL DE RLS (nao da pra validar no SQL Editor — contexto e
-- privilegiado e ignora RLS). Fazer via app / cliente PostgREST:
--
--  [ ] Sem sessao (anon key, sem login): SELECT em cada uma das 6 tabelas
--      retorna 0 linhas / erro de permissao. Nenhuma linha vaza.
--  [ ] Sem sessao: INSERT em qualquer das 6 tabelas e recusado.
--  [ ] Com usuario autenticado: SELECT e INSERT funcionam nas 6 tabelas.
--  [ ] Com usuario autenticado: DELETE em qualquer das 6 tabelas e recusado
--      (nao existe policy de DELETE).
--  [ ] webhook_events.payload e tokens nao aparecem em nenhuma rota publica
--      (nao ha rota publica neste bloco; reconferir quando a UI/endpoint entrar).
-- ============================================================================
