// Camada de PESQUISA — produz evidencias. Nao interpreta (isso e da IA).
// Limites V1: <=5 queries Brave, 1 dominio principal, <=5 fetches de pagina, 0 concorrentes.

const FETCH_TIMEOUT_MS = 5000
const MAX_PAGE_BYTES = 250_000
const MAX_BRAVE_QUERIES = 5

function norm(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function digits(s) {
  return (s || '').toString().replace(/\D+/g, '')
}
function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
function tokenOverlap(a, b) {
  const ta = new Set(norm(a).split(' ').filter((t) => t.length > 2))
  const tb = new Set(norm(b).split(' ').filter((t) => t.length > 2))
  if (!ta.size || !tb.size) return 0
  let hit = 0
  for (const t of ta) if (tb.has(t)) hit++
  return hit / Math.max(ta.size, tb.size)
}

// ---------------------------------------------------------------------------
// Google Places API (New) — places:searchText
// ---------------------------------------------------------------------------
async function placesSearch(lead, mapsKey) {
  if (!mapsKey) return { ok: false, reason: 'no_key', candidates: [] }
  const razao = lead.razao_social || ''
  const cidade = lead.cidade || ''
  const textQuery = [razao, cidade].filter(Boolean).join(' ').trim()
  if (!textQuery) return { ok: false, reason: 'no_query', candidates: [] }
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': mapsKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.primaryTypeDisplayName,places.types',
      },
      body: JSON.stringify({ textQuery, regionCode: 'BR', languageCode: 'pt-BR', maxResultCount: 5 }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS + 3000),
    })
    if (!r.ok) return { ok: false, reason: `http_${r.status}`, candidates: [] }
    const data = await r.json()
    const candidates = (data.places || []).map((p) => ({
      place_id: p.id || null,
      name: p.displayName?.text || '',
      address: p.formattedAddress || '',
      phone: p.nationalPhoneNumber || p.internationalPhoneNumber || '',
      website: p.websiteUri || '',
      rating: typeof p.rating === 'number' ? p.rating : null,
      review_count: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
      category: p.primaryTypeDisplayName?.text || (p.types || [])[0] || '',
    }))
    return { ok: true, candidates }
  } catch (e) {
    return { ok: false, reason: e.name === 'TimeoutError' ? 'timeout' : 'exception', candidates: [] }
  }
}

// Pontua um candidato do Places contra os dados do Lead.
function scoreCandidate(lead, c) {
  const nameSim = tokenOverlap(lead.razao_social, c.name)
  const leadCityTokens = norm(lead.cidade).split(' ').filter(Boolean)
  const cityMatch = leadCityTokens.length > 0 && leadCityTokens.every((t) => norm(c.address).includes(t))
  const leadPhone = digits(lead.telefone || lead.celular)
  const candPhone = digits(c.phone)
  const phoneMatch = leadPhone.length >= 8 && candPhone.length >= 8 && candPhone.endsWith(leadPhone.slice(-8))
  let level = 'LOW'
  if (phoneMatch && nameSim >= 0.4) level = 'HIGH'
  else if (nameSim >= 0.6 && cityMatch) level = 'HIGH'
  else if (nameSim >= 0.4 && (cityMatch || phoneMatch)) level = 'MEDIUM'
  else if (nameSim >= 0.6) level = 'MEDIUM'
  return { nameSim, cityMatch, phoneMatch, level }
}

// ---------------------------------------------------------------------------
// Brave Search API
// ---------------------------------------------------------------------------
async function braveSearch(query, braveKey) {
  if (!braveKey) return { ok: false, reason: 'no_key', results: [] }
  try {
    const u = new URL('https://api.search.brave.com/res/v1/web/search')
    u.searchParams.set('q', query)
    u.searchParams.set('country', 'br')
    u.searchParams.set('search_lang', 'pt')
    u.searchParams.set('count', '5')
    const r = await fetch(u, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': braveKey },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS + 3000),
    })
    if (!r.ok) return { ok: false, reason: `http_${r.status}`, results: [] }
    const data = await r.json()
    const results = (data.web?.results || []).slice(0, 5).map((x) => ({
      url: x.url,
      title: x.title || '',
      snippet: (x.description || '').replace(/<[^>]+>/g, '').slice(0, 280),
    }))
    return { ok: true, results }
  } catch (e) {
    return { ok: false, reason: e.name === 'TimeoutError' ? 'timeout' : 'exception', results: [] }
  }
}

