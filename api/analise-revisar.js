// POST /api/analise-revisar  { analysis_id, action: "approve" | "reject", review_notes? }
// Governanca humana da analise digital (BLOCO 03C).
// "completed" NAO e "approved". Aprovacao/rejeicao so por acao humana autenticada.

import { getBearer, authUser, papelDoUsuario, rest, logAudit, isUuid, PAPEIS_PERMITIDOS } from './_auth.js'

export const config = { maxDuration: 15 }

// De quais status uma acao de revisao pode partir.
const ORIGEM_VALIDA = new Set(['completed', 'under_review'])

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
    res.status(403).json({ error: 'Seu perfil não pode revisar análises' })
    return
  }

  // --- input ---
  const analysisId = req.body?.analysis_id
  const action = req.body?.action
  const reviewNotes = (req.body?.review_notes || '').toString().trim()

  if (!isUuid(analysisId)) {
    res.status(400).json({ error: 'analysis_id inválido' })
    return
  }
  if (action !== 'approve' && action !== 'reject') {
    res.status(400).json({ error: 'action deve ser "approve" ou "reject"' })
    return
  }
  if (action === 'reject' && !reviewNotes) {
    res.status(400).json({ error: 'Informe o motivo da rejeição' })
    return
  }

  const db = rest(token)

  // --- carrega a analise pelo token do proprio usuario (RLS aplica) ---
  let analise
  try {
    const rows = await db.select(
      `digital_analyses?select=id,analysis_status,proposal_id&id=eq.${analysisId}&limit=1`,
    )
    analise = rows?.[0]
  } catch {
    res.status(502).json({ error: 'Falha ao consultar a análise' })
    return
  }
  if (!analise) {
    res.status(404).json({ error: 'Análise não encontrada' })
    return
  }

  // --- transicao valida? ---
  if (!ORIGEM_VALIDA.has(analise.analysis_status)) {
    res.status(400).json({
      error: `Transição inválida: não é possível revisar uma análise com status "${analise.analysis_status}"`,
    })
    return
  }

  // --- aplica ---
  const agora = new Date().toISOString()
  const patch = { reviewed_by: user.id, reviewed_at: agora }
  if (reviewNotes) patch.review_notes = reviewNotes
  if (action === 'approve') {
    patch.analysis_status = 'approved'
    patch.approved_at = agora
  } else {
    patch.analysis_status = 'rejected'
  }

  try {
    await db.patch('digital_analyses', `id=eq.${analysisId}`, patch)
  } catch {
    res.status(502).json({ error: 'Falha ao gravar a revisão' })
    return
  }

  await logAudit(token, {
    usuario: user.email,
    acao: action === 'approve' ? 'ANALISE_APROVADA' : 'ANALISE_REJEITADA',
    tabela: 'digital_analyses',
    id_registro: analysisId,
    detalhes:
      `proposta ${analise.proposal_id} · de "${analise.analysis_status}"` +
      (reviewNotes ? ` · nota: ${reviewNotes.slice(0, 200)}` : ''),
  })

  res.status(200).json({ analysis_id: analysisId, status: action === 'approve' ? 'approved' : 'rejected' })
}
