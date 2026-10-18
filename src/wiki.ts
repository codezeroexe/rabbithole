// Free engine: suggestions and research from Wikipedia's public API. No key, no model.
// Suggestions come from the article's own lead links (in reading order), its "See also" list and
// Wikipedia's similar-article search, so every card is a real, on-topic article.
import type { Anchor, ExpandContext, Facet, Kind, Research, Suggestion } from './graph.ts'
import { wikidataAspects, wikidataMembers } from './wikidata.ts'
import { wikimedia } from './net.ts'
import type { Aspect } from './wikidata.ts'
import type { SearchResult } from './ai.ts'

const API = 'https://en.wikipedia.org/w/api.php'
const lc = (s: string) => s.toLowerCase()
const pageUrl = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
// "Ferrari (company)" -> "Ferrari"; the exact title is kept as the node's ref.
export const labelOf = (title: string) => title.replace(/\s+\([^)]*\)$/, '')

// Wikipedia asks API clients to identify themselves; Api-User-Agent is the CORS-safe header for that.
const HEADERS = { 'Api-User-Agent': 'Rabbithole/0.1 (https://github.com/codezeroexe/rabbithole)' }
async function api(params: Record<string, string>): Promise<Record<string, unknown>> {
  const q = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params })
  const r = await wikimedia(`${API}?${q}`, HEADERS)
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