// ---------------------------------------------------------------------------
// Fetch de pagina publica (site oficial) — timeout curto, limite de tamanho
// ---------------------------------------------------------------------------
async function fetchSite(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DesiberneCRMBot/1.0; +https://desiberneia.com.br)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const finalUrl = r.url || url
    if (!r.ok) return { found: false, url: finalUrl, https: finalUrl.startsWith('https://'), reason: `http_${r.status}` }
    const buf = await r.arrayBuffer()
    const html = Buffer.from(buf.slice(0, MAX_PAGE_BYTES)).toString('utf8')
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const title = (html.match(/<title[^>]*>([^<]{1,200})<\/title>/i) || [])[1]?.trim() || ''
    const desc =
      (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})["']/i) || [])[1]?.trim() || ''
    const lower = (title + ' ' + desc + ' ' + text.slice(0, 4000)).toLowerCase()
    return {
      found: true,
      url: finalUrl,
      https: finalUrl.startsWith('https://'),
      title,
      description: desc,
      has_whatsapp: /whatsapp|wa\.me|api\.whatsapp/.test(lower),
      mentions_contact: /contato|fale conosco|telefone|e-mail|email/.test(lower),
      mentions_services: /servi[çc]os|especialidades|o que fazemos|solu[çc][õo]es/.test(lower),
      text_sample: text.slice(0, 600),
    }
  } catch (e) {
    return { found: false, url, https: url.startsWith('https://'), reason: e.name === 'TimeoutError' ? 'timeout' : 'exception' }
  }
}

