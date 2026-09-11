// POST /api/prospeccao-material   { lead_id }
// Gera o PROMPT DE IMAGEM (texto) do "Material de Prospecção" — não gera a imagem em si.
// Usa a análise digital APROVADA mais recente do lead + dados já existentes do lead.
// Nunca inventa dado ausente. Autenticado (master/admin/vendedor). Chave OpenAI só no servidor.

import { getBearer, authUser, papelDoUsuario, rest, logAudit, isUuid, PAPEIS_PERMITIDOS } from './_auth.js'

export const config = { maxDuration: 30 }

// ----------------------------------------------------------------------------
// 4 travas anti-invenção (aprovadas no plano) — vão literalmente no system prompt.
// ----------------------------------------------------------------------------
const TRAVAS = [
  'Nunca invente dados.',
  'Use somente as evidências fornecidas.',
  'Não transforme ausência de informação em informação negativa.',
  'Não faça afirmações quantitativas sem evidência.',
]

const SYSTEM = `Você monta o CONTEÚDO de um material comercial de prospecção da Desiberne IA — um "raio-x da presença digital" de UMA empresa específica, que depois vira uma imagem pra WhatsApp.

Você NÃO pesquisa nada. Você recebe evidência (Análise Digital já aprovada) e dados de cadastro do lead. Você organiza e escreve o texto final de cada bloco.

REGRAS INEGOCIÁVEIS (nunca quebre nenhuma):
${TRAVAS.map((t, i) => `${i + 1}. ${t}`).join('\n')}
5. Não cite dados que não estejam no contexto fornecido.
6. Se uma seção não tiver evidência (ex.: redes sociais sem análise), diga isso com neutralidade — nunca declare "ruim" ou "fraco" por falta de dado. Ausência de dado é diferente de dado negativo.
7. Separe mentalmente evidência (o que foi observado) / interpretação (o que a análise concluiu) / oportunidade (o que pode ser oferecido comercialmente) — mas escreva de forma direta e curta, sem esses rótulos no texto.

TOM: consultivo, objetivo, comercial, respeitoso. NUNCA alarmista ("você está perdendo clientes", "invisível", "urgente"). A mensagem é "existe uma oportunidade concreta", nunca medo artificial.

TAMANHO: textos CURTOS — o destino é uma imagem de WhatsApp. Cada "text" de status deve ter no máximo ~14 palavras. Cada descrição de oportunidade no máximo ~20 palavras. Headline no máximo 10 palavras.

Escolha as 3 oportunidades comerciais MAIS relevantes para ESTE lead especificamente, a partir das oportunidades da análise. Não repita um padrão fixo — cada lead tem oportunidades diferentes conforme os dados reais dele.

Responda APENAS um JSON válido, exatamente neste formato (todos os campos string, exceto "opportunities" que é array de exatamente 3 itens — ou menos, se não houver 3 oportunidades sustentadas por evidência):
{
  "company_name": "",
  "headline": "",
  "google": { "status": "", "text": "" },
  "reputation": { "status": "", "text": "" },
  "social": { "status": "", "text": "" },
  "website": { "status": "", "text": "" },
  "opportunities": [ { "title": "", "description": "" } ],
  "closing_message": ""
}
"status" de cada bloco é um rótulo curto (2-4 palavras) tipo "Boa presença", "Não possui", "Ativa", "Sem evidência nesta análise", "Ponto forte". "text" é a frase curta de apoio.`

