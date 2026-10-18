// Prompts and reply parsing. The transport is the desktop app's main process (window.rh), which
// holds the keys and talks to the chosen backend. In a plain browser (npm run dev without
// Electron) it falls back to an OpenCode server behind the Vite proxy at /oc.
import type { ExpandContext, Fact, Research, Source, Suggestion } from './graph.ts'

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

type Bridge = {
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Pick<Settings, 'backend' | 'search' | 'models' | 'urls'>>, secrets?: Record<string, string | undefined>): Promise<Settings>
  listModels(backend: string): Promise<string[]>
  complete(prompt: string): Promise<string>
  search(query: string): Promise<SearchResult[]>
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
const complete = (model: string, prompt: string) => (bridge ? bridge.complete(prompt) : proxyComplete(model, prompt))

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
    `Expand the node "${c.label}" into sub-topics worth exploring next.`,
    c.steered.length ? `The user added these themselves, so lean strongly toward things like them: ${c.steered.join(', ')}.` : '',
    c.dismissed.length ? `The user rejected these, so avoid them and things like them: ${c.dismissed.join(', ')}.` : '',
    c.taste.length ? `Elsewhere in the graph the user steered toward: ${c.taste.join(', ')}.` : '',
    c.avoid.length ? `Already on the graph, do not repeat: ${c.avoid.join(', ')}.` : '',
    c.rolls ? 'The user asked for a fresh batch, so give different ideas from the obvious ones.' : '',
    `Give exactly ${c.focusCount + c.tangentCount} items: ${c.focusCount} that go deeper into "${c.label}" (tangent false)` +
      (c.tangentCount ? ` and ${c.tangentCount} lateral, surprising but related jumps (tangent true).` : '.'),
    'Each label is 1 to 4 words. Each teaser is one sentence under 12 words.',
    'Reply with only this JSON: {"children":[{"label":"...","teaser":"...","tangent":false}]}',
  ].filter(Boolean).join('\n')
}

export function parseSuggestions(text: string): Suggestion[] {
  const d = rec(extractJson(text))
  const items = (Array.isArray(d.children) ? d.children : []).map((x) => {
    const o = rec(x)
    return { label: str(o.label), teaser: str(o.teaser), tangent: o.tangent === true }
  })
  if (!items.some((i) => i.label)) throw new Error('The model returned no suggestions.')
  return items
}

export async function suggest(model: string, c: ExpandContext): Promise<Suggestion[]> {
  return parseSuggestions(await complete(model, suggestPrompt(c)))
}

export function researchPrompt(path: string[], results: SearchResult[]): string {
  const label = path[path.length - 1]
  const lines = [`Write a short research note on "${label}", read in the context of this path: ${path.join(' › ')}.`]
  if (results.length) {
    lines.push(
      'Base the note on these web search results. Cite them by number; use nothing you cannot support from them or confidently know.',
      ...results.map((r, i) => `[${i + 1}] ${r.title} (${r.url})\n${r.snippet}`),
      'summary: 2 or 3 plain sentences.',
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

export function parseResearch(text: string, label: string, results: SearchResult[]): Research {
  const d = rec(extractJson(text))
  const facts: Fact[] = (Array.isArray(d.facts) ? d.facts : []).map((f) => ({ k: str(rec(f).k), v: str(rec(f).v) })).filter((f) => f.k && f.v)
  const raw = Array.isArray(d.sources) ? d.sources : []
  const sources: Source[] = results.length
    // With search, sources are only ever results we fetched: the model picks them by number.
    ? raw.map((n) => results[Number(n) - 1]).filter(Boolean).map((r) => ({ title: r.title, url: r.url }))
    : raw.map((s) => ({ title: str(rec(s).title), url: str(rec(s).url) })).filter((s) => /^https?:\/\//.test(s.url))
  return { summary: str(d.summary) || `No summary came back for ${label}.`, facts, sources, verified: results.length > 0 }
}

export async function research(model: string, path: string[], useSearch: boolean): Promise<Research> {
  const results = useSearch && bridge ? await bridge.search(path.slice(-3).join(' ')) : []
  return parseResearch(await complete(model, researchPrompt(path, results)), path[path.length - 1], results)
}