// ---------------------------------------------------------------------------
// Orquestrador da pesquisa
// ---------------------------------------------------------------------------
export async function runResearch(lead, { braveKey, mapsKey }) {
  const startedAt = Date.now()
  const sources = []
  const evidence = []
  const warnings = []
  let srcN = 0
  let evN = 0
  const nextSrc = () => `src_${String(++srcN).padStart(3, '0')}`
  const nextEv = () => `ev_${String(++evN).padStart(3, '0')}`
  const addSource = (s) => {
    const id = nextSrc()
    sources.push({ id, retrieved_at: new Date().toISOString(), ...s })
    return id
  }
  const addEvidence = (claim, source_id, confidence) => {
    const id = nextEv()
    evidence.push({ id, claim, source_id: source_id || null, confidence })
    return id
  }

  // 1) Google Places — identificacao
  const places = await placesSearch(lead, mapsKey)
  let identity = {
    razao_social: lead.razao_social || null,
    cnpj: lead.cnpj || null,
    cidade: lead.cidade || null,
    telefone: lead.telefone || lead.celular || null,
    segmento: lead.segmento || lead.vertical || null,
    place_id: null,
    site_url: null,
    id_confidence: 'LOW',
    status: 'unconfirmed', // confirmed | weak | ambiguous | unconfirmed
  }
  let placesCandidates = []
  let sitePlacesUrl = null

  if (!places.ok) {
    warnings.push(`places:${places.reason}`)
  } else {
    placesCandidates = places.candidates.map((c) => ({ ...c, ...scoreCandidate(lead, c) }))
    const strong = placesCandidates.filter((c) => c.level === 'HIGH' || c.level === 'MEDIUM')
    if (strong.length === 1) {
      const c = strong[0]
      const sid = addSource({
        url: `https://www.google.com/maps/place/?q=place_id:${c.place_id}`,
        domain: 'google.com/maps',
        title: c.name || 'Google Places',
        type: 'places',
        snippet: [c.address, c.phone, c.category].filter(Boolean).join(' · ').slice(0, 280),
        confidence: c.level,
      })
      identity = {
        ...identity,
        place_id: c.place_id,
        site_url: c.website || null,
        id_confidence: c.level,
        status: c.level === 'HIGH' ? 'confirmed' : 'weak',
      }
      sitePlacesUrl = c.website || null
      addEvidence(`Empresa localizada no Google Maps: "${c.name}" — ${c.address || 'endereço não informado'}.`, sid, c.level)
      if (c.rating != null && c.review_count != null) {
        addEvidence(`Avaliação no Google: ${c.rating} (${c.review_count} avaliações).`, sid, c.level)
      } else {
        addEvidence('Sem avaliações registradas no Google Maps para o registro localizado.', sid, 'MEDIUM')
      }
      if (!c.website) {
        addEvidence('O registro do Google Maps não aponta website oficial.', sid, c.level)
      }
    } else if (strong.length > 1) {
      identity.status = 'ambiguous'
      strong.slice(0, 4).forEach((c) => {
        addSource({
          url: `https://www.google.com/maps/place/?q=place_id:${c.place_id}`,
          domain: 'google.com/maps',
          title: c.name || 'Google Places',
          type: 'places',
          snippet: [c.address, c.phone].filter(Boolean).join(' · ').slice(0, 280),
          confidence: 'MEDIUM',
        })
      })
    } else {
      warnings.push('places:no_confident_candidate')
      addEvidence(
        `Nenhum registro do Google Maps combinou com confiança para "${lead.razao_social || 'empresa'}"${lead.cidade ? ` em ${lead.cidade}` : ''}.`,
        null,
        'MEDIUM',
      )
    }
  }

  // 2) Brave Search — no maximo 5 queries; complementa identidade + presenca
  const razao = lead.razao_social || ''
  const cidade = lead.cidade || ''
  const queries = [
    [razao, cidade].filter(Boolean).join(' '),
    `${razao} site oficial`,
    `${razao} contato`,
    `${razao} avaliações`,
    `${razao} ${lead.segmento || lead.vertical || ''}`.trim(),
  ]
    .map((q) => q.trim())
    .filter((q, i, a) => q && a.indexOf(q) === i)
    .slice(0, MAX_BRAVE_QUERIES)

  let queriesRun = 0
  const braveHits = []
  for (const q of queries) {
    const res = await braveSearch(q, braveKey)
    queriesRun++
    if (!res.ok) {
      warnings.push(`brave:${res.reason}`)
      continue
    }
    for (const r of res.results) braveHits.push({ ...r, query: q })
  }
  // dedup por url
  const seen = new Set()
  const braveUnique = braveHits.filter((r) => {
    const d = r.url
    if (!d || seen.has(d)) return false
    seen.add(d)
    return true
  })

  // Tenta achar site oficial candidato via Brave se Places nao deu
  const leadNameTokens = norm(razao).split(' ').filter((t) => t.length > 2)
  const officialGuess =
    sitePlacesUrl ||
    braveUnique.find((r) => {
      const dom = norm(domainOf(r.url))
      return leadNameTokens.length > 0 && leadNameTokens.some((t) => dom.includes(t))
    })?.url ||
    null

  // registra ate 4 fontes de SERP
  braveUnique.slice(0, 4).forEach((r) => {
    const sid = addSource({
      url: r.url,
      domain: domainOf(r.url),
      title: r.title,
      type: 'serp',
      snippet: r.snippet,
      confidence: 'MEDIUM',
    })
    addEvidence(`Resultado de busca ("${r.query}"): ${r.title} — ${r.snippet}`.slice(0, 400), sid, 'MEDIUM')
  })

  if (identity.status === 'unconfirmed' && officialGuess && !places.ok) {
    // evidencia adicional de identidade via dominio
    identity.status = 'weak'
    identity.id_confidence = 'LOW'
  }

  // 3) Fetch do site oficial (1 dominio principal)
  let siteSignals = null
  let pagesFetched = 0
  const siteUrl = identity.site_url || officialGuess
  if (siteUrl) {
    const site = await fetchSite(siteUrl)
    pagesFetched = 1
    if (site.found) {
      const sid = addSource({
        url: site.url,
        domain: domainOf(site.url),
        title: site.title || 'Site oficial',
        type: 'site_oficial',
        snippet: (site.description || site.text_sample || '').slice(0, 280),
        confidence: 'HIGH',
      })
      identity.site_url = site.url
      if (identity.status === 'unconfirmed') identity.status = 'weak'
      siteSignals = {
        exists: true,
        url: site.url,
        https: site.https,
        title: site.title,
        description: site.description,
        has_whatsapp: site.has_whatsapp,
        mentions_contact: site.mentions_contact,
        mentions_services: site.mentions_services,
      }
      addEvidence(`Site oficial acessível: ${domainOf(site.url)} (HTTPS: ${site.https ? 'sim' : 'não'}).`, sid, 'HIGH')
      if (!site.has_whatsapp) addEvidence('O site não apresenta link/menção a WhatsApp na página inicial.', sid, 'MEDIUM')
      if (!site.mentions_services) addEvidence('A página inicial do site não descreve claramente os serviços.', sid, 'MEDIUM')
    } else {
      siteSignals = { exists: false, attempted_url: siteUrl, reason: site.reason }
      addEvidence(`Não foi possível acessar um site oficial (${siteUrl}): ${site.reason}.`, null, 'MEDIUM')
      warnings.push(`site:${site.reason}`)
    }
  } else {
    siteSignals = { exists: false, attempted_url: null }
    addEvidence('Nenhum website oficial foi localizado via Google Maps nem nas buscas.', null, 'MEDIUM')
  }

  return {
    identity,
    placesCandidates,
    siteSignals,
    sources,
    evidence,
    meta: {
      queries_run: queriesRun,
      pages_fetched: pagesFetched,
      sources_count: sources.length,
      evidence_count: evidence.length,
      research_ms: Date.now() - startedAt,
      warnings,
    },
  }
}
