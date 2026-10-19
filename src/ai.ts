// Prompts and reply parsing. The transport is the desktop app's main process (window.rh), which
// holds the keys and talks to the chosen backend. In a plain browser (npm run dev without
// Electron) it falls back to an OpenCode server behind the Vite proxy at /oc.
import type { ExpandContext, Fact, Research, Source, Suggestion } from './graph.ts'
import { wikiSearch } from './wiki.ts'

export type BackendInfo = { id: string; label: string; key: boolean | 'optional'; editableUrl: boolean; defaultModel: string }
export type Settings = {
  backend: string
  models: Record<string, string>
  urls: Record<string, string>
  search: string
  keysSet: Record<string, boolean>
  backends: BackendInfo[]
  searchProviders: { id: string; label: string }[]
  encryption: boolean
}
export type SearchResult = { title: string; url: string; snippet: string }
export type NewsItem = { title: string; url: string; source: string; date: string }
export type LocalModel = { id: string; label: string; size: string; downloaded: boolean }

type Bridge = {
  platform: string
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Pick<Settings, 'backend' | 'search' | 'models' | 'urls'>>, secrets?: Record<string, string | undefined>): Promise<Settings>
  listModels(backend: string): Promise<string[]>
  complete(prompt: string, schema?: object): Promise<string>
  search(query: string): Promise<SearchResult[]>
  news(query: string): Promise<NewsItem[]>
  openSettings(): Promise<void>
  setMenuState(state: { theme: string }): Promise<void>
  onMenu(fn: (cmd: string) => void): () => void
  onSettingsChanged(fn: (s: Settings) => void): () => void
  localModels(): Promise<LocalModel[]>
  downloadLocal(id: string): Promise<LocalModel[]>
  onLocalProgress(fn: (id: string, progress: number) => void): () => void
}
export const bridge = (globalThis as unknown as { rh?: Bridge }).rh

// ---------- Browser-only fallback: OpenCode through the Vite proxy ----------
const BASE = '/oc'
export type ModelOption = { value: string; label: string }
export const parseModel = (v: string) => {
  const i = v.indexOf('/')
  return i > 0 ? { providerID: v.slice(0, i), modelID: v.slice(i + 1) } : null
}
export async function listProxyModels(): Promise<ModelOption[]> {
  const r = await fetch(`${BASE}/config/providers`)
  if (!r.ok) throw new Error(`OpenCode server answered ${r.status}`)
  const d = await r.json()
  return (d.providers ?? []).flatMap((p: { id: string; name?: string; models?: object }) =>
    Object.keys(p.models ?? {}).map((id) => ({ value: `${p.id}/${id}`, label: `${p.name ?? p.id} · ${id}` })))
}
async function proxyComplete(model: string, prompt: string): Promise<string> {
  const m = parseModel(model)
  if (!m) throw new Error('Pick a model.')
  const post = async (path: string, body: unknown) => {
    const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) throw new Error(`OpenCode server answered ${r.status}`)
    return r.json()
  }
  const s = await post('/session', { title: 'rabbithole' })
  try {
    const d = await post(`/session/${s.id}/message`, { agent: 'rabbithole', model: m, parts: [{ type: 'text', text: prompt }] })
    if (d.info?.error) throw new Error(d.info.error.data?.message ?? d.info.error.name)
    return (d.parts ?? []).filter((p: { type: string }) => p.type === 'text').map((p: { text: string }) => p.text).join('\n')
  } finally {
    fetch(`${BASE}/session/${s.id}`, { method: 'DELETE' }).catch(() => {})
  }
}

// `model` only matters for the browser fallback; the desktop app uses its saved settings.
// schema: the reply's JSON shape. The built-in model is held to it token by token; other backends ignore it.
const complete = (model: string, prompt: string, schema?: object) => (bridge ? bridge.complete(prompt, schema) : proxyComplete(model, prompt))

// Pull the first JSON object out of a model reply, tolerating prose and ``` fences around it.
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The model reply had no JSON in it.')
  return JSON.parse(text.slice(start, end + 1))
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const rec = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

