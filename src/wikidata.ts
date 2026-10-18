// Aspects of a thing, from Wikidata's relations: what it is made of, who made it, what it made.
// Nothing here knows about any particular topic. A band gets Members and Works, a company Products
// and Founders, a game Characters and Platforms, because those are the relations its item has.
// Keyless: the Action APIs of Wikipedia and Wikidata. No SPARQL (it is slow and blocks some clients).
import type { Facet } from './graph.ts'
import { wikimedia } from './net.ts'

const HEADERS = { 'Api-User-Agent': 'Rabbithole/0.1 (https://github.com/codezeroexe/rabbithole)' }
const WP = 'https://en.wikipedia.org/w/api.php'
const WD = 'https://www.wikidata.org/w/api.php'
const rec = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const arr = (v: unknown) => (Array.isArray(v) ? v : [])

async function get(base: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const q = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params })
  const r = await wikimedia(`${base}?${q}`, HEADERS)
  if (!r.ok) throw new Error(`Wikidata answered ${r.status}`)
  return r.json()
}

// Relations that point at the thing from elsewhere, with what the list of them is called.
// These are kinds of relation (made by, part of, member of), not topics, so they hold for anything.
const INBOUND: Record<string, string> = {
  P176: 'Products', P178: 'Software', P175: 'Works', P50: 'Writings', P57: 'Films', P86: 'Music',
  P361: 'Parts', P463: 'Members', P54: 'Players', P108: 'People who work there', P127: 'Owns',
  P749: 'Subsidiaries', P179: 'In the series', P1441: 'Characters', P800: 'People known for it',
  P737: 'Influenced', P1269: 'Topics', P144: 'Based on it',
}
// Outbound relations that describe the item's bookkeeping or its place, not something to explore inside it.
const SKIP = new Set(['P1454', 'P31', 'P279', 'P17', 'P27', 'P495', 'P131', 'P159', 'P740', 'P19', 'P20', 'P551', 'P1532', 'P407', 'P364', 'P103', 'P1412', 'P37', 'P21', 'P910', 'P1424', 'P1151', 'P2354', 'P5008', 'P6216', 'P8345', 'P1343', 'P972', 'P1889', 'P460', 'P461', 'P7084', 'P3831', 'P1552', 'P2283', 'P5125', 'P6104', 'P8989', 'P1080', 'P625', 'P30', 'P706', 'P206', 'P47', 'P190', 'P421', 'P150', 'P1376', 'P36', 'P38', 'P1622', 'P8402', 'P2184', 'P1792', 'P1464', 'P1465', 'P6', 'P35', 'P122'])

// members: Wikipedia titles. others: names of members that have no English article yet.
export type Aspect = { label: string; facet: Facet; members: string[]; others?: string[] }

const cache = new Map<string, Promise<Aspect[]>>()
export function wikidataAspects(title: string): Promise<Aspect[]> {
  if (!cache.has(title)) {
    const p = load(title)
    p.catch(() => cache.delete(title))
    cache.set(title, p)
  }
  return cache.get(title)!
}

export async function wikidataMembers(f: Facet): Promise<{ members: string[]; others: string[] }> {
  const a = (await wikidataAspects(f.of)).find((x) => x.facet.key === f.key)
  return { members: a?.members ?? [], others: a?.others ?? [] }
}

