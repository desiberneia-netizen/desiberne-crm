// GET /api/analise-status?analysis_id=<uuid>
// Retorna o estado atual da analise. Leitura escopada pelo token do chamador (RLS).

import { getBearer, authUser, rest, isUuid } from './_auth.js'

export const config = { maxDuration: 15 }

const CAMPOS = [
  'id',
  'proposal_id',
  'lead_id',
  'analysis_status',
  'company_presence',
  'website_presence',
  'google_presence',
  'social_presence',
  'reputation',
  'competitors',
  'market_context',
  'market_research',
  'opportunities',
  'recommendations',
  'sources',
  'confidence_score',
  'ai_model',
  'ai_prompt_version',
  'metadata',
  'created_at',
  'updated_at',
].join(',')

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const token = getBearer(req)
  const user = await authUser(token)
  if (!user) {
    res.status(401).json({ error: 'Não autenticado' })
    return
  }

  const analysisId = req.query?.analysis_id
  if (!isUuid(analysisId)) {
    res.status(400).json({ error: 'analysis_id inválido' })
    return
  }

  try {
    const rows = await rest(token).select(`digital_analyses?select=${CAMPOS}&id=eq.${analysisId}&limit=1`)
    const a = rows?.[0]
    if (!a) {
      res.status(404).json({ error: 'Análise não encontrada' })
      return
    }
    res.status(200).json(a)
  } catch {
    res.status(502).json({ error: 'Falha ao consultar a análise' })
  }
}
