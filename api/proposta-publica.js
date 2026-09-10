// GET /api/proposta-publica?token=<public_token>
// Leitura PÚBLICA de uma proposta comercial. Sem Supabase Auth do CRM.
// Usa service_role SOMENTE no servidor e devolve APENAS campos destinados ao cliente
// (whitelist a partir de proposal_versions.content_snapshot). Nunca expõe:
//   negotiation_context, audit_log, secrets, IDs internos, metadata de análise,
//   dados internos de usuarios/lead.

export const config = { maxDuration: 15 }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUS_PUBLICAVEL = new Set(['sent', 'viewed', 'approved', 'paid'])

function jsonNoStore(res, code, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(code).json(body)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const token = (req.query?.token || '').toString().trim()
  // token inválido = mesma resposta de "não encontrada" (não revela existência)
  if (!UUID_RE.test(token)) {
    jsonNoStore(res, 404, { state: 'not_found' })
    return
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    jsonNoStore(res, 500, { state: 'error', message: 'Serviço indisponível.' })
    return
  }
  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

  try {
    // 1) proposta pelo public_token — só as colunas que precisamos
    const pResp = await fetch(
      `${supabaseUrl}/rest/v1/proposals?select=id,proposal_number,client_name,product_code,status,valid_until,created_at,responsavel_id&public_token=eq.${token}&limit=1`,
      { headers: h },
    )
    if (!pResp.ok) {
      jsonNoStore(res, 502, { state: 'error', message: 'Serviço indisponível.' })
      return
    }
    const proposals = await pResp.json()
    const p = proposals?.[0]
    if (!p) {
      jsonNoStore(res, 404, { state: 'not_found' })
      return
    }

    // 2) status não publicável -> indisponível (nada de conteúdo parcial)
    if (!STATUS_PUBLICAVEL.has(p.status) && p.status !== 'expired') {
      jsonNoStore(res, 200, { state: 'unavailable' })
      return
    }

    // 3) versão comercial consolidada mais recente
    const vResp = await fetch(
      `${supabaseUrl}/rest/v1/proposal_versions?select=version_number,content_snapshot,created_at&proposal_id=eq.${p.id}&order=version_number.desc&limit=1`,
      { headers: h },
    )
    if (!vResp.ok) {
      jsonNoStore(res, 502, { state: 'error', message: 'Serviço indisponível.' })
      return
    }
    const versoes = await vResp.json()
    const v = versoes?.[0]
    if (!v || !v.content_snapshot) {
      jsonNoStore(res, 200, { state: 'unavailable' })
      return
    }

    const snap = v.content_snapshot || {}
    const nar = snap.narrativa || {}
    const esc = snap.escopo || {}
    const inv = snap.investimento || {}
    const cond = snap.condicoes || {}

    // 4) responsável comercial — só o nome, se resolver
    let responsavelNome = null
    const respId = snap.responsavel_id || p.responsavel_id
    if (respId && UUID_RE.test(respId)) {
      try {
        const uResp = await fetch(
          `${supabaseUrl}/rest/v1/usuarios?select=nome&auth_id=eq.${respId}&limit=1`,
          { headers: h },
        )
        if (uResp.ok) {
          const us = await uResp.json()
          responsavelNome = us?.[0]?.nome || null
        }
      } catch { /* opcional */ }
    }

    // 5) análise aprovada CONGELADA no snapshot — só insights comerciais
    let analise = null
    if (snap.analise_aprovada && Array.isArray(snap.analise_aprovada.opportunities)) {
      analise = {
        oportunidades: snap.analise_aprovada.opportunities
          .map((o) => ({
            achado: o.finding || '',
            impacto: o.impact || '',
            oportunidade: o.opportunity || '',
          }))
          .filter((o) => o.achado || o.oportunidade),
        recomendacao: snap.analise_aprovada.recommendations || null,
      }
      if (!analise.oportunidades.length && !analise.recomendacao) analise = null
    }

    // 6) expiração
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const validade = p.valid_until || cond.valid_until || null
    const expirada =
      p.status === 'expired' || (validade && new Date(validade + 'T00:00:00') < hoje)

    const payload = {
      state: expirada ? 'expired' : 'ok',
      proposal: {
        proposal_number: p.proposal_number || null,
        client_name: snap.client_name || p.client_name || null,
        product_name: snap.product_name || null,
        version: v.version_number,
        data: v.created_at || snap.generated_at || p.created_at || null,
        valid_until: validade,
      },
      content: {
        narrativa: {
          headline: nar.headline || '',
          subheadline: nar.subheadline || '',
          contexto: nar.contexto || '',
          oportunidade: nar.oportunidade || '',
          solucao: nar.solucao || '',
          proximos_passos: nar.proximos_passos || '',
        },
        escopo: {
          descricao: esc.descricao || '',
          entregaveis: esc.entregaveis || '',
          limites: esc.limites || '',
        },
        investimento: {
          implementation_value: inv.implementation_value ?? null,
          recurring_value: inv.recurring_value ?? null,
          recurring_period: inv.recurring_period || 'mensal',
        },
        condicoes: {
          delivery_term: cond.delivery_term || '',
          payment_method: cond.payment_method || '',
          commercial_notes: cond.commercial_notes || '',
        },
        analise_aprovada: analise,
        responsavel: responsavelNome,
      },
    }

    jsonNoStore(res, 200, payload)
  } catch (err) {
    jsonNoStore(res, 500, { state: 'error', message: 'Serviço indisponível.' })
  }
}