async function load(title: string): Promise<Aspect[]> {
  const pp = await get(WP, { action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1', titles: title })
  const q = String(rec(rec(arr(rec(pp.query).pages)[0]).pageprops).wikibase_item ?? '')
  if (!q) return []

  // Outbound: the item's own statements whose values are other items.
  const e = rec(rec(rec(await get(WD, { action: 'wbgetentities', ids: q, props: 'claims' })).entities)[q])
  const outbound = new Map<string, string[]>()
  for (const [p, claims] of Object.entries(rec(e.claims))) {
    if (SKIP.has(p)) continue
    const ids = arr(claims).map((c) => String(rec(rec(rec(rec(c).mainsnak).datavalue).value).id ?? '')).filter((id) => /^Q\d+$/.test(id))
    if (ids.length) outbound.set(p, [...new Set(ids)])
  }
  // Inbound: items that name this one in a relation. One small search per relation.
  const inbound = new Map<string, string[]>()
  // The shared queue in net.ts keeps these to a few at a time.
  await Promise.all(Object.keys(INBOUND).map(async (p) => {
    const d = await get(WD, { action: 'query', list: 'search', srsearch: `haswbstatement:${p}=${q}`, srlimit: '40', srprop: '' }).catch(() => ({}))
    const ids = arr(rec(rec(d).query).search).map((r) => String(rec(r).title)).filter((id) => /^Q\d+$/.test(id))
    if (ids.length) inbound.set(p, ids)
  }))

  // Only items with an English Wikipedia article can become nodes: they can be read and researched.
  const ids = [...new Set([...outbound.values(), ...inbound.values()].flat())]
  const titles = new Map<string, string>()
  const labels = new Map<string, string>()
  await Promise.all(Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => ids.slice(i * 50, i * 50 + 50)).map(async (batch) => {
    const d = await get(WD, { action: 'wbgetentities', ids: batch.join('|'), props: 'sitelinks|labels', languages: 'en', sitefilter: 'enwiki' })
    for (const [id, it] of Object.entries(rec(rec(d).entities))) {
      const t = rec(rec(rec(it).sitelinks).enwiki).title
      if (t) titles.set(id, String(t))
      else { const l = rec(rec(rec(it).labels).en).value; if (l) labels.set(id, String(l)) }
    }
  }))
  const names = await propertyNames([...outbound.keys()])

  const byLabel = new Map<string, Aspect>()
  const add = (label: string, key: string, qids: string[]) => {
    const members = qids.map((id) => titles.get(id)).filter((t): t is string => !!t && t !== title)
    const others = qids.map((id) => labels.get(id)).filter((t): t is string => !!t && !/^Q\d+$/.test(t))
    if (!members.length) return
    const a = byLabel.get(label.toLowerCase())
    if (a) { a.facet.key += `,${key}`; a.members = [...new Set([...a.members, ...members])]; a.others = [...new Set([...(a.others ?? []), ...others])] }
    else byLabel.set(label.toLowerCase(), { label, facet: { src: 'wd', key, of: title }, members, others })
  }
  // The item's own statements first: on a tie their names win ("Founder" over "Owners").
  for (const [p, qids] of outbound) if (names.has(p)) add(names.get(p)!, `${p}>`, qids)
  for (const [p, qids] of inbound) add(INBOUND[p], `${p}<`, qids)
  return mergeAlike([...byLabel.values()]).sort((a, b) => b.members.length - a.members.length)
}

// A property's name as an aspect: its English label, or its shortest alias when the label is a
// mouthful ("product or material produced" -> "products").
const propCache = new Map<string, string>()
async function propertyNames(ps: string[]): Promise<Map<string, string>> {
  const need = ps.filter((p) => !propCache.has(p))
  for (let i = 0; i < need.length; i += 50) {
    const d = await get(WD, { action: 'wbgetentities', ids: need.slice(i, i + 50).join('|'), props: 'labels|aliases', languages: 'en' })
    for (const [p, it] of Object.entries(rec(rec(d).entities))) {
      const label = String(rec(rec(rec(it).labels).en).value ?? '')
      const aliases = arr(rec(rec(it).aliases).en).map((a) => String(rec(a).value))
      propCache.set(p, aspectName(label, aliases))
    }
  }
  return new Map(ps.filter((p) => propCache.get(p)).map((p) => [p, propCache.get(p)!]))
}
export function aspectName(label: string, aliases: string[]): string {
  const ok = (s: string) => s.length >= 4 && s.length <= 22 && !/[()]/.test(s)
  const pick = ok(label) ? label : aliases.filter(ok).sort((a, b) => a.length - b.length)[0] ?? ''
  return pick ? pick[0].toUpperCase() + pick.slice(1) : ''
}

// Two relations often list the same things from both ends ("Products" made by it, "Makes" on it).
// Keep one aspect when most of the smaller one's members are in the bigger one.
export function mergeAlike(aspects: Aspect[]): Aspect[] {
  const out: Aspect[] = []
  for (const a of [...aspects].sort((x, y) => y.members.length - x.members.length)) {
    const same = out.find((b) => a.members.filter((m) => b.members.includes(m)).length >= Math.ceil(a.members.length * 0.6))
    // One person who is founder, chief executive and owner is one card, under the first name.
    if (same && a.members.length === 1) continue
    if (same) { same.facet.key += `,${a.facet.key}`; same.members = [...new Set([...same.members, ...a.members])]; same.others = [...new Set([...(same.others ?? []), ...(a.others ?? [])])] }
    else out.push(a)
  }
  return out
}