// Which article a node is about, read with what is above it. The seed is looked up by title
// ("Cars" -> "Car"), or with the user's steer ("nothing" + "tech brand" -> Nothing (company)).
// Anything else is searched together with the nearest article above it, so "Brands" under "Cars"
// finds "List of car brands", not the generic "Brand" article.
async function resolve(c: ExpandContext): Promise<string> {
  if (c.ref) return c.ref
  const anchor = c.anchors[0]?.label
  const stem = (w: string) => lc(w).replace(/s$/, '')
  const direct = async () => (await describe([c.label])).get(c.label)?.title
  if (!anchor && !c.steer) { const hit = await direct(); if (hit) return hit }
  const hits = await search([c.label, c.steer, anchor].filter(Boolean).join(' '))
  // Best: an article about both ("List of car brands" for Brands under Cars).
  const both = anchor && hits.find((h) => lc(h).includes(stem(c.label)) && lc(h).includes(stem(labelOf(anchor))))
  if (both) return both
  // Steered: the hit that still names the node ("Nothing (company)"), not one that only matches the steer.
  const named = c.steer && hits.find((h) => lc(h).includes(stem(c.label)))
  if (named) return named
  // Then the plain article ("YouTube"), never another topic that shares the name ("YouTube (YouTube channel)").
  const exact = hits.find((h) => lc(h) === lc(c.label)) ?? await direct()
  if (exact || hits[0]) return exact ?? hits[0]
  const loose = await search(c.label)
  if (loose[0]) return loose[0]
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
// linksTo: which of `topics` the candidate's own article links to. Two articles that link each other
// are about related things, which filters out the passing mentions every lead has.
type Info = { title: string; description: string; intro: string; linksTo: Set<string> }
async function describe(titles: string[], topics: string[] = []): Promise<Map<string, Info>> {
  const out = new Map<string, Info>()
  // 20 at a time: the most intro extracts Wikipedia returns in one request.
  for (let i = 0; i < titles.length; i += 20) {
    const d = await api({ action: 'query', prop: topics.length ? 'description|pageprops|extracts|links' : 'description|pageprops|extracts', ppprop: 'disambiguation', exintro: '1', explaintext: '1', exsentences: '2', exlimit: 'max', redirects: '1', titles: titles.slice(i, i + 20).join('|'), ...(topics.length ? { pltitles: topics.join('|'), pllimit: 'max' } : {}) })
    const q = rec(d.query)
    const final = new Map<string, string>()
    for (const r of [...arr(q.normalized), ...arr(q.redirects)].map(rec)) final.set(String(r.from), String(r.to))
    const pages = new Map(arr(q.pages).map(rec).map((p) => [String(p.title), p]))
    for (const t of titles.slice(i, i + 20)) {
      let to = t
      for (let hop = 0; hop < 3 && final.has(to); hop++) to = final.get(to)!
      const p = pages.get(to)
      if (!p || p.missing || rec(p.pageprops).disambiguation !== undefined) continue
      const description = String(p.description ?? '')
      if (BROAD.test(description) || /^\d{1,4}s?( BC| AD)?$/.test(to)) continue
      out.set(t, { title: to, description, intro: String(p.extract ?? ''), linksTo: new Set(arr(p.links).map((l) => String(rec(l).title))) })
    }
  }
  return out
}

const teaser = (d: string) => (d ? d[0].toUpperCase() + d.slice(1).replace(/\.?$/, '.') : 'Wikipedia article.')

// ---------- Suggestions: narrowing by the whole path ----------
// Every pick has to fit the path above it. Fitting means the two articles link each other, or the
// candidate's opening lines name the article above ("a mid-engine sports car" fits Car). Nothing
// here knows about any particular topic: the same rules run for games, bands, places and brands.

const refOf = (a: Anchor) => a.ref ?? a.label
const words = (s: string) => lc(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3)
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Whole-word mention of an article's name, singular or plural, not part of another word.
export function mentions(text: string, name: string): boolean {
  const n = lc(labelOf(name)).replace(/s$/, '').trim()
  return n.length > 1 && new RegExp(`(^|[^\\p{L}\\p{N}])${escape(n)}(s|es)?([^\\p{L}\\p{N}]|$)`, 'u').test(lc(text))
}

async function linksFrom(from: string, titles: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (let i = 0; i < titles.length; i += 50) {
    const d = await api({ action: 'query', titles: from, prop: 'links', pltitles: titles.slice(i, i + 50).join('|'), pllimit: 'max', redirects: '1' })
    for (const p of arr(rec(d.query).pages)) for (const l of arr(rec(p).links)) out.add(String(rec(l).title))
  }
  return out
}

type Fit = { info: Map<string, Info>; fits: (t: string, i: number) => boolean; score: (t: string) => number }
// anchors: the articles above, nearest first. A candidate scores for each one it fits (nearer ones
// count more) and for each of the user's steer words it contains.
async function fitTo(cands: string[], anchors: string[], qualifiers: string[]): Promise<Fit> {
  const info = await describe([...new Set(cands)], anchors.slice(0, 4))
  const finals = [...new Set([...info.values()].map((d) => d.title))]
  const back = await Promise.all(anchors.slice(0, 2).map((a) => linksFrom(a, finals).catch(() => new Set<string>())))
  const fits = (t: string, i: number) => {
    const d = info.get(t)
    const a = anchors[i]
    if (!d || !a) return false
    return d.title === a || d.linksTo.has(a) || !!back[i]?.has(d.title) || mentions(`${d.description} ${d.intro}`, a)
  }
  const q = qualifiers.flatMap(words)
  const score = (t: string) => {
    const d = info.get(t)
    if (!d) return -1
    const text = lc(`${d.title} ${d.description} ${d.intro}`)
    return anchors.reduce((s, _, i) => s + (fits(t, i) ? 4 / (i + 1) : 0), 0) + q.filter((w) => text.includes(w)).length * 3
  }
  return { info, fits, score }
}

// The best-fitting picks, n of them. A re-roll moves along the ranked list to the next n.
function choose(pool: string[], n: number, f: Fit, ok: (t: string) => boolean, avoid: Set<string>, taken: Set<string>, rolls: number, make: (d: Info) => Suggestion): Suggestion[] {
  const eligible: Info[] = []
  for (const t of [...new Set(pool)].sort((a, b) => f.score(b) - f.score(a))) {
    const d = f.info.get(t)
    if (!d || !ok(t)) continue
    const key = lc(d.title)
    if (taken.has(key) || avoid.has(key) || avoid.has(lc(labelOf(d.title)))) continue
    taken.add(key)
    eligible.push(d)
  }
  const k = eligible.length ? (rolls * n) % eligible.length : 0
  return [...eligible.slice(k), ...eligible.slice(0, k)].slice(0, n).map(make)
}
const item = (d: Info, tangent: boolean, kind: Kind): Suggestion => ({ label: labelOf(d.title), teaser: teaser(d.description), tangent, ref: d.title, kind })

// Aspects: Wikidata's relations first; an article Wikidata knows little about splits by its sections.
const META = /^(See also|References|Notes|Citations|Sources|Bibliography|Further reading|External links|Footnotes|Works cited|Gallery|Notes and references)$/i
async function aspectsOf(title: string): Promise<Aspect[]> {
  const wd = await wikidataAspects(title).catch(() => [] as Aspect[])
  if (wd.length >= 3) return wd
  const d = rec(rec(await api({ action: 'parse', page: title, prop: 'sections', redirects: '1' }).catch(() => ({}))).parse)
  const sections = arr(d.sections).map(rec).filter((x) => x.toclevel === 1 && !META.test(String(x.line)))
    .map((x) => ({ label: String(x.line).replace(/<[^>]*>/g, ''), facet: { src: 'section' as const, key: String(x.index), of: String(d.title ?? title) }, members: [] }))
  return [...wd, ...sections]
}
export async function aspectMembers(f: Facet): Promise<{ members: string[]; others: string[] }> {
  if (f.src === 'wd') return wikidataMembers(f)
  const d = await api({ action: 'parse', page: f.of, prop: 'links', section: f.key, redirects: '1' })
  return { members: arr(rec(d.parse).links).map(rec).filter((x) => x.ns === 0 && x.exists).map((x) => String(x.title)), others: [] }
}
const preview = (m: string[]) => `${m.slice(0, 3).map(labelOf).join(', ')}${m.length > 3 ? ` and ${m.length - 3} more` : ''}.`
const aspectItem = (a: Aspect): Suggestion => ({
  label: a.label, kind: 'aspect', facet: a.facet, tangent: false,
  teaser: a.members.length ? preview(a.members) : `The ${lc(a.label)} part of the ${labelOf(a.facet.of)} article.`,
})

export async function wikiSuggest(c: ExpandContext): Promise<{ ref?: string; items: Suggestion[] }> {
  const items = c.kind === 'aspect' && c.facet ? await memberSuggest(c, c.facet) : null
  if (items) return { items }
  if (c.offWiki) throw new Error(`${c.label} has no Wikipedia article yet, so there is nothing to branch into. Its note comes from the web and the news.`)
  const title = await resolve(c)
  return { ref: title, items: await articleSuggest(c, title) }
}

// A thing or a cross: its aspects first, then related articles that fit the whole path.
async function articleSuggest(c: ExpandContext, title: string): Promise<Suggestion[]> {
  const outer = c.anchors.map(refOf)
  const anchors = [title, ...outer]
  // A cross ("YouTube" under "Minecraft") means both at once: everything under it must fit both.
  const cross = c.kind === 'cross' && outer.length > 0
  const scope = [c.label, c.steer, ...c.qualifiers, ...c.anchors.slice(0, 2).map((a) => labelOf(a.label))].filter(Boolean).join(' ')
  const [aspects, lead, also, like, inScope] = await Promise.all([
    aspectsOf(title), leadLinks(title).catch(() => [] as string[]),
    c.tangentCount ? seeAlso(title).catch(() => [] as string[]) : [], c.tangentCount ? moreLike(title).catch(() => [] as string[]) : [],
    outer.length || c.steer ? search(scope, 20).catch(() => []) : Promise.resolve([] as string[]),
  ])
  const related = [...inScope, ...lead]
  const sideways = [...also, ...like].filter((t) => !lead.includes(t))
  // Under a cross, an aspect stays only if its members fit the article above too.
  const sample = cross ? aspects.slice(0, 8).flatMap((a) => a.members.slice(0, 4)) : []
  const f = await fitTo([...related.slice(0, 40), ...sideways.slice(0, 12), ...sample], anchors, [c.steer ?? '', ...c.qualifiers])
  const avoid = new Set([...c.avoid, ...c.path, title].flatMap((x) => [lc(x), lc(labelOf(x))]))
  const taken = new Set<string>()
  const ok = (t: string) => f.fits(t, 0) && (!cross || f.fits(t, 1))

  const used = new Set(c.taken.map(lc))
  const shown = aspects.filter((a) => !used.has(lc(a.label)) && (!cross || (a.members.length > 0 && a.members.slice(0, 4).filter((m) => f.fits(m, 1)).length >= Math.min(2, a.members.length))))
  const things = choose(related, c.focusCount, f, ok, avoid, taken, c.rolls, (d) => item(d, false, 'cross'))
  const nAspects = Math.min(shown.length, things.length ? c.focusCount - 1 : c.focusCount)
  const k = shown.length ? (c.rolls * Math.max(nAspects, 1)) % shown.length : 0
  const focus = [...[...shown.slice(k), ...shown.slice(0, k)].slice(0, nAspects).map(aspectItem), ...things.slice(0, c.focusCount - nAspects)]
  const tangents = choose(sideways, c.tangentCount, f, (t) => f.fits(t, 0), avoid, taken, c.rolls, (d) => item(d, true, 'cross'))
  const items = [...focus, ...tangents]
  if (!items.length) throw new Error(`Found nothing under "${c.label}" that fits ${c.path.join(' › ')}. Try Re-roll or steer.`)
  return items
}

// An aspect: its members, all of them in turn, best fit to the path first.
async function memberSuggest(c: ExpandContext, facet: Facet): Promise<Suggestion[]> {
  const { members, others } = await aspectMembers(facet)
  const anchors = [facet.of, ...c.anchors.map(refOf).filter((a) => a !== facet.of)]
  const extra = c.tangentCount ? await search([c.label, c.steer, ...c.qualifiers, labelOf(facet.of)].filter(Boolean).join(' '), 12).catch(() => []) : []
  const f = await fitTo([...members.slice(0, 80), ...extra], anchors, [c.steer ?? '', ...c.qualifiers])
  const avoid = new Set([...c.avoid, ...c.path, facet.of].flatMap((x) => [lc(x), lc(labelOf(x))]))
  const taken = new Set<string>()
  // Wikidata members belong by their own data; links in a section must also fit the article.
  const ok = (t: string) => facet.src === 'wd' || f.fits(t, 0)
  const n = Math.max(c.focusCount, 6)
  const focus = choose(members, n, f, ok, avoid, taken, c.rolls, (d) => item(d, false, 'thing'))
  // Real members too new or niche for Wikipedia still belong here; the web researches them.
  for (const o of others) {
    if (focus.length >= n) break
    if (!avoid.has(lc(o)) && !taken.has(lc(o))) { taken.add(lc(o)); focus.push({ label: o, teaser: 'Not on Wikipedia yet: read about it from the web.', tangent: false, kind: 'thing', offWiki: true }) }
  }
  const tangents = choose(extra, c.tangentCount, f, (t) => f.fits(t, 0), avoid, taken, c.rolls, (d) => item(d, true, 'cross'))
  const items = [...focus, ...tangents]
  if (!items.length) throw new Error(`No ${lc(c.label)} of ${labelOf(facet.of)} left to show. Try another aspect.`)
  return items
}

// For model backends: a wider pool of real, path-fitting picks for the model to choose and word.
export async function wikiHints(c: ExpandContext): Promise<{ ref?: string; pool: Suggestion[] }> {
  const r = await wikiSuggest({ ...c, focusCount: c.focusCount + 8, tangentCount: c.tangentCount + 3 })
  return { ref: r.ref, pool: r.items }
}

// An aspect's note: what it is and what is in it.
export async function wikiAspectResearch(label: string, facet: Facet): Promise<Research> {
  const { members, others } = await aspectMembers(facet)
  const all = [...members, ...others]
  const of = labelOf(facet.of)
  return {
    summary: all.length ? `${label} of ${of}: ${preview(all)}` : `The ${lc(label)} section of the ${of} article.`,
    facts: [{ k: 'Part of', v: of }, ...(all.length ? [{ k: 'Items', v: String(all.length) }] : [])],
    sources: [{ title: `Wikipedia: ${facet.of}`, url: pageUrl(facet.of) }],
    verified: true,
  }
}


// Research reads the node's article, found with the path and steer the same way suggestions are.
export async function wikiResearch(c: ExpandContext): Promise<{ ref: string; research: Research }> {
  const label = c.label
  const title = await resolve(c)
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

// ---------- Reader: one article, one section at a time ----------

export type Section = { index: string; title: string }

// "/wiki/Ada_Lovelace#Life" -> "Ada Lovelace". Namespaced pages (File:, Help:, ...) are not articles.
export function wikiLinkTitle(href: string): string | null {
  const m = /^(?:https?:)?(?:\/\/en\.wikipedia\.org)?\/wiki\/([^#?]+)/.exec(href)
  if (!m) return null
  let t: string
  try { t = decodeURIComponent(m[1]) } catch { return null }
  return t.includes(':') ? null : t.replace(/_/g, ' ')
}

const sectionCache = new Map<string, Promise<string>>()

export async function wikiSections(title: string): Promise<{ title: string; sections: Section[] }> {
  const d = rec((await api({ action: 'parse', page: title, prop: 'sections', redirects: '1' })).parse)
  const sections = arr(d.sections).map(rec).filter((s) => s.toclevel === 1 && !SKIP_SECTIONS.test(String(s.line)))
  return { title: String(d.title ?? title), sections: sections.map((s) => ({ index: String(s.index), title: String(s.line).replace(/<[^>]*>/g, '') })) }
}
const SKIP_SECTIONS = /^(See also|References|Notes|Citations|Sources|Bibliography|Further reading|External links)$/

export function wikiSection(title: string, index: string): Promise<string> {
  const key = `${title}#${index}`
  if (!sectionCache.has(key)) {
    const p = api({ action: 'parse', page: title, prop: 'text', section: index, redirects: '1', disableeditsection: '1', disabletoc: '1' })
      .then((d) => sanitize(String(rec(d.parse).text ?? '')).replace(index === '0' ? /^$/ : /^\s*<h2>[\s\S]*?<\/h2>/, ''))
    p.catch(() => sectionCache.delete(key))
    sectionCache.set(key, p)
  }
  return sectionCache.get(key)!
}

// Article HTML is third-party content and the page can reach the app's bridge, so keep only an
// allow-list of plain text markup. DOMParser builds an inert document: nothing in it runs.
const DROP = 'script, style, link, meta, noscript, iframe, object, embed, form, input, button, textarea, select, img, svg, video, audio, figure, table, sup, .infobox, .navbox, .hatnote, .metadata, .ambox, .reflist, .mw-references-wrap, .mw-editsection, .shortdescription, .thumb, .gallery, .mw-empty-elt'
const KEEP = new Set(['P', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'B', 'I', 'EM', 'STRONG', 'A', 'BLOCKQUOTE', 'DL', 'DT', 'DD', 'BR', 'CODE', 'SUB'])
function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.body.querySelectorAll(DROP).forEach((el) => el.remove())
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      walk(child)
      if (!KEEP.has(child.tagName)) { child.replaceWith(...child.childNodes); continue }
      const title = child.tagName === 'A' ? wikiLinkTitle(child.getAttribute('href') ?? '') : null
      for (const a of [...child.attributes]) child.removeAttribute(a.name)
      if (child.tagName === 'A') {
        if (title) { child.setAttribute('href', pageUrl(title)); child.setAttribute('data-wiki', title) }
        else child.replaceWith(...child.childNodes)
      }
    }
  }
  walk(doc.body)
  return doc.body.innerHTML.replace(/<p>\s*<\/p>/g, '')
}
export const wikiPageUrl = pageUrl
