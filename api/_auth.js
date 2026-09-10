// Autenticacao e acesso a dados via PostgREST usando o TOKEN DO PROPRIO CHAMADOR.
// Nunca usa service_role. Segredos so em env vars.

export const PAPEIS_PERMITIDOS = ['master', 'admin', 'vendedor']

export function supaEnv() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  return { url, anon }
}

export function getBearer(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
}

// Valida o access token no Supabase Auth. Retorna { id, email, ... } ou null.
export async function authUser(token) {
  if (!token) return null
  const { url, anon } = supaEnv()
  if (!url || !anon) return null
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

// Le usuarios.permissao pelo email (nunca confia no papel enviado pelo frontend).
export async function papelDoUsuario(token, email) {
  const { url, anon } = supaEnv()
  try {
    const q = `${url}/rest/v1/usuarios?select=permissao&email=eq.${encodeURIComponent((email || '').toLowerCase())}&limit=1`
    const r = await fetch(q, { headers: { apikey: anon, Authorization: `Bearer ${token}` } })
    if (!r.ok) return null
    const rows = await r.json()
    return rows?.[0]?.permissao || null
  } catch {
    return null
  }
}

// Cliente PostgREST minimo escopado ao token do chamador (RLS aplica normalmente).
export function rest(token) {
  const { url, anon } = supaEnv()
  const base = `${url}/rest/v1`
  const headers = { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  return {
    async select(pathAndQuery) {
      const r = await fetch(`${base}/${pathAndQuery}`, { headers })
      if (!r.ok) throw Object.assign(new Error(`select ${r.status}`), { httpStatus: r.status })
      return r.json()
    },
    async insertOne(table, body) {
      const r = await fetch(`${base}/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw Object.assign(new Error(`insert ${table} ${r.status}`), { httpStatus: r.status })
      const rows = await r.json()
      return rows[0]
    },
    async patch(table, filterQuery, body) {
      const r = await fetch(`${base}/${table}?${filterQuery}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw Object.assign(new Error(`patch ${table} ${r.status}`), { httpStatus: r.status })
    },
  }
}

// Auditoria — mesmo shape do logAudit() do index.html.
export async function logAudit(token, { usuario, acao, tabela, id_registro, detalhes }) {
  try {
    await rest(token).insertOne('audit_log', {
      usuario: usuario || 'unknown',
      acao,
      tabela,
      id_registro: id_registro || null,
      detalhes: detalhes || null,
      created_at: new Date().toISOString(),
    })
  } catch {
    /* auditoria nunca quebra o fluxo */
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v)
}