export function suggestPrompt(c: ExpandContext): string {
  return [
    `Topic path: ${c.path.join(' › ')}`,
    // The whole path is the question: each level narrows the ones above it.
    `Read the path as one narrowing question: "${c.label}"${c.anchors.length ? ` as it relates to ${c.anchors.map((a) => a.label).join(', then ')}` : ''}${c.qualifiers.length ? `, narrowed to: ${c.qualifiers.join('; ')}` : ''}. Every item must fit all of it, not just "${c.label}".`,
    c.kind === 'aspect' ? `"${c.label}" is one aspect of ${c.anchors[0]?.label ?? 'the topic above'}: list its specific members.` : `Expand the node "${c.label}" into sub-topics worth exploring next.`,
    c.steered.length ? `The user added these themselves, so lean strongly toward things like them: ${c.steered.join(', ')}.` : '',
    c.dismissed.length ? `The user rejected these, so avoid them and things like them: ${c.dismissed.join(', ')}.` : '',
    c.taste.length ? `Elsewhere in the graph the user steered toward: ${c.taste.join(', ')}.` : '',
    c.avoid.length ? `Already on the graph, do not repeat: ${c.avoid.join(', ')}.` : '',
    c.hints?.length ? `These real articles already fit the whole path; choose from them: ${c.hints.join(', ')}.` : '',
    c.hints?.length ? '' : `Every item must be a specific, named thing that belongs under "${c.label}" in this path: a real model, person, place, event, technique or sub-field. Never generic headings such as "History", "Key facts", "Rivals", "Today", "In pop culture", "Design" or "Economics".`,
    c.rolls ? 'The user asked for a fresh batch, so give different ideas from the obvious ones.' : '',
    `Give exactly ${c.focusCount + c.tangentCount} items: ${c.focusCount} that go deeper into "${c.label}" (tangent false)` +
      (c.tangentCount ? ` and ${c.tangentCount} lateral, surprising but related jumps (tangent true).` : '.'),
    'Each label is 1 to 4 words. Each teaser is one plain statement under 12 words, not a question.',
    'Reply with only this JSON: {"children":[{"label":"...","teaser":"...","tangent":false}]}',
  ].filter(Boolean).join('\n')
}

export function parseSuggestions(text: string, max = Infinity): Suggestion[] {
  const d = rec(extractJson(text))
  const seen = new Set<string>()
  const items = (Array.isArray(d.children) ? d.children : []).map((x) => {
    const o = rec(x)
    return { label: str(o.label), teaser: str(o.teaser), tangent: o.tangent === true }
  }).filter((i) => i.label && !seen.has(i.label.toLowerCase()) && seen.add(i.label.toLowerCase())).slice(0, max)
  if (!items.some((i) => i.label)) throw new Error('The model returned no suggestions.')
  return items
}

// With Wikipedia hints, labels can only be picked from them: a tiny model then ranks real
// articles instead of making up headings.
export function suggestSchema(c: ExpandContext): object {
  // Two spare items: small models sometimes repeat a pick, and parseSuggestions keeps the first n distinct.
  const n = c.focusCount + c.tangentCount + 2
  const label = c.hints?.length ? { enum: c.hints } : { type: 'string', minLength: 2, maxLength: 40 }
  const item = { type: 'object', properties: { label, teaser: { type: 'string', minLength: 10, maxLength: 90 }, tangent: { type: 'boolean' } } }
  return { type: 'object', properties: { children: { type: 'array', minItems: n, maxItems: n, items: item } } }
}

export async function suggest(model: string, c: ExpandContext): Promise<Suggestion[]> {
  return parseSuggestions(await complete(model, suggestPrompt(c), suggestSchema(c)), c.focusCount + c.tangentCount)
}

