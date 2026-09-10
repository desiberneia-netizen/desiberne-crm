// POST /api/analise-iniciar  { proposal_id }
// Motor de analise digital V1. Executa o pipeline controlado dentro da funcao.
// Sem waitUntil, sem fila. Se exceder o limite do ambiente, a linha fica em
// 'running' e o frontend trata via timeout de polling.

import { getBearer, authUser, papelDoUsuario, rest, logAudit, isUuid, PAPEIS_PERMITIDOS } from './_auth.js'
import { runResearch } from './_research.js'
import { interpretar, validarContraEvidencias } from './_ai.js'
import { AGENT_VERSION, PROMPT_VERSION, AI_MODEL } from './_prompts.js'

export const config = { maxDuration: 60 }

function mensagemSegura(err) {
  // nunca vaza key/token; mensagem generica por estagio
  const stage = err?.stage || 'pipeline'
  const map = {
    google_places: 'Falha ao consultar o serviço de mapas.',
    brave: 'Falha ao consultar o serviço de busca.',
    site_fetch: 'Falha ao acessar o site da empresa.',
    openai: 'Falha ao interpretar as informações coletadas.',
    ai_parse: 'A interpretação retornou um formato inválido.',
    persist: 'Falha ao gravar o resultado da análise.',
    pipeline: 'Falha ao executar a análise.',
  }
  return { stage, message: map[stage] || map.pipeline }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // --- auth ---
  const token = getBearer(req)
  const user = await authUser(token)
  if (!user) {
    res.status(401).json({ error: 'Não autenticado' })
    return
  }
  const papel = await papelDoUsuario(token, user.email)
  if (!PAPEIS_PERMITIDOS.includes(papel)) {
    res.status(403).json({ error: 'Seu perfil não pode executar análises' })
    return
  }

  // --- input ---
  const proposalId = req.body?.proposal_id
  if (!isUuid(proposalId)) {
    res.status(400).json({ error: 'proposal_id inválido' })
    return
  }

  const db = rest(token)

  // --- proposta -> lead (deriva do banco, nunca confia em lead_id do frontend) ---
  let proposal
  try {
    const rows = await db.select(`proposals?select=id,lead_id&id=eq.${proposalId}&limit=1`)
    proposal = rows?.[0]
  } catch {
    res.status(502).json({ error: 'Falha ao consultar a proposta' })
    return
  }
  if (!proposal) {
    res.status(404).json({ error: 'Proposta não encontrada' })
    return
  }
  if (!proposal.lead_id) {
    res.status(422).json({ error: 'Proposta sem lead associado' })
    return
  }

  let lead
  try {
    const rows = await db.select(
      `leads?select=id,razao_social,cnpj,cidade,logradouro,bairro,cep,celular,email,segmento,vertical&id=eq.${proposal.lead_id}&limit=1`,
    )
    lead = rows?.[0]
  } catch {
    res.status(502).json({ error: 'Falha ao consultar o lead' })
    return
  }
  if (!lead) {
    res.status(404).json({ error: 'Lead não encontrado' })
    return
  }
  lead.telefone = lead.celular || null

  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY não configurada no servidor' })
    return
  }
  const braveKey = process.env.BRAVE_API_KEY || null
  const mapsKey = process.env.GOOGLE_MAPS_KEY || null

  // --- cria a linha da analise (pending -> running) ---
  const startedAt = new Date().toISOString()
  const startMs = Date.now()
  let analysis
  try {
    analysis = await db.insertOne('digital_analyses', {
      proposal_id: proposalId,
      lead_id: lead.id,
      analysis_status: 'pending',
      ai_model: AI_MODEL,
      ai_prompt_version: PROMPT_VERSION,
      metadata: { agent_version: AGENT_VERSION, prompt_version: PROMPT_VERSION, started_at: startedAt },
    })
  } catch (e) {
    res.status(502).json({ error: 'Falha ao criar a análise' })
    return
  }
  const analysisId = analysis.id
  await logAudit(token, {
    usuario: user.email,
    acao: 'analise_iniciada',
    tabela: 'digital_analyses',
    id_registro: analysisId,
    detalhes: `proposta ${proposalId}`,
  })

  try {
    await db.patch('digital_analyses', `id=eq.${analysisId}`, { analysis_status: 'running' })
  } catch {
    /* segue mesmo assim */
  }

  // --- pipeline ---
  try {
    const research = await runResearch(lead, { braveKey, mapsKey })
    const { identity, placesCandidates, siteSignals, sources, evidence, meta } = research

    const companyPresence = {
      company_identity: {
        razao_social: identity.razao_social,
        cnpj: identity.cnpj,
        cidade: identity.cidade,
        telefone: identity.telefone,
        segmento: identity.segmento,
        place_id: identity.place_id,
        site_url: identity.site_url,
        id_confidence: identity.id_confidence,
        status: identity.status,
      },
      places_candidates: (placesCandidates || []).map((c) => ({
        name: c.name,
        address: c.address,
        phone: c.phone,
        website: c.website,
        rating: c.rating,
        review_count: c.review_count,
        match_level: c.level,
      })),
    }

    const finishedAtBase = () => new Date().toISOString()

    // identidade ambigua ou nao confirmada -> under_review, sem IA
    if (identity.status === 'ambiguous' || identity.status === 'unconfirmed') {
      await db.patch('digital_analyses', `id=eq.${analysisId}`, {
        analysis_status: 'under_review',
        company_presence: companyPresence,
        website_presence: siteSignals ? { exists: !!siteSignals.exists } : {},
        google_presence: {},
        social_presence: {},
        reputation: {},
        competitors: [],
        market_context: {},
        market_research: [],
        opportunities: [],
        recommendations: '',
        sources,
        confidence_score: null,
        metadata: {
          agent_version: AGENT_VERSION,
          prompt_version: PROMPT_VERSION,
          started_at: startedAt,
          finished_at: finishedAtBase(),
          duration_ms: Date.now() - startMs,
          queries_run: meta.queries_run,
          pages_fetched: meta.pages_fetched,
          sources_count: meta.sources_count,
          evidence_count: meta.evidence_count,
          warnings: meta.warnings,
          reason: `identity_${identity.status}`,
        },
      })
      await logAudit(token, {
        usuario: user.email,
        acao: 'analise_under_review',
        tabela: 'digital_analyses',
        id_registro: analysisId,
        detalhes: `identidade ${identity.status}`,
      })
      res.status(200).json({ analysis_id: analysisId, status: 'under_review' })
      return
    }

    // --- IA: so interpreta ---
    let ai
    try {
      ai = await interpretar({ apiKey: openaiKey, identity, placesCandidates, siteSignals, sources, evidence })
    } catch (e) {
      e.stage = e.stage || 'openai'
      throw e
    }
    const v = validarContraEvidencias(ai.json, evidence, sources)

    const websitePresence = { ...v.website_presence }
    if (siteSignals) websitePresence.signals = siteSignals

    await db.patch('digital_analyses', `id=eq.${analysisId}`, {
      analysis_status: 'completed',
      company_presence: companyPresence,
      google_presence: v.google_presence,
      website_presence: websitePresence,
      social_presence: {},
      reputation: v.reputation,
      competitors: [],
      market_context: {},
      market_research: [],
      opportunities: v.opportunities,
      recommendations: v.recommendations,
      sources,
      confidence_score: v.confidence_score,
      metadata: {
        agent_version: AGENT_VERSION,
        prompt_version: PROMPT_VERSION,
        started_at: startedAt,
        finished_at: finishedAtBase(),
        duration_ms: Date.now() - startMs,
        queries_run: meta.queries_run,
        pages_fetched: meta.pages_fetched,
        sources_count: meta.sources_count,
        evidence_count: meta.evidence_count,
        tokens_in: ai.usage.tokens_in,
        tokens_out: ai.usage.tokens_out,
        warnings: [...new Set([...(meta.warnings || []), ...v.warnings])],
      },
    })

    await logAudit(token, {
      usuario: user.email,
      acao: 'analise_concluida',
      tabela: 'digital_analyses',
      id_registro: analysisId,
      detalhes: `oportunidades: ${v.opportunities.length}`,
    })
    res.status(200).json({ analysis_id: analysisId, status: 'completed' })
  } catch (err) {
    const safe = mensagemSegura(err)
    try {
      await db.patch('digital_analyses', `id=eq.${analysisId}`, {
        analysis_status: 'error',
        metadata: {
          agent_version: AGENT_VERSION,
          prompt_version: PROMPT_VERSION,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startMs,
          error: safe,
        },
      })
    } catch {
      /* nada a fazer */
    }
    await logAudit(token, {
      usuario: user.email,
      acao: 'analise_erro',
      tabela: 'digital_analyses',
      id_registro: analysisId,
      detalhes: safe.stage,
    })
    res.status(200).json({ analysis_id: analysisId, status: 'error', error: safe })
  }
}
