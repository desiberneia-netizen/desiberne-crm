// POST /api/normalizar-segmento   { texto }
// Corrige/padroniza o segmento digitado a mão pra um rótulo comercial limpo.
// Autenticado (qualquer usuário logado). Chave OpenAI só no servidor.

import { getBearer, authUser } from './_auth.js'

export const config = { maxDuration: 15 }

const TAXONOMIA = [
  'Clínica / Saúde', 'Estética / Beleza', 'Salão de Beleza', 'Barbearia',
  'Odontologia', 'Fisioterapia', 'Psicologia', 'Advocacia', 'Contabilidade',
  'Arquitetura / Engenharia', 'Imobiliária', 'Construção / Reforma',
  'Alimentação / Restaurante', 'Bar / Boteco', 'Confeitaria / Doces',
  'Pet Shop / Veterinária', 'Academia / Fitness', 'Moda / Vestuário',
  'Educação / Cursos', 'Tecnologia / TI', 'Automotivo / Oficina',
  'Varejo / Loja física', 'E-commerce', 'Eventos', 'Turismo / Hotelaria',
  'Serviços Gerais', 'Outro',
]

const SYSTEM = `Você padroniza o segmento de negócio de um lead comercial brasileiro.
Receberá um texto livre (às vezes já é uma categoria do Google Maps, às vezes é digitado à mão).
Escolha o rótulo mais adequado da lista abaixo. Se realmente nenhum servir bem, proponha um rótulo
novo, curto (até 3 palavras), em português, Title Case, no mesmo estilo dos exemplos.
Nunca invente segmento sem relação com o texto recebido.

Lista de referência:
${TAXONOMIA.join(', ')}

Responda APENAS um JSON: {"segmento": "..."}`

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }

  const token = getBearer(req)
  const user = await authUser(token)
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return }

  const texto = (req.body?.texto || '').toString().trim()
  if (!texto) { res.status(400).json({ error: 'texto obrigatório' }); return }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) { res.status(500).json({ error: 'OPENAI_API_KEY não configurada' }); return }

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 60,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: texto.slice(0, 300) },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) { res.status(r.status).json({ error: data?.error?.message || 'Erro na OpenAI' }); return }
    let parsed
    try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}') } catch { res.status(502).json({ error: 'Resposta inválida' }); return }
    const segmento = (parsed.segmento || '').toString().trim()
    if (!segmento) { res.status(502).json({ error: 'Não consegui sugerir um segmento' }); return }
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ segmento })
  } catch (err) {
    res.status(500).json({ error: 'Falha ao normalizar segmento' })
  }
}
