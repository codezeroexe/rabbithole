// Free engine: suggestions and research from Wikipedia's public API. No key, no model.
// Suggestions come from the article's own lead links (in reading order), its "See also" list and
// Wikipedia's similar-article search, so every card is a real, on-topic article.
import type { ExpandContext, Research, Suggestion } from './graph.ts'
import type { SearchResult } from './ai.ts'

const API = 'https://en.wikipedia.org/w/api.php'
const lc = (s: string) => s.toLowerCase()
const pageUrl = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
// "Ferrari (company)" -> "Ferrari"; the exact title is kept as the node's ref.
export const labelOf = (title: string) => title.replace(/\s+\([^)]*\)$/, '')

// Wikipedia asks API clients to identify themselves; Api-User-Agent is the CORS-safe header for that.
const HEADERS = { 'Api-User-Agent': 'Rabbithole/0.1 (https://github.com/codezeroexe/rabbithole)' }
async function api(params: Record<string, string>, retry = 2): Promise<Record<string, unknown>> {
  const q = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params })
  const r = await fetch(`${API}?${q}`, { headers: HEADERS, signal: AbortSignal.timeout(15_000) })
  if (r.status === 429 && retry) { await new Promise((ok) => setTimeout(ok, 1500)); return api(params, retry - 1) }
  if (!r.ok) throw new Error(`Wikipedia answered ${r.status}`)
  const d = await r.json()
  if (d.error) throw new Error(`Wikipedia: ${d.error.info ?? d.error.code}`)
  return d
}
const rec = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const arr = (v: unknown) => (Array.isArray(v) ? v : [])

async function search(query: string, limit = 5): Promise<string[]> {
  const d = await api({ action: 'query', list: 'search', srsearch: query, srlimit: String(limit), srprop: '' })
  return arr(rec(d.query).search).map((r) => String(rec(r).title))
}

// Which article a node is about. The seed is looked up by title ("Cars" redirects to "Car").
// A child is searched together with its parent, so "Brands" under "Cars" finds
// "List of car brands", not the generic "Brand" article.
async function resolve(c: ExpandContext): Promise<string> {
  if (c.ref) return c.ref
  const parent = c.path[c.path.length - 2]
  if (!parent) { const d = await describe([c.label]); const hit = d.get(c.label); if (hit) return hit.title }
  const hits = await search(parent ? `${c.label} ${parent}` : c.label)
  const exact = hits.find((h) => lc(h) === lc(c.label)) ?? hits.find((h) => lc(labelOf(h)) === lc(c.label))
  if (exact || hits[0]) return exact ?? hits[0]
  if (parent) { const loose = await search(c.label); if (loose[0]) return loose[0] }
  throw new Error(`Wikipedia has no article for "${c.label}".`)
}

