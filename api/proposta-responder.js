// POST /api/proposta-responder   { token, action: "decline" | "changes", note? }
// Resposta pública do cliente à proposta: recusar ou pedir ajustes.
// Não altera proposal.status. Grava client_response* + auditoria.
// service_role só server-side. no-store. Sem dados internos na resposta.

export const config = { maxDuration: 15 }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function noStore(res, code, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(code).json(body)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const body = req.body || {}
  const token = (body.token || '').toString().trim()
  const action = body.action
  const note = (body.note || '').toString().trim().slice(0, 2000) || null

  if (!UUID_RE.test(token)) { noStore(res, 404, { state: 'not_found' }); return }
  if (action !== 'decline' && action !== 'changes') { noStore(res, 400, { state: 'invalid_action' }); return }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) { noStore(res, 500, { state: 'error' }); return }
  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }

  try {
    const pResp = await fetch(
      `${supabaseUrl}/rest/v1/proposals?select=id,proposal_number,status&public_token=eq.${token}&limit=1`,
      { headers: h },
    )
    if (!pResp.ok) { noStore(res, 502, { state: 'error' }); return }
    const p = (await pResp.json())?.[0]
    if (!p) { noStore(res, 404, { state: 'not_found' }); return }

    // só dá pra responder enquanto a proposta está publicada e não fechada
    if (!['sent', 'viewed'].includes(p.status)) { noStore(res, 200, { state: 'unavailable' }); return }

    const resposta = action === 'decline' ? 'declined' : 'changes_requested'
    const agora = new Date().toISOString()
    const up = await fetch(`${supabaseUrl}/rest/v1/proposals?public_token=eq.${token}`, {
      method: 'PATCH',
      headers: { ...h, Prefer: 'return=minimal' },
      body: JSON.stringify({ client_response: resposta, client_response_at: agora, client_response_note: note, updated_at: agora }),
    })
    if (!up.ok) { noStore(res, 502, { state: 'error' }); return }

    try {
      await fetch(`${supabaseUrl}/rest/v1/audit_log`, {
        method: 'POST',
        headers: { ...h, Prefer: 'return=minimal' },
        body: JSON.stringify({
          usuario: 'cliente (link público)',
          acao: action === 'decline' ? 'PROPOSTA_RECUSADA' : 'PROPOSTA_AJUSTE_SOLICITADO',
          tabela: 'proposals',
          id_registro: p.id,
          detalhes: `via link público${note ? ' · motivo: ' + note.slice(0, 200) : ''}`,
          created_at: agora,
        }),
      })
    } catch { /* auditoria não bloqueia */ }

    noStore(res, 200, { state: 'recorded', response: resposta })
  } catch (err) {
    noStore(res, 500, { state: 'error' })
  }
}
