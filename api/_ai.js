// Camada de IA — SO interpreta evidencias. Nao pesquisa, nao cria evidencia.
import { SYSTEM_PROMPT, buildUserPayload, AI_MODEL } from './_prompts.js'

export async function interpretar({ apiKey, identity, placesCandidates, siteSignals, sources, evidence }) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.2,
      max_tokens: 1600,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPayload({ identity, placesCandidates, siteSignals, sources, evidence }) },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  })

  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const err = new Error(data?.error?.message || `OpenAI ${resp.status}`)
    err.stage = 'openai'
    throw err
  }

  let parsed
  try {
    parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}')
  } catch {
    const err = new Error('Resposta da IA não é JSON válido')
    err.stage = 'ai_parse'
    throw err
  }

  return {
    json: parsed,
    usage: {
      tokens_in: data.usage?.prompt_tokens ?? null,
      tokens_out: data.usage?.completion_tokens ?? null,
    },
  }
}

// Validacao anti-alucinacao. Remove/invalida referencias que nao existem.
export function validarContraEvidencias(ai, evidence, sources) {
  const evIds = new Set((evidence || []).map((e) => e.id))
  const srcUrls = new Set((sources || []).map((s) => s.url).filter(Boolean))
  const warnings = []

  const limparEvidenceRefs = (arr) => {
    if (!Array.isArray(arr)) return []
    const kept = arr.filter((id) => evIds.has(id))
    if (kept.length !== arr.length) warnings.push('evidence_ref_invalida_removida')
    return kept
  }

  const secao = (obj) => {
    if (!obj || typeof obj !== 'object') return { summary: '', interpretation: '', evidence: [], supported: false }
    const evs = limparEvidenceRefs(obj.evidence)
    return {
      summary: typeof obj.summary === 'string' ? obj.summary : '',
      interpretation: typeof obj.interpretation === 'string' ? obj.interpretation : '',
      evidence: evs,
      supported: evs.length > 0,
    }
  }

  // qualquer URL http(s) escrita em campo de texto que nao esteja nas fontes -> aviso
  const scanUrls = (s) => {
    if (typeof s !== 'string') return
    const found = s.match(/https?:\/\/[^\s)"']+/g) || []
    for (const u of found) if (!srcUrls.has(u)) warnings.push('url_fora_das_fontes')
  }

  const website_presence = secao(ai.website_presence)
  const google_presence = secao(ai.google_presence)
  const reputation = secao(ai.reputation)
  ;[website_presence, google_presence, reputation].forEach((x) => {
    scanUrls(x.summary)
    scanUrls(x.interpretation)
  })

  let opportunities = Array.isArray(ai.opportunities) ? ai.opportunities : []
  opportunities = opportunities
    .map((o) => {
      const evs = limparEvidenceRefs(o?.evidence)
      scanUrls(o?.finding)
      scanUrls(o?.opportunity)
      let conf = Number(o?.confidence)
      if (!Number.isFinite(conf)) conf = 0
      conf = Math.max(0, Math.min(100, Math.round(conf)))
      return {
        finding: typeof o?.finding === 'string' ? o.finding : '',
        impact: typeof o?.impact === 'string' ? o.impact : '',
        opportunity: typeof o?.opportunity === 'string' ? o.opportunity : '',
        evidence: evs,
        confidence: conf,
        supported: evs.length > 0,
      }
    })
    // oportunidade sem NENHUMA evidencia valida e descartada (regra 4)
    .filter((o) => {
      if (!o.supported) {
        warnings.push('oportunidade_sem_evidencia_removida')
        return false
      }
      return o.finding || o.opportunity
    })

  let confidence_score = Number(ai.confidence_score)
  if (!Number.isFinite(confidence_score)) confidence_score = 0
  confidence_score = Math.max(0, Math.min(100, Math.round(confidence_score)))

  const recommendations = typeof ai.recommendations === 'string' ? ai.recommendations : ''
  scanUrls(recommendations)

  return {
    website_presence,
    google_presence,
    reputation,
    social_presence: {},
    opportunities,
    recommendations,
    confidence_score,
    warnings: [...new Set(warnings)],
  }
}
