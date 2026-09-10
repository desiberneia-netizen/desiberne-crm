// POST /api/gerar-texto-proposta   { proposal_id }
// Gera a narrativa comercial da proposta (headline/subheadline/contexto/oportunidade/
// solucao/proximos_passos) a partir do lead + escopo + análise aprovada.
// Autenticado (master/admin/vendedor). Chave OpenAI só no servidor.

import { getBearer, authUser, papelDoUsuario, rest, isUuid, PAPEIS_PERMITIDOS } from './_auth.js'

export const config = { maxDuration: 30 }

const SYSTEM = `Você escreve a narrativa comercial de uma proposta da Desiberne IA — produto "Site — Projeto de Presença Digital".
Tom: consultivo, executivo, direto. Português do Brasil. Sem exagero de marketing, sem inventar dado que não foi fornecido.
Posicionamento: o site é ferramenta dentro de uma estratégia de presença digital ("Tire sua empresa do modo de hibernação digital").

Devolva APENAS um JSON com estas chaves (todas string):
{
  "headline": "título curto e impactante (máx ~8 palavras)",
  "subheadline": "uma frase de reforço",
  "contexto": "2-4 frases sobre a situação digital atual da empresa (use as evidências fornecidas; se não houver, fale de forma geral sem inventar)",
  "oportunidade": "2-4 frases: por que faz sentido agir agora",
  "solucao": "3-6 frases: o que a Desiberne entrega e como resolve",
  "proximos_passos": "1-3 frases sobre aprovação -> pagamento -> onboarding -> execução"
}`

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const token = getBearer(req)
  const user = await authUser(token)
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return }
  const papel = await papelDoUsuario(token, user.email)
  if (!PAPEIS_PERMITIDOS.includes(papel)) { res.status(403).json({ error: 'Sem permissão' }); return }

  const proposalId = req.body?.proposal_id
  if (!isUuid(proposalId)) { res.status(400).json({ error: 'proposal_id inválido' }); return }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) { res.status(500).json({ error: 'OPENAI_API_KEY não configurada' }); return }

  const db = rest(token)
  let prop, lead, analise
  try {
    const rows = await db.select(`proposals?select=id,client_name,product_code,lead_id,scope,commercial_content&id=eq.${proposalId}&limit=1`)
    prop = rows?.[0]
  } catch { res.status(502).json({ error: 'Falha ao ler a proposta' }); return }
  if (!prop) { res.status(404).json({ error: 'Proposta não encontrada' }); return }

  try {
    if (prop.lead_id) {
      const lr = await db.select(`leads?select=razao_social,segmento,cidade,gestor,observacoes,vertical&id=eq.${prop.lead_id}&limit=1`)
      lead = lr?.[0] || {}
    } else lead = {}
  } catch { lead = {} }

  try {
    const ar = await db.select(
      `digital_analyses?select=opportunities,recommendations&proposal_id=eq.${proposalId}&analysis_status=eq.approved&order=approved_at.desc&limit=1`,
    )
    analise = ar?.[0] || null
  } catch { analise = null }

  const escopo = prop.scope || {}
  const ops = analise && Array.isArray(analise.opportunities) ? analise.opportunities : []
  const contexto = {
    empresa: prop.client_name || lead.razao_social || '',
    segmento: lead.segmento || lead.vertical || '',
    cidade: lead.cidade || '',
    observacoes_lead: lead.observacoes || '',
    escopo_descricao: escopo.descricao || '',
    escopo_entregaveis: escopo.entregaveis || '',
    analise_oportunidades: ops.map((o) => ({ achado: o.finding || '', impacto: o.impact || '', oportunidade: o.opportunity || '' })),
    analise_recomendacao: analise?.recommendations || '',
  }

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.5,
        max_tokens: 900,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: 'Dados da proposta:\n' + JSON.stringify(contexto, null, 2) },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) { res.status(r.status).json({ error: data?.error?.message || 'Erro na OpenAI' }); return }
    let parsed
    try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}') } catch { res.status(502).json({ error: 'Resposta da IA inválida' }); return }
    const s = (k) => (typeof parsed[k] === 'string' ? parsed[k].trim() : '')
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      texto: {
        headline: s('headline'),
        subheadline: s('subheadline'),
        contexto: s('contexto'),
        oportunidade: s('oportunidade'),
        solucao: s('solucao'),
        proximos_passos: s('proximos_passos'),
      },
    })
  } catch (err) {
    res.status(500).json({ error: 'Falha ao gerar o texto' })
  }
}