export function researchPrompt(path: string[], results: SearchResult[]): string {
  const label = path[path.length - 1]
  const lines = [`Write a short research note on "${label}", read in the context of this path: ${path.join(' › ')}.`]
  if (results.length) {
    lines.push(
      'Base the note on these web search results. Cite them by number; use nothing you cannot support from them or confidently know.',
      ...results.map((r, i) => `[${i + 1}] ${r.title} (${r.url})\n${r.snippet}`),
      'summary: 2 or 3 plain sentences. End each sentence with the number of the result it comes from in square brackets, like [2].',
      'facts: up to 4 short key/value pairs. Leave the list empty rather than guess.',
      'sources: the numbers of the results you used.',
      'Reply with only this JSON: {"summary":"...","facts":[{"k":"...","v":"..."}],"sources":[1,2]}',
    )
  } else {
    lines.push(
      'summary: 2 or 3 plain sentences.',
      'facts: up to 4 short key/value pairs you are confident are true. Leave the list empty rather than guess.',
      'sources: up to 3 pages you are confident exist, with full https URLs. Leave the list empty rather than guess.',
      'Reply with only this JSON: {"summary":"...","facts":[{"k":"...","v":"..."}],"sources":[{"title":"...","url":"https://..."}]}',
    )
  }
  return lines.join('\n')
}

export function researchSchema(results: SearchResult[]): object {
  const fact = { type: 'object', properties: { k: { type: 'string', maxLength: 30 }, v: { type: 'string', maxLength: 80 } } }
  const sources = results.length
    ? { type: 'array', maxItems: 3, items: { enum: results.map((_, i) => i + 1) } }
    : { type: 'array', maxItems: 3, items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } } } }
  return { type: 'object', properties: { summary: { type: 'string', minLength: 40, maxLength: 600 }, facts: { type: 'array', maxItems: 4, items: fact }, sources } }
}

export function parseResearch(text: string, label: string, results: SearchResult[]): Research {
  const d = rec(extractJson(text))
  const facts: Fact[] = (Array.isArray(d.facts) ? d.facts : []).map((f) => ({ k: str(rec(f).k), v: str(rec(f).v) })).filter((f) => f.k && f.v)
  const raw = Array.isArray(d.sources) ? d.sources : []
  let summary = str(d.summary)
  let sources: Source[]
  if (results.length) {
    // With search, sources are only ever results we fetched: the model picks them by number.
    // Cited markers come first (first-cited order), then d.sources; markers are renumbered to list position.
    const order: number[] = []
    const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= results.length
    for (const m of summary.matchAll(/\[(\d+)\]/g)) if (ok(+m[1]) && !order.includes(+m[1])) order.push(+m[1])
    for (const n of raw) if (ok(Number(n)) && !order.includes(Number(n))) order.push(Number(n))
    summary = summary.replace(/\s*\[(\d+)\]/g, (m, n) => (ok(+n) ? m.replace(/\d+/, String(order.indexOf(+n) + 1)) : ''))
    sources = order.map((n) => ({ title: results[n - 1].title, url: results[n - 1].url }))
  } else sources = raw.map((s) => ({ title: str(rec(s).title), url: str(rec(s).url) })).filter((s) => /^https?:\/\//.test(s.url))
  return { summary: summary || `No summary came back for ${label}.`, facts, sources, verified: results.length > 0 }
}

// Drop [n] citation markers (cards, plain exports).

// Keyless 'web' mixes the open web (main process) with Wikipedia, so research never rests on one site.
export async function searchFor(q: string, search: string): Promise<SearchResult[]> {
  if (search === 'none') return []
  if (search === 'wikipedia' || !bridge) return wikiSearch(q).catch(() => [])
  if (search !== 'web') return bridge.search(q)
  const [web, wiki] = await Promise.all([bridge.search(q).catch(() => []), wikiSearch(q, 2).catch(() => [])])
  const seen = new Set(web.map((r) => r.url))
  return [...web.slice(0, 5), ...wiki.filter((r) => !seen.has(r.url))]
}

// search: 'none', 'web' (free), 'wikipedia' (free) or a keyed provider the main process calls.
export async function research(model: string, path: string[], search: string): Promise<Research> {
  const q = path.slice(-3).join(' ')
  const results = await searchFor(q, search)
  return parseResearch(await complete(model, researchPrompt(path, results), researchSchema(results)), path[path.length - 1], results)
}