// Links in the lead paragraphs, in reading order: the article's own idea of what matters most.
// The first sentence is skipped: it names what the topic is a kind of ("a car is a motor
// vehicle with wheels"), which is a step up, not a step deeper.
export function linksInParagraphs(html: string): string[] {
  const out: string[] = []
  let first = true
  for (let p of html.match(/<p>[\s\S]*?<\/p>/g) ?? []) {
    if (first && /href="\/wiki\//.test(p)) { first = false; const end = p.indexOf('. '); p = end > 0 ? p.slice(end) : '' }
    for (const m of p.matchAll(/href="\/wiki\/([^"#?]+)[^"]*"/g)) {
      const title = decodeURIComponent(m[1]).replace(/_/g, ' ')
      if (!title.includes(':')) out.push(title)
    }
  }
  return out
}
async function leadLinks(title: string): Promise<string[]> {
  // A list's lead is about lists; its body is the actual members ("List of car brands" -> Ferrari, Kia...).
  if (/^(list|lists|index|outline) of /i.test(title)) {
    const d = await api({ action: 'parse', page: title, prop: 'links', redirects: '1' })
    // Links come back A to Z, so mix them (stably) to avoid always showing the A's. Skip other lists and
    // "X in Country" overviews, which are the list's navigation, not its members.
    const hash = (t: string) => [...t].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7)
    return arr(rec(d.parse).links).map(rec).filter((x) => x.ns === 0 && x.exists).map((x) => String(x.title))
      .filter((t) => !/^(list|lists|index|outline|timeline|history|glossary) of /i.test(t) && !/ in /.test(t))
      .sort((a, b) => hash(a) - hash(b))
  }
  const d = await api({ action: 'parse', page: title, prop: 'text', section: '0', redirects: '1' })
  return linksInParagraphs(String(rec(d.parse).text ?? ''))
}
async function seeAlso(title: string): Promise<string[]> {
  const d = await api({ action: 'parse', page: title, prop: 'sections', redirects: '1' })
  const s = arr(rec(d.parse).sections).map(rec).find((x) => /^see also$/i.test(String(x.line)))
  if (!s) return []
  const l = await api({ action: 'parse', page: title, prop: 'links', section: String(s.index), redirects: '1' })
  return arr(rec(l.parse).links).map(rec).filter((x) => x.ns === 0 && x.exists).map((x) => String(x.title))
}
const moreLike = (title: string, n = 10) => search(`morelike:${title}`, n)

// Short descriptions double as teasers; they also flag disambiguation pages and broad
// articles (countries, years, currencies) that are linked from everywhere and lead nowhere.
const BROAD = /disambiguation|^(sovereign state|country|capital|city|commune|municipality|town|village|human settlement|calendar year|year|decade|century|currency|stock market index|language|family name|surname|given name|unit of)/i
// linksBack: the candidate's own article links to `topic`. Two articles that link each other are
// about related things, which filters out the passing mentions every lead has.
type Info = { title: string; description: string; linksBack: boolean }
async function describe(titles: string[], topic = ''): Promise<Map<string, Info>> {
  const out = new Map<string, Info>()
  for (let i = 0; i < titles.length; i += 50) {
    const d = await api({ action: 'query', prop: topic ? 'description|pageprops|links' : 'description|pageprops', ppprop: 'disambiguation', redirects: '1', titles: titles.slice(i, i + 50).join('|'), ...(topic ? { pltitles: topic, pllimit: 'max' } : {}) })
    const q = rec(d.query)
    const final = new Map<string, string>()
    for (const r of [...arr(q.normalized), ...arr(q.redirects)].map(rec)) final.set(String(r.from), String(r.to))
    const pages = new Map(arr(q.pages).map(rec).map((p) => [String(p.title), p]))
    for (const t of titles.slice(i, i + 50)) {
      let to = t
      for (let hop = 0; hop < 3 && final.has(to); hop++) to = final.get(to)!
      const p = pages.get(to)
      if (!p || p.missing || rec(p.pageprops).disambiguation !== undefined) continue
      const description = String(p.description ?? '')
      if (BROAD.test(description) || /^\d{1,4}s?( BC| AD)?$/.test(to)) continue
      out.set(t, { title: to, description, linksBack: arr(p.links).length > 0 })
    }
  }
  return out
}

const teaser = (d: string) => (d ? d[0].toUpperCase() + d.slice(1).replace(/\.?$/, '.') : 'Wikipedia article.')

export async function wikiSuggest(c: ExpandContext): Promise<{ ref: string; items: Suggestion[] }> {
  const title = await resolve(c)
  const steered = c.steeredRefs.length ? await Promise.all(c.steeredRefs.map((s) => moreLike(s, 8).catch(() => []))) : []
  const [lead, also, like] = await Promise.all([leadLinks(title), seeAlso(title).catch(() => []), moreLike(title).catch(() => [])])

  // Steered nodes pull their own neighbours to the front; the article's lead links follow.
  // Tangents are the sideways jumps: "See also" and similar articles not already in the lead.
  const interleave = (lists: string[][]) => lists.length ? Array.from({ length: Math.max(...lists.map((l) => l.length)) }, (_, i) => lists.map((l) => l[i])).flat().filter(Boolean) : []
  const focus = [...interleave(steered), ...lead]
  const leadSet = new Set(lead.map(lc))
  const tangents = [...also, ...like].filter((t) => !leadSet.has(lc(t)))

  const avoid = new Set([...c.avoid, ...c.path, title].flatMap((x) => [lc(x), lc(labelOf(x))]))
  const fresh = (list: string[]) => [...new Set(list)].filter((t) => !avoid.has(lc(t)) && !avoid.has(lc(labelOf(t))))
  // Rotate by the re-roll count so each re-roll shows a different slice of the pool.
  const rotate = (list: string[], n: number) => { const k = list.length ? (c.rolls * n) % list.length : 0; return [...list.slice(k), ...list.slice(0, k)] }
  const focusPool = rotate(fresh(focus), c.focusCount).slice(0, c.focusCount + 16)
  const tangentPool = rotate(fresh(tangents), Math.max(c.tangentCount, 1)).slice(0, c.tangentCount + 6)
  const info = await describe([...new Set([...focusPool, ...tangentPool])], title)
  // Focus picks that link back to the topic come first; the rest only fill gaps.
  const steeredSet = new Set(interleave(steered).map(lc))
  const linked = (t: string) => steeredSet.has(lc(t)) || !!info.get(t)?.linksBack
  focusPool.sort((a, b) => Number(linked(b)) - Number(linked(a)))

  const items: Suggestion[] = []
  const taken = new Set<string>()
  const take = (pool: string[], n: number, tangent: boolean) => {
    for (const t of pool) {
      if (items.filter((i) => i.tangent === tangent).length >= n) break
      const d = info.get(t)
      if (!d || taken.has(lc(d.title)) || avoid.has(lc(d.title))) continue
      taken.add(lc(d.title))
      items.push({ label: labelOf(d.title), teaser: teaser(d.description), tangent, ref: d.title })
    }
  }
  take(focusPool, c.focusCount, false)
  take(tangentPool, c.tangentCount, true)
  if (!items.length) throw new Error(`Found nothing new to suggest under "${c.label}". Try Re-roll or steer.`)
  return { ref: title, items }
}

// Lead-paragraph links for a model backend to draw on, so its suggestions stay on topic.
export async function wikiHints(c: ExpandContext): Promise<{ ref: string; hints: string[] }> {
  const ref = await resolve(c)
  const avoid = new Set(c.avoid.map(lc))
  return { ref, hints: [...new Set(await leadLinks(ref))].filter((t) => !avoid.has(lc(t))).slice(0, 20).map(labelOf) }
}

export async function wikiResearch(path: string[], ref?: string): Promise<{ ref: string; research: Research }> {
  const label = path[path.length - 1]
  const title = ref ?? await resolve({ path, label, steered: [], steeredRefs: [], dismissed: [], taste: [], avoid: [], focusCount: 0, tangentCount: 0, rolls: 0 })
  const d = await api({ action: 'query', prop: 'extracts|description', exintro: '1', explaintext: '1', exsentences: '4', redirects: '1', titles: title })
  const p = rec(arr(rec(d.query).pages)[0])
  // Drop the pronunciation stubs the plain-text extract leaves behind: "Ferrari S.p.A. (; Italian: ...)".
  const summary = String(p.extract ?? '').replace(/\s*\(\s*;[^)]*\)/g, '').replace(/\s+/g, ' ').trim()
  return {
    ref: String(p.title ?? title),
    research: {
      summary: summary || `Wikipedia has no summary for ${label}.`,
      facts: p.description ? [{ k: 'In short', v: teaser(String(p.description)) }] : [],
      sources: [{ title: `Wikipedia: ${p.title ?? title}`, url: pageUrl(String(p.title ?? title)) }],
      verified: true,
    },
  }
}

// Keyless "web search" for model backends: the top Wikipedia articles with their opening lines.
export async function wikiSearch(query: string, limit = 4): Promise<SearchResult[]> {
  const titles = await search(query, limit)
  if (!titles.length) return []
  const d = await api({ action: 'query', prop: 'extracts', exintro: '1', explaintext: '1', exsentences: '3', redirects: '1', titles: titles.join('|') })
  const pages = new Map(arr(rec(d.query).pages).map(rec).map((p) => [String(p.title), p]))
  return titles.map((t) => pages.get(t) ?? { title: t }).map((p) => ({
    title: String(rec(p).title), url: pageUrl(String(rec(p).title)), snippet: String(rec(p).extract ?? '').slice(0, 600),
  }))
}