// ----------------------------------------------------------------------------
// Template visual fixo da Desiberne — o backend monta o prompt final, não a IA.
// Mantém a estrutura sempre igual; só o conteúdo interpolado muda (item 8 do plano).
// ----------------------------------------------------------------------------
function montarPromptVisual(d, empresaFallback) {
  const nome = d.company_name || empresaFallback || 'a empresa'
  const ops = (Array.isArray(d.opportunities) ? d.opportunities : []).slice(0, 3)
  const opsTexto = ops
    .map((o, i) => `${String(i + 1).padStart(2, '0')}\n${o.title || ''}\n${o.description || ''}`)
    .join('\n\n')

  return `Crie uma imagem vertical (proporção 4:5 ou 9:16, otimizada para visualização no WhatsApp), estilo premium, corporativo, comercial, humano, sofisticado, limpo e moderno.

IDENTIDADE VISUAL DESIBERNE (obrigatória):
- Fundo escuro/navy profundo
- Elementos em branco, azul elétrico, azul profundo e roxo, com gradientes discretos
- Tipografia moderna, limpa, alto contraste
- Logo "Desiberne IA" no topo
- NÃO usar: excesso de neon, estética cyberpunk, robôs, cérebro de IA, circuitos exagerados, aparência genérica de "banner de IA", stock photo genérica, visual de apresentação corporativa antiga ou excesso de elementos futuristas

A peça deve parecer um DIAGNÓSTICO COMERCIAL profissional feito especificamente para esta empresa — não uma propaganda da Desiberne.

ESTRUTURA (manter esta ordem e hierarquia; preservar legibilidade — textos curtos, prioriza o que couber com clareza):

[TOPO] Logo Desiberne IA

[TÍTULO] RAIO-X DA PRESENÇA DIGITAL
${nome}
"Como um novo cliente encontra sua empresa hoje."

[4 BLOCOS DE DIAGNÓSTICO — lado a lado ou em grid 2x2]
GOOGLE
${d.google?.status || 'Sem evidência nesta análise'}
${d.google?.text || ''}

REPUTAÇÃO
${d.reputation?.status || 'Sem evidência nesta análise'}
${d.reputation?.text || ''}

REDES SOCIAIS
${d.social?.status || 'Sem evidência nesta análise'}
${d.social?.text || ''}

SITE PRÓPRIO
${d.website?.status || 'Sem evidência nesta análise'}
${d.website?.text || ''}

[SEÇÃO] OPORTUNIDADES IDENTIFICADAS

${opsTexto || 'Nenhuma oportunidade sustentada por evidência suficiente nesta análise.'}

[FECHAMENTO]
"Uma empresa forte merece uma presença digital à altura."

DESIBERNE IA
"Presença digital que gera oportunidades."

${d.closing_message ? `\n[Nota de contexto, não incluir literalmente na imagem — só orientar o tom]: ${d.closing_message}` : ''}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const token = getBearer(req)
  const user = await authUser(token)
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return }
  const papel = await papelDoUsuario(token, user.email)
  if (!PAPEIS_PERMITIDOS.includes(papel)) { res.status(403).json({ error: 'Seu perfil não pode gerar material comercial' }); return }

  const leadId = req.body?.lead_id
  if (!isUuid(leadId)) { res.status(400).json({ error: 'lead_id inválido' }); return }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) { res.status(500).json({ error: 'OPENAI_API_KEY não configurada' }); return }

  const db = rest(token)

  let lead
  try {
    const rows = await db.select(
      `leads?select=id,razao_social,segmento,cidade,bairro,responsavel,site_url,instagram&id=eq.${leadId}&limit=1`,
    )
    lead = rows?.[0]
  } catch { res.status(502).json({ error: 'Falha ao consultar o lead' }); return }
  if (!lead) { res.status(404).json({ error: 'Lead não encontrado' }); return }

  let analise
  try {
    const rows = await db.select(
      `digital_analyses?select=id,company_presence,website_presence,google_presence,reputation,opportunities,recommendations,approved_at&lead_id=eq.${leadId}&analysis_status=eq.approved&order=approved_at.desc&limit=1`,
    )
    analise = rows?.[0] || null
  } catch { res.status(502).json({ error: 'Falha ao consultar a análise digital' }); return }

  if (!analise) {
    res.status(422).json({ error: 'É necessário ter uma Análise Digital aprovada para gerar o material de prospecção.' })
    return
  }

  // Contexto pro modelo — só o que existe de verdade, separando evidência/interpretação/oportunidade.
  // Nunca envia negotiation_context, dados de outro lead, ou qualquer coisa fora deste escopo.
  const ci = (analise.company_presence && analise.company_presence.company_identity) || {}
  const ops = Array.isArray(analise.opportunities) ? analise.opportunities : []

  const contexto = {
    identidade: {
      nome: lead.razao_social || ci.razao_social || null,
      segmento: lead.segmento || null,
      cidade: lead.cidade || null,
      bairro: lead.bairro || null,
      responsavel: lead.responsavel || null,
    },
    site: {
      possui_site_cadastrado: !!lead.site_url,
      url_cadastrada: lead.site_url || null,
      site_localizado_na_analise: ci.site_url || null,
      evidencia_da_analise: analise.website_presence || null, // {summary, interpretation, evidence[]}
    },
    google: {
      evidencia_da_analise: analise.google_presence || null, // {summary, interpretation, evidence[]}
    },
    redes_sociais: {
      instagram_cadastrado: lead.instagram || null,
      observacao: 'Este projeto ainda não faz análise automatizada de atividade em redes sociais — não há evidência de atividade, só o dado cadastral, se existir.',
    },
    reputacao: {
      evidencia_da_analise: analise.reputation || null, // {summary, interpretation, evidence[]}
    },
    oportunidades_da_analise: ops.map((o) => ({
      achado: o.finding || '',
      impacto: o.impact || '',
      oportunidade: o.opportunity || '',
      confianca: o.confidence ?? null,
    })),
    recomendacao_da_analise: analise.recommendations || null,
  }

  let parsed
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: 'Dados do lead + análise digital aprovada:\n' + JSON.stringify(contexto, null, 2) },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) { res.status(r.status).json({ error: data?.error?.message || 'Erro na OpenAI' }); return }
    try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}') } catch { res.status(502).json({ error: 'Resposta da IA inválida' }); return }
  } catch (err) {
    res.status(500).json({ error: 'Falha ao gerar o material' })
    return
  }

  const prompt = montarPromptVisual(parsed, lead.razao_social)

  await logAudit(token, {
    usuario: user.email,
    acao: 'material_prospeccao_gerado',
    tabela: 'digital_analyses',
    id_registro: analise.id,
    detalhes: `lead ${leadId}`,
  })

  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    success: true,
    lead: { id: lead.id, name: lead.razao_social || null },
    analysis_id: analise.id,
    prompt,
  })
}
