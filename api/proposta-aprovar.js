// POST /api/proposta-aprovar   { token: <public_token>, confirmation: true }
// Aprovação REAL da proposta pelo cliente, via link público. Sem Supabase Auth do CRM.
// Idempotente, atômica (UPDATE ... WHERE status='sent'), auditável.
// APROVAÇÃO ≠ PAGAMENTO: aqui só sent -> approved. Nada de payment/onboarding.

export const config = { maxDuration: 15 }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function noStore(res, code, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(code).json(body)
}

function clientIp(req) {
  const xff = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim()
  return xff || (req.headers['x-real-ip'] || '').toString().trim() || null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = req.body || {}
  const token = (body.token || '').toString().trim()
  const confirmation = body.confirmation === true

  if (!UUID_RE.test(token)) {
    noStore(res, 404, { state: 'not_found' })
    return
  }
  if (!confirmation) {
    noStore(res, 200, { state: 'confirmation_required' })
    return
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    noStore(res, 500, { state: 'error' })
    return
  }
  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }

  try {
    // 1) proposta pelo public_token — só o que precisamos
    const pResp = await fetch(
      `${supabaseUrl}/rest/v1/proposals?select=id,proposal_number,status,valid_until,approved_at,approved_version_number,payment_link&public_token=eq.${token}&limit=1`,
      { headers: h },
    )
    if (!pResp.ok) { noStore(res, 502, { state: 'error' }); return }
    const rows = await pResp.json()
    const p = rows?.[0]
    if (!p) { noStore(res, 404, { state: 'not_found' }); return }

    // 2) já aprovada (ou paga) -> idempotente, não cria segunda aprovação
    if (p.status === 'approved' || p.status === 'paid') {
      noStore(res, 200, {
        state: 'already_approved',
        proposal: {
          proposal_number: p.proposal_number || null,
          version: p.approved_version_number ?? null,
          approved_at: p.approved_at || null,
        },
        payment: {
          state: p.status === 'paid' ? 'paid' : 'pending',
          link: (p.status === 'approved' && p.payment_link) ? p.payment_link : null,
        },
      })
      return
    }

    // 3) não publicável
    if (p.status === 'draft' || p.status === 'generated' || p.status === 'cancelled') {
      noStore(res, 200, { state: 'unavailable' })
      return
    }

    // 4) expiração (status ou data)
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
    if (p.status === 'expired' || (p.valid_until && new Date(p.valid_until + 'T00:00:00') < hoje)) {
      noStore(res, 200, { state: 'expired' })
      return
    }

    // 5) precisa de versão consolidada — e é ELA que fica aprovada
    const vResp = await fetch(
      `${supabaseUrl}/rest/v1/proposal_versions?select=version_number&proposal_id=eq.${p.id}&order=version_number.desc&limit=1`,
      { headers: h },
    )
    if (!vResp.ok) { noStore(res, 502, { state: 'error' }); return }
    const versoes = await vResp.json()
    const versao = versoes?.[0]?.version_number
    if (versao == null) { noStore(res, 200, { state: 'unavailable' }); return }

    // 6) UPDATE ATÔMICO — só aprova se ainda estiver 'sent'. Duas abas: só uma pega a linha.
    const approvedAt = new Date().toISOString()
    const patch = {
      status: 'approved',
      approved_at: approvedAt,
      approved_version_number: versao,
      approved_ip: clientIp(req),
      approval_metadata: {
        user_agent: (req.headers['user-agent'] || '').toString().slice(0, 300) || null,
        approved_via: 'public_link',
      },
      updated_at: approvedAt,
    }
    const upResp = await fetch(
      `${supabaseUrl}/rest/v1/proposals?public_token=eq.${token}&status=eq.sent`,
      { method: 'PATCH', headers: { ...h, Prefer: 'return=representation' }, body: JSON.stringify(patch) },
    )
    if (!upResp.ok) { noStore(res, 502, { state: 'error' }); return }
    const updated = await upResp.json()

    if (!Array.isArray(updated) || updated.length === 0) {
      // corrida perdida: outra requisição já mudou o status. Reclassifica.
      const reResp = await fetch(
        `${supabaseUrl}/rest/v1/proposals?select=status,proposal_number,approved_at,approved_version_number&public_token=eq.${token}&limit=1`,
        { headers: h },
      )
      const re = reResp.ok ? (await reResp.json())?.[0] : null
      if (re && (re.status === 'approved' || re.status === 'paid')) {
        noStore(res, 200, {
          state: 'already_approved',
          proposal: {
            proposal_number: re.proposal_number || null,
            version: re.approved_version_number ?? null,
            approved_at: re.approved_at || null,
          },
        })
        return
      }
      noStore(res, 200, { state: 'unavailable' })
      return
    }

    // 7) auditoria — sem token completo, sem secrets
    try {
      await fetch(`${supabaseUrl}/rest/v1/audit_log`, {
        method: 'POST',
        headers: { ...h, Prefer: 'return=minimal' },
        body: JSON.stringify({
          usuario: 'cliente (link público)',
          acao: 'PROPOSTA_APROVADA_PELO_CLIENTE',
          tabela: 'proposals',
          id_registro: p.id,
          detalhes: `versão ${versao} aprovada via link público`,
          created_at: approvedAt,
        }),
      })
    } catch { /* auditoria não bloqueia o resultado */ }

    noStore(res, 200, {
      state: 'approved',
      proposal: {
        proposal_number: updated[0].proposal_number || p.proposal_number || null,
        version: versao,
        approved_at: approvedAt,
      },
      payment: { state: 'pending', link: p.payment_link || null },
    })
  } catch (err) {
    noStore(res, 500, { state: 'error' })
  }
}
