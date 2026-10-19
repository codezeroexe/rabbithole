import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { CSSProperties, FormEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  clearGhosts, kindOf, linkNode, steerOn, contextFor, dismissNode, exportMarkdown, exportVault, find, kidsOf, liveKids, mergeGhosts,
  COLUMN, newGraph, pathOf, relayout, SKELETONS, stripCites, tangentsFor,
} from './graph.ts'
import type { ExpandContext, Graph, GraphNode, Research, Source, Suggestion } from './graph.ts'
import { bridge, listProxyModels, research, searchFor, suggest } from './ai.ts'
import type { ModelOption, Settings } from './ai.ts'
import { mockResearch, mockSuggest } from './mock.ts'
import { THEMES, nativeTheme } from './Settings.tsx'
import type { Theme } from './Settings.tsx'
import { wikiAspectResearch, wikiHints, wikiResearch, wikiSuggest } from './wiki.ts'
import { Reader } from './Reader.tsx'
import { applyM3, BURST, CLOVER, DEFAULT_SEED } from './m3.ts'

// Four steps, one per number of tangents (0 to 3) among the 4 suggestions.
const BREADTH = [{ label: 'Focus', spread: 20 }, { label: 'Balanced', spread: 50 }, { label: 'Wide', spread: 75 }, { label: 'Spread', spread: 100 }]
const OFFLINE = 'offline'
const FREE = 'free'

// Browser storage is a per-viewer convenience only; every access is guarded.
const load = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback } catch { return fallback }
}
const save = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ } }

type Dive = { id: string; updated: number; graph: Graph }
const clone = (g: Graph): Graph => ({ ...g, nodes: g.nodes.map((n) => ({ ...n })), notes: { ...g.notes } })
let reqSeq = 1

// Summary with [k] markers as superscript links to sources[k - 1]; plain text passes through.
function cited(s: string, sources: Source[]) {
  return s.split(/(\[\d+\])/).map((p, i) => {
    const src = /^\[\d+\]$/.test(p) ? sources[+p.slice(1, -1) - 1] : undefined
    return src ? <sup key={i}><a href={src.url} target="_blank" rel="noreferrer" title={src.title}>{p.slice(1, -1)}</a></sup> : p
  })
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// The mark: three nested circles, a hole that keeps going.
const Logo = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <circle cx="12" cy="12" r="9.5" /><circle cx="13" cy="12.6" r="5.6" /><circle cx="14" cy="13.2" r="2.2" fill="var(--active)" stroke="var(--active)" />
  </svg>
)
const HomeIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z" /></svg>
const Plus = () => <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
const Gear = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
)
// The furthest path someone went in a dive, for the home screen: "Minecraft › YouTube › Dream".
const Mark = () => (
  <svg className="mark" viewBox="0 0 120 120" aria-hidden="true">
    <circle className="ring r1" cx="60" cy="60" r="54" /><circle className="ring r2" cx="65" cy="63" r="33" /><circle className="ring r3" cx="70" cy="66" r="15" />
    <circle className="dot" cx="70" cy="66" r="9" />
  </svg>
)
const Arrow = () => <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
const ago = (t: number) => {
  const s = (t - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, sec] of [['day', 86400], ['hour', 3600], ['minute', 60]] as const) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), unit)
  return 'just now'
}
// Home and a dive swap with the platform's view transition, a cross-fade the browser draws between two snapshots.
const morph = (fn: () => void) => {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (d.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) d.startViewTransition(() => flushSync(fn))
  else fn()
}
const deepestTrail = (g: Graph) => {
  const solid = g.nodes.filter((n) => n.status === 'solid')
  const deepest = solid.reduce((best, n) => (pathOf(g, n.id).length > pathOf(g, best.id).length ? n : best), solid[0])
  return deepest ? pathOf(g, deepest.id).map((n) => n.label).join(' › ') : ''
}

const X = () => (
  <svg width="9" height="9" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 1 7 7M7 1 1 7" stroke="currentColor" strokeWidth="1.4" /></svg>
)

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    // First run: the platform's own look (Liquid Glass on a Mac, WinUI 3 on Windows).
    const t = load<string>('rh.theme', nativeTheme())
    return (t === 'dark' ? 'obsidian' : t) as Theme
  })
  const [model, setModel] = useState<string>(() => load('rh.model', FREE))
  const [models, setModels] = useState<ModelOption[] | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const settingsRef = useRef<Settings | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  // Every dive is kept; the one on screen is `diveId`. A graph saved by an older version becomes the first dive.
  const [dives, setDives] = useState<Dive[]>(() => {
    const saved = load<Dive[] | null>('rh.dives', null)
    if (saved) return saved
    const old = load<Graph | null>('rh.graph', null)
    return old ? [{ id: 'd1', updated: Date.now(), graph: old }] : []
  })
  const [diveId, setDiveId] = useState<string | null>(() => load<string | null>('rh.dive', null) ?? (load<Graph | null>('rh.graph', null) ? 'd1' : null))
  const [graph, setGraph] = useState<Graph | null>(() => dives.find((d) => d.id === diveId)?.graph ?? null)
  const [error, setError] = useState<string | null>(null)
  const [steerText, setSteerText] = useState('')
  const [seedText, setSeedText] = useState('')
  const [query, setQuery] = useState('')
  const [composing, setComposing] = useState(false)
  const [tab, setTab] = useState<'notes' | 'read'>('notes')
  const [exportMode, setExportMode] = useState<'md' | 'vault' | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set())
  const [wheeling, setWheeling] = useState(false)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const stageRef = useRef<HTMLElement>(null)
  const wheelTimer = useRef(0)
  const hoverTimer = useRef(0)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const ref = useRef<Graph | null>(graph)
  const modelRef = useRef(model)

  useEffect(() => { document.documentElement.dataset.theme = theme; save('rh.theme', theme); bridge?.setMenuState({ theme }).catch(() => {}) }, [theme])
  // Material 3: the seed color from Settings drives every color role; Settings saves it, this window follows.
  const [seed, setSeed] = useState(() => load('rh.seed', DEFAULT_SEED))
  useEffect(() => applyM3(theme, seed), [theme, seed])
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === 'rh.seed' && e.newValue) setSeed(JSON.parse(e.newValue)) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  // Platform styles: room for the macOS traffic lights or the Windows caption buttons, and native materials.
  useEffect(() => { document.documentElement.dataset.platform = bridge?.platform ?? 'web' }, [])
  useEffect(() => { modelRef.current = model; save('rh.model', model) }, [model])
  // The dive on screen joins the others at the top of the list; in-flight markers are dropped so a
  // reopened dive never looks stuck loading.
  const allDives = useMemo(() => (graph && diveId
    ? [{ id: diveId, updated: graph.updated ?? 0, graph: { ...graph, nodes: graph.nodes.map(({ loading: _l, researching: _r, ...n }) => n) } }, ...dives.filter((d) => d.id !== diveId)]
    : dives), [graph, diveId, dives])
  useEffect(() => { save('rh.dives', allDives); save('rh.dive', diveId) }, [allDives, diveId])
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => {
    if (bridge) {
      bridge.getSettings().then((s) => { setSettings(s); if (s.backend === OFFLINE) bridge!.openSettings() }).catch((e) => setServerError(e.message))
      return bridge.onSettingsChanged(setSettings)
    }
    listProxyModels().then(setModels).catch((e) => setServerError(`OpenCode server not reachable (${e.message}). Run "npm run opencode" for real research; the offline demo still works.`))
  }, [])
  // Desktop app: the backend chosen in Settings. Browser: the model picked in the header.
  // 'free' and 'offline' need no model; anything else is a model backend.
  const engine = () => (bridge ? settingsRef.current?.backend ?? FREE : modelRef.current === OFFLINE || modelRef.current === FREE ? modelRef.current : 'model')

  // All writes go through commit so async callbacks always build on the latest graph.
  const commit = useCallback((fn: (g: Graph) => void): Graph | null => {
    if (!ref.current) return null
    const next = clone(ref.current)
    fn(next)
    next.updated = Date.now()
    ref.current = next
    setGraph(next)
    return next
  }, [])

  // Undo history for re-roll, dismiss, steer and breadth; selection and note typing are not recorded.
  const past = useRef<Graph[]>([])
  const future = useRef<Graph[]>([])
  const snapshot = () => {
    if (!ref.current) return
    past.current.push(clone(ref.current))
    if (past.current.length > 30) past.current.shift()
    future.current = []
  }
  // Clearing loading/researching makes in-flight replies find their request id gone and drop.
  const restore = (g: Graph) => {
    g.nodes.forEach((n) => { n.loading = undefined; n.researching = undefined })
    ref.current = g
    setGraph(g)
    setPan({ x: 0, y: 0 })
    prefetched.current.clear()
    setUnfolded(new Set())
  }
  const undo = () => {
    const g = past.current.pop()
    if (!g || !ref.current) return
    future.current.push(clone(ref.current))
    restore(g)
  }
  const redo = () => {
    const g = future.current.pop()
    if (!g || !ref.current) return
    past.current.push(clone(ref.current))
    restore(g)
  }

  // Suggestions for one node, never touching the graph or the error banner: the caller decides what to show.
  const fetchSuggestions = useCallback(async (ctx: ExpandContext, kind: string, onPartial?: (items: Suggestion[]) => void): Promise<{ items: Suggestion[]; ref?: string; error?: string }> => {
    let items: Suggestion[] = []
    let ref: string | undefined
    let error: string | undefined
    try {
      if (kind === OFFLINE) items = mockSuggest(ctx)
      else if (kind === FREE) { const r = await wikiSuggest(ctx, onPartial && ((p) => onPartial(wikiItems(p)))); items = wikiItems(r.items); ref = r.ref }
      else {
        // Ground the model in the real article so it stays on topic; carry on without it if Wikipedia is down.
        // The model picks from (and words) real articles that already fit the path.
        const h = await wikiHints(ctx).catch(() => null)
        if (h) { ref = h.ref; ctx.hints = h.pool.map((p) => p.label) }
        const byLabel = new Map((h?.pool ?? []).map((p) => [p.label.toLowerCase(), p]))
        items = (await suggest(modelRef.current, ctx)).map((i) => { const p = byLabel.get(i.label.toLowerCase()); return p ? { ...p, teaser: i.teaser || p.teaser, tangent: i.tangent, origin: 'wiki' } : { ...i, origin: 'model' } })
      }
    } catch (e) {
      const msg = (e as Error).message
      if (kind === FREE || kind === OFFLINE) error = `Suggestions failed: ${msg}`
      else {
        try { const r = await wikiSuggest(ctx); items = wikiItems(r.items); ref = r.ref; error = `Suggestions failed: ${msg} Showing Wikipedia suggestions instead.` }
        catch { error = `Suggestions failed: ${msg}` }
      }
    }
    return { items, ref, error }
  }, [])

  // Prefetch the next level on the free engine only: cloud models cost money, the local one has two slots.
  // Results wait in the map until expand claims them; at most 2 run at once, extras are dropped.
  // r is filled once the fetch settles, so expand can skip the loading state entirely.
  type Fetched = { items: Suggestion[]; ref?: string; error?: string }
  const prefetched = useRef(new Map<string, { p: Promise<Fetched>; r?: Fetched }>())
  const inflight = useRef(0)
  const prefetch = useCallback((id: string) => {
    const g = ref.current
    const n = g && find(g, id)
    if (!g || !n || engine() !== FREE || inflight.current >= 2) return
    const key = `${id}:${g.spread}:${n.rolls}`
    if (prefetched.current.has(key)) return
    inflight.current++
    const e: { p: Promise<Fetched>; r?: Fetched } = { p: fetchSuggestions(contextFor(g, id), FREE) }
    prefetched.current.set(key, e)
    e.p.then((r) => { e.r = r }).finally(() => { inflight.current-- })
  }, [fetchSuggestions])

  const expand = useCallback(async (id: string) => {
    const req = reqSeq++
    const cur = ref.current
    const cn = cur && find(cur, id)
    const key = cn ? `${id}:${cur.spread}:${cn.rolls}` : ''
    const hit = prefetched.current.get(key)
    prefetched.current.delete(key)
    // A prefetch that already landed needs no loading state at all.
    const g = commit((g) => { clearGhosts(g, id); const n = find(g, id); if (n && !hit?.r) n.loading = req })
    if (!g || !find(g, id)) return
    const ctx = contextFor(g, id)
    // Free engine: aspects land first; show them while the rest loads (dropped if this request is superseded).
    const onPartial = (items: Suggestion[]) => { commit((g) => { const n = find(g, id); if (n && n.loading === req) mergeGhosts(g, id, items) }) }
    const { items, ref: found, error } = hit?.r ?? await (hit?.p ?? fetchSuggestions(ctx, engine(), engine() === FREE ? onPartial : undefined))
    if (error) setError(error)
    let applied = false
    const next = commit((g) => {
      const n = find(g, id)
      if (!n || (!hit?.r && n.loading !== req)) return
      applied = true
      n.loading = undefined
      if (found && !n.ref) n.ref = found
      // An error keeps what already streamed in.
      if (items.length) mergeGhosts(g, id, items)
    })
    // Warm the Go-deeper target (same pick as deeper()) while the user reads.
    if (applied && next) {
      const ghosts = kidsOf(next, id).filter((k) => k.status === 'ghost')
      const best = ghosts.find((k) => !k.tangent) ?? ghosts[0]
      if (best) prefetch(best.id)
    }
  }, [commit, fetchSuggestions, prefetch])

  const doResearch = useCallback(async (id: string) => {
    const req = reqSeq++
    const g = commit((g) => { const n = find(g, id); if (n) n.researching = req })
    if (!g || !find(g, id)) return
    const path = pathOf(g, id).map((n) => n.label)
    const ctx = contextFor(g, id)
    const kind = engine()
    let r: Research | undefined
    let ref: string | undefined
    try {
      if (kind === OFFLINE) r = mockResearch(path)
      else if (ctx.kind === 'aspect' && ctx.facet) r = await wikiAspectResearch(ctx.label, ctx.facet)
      else if (kind === FREE) {
        // Summary from Wikipedia; the open web adds other pages and what they say.
        const search = settingsRef.current?.search ?? 'web'
        const [w, web] = await Promise.all([
          ctx.offWiki ? Promise.resolve(null) : wikiResearch(ctx).catch(() => null),
          // The web search reads the node with what narrows it: its steer and the articles above.
          search === 'web' ? searchFor([ctx.label, ctx.steer, ...ctx.anchors.slice(0, 2).map((a) => a.label)].filter(Boolean).join(' '), 'web').catch(() => []) : Promise.resolve([]),
        ])
        const others = web.filter((x) => !x.url.includes('wikipedia.org')).slice(0, 5)
        const shown = others.map((x) => ({ ...x, snippet: x.snippet.slice(0, 280) }))
        if (w) {
          ref = w.ref
          r = { ...w.research, web: shown, sources: [...w.research.sources, ...others.map((x) => ({ title: x.title, url: x.url }))] }
        } else if (others.length) {
          // Not on Wikipedia (too new, too niche): the note comes from the web pages themselves.
          r = { summary: others[0].snippet.slice(0, 600), facts: [], web: shown.slice(1), sources: others.map((x) => ({ title: x.title, url: x.url })), verified: true }
        } else throw new Error(`Neither Wikipedia nor the web has anything on "${ctx.label}".`)
      }
      else r = await research(modelRef.current, path, settingsRef.current?.search ?? 'wikipedia')
      // Latest news on the node as the path reads it, when the free web search is on.
      if (r && bridge && kind !== OFFLINE && (settingsRef.current?.search ?? 'web') === 'web' && ctx.kind !== 'aspect') {
        const news = await bridge.news([ctx.label, ctx.steer, ctx.anchors[0]?.label].filter(Boolean).join(' ')).catch(() => [])
        if (news.length) r = { ...r, news: news.slice(0, 6) }
      }
    } catch (e) {
      setError(`Research failed: ${(e as Error).message}`)
    }
    commit((g) => {
      const n = find(g, id)
      if (!n || n.researching !== req) return
      n.researching = undefined
      if (ref && !n.ref) n.ref = ref
      if (r) n.research = r
    })
  }, [commit])

  const select = useCallback((id: string) => {
    setUnfolded(new Set())
    const g = commit((g) => { const n = find(g, id); if (n) { n.status = 'solid'; g.active = id } })
    if (!g) return
    setPan({ x: 0, y: 0 })
    const n = find(g, id)!
    if (!liveKids(g, id).length && !n.loading) expand(id)
    if (!n.research && !n.researching) doResearch(id)
  }, [commit, expand, doResearch])

  const startTopic = (e: FormEvent) => {
    e.preventDefault()
    const seed = seedText.trim()
    if (!seed) return
    const g = { ...newGraph(seed), updated: Date.now() }
    morph(() => {
      past.current = []; future.current = []; prefetched.current.clear(); setUnfolded(new Set())
      ref.current = g
      setDiveId(`d${Date.now().toString(36)}`)
      setGraph(g)
      setSeedText('')
      setZoom(1)
      setError(null)
      setComposing(false)
      select('root')
    })
  }

  const steer = (e: FormEvent) => {
    e.preventDefault()
    if (!ref.current) return
    narrow(ref.current.active, steerText)
    setSteerText('')
  }
  // Steering narrows the node itself and re-rolls what is under it; it never adds a node.
  const narrow = (id: string, words: string) => {
    snapshot()
    commit((g) => steerOn(g, id, words))
    expand(id)
    doResearch(id)
  }

  // A link clicked in the reader becomes a child of the node being read, and the reader follows it.
  const branch = (title: string) => {
    if (!ref.current) return
    const pid = ref.current.active
    let id = ''
    commit((g) => { id = linkNode(g, pid, title) })
    select(id)
  }

  const dismiss = (id: string) => { snapshot(); commit((g) => dismissNode(g, id)) }
  const reroll = () => {
    snapshot()
    const id = ref.current?.active
    if (!id) return
    commit((g) => { const n = find(g, id); if (n) n.rolls += 1 })
    expand(id)
  }
  const setSpread = (v: number) => {
    snapshot()
    const old = ref.current?.spread ?? v
    commit((g) => { g.spread = v })
    if (tangentsFor(v) !== tangentsFor(old) && ref.current) { prefetched.current.clear(); expand(ref.current.active) }
  }
  // Resting on a ghost card for 400 ms warms its children.
  const hoverGhost = (id: string, ghost: boolean) => {
    window.clearTimeout(hoverTimer.current)
    if (ghost) hoverTimer.current = window.setTimeout(() => prefetch(id), 400)
  }
  const deeper = useCallback(() => {
    const g = ref.current
    if (!g) return
    const ghosts = kidsOf(g, g.active).filter((n) => n.status === 'ghost')
    const best = ghosts.find((n) => !n.tangent) ?? ghosts[0]
    if (best) select(best.id)
  }, [select])

  // A new dive keeps the current one in the list; nothing is lost.
  const goHome = (compose: boolean) => morph(() => { past.current = []; future.current = []; prefetched.current.clear(); setUnfolded(new Set()); setDives(allDives); ref.current = null; setGraph(null); setDiveId(null); setError(null); setPan({ x: 0, y: 0 }); setZoom(1); setComposing(compose); setQuery('') })
  const newTopic = () => goHome(true)
  const openDive = (id: string, nodeId?: string) => {
    const d = allDives.find((x) => x.id === id)
    if (!d) return newTopic()
    morph(() => {
      past.current = []; future.current = []; prefetched.current.clear(); setUnfolded(new Set())
      setDives(allDives)
      const g = nodeId && d.graph.nodes.some((n) => n.id === nodeId) ? { ...d.graph, active: nodeId } : d.graph
      ref.current = g
      setGraph(g)
      setDiveId(id)
      setError(null)
      setPan({ x: 0, y: 0 })
      setZoom(1)
    })
  }
  const deleteDive = (id: string) => {
    const d = allDives.find((x) => x.id === id)
    if (d && confirm(`Delete the dive "${d.graph.nodes[0].label}"? This cannot be undone.`)) setDives(allDives.filter((x) => x.id !== id))
  }
  // Commands from the native menu bar (desktop app only). Kept in a ref so the listener is set once.
  // Text fields keep their own undo; true when the focused element took it.
  const textFieldUndo = (cmd: string) => document.activeElement?.matches('input, textarea, [contenteditable]') ? document.execCommand(cmd) || true : false
  const menuRef = useRef<(cmd: string) => void>(() => {})
  const fitRef = useRef<() => void>(() => {})
  const keysRef = useRef<HTMLDialogElement>(null)
  const steerRef = useRef<HTMLInputElement>(null)
  const toggleKeys = useCallback(() => { const d = keysRef.current; if (d) { if (d.open) d.close(); else d.showModal() } }, [])
  // Focus a card once `ready` matches: React renders the state change a frame or two after the key press.
  const focusCard = (id: string | undefined, ready = '', tries = 20, live = false) => {
    if (live) id = ref.current?.active
    if (!id) return
    const el = document.querySelector<HTMLElement>(`.card[data-id="${id}"]`)
    if (el && (!ready || document.querySelector(ready + (live ? `[data-id="${id}"]` : '')))) el.focus({ preventScroll: true })
    else if (tries) requestAnimationFrame(() => focusCard(id, ready, tries - 1, live))
  }
  useEffect(() => {
    menuRef.current = (cmd: string) => {
      const g = ref.current
      if (cmd === 'undo' || cmd === 'redo') return textFieldUndo(cmd) || (cmd === 'undo' ? undo() : redo())
      if (cmd.startsWith('theme:')) return setTheme(cmd.slice(6) as Theme)
      if (cmd === 'new-topic') return newTopic()
      if (cmd === 'shortcuts') return toggleKeys()
      if (!g) return
      const n = find(g, g.active)
      if (cmd === 'export-md') setExportMode('md')
      else if (cmd === 'export-vault') setExportMode('vault')
      else if (cmd === 'deeper') deeper()
      else if (cmd === 'up' && n?.parent) select(n.parent)
      else if (cmd === 'reroll') reroll()
      else if (cmd === 'research' && n) doResearch(n.id)
      else if (cmd === 'dismiss' && n?.parent) dismiss(n.id)
      else if (cmd.startsWith('breadth:')) setSpread(BREADTH[Number(cmd.slice(8))]?.spread ?? g.spread)
    }
  })
  useEffect(() => bridge?.onMenu((cmd) => menuRef.current(cmd)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      // Desktop gets undo from the Edit menu; this covers browser mode.
      if (!bridge && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (!textFieldUndo(e.shiftKey ? 'redo' : 'undo')) (e.shiftKey ? redo : undo)()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const typing = !!el.closest('input, textarea, select, [contenteditable]')
      if (typing) return
      const key = e.key.toLowerCase()
      if (e.key === '?') { e.preventDefault(); return toggleKeys() }
      const g = ref.current
      if (!g || keysRef.current?.open) return
      const onCard = !!el.closest('.card')
      // Focus follows the camera only when the keyboard was already on a card.
      const go = (fn: () => void) => {
        fn()
        if (onCard) requestAnimationFrame(() => focusCard(ref.current?.active, '.card.is-active', 20, true))
      }
      const cur = el.closest<HTMLElement>('.card')?.dataset.id
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const kids = liveKids(g, g.active)
        const i = cur ? kids.findIndex((n) => n.id === cur) : -1
        const next = e.key === 'ArrowDown' ? (cur ? kids[i + 1] : kids[0]) : i > 0 ? kids[i - 1] : i === 0 ? find(g, g.active) : undefined
        if (next) { e.preventDefault(); focusCard(next.id) }
      } else if (e.key === 'ArrowRight') { e.preventDefault(); go(deeper) }
      else if (e.key === 'ArrowLeft') { const p = find(g, g.active)?.parent; if (p) { e.preventDefault(); go(() => select(p)) } }
      else if (e.key === ' ' && !el.closest('button, a')) { e.preventDefault(); go(deeper) }
      else if (key === 'x' || e.key === 'Delete') {
        const n = cur ? find(g, cur) : undefined
        if (!n || n.parent !== g.active) return
        const sibs = liveKids(g, g.active)
        const i = sibs.findIndex((s) => s.id === n.id)
        const next = sibs[i + 1] ?? sibs[i - 1] ?? find(g, g.active)
        e.preventDefault()
        dismiss(n.id)
        requestAnimationFrame(() => focusCard(next?.id, `.card.is-dismissed[data-id="${n.id}"]`))
      } else if (key === 'r') { e.preventDefault(); reroll() }
      else if (key === 's') { e.preventDefault(); steerRef.current?.focus() }
      else if (key === 'f') { e.preventDefault(); fitRef.current() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // every render: the handler reads dismiss and reroll, which are not memoised

  // Drag the empty canvas to pan; a click on a card never starts a drag.
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (!graph || (e.target as HTMLElement).closest('.card-wrap, .fold-pill, .home, .minimap')) return
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y })
  }
  const onPointerUp = () => { drag.current = null; setDragging(false) }

  const saveVault = async () => {
    if (!graph) return
    const files = exportVault(graph)
    const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
    if (!picker) {
      download(`${graph.nodes[0].label} vault.md`, files.map((f) => `<!-- ${f.name} -->\n${f.text}`).join('\n\n'))
      return
    }
    try {
      const dir = await picker({ mode: 'readwrite' })
      for (const f of files) {
        const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable()
        await w.write(f.text)
        await w.close()
      }
      setExportMode(null)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(`Could not save the vault: ${(e as Error).message}`)
    }
  }

  const view = useMemo(() => (graph ? buildView(graph, unfolded) : null), [graph, unfolded])

  // Camera: world point P sits at origin + pan + zoom * (P - active). Origin is the .camera anchor (34%, 46%).
  const origin = { x: size.w * 0.34, y: size.h * 0.46 }
  const here = graph && view ? view.pos[graph.active] : null
  // Pan that puts world point p in the middle of the stage at the given zoom.
  const centreOn = (p: { x: number; y: number }, z: number) => here && setPan({ x: size.w / 2 - origin.x - z * (p.x - here.x), y: size.h / 2 - origin.y - z * (p.y - here.y) })
  const fit = () => {
    if (!graph || !view || !here || !size.w) return
    const ids = [...pathOf(graph, graph.active), ...kidsOf(graph, graph.active)].map((n) => n.id).filter((id) => view.pos[id])
    if (!ids.length) return
    const xs = ids.map((id) => view.pos[id].x), ys = ids.map((id) => view.pos[id].y)
    const x0 = Math.min(...xs) - 125, x1 = Math.max(...xs) + 125, y0 = Math.min(...ys) - 90, y1 = Math.max(...ys) + 90
    const z = Math.max(0.3, Math.min(1, size.w / (x1 - x0 + 120), size.h / (y1 - y0 + 120)))
    setZoom(z)
    centreOn({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, z)
  }
  useEffect(() => { fitRef.current = graph ? fit : () => {} })
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Native non-passive listener: React's onWheel is passive, so it could not stop the page zooming.
  const open = !!graph
  useEffect(() => {
    const el = stageRef.current
    if (!el || !open) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setWheeling(true)
      window.clearTimeout(wheelTimer.current)
      wheelTimer.current = window.setTimeout(() => setWheeling(false), 150)
      // Functional update: trackpads fire faster than re-renders, so no delta is lost to a stale pan.
      if (!e.ctrlKey) return setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
      const z = Math.max(0.3, Math.min(1.5, zoom * Math.exp(-e.deltaY * 0.01)))
      const r = el.getBoundingClientRect()
      const sx = e.clientX - r.left - size.w * 0.34, sy = e.clientY - r.top - size.h * 0.46
      // Keep the world point under the pointer fixed.
      setZoom(z)
      setPan({ x: sx - (z / zoom) * (sx - pan.x), y: sy - (z / zoom) * (sy - pan.y) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [open, pan, zoom, size])

  // Minimap: every live node scaled into 160x110; a click centres the camera on that point.
  const mini = (() => {
    if (!graph || !view || !here || !size.w) return null
    const live = graph.nodes.filter((n) => n.status !== 'dismissed' && view.pos[n.id])
    if (live.length <= 12) return null
    const xs = live.map((n) => view.pos[n.id].x), ys = live.map((n) => view.pos[n.id].y)
    const x0 = Math.min(...xs) - 125, y0 = Math.min(...ys) - 90
    const k = Math.min(160 / (Math.max(...xs) + 125 - x0), 110 / (Math.max(...ys) + 90 - y0))
    const ox = (160 - k * (Math.max(...xs) + 125 - x0)) / 2, oy = (110 - k * (Math.max(...ys) + 90 - y0)) / 2
    const onPath = new Set(pathOf(graph, graph.active).map((n) => n.id))
    const vx = here.x + (-origin.x - pan.x) / zoom, vy = here.y + (-origin.y - pan.y) / zoom
    return {
      k, ox, oy, x0, y0,
      dots: live.map((n) => ({ id: n.id, x: ox + k * (view.pos[n.id].x - x0) - 2, y: oy + k * (view.pos[n.id].y - y0) - 1.5, hot: onPath.has(n.id) })),
      box: { x: ox + k * (vx - x0), y: oy + k * (vy - y0), w: (k * size.w) / zoom, h: (k * size.h) / zoom },
    }
  })()
  const onMiniClick = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!mini) return
    const r = e.currentTarget.getBoundingClientRect()
    centreOn({ x: (e.clientX - r.left - mini.ox) / mini.k + mini.x0, y: (e.clientY - r.top - mini.oy) / mini.k + mini.y0 }, zoom)
  }
  const a = graph && view ? find(graph, graph.active)! : null
  const onGraph = new Set((graph?.nodes ?? []).filter((n) => n.status === 'solid').flatMap((n) => [n.label.toLowerCase(), (n.ref ?? '').toLowerCase()]))
  const [last, ...earlier] = [...allDives].sort((x, y) => y.updated - x.updated)
  // Search: a dive matches when an opened node's label, summary or note contains the query.
  const q = query.trim().toLowerCase()
  // Only opened nodes: a suggestion never opened is not somewhere you have been.
  const hitsOf = (n: GraphNode, g: Graph) => n.status === 'solid' && [n.label, n.research?.summary, g.notes[n.id]].some((s) => s?.toLowerCase().includes(q))
  const rows: { d: Dive; ns: GraphNode[] }[] = q
    ? allDives.map((d) => ({ d, ns: d.graph.nodes.filter((n) => hitsOf(n, d.graph)) })).filter((r) => r.ns.length > 0)
    : earlier.map((d) => ({ d, ns: [] }))
  const recent = [...allDives].sort((x, y) => y.updated - x.updated).slice(0, 12)
  const stops = allDives.reduce((t, d) => t + d.graph.nodes.filter((n) => n.status === 'solid').length, 0)

  return (
    <div className="app">
      <nav className="side" aria-label="Dives">
        <div className="side-top">
          {graph && <button type="button" className="logo" onClick={() => goHome(false)} aria-label="Home: all your dives" title="All your dives"><Logo /><span>Rabbithole</span></button>}
        </div>
        <button type="button" className={`nav-item${graph ? '' : ' on'}`} aria-current={graph ? undefined : 'page'} onClick={() => goHome(false)}><HomeIcon />Home</button>
        <button type="button" className="nav-item" onClick={newTopic}><Plus />New dive</button>
        {recent.length > 0 && <h2 className="side-h">Recent dives</h2>}
        <ul className="side-list">
          {recent.map((d) => (
            <li key={d.id}>
              <button type="button" className={`nav-item${d.id === diveId ? ' on' : ''}`} aria-current={d.id === diveId ? 'page' : undefined} onClick={() => openDive(d.id)}>
                <span className="dot" aria-hidden="true" /><span className="grow ellipsis">{d.graph.nodes[0].label}</span>
                <span className="count">{d.graph.nodes.filter((n) => n.status === 'solid').length}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="spacer" />
        {bridge ? (
          <button type="button" className="nav-item" onClick={() => bridge!.openSettings()}><Gear />Settings</button>
        ) : (
          <div className="side-fields">
            <label className="sr-only" htmlFor="model">AI model</label>
            <select id="model" className="field" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value={FREE}>Free: Wikipedia</option>
              <option value={OFFLINE}>Offline demo</option>
              {models?.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              {model !== OFFLINE && model !== FREE && models && !models.some((m) => m.value === model) && <option value={model}>{model}</option>}
            </select>
            <label className="sr-only" htmlFor="theme">Theme</label>
            <select id="theme" className="field" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              {THEMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        )}
      </nav>

      <div className="main">
        {/* Where you are, then the actions on this view. */}
        <header className="header">
          {graph ? (
            <nav className="crumbs" aria-label="Breadcrumb">
              <ol>
                {pathOf(graph, graph.active).map((n, i, all) => (
                  <li key={n.id}>
                    {i > 0 && <span className="sep" aria-hidden="true">›</span>}
                    <button type="button" aria-current={i === all.length - 1 ? 'page' : undefined} onClick={() => select(n.id)}>{n.label}</button>
                  </li>
                ))}
              </ol>
            </nav>
          ) : <span className="header-title">Home</span>}
          <div className="spacer" />
          {graph && a && (
            <div className="toolbar" role="toolbar" aria-label="Dive actions">
              <button type="button" className="btn" onClick={reroll} disabled={!!a.loading}>Re-roll</button>
              <button type="button" className="btn" onClick={fit} title="Fit the path on screen (F)">Fit</button>
              <div className="segmented" role="group" aria-label="Breadth of suggestions">
                {BREADTH.map((b, i) => (
                  <button key={b.label} type="button" aria-pressed={tangentsFor(graph.spread) === i}
                    title={`${4 - i} deeper, ${i} tangent${i === 1 ? '' : 's'}`} onClick={() => setSpread(b.spread)}>{b.label}</button>
                ))}
              </div>
              <button type="button" className="btn btn-go" onClick={deeper}>Go deeper <kbd>Space</kbd></button>
            </div>
          )}
        </header>

      <div className="body">
        <main
          ref={stageRef}
          className={`stage${dragging ? ' dragging' : ''}${wheeling ? ' wheeling' : ''}`}
          onDoubleClick={(e) => { if (graph && !(e.target as HTMLElement).closest('.card-wrap, .fold-pill, .home, .minimap')) { setZoom(1); setPan({ x: 0, y: 0 }) } }}
          aria-label="Graph. Press Space to go deeper."
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        >
          {!graph || !view ? (
            // Home: the logo, one question, one box, where you left off, then earlier dives.
            <div className="home">
              <div className="home-col">
                <div className="brandmark m-in" style={{ '--i': 0 } as CSSProperties}><Mark /><span className="wordmark">Rabbithole</span></div>
                {allDives.length > 0 && <p className="label m-in" style={{ '--i': 1 } as CSSProperties}>{allDives.length} {allDives.length === 1 ? 'dive' : 'dives'} · {stops} stops</p>}
                <h1 className="question m-in" style={{ '--i': 1 } as CSSProperties}>What are you curious about?</h1>
                <form className="ask m-in" style={{ '--i': 2 } as CSSProperties} onSubmit={startTopic}>
                  <label className="sr-only" htmlFor="seed">Topic</label>
                  <input id="seed" className="field" autoFocus={composing || !last} placeholder="A topic, a person, a song…" value={seedText} onChange={(e) => setSeedText(e.target.value)} />
                  <button type="submit" className="btn btn-go" disabled={!seedText.trim()}>Start a dive</button>
                </form>
                {(bridge ? settings?.backend === OFFLINE : model === OFFLINE) && <p className="muted">Offline demo has car data only. {bridge ? 'Open Settings to pick a backend' : 'Pick a model in the sidebar'} for any topic.</p>}
                {serverError && <p className="error">{serverError}</p>}
                {last && (
                  <button type="button" className="resume m-in" style={{ '--i': 3 } as CSSProperties} onClick={() => openDive(last.id)}>
                    <svg className="resume-mark" width="48" height="48" viewBox="0 0 48 48" aria-hidden="true"><path className="resume-shape" /><path d="M19 15l14 9-14 9z" fill="var(--active)" /></svg>
                    <span className="resume-text">
                      <span className="label">Continue where you left off</span>
                      <b>{find(last.graph, last.graph.active)?.label ?? last.graph.nodes[0].label}</b>
                      <span className="trail">{pathOf(last.graph, last.graph.active).map((n) => n.label).join(' › ')} · {last.graph.nodes.filter((n) => n.status === 'solid').length} stops · {ago(last.updated)}</span>
                    </span>
                    <Arrow />
                  </button>
                )}
                {allDives.length >= 2 && (
                  <input type="search" className="field toc-search" placeholder="Search your dives" aria-label="Search your dives" value={query} onChange={(e) => setQuery(e.target.value)} />
                )}
                {query.trim() && rows.length === 0 && <p className="label">Nothing in your dives matches "{query}".</p>}
                {rows.length > 0 && (
                  <section className="toc m-in" style={{ '--i': 4 } as CSSProperties} aria-labelledby="dives-title">
                    <h2 id="dives-title" className="label">{q ? 'Matches' : 'Earlier dives'}</h2>
                    <ul>
                      {rows.map(({ d, ns }) => (
                        <Fragment key={d.id}>
                          <li>
                            <button type="button" className="toc-row" onClick={() => openDive(d.id)} title={deepestTrail(d.graph)}>
                              <span className="toc-title">{d.graph.nodes[0].label}</span>
                              <span className="leader" aria-hidden="true" />
                              <span className="toc-meta">{d.graph.nodes.filter((n) => n.status === 'solid').length} stops · {ago(d.updated)}</span>
                            </button>
                            <button type="button" className="icon-btn del" aria-label={`Delete dive ${d.graph.nodes[0].label}`} title="Delete dive" onClick={() => deleteDive(d.id)}><X /></button>
                          </li>
                          {ns.length > 0 && (
                            <li className="toc-hits">
                              {ns.slice(0, 3).map((n) => <button key={n.id} type="button" className="link-btn toc-hit" onClick={() => openDive(d.id, n.id)}>{n.label}</button>)}
                            </li>
                          )}
                        </Fragment>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            </div>
          ) : (
            <div className="camera" style={{ transform: `translate(${pan.x - zoom * view.pos[graph.active].x}px, ${pan.y - zoom * view.pos[graph.active].y}px) scale(${zoom})` }}>
              {view.rail.map((r) => <div key={r.depth} className="rail" style={{ left: r.x, top: r.y }}><b>{r.name}</b><span>{r.count}</span></div>)}
              {view.edges.map((e) => <div key={e.id} className="edge" style={e.style} />)}
              {view.skeletons.map((k) => (
                <div key={k.id} className="card-wrap" style={{ left: k.at.x, top: k.at.y, width: 180 }} aria-hidden="true">
                  <div className="card skeleton"><span /><span /><span /></div>
                </div>
              ))}
              {view.folds.map((f) => (
                <button key={`fold-${f.id}`} type="button" className="fold-pill" style={{ left: f.at.x, top: f.at.y }} aria-label={`Show ${f.count} more under ${f.label}`} onClick={() => setUnfolded((u) => new Set(u).add(f.id))}>+{f.count} more</button>
              ))}
              {view.cards.map((c) => (
                <div key={c.n.id} className="card-wrap" style={c.wrap}>
                  <button type="button" className={c.cls} data-id={c.n.id} style={c.style} onClick={() => select(c.n.id)} onPointerEnter={() => hoverGhost(c.n.id, c.cls.includes('is-ghost'))} onPointerLeave={() => window.clearTimeout(hoverTimer.current)} aria-label={c.aria}>
                    {c.aspect && <svg className="shape" viewBox="0 0 120 120" aria-hidden="true"><path d={c.n.label.length % 2 ? BURST : CLOVER} /></svg>}
                    {c.tag && <span className={`tag${c.busy ? ' pulse' : ''}`} style={{ color: c.tagColor }}>{c.tag}</span>}
                    {c.badge && <span className="card-badge" title={c.badge === 'AI' ? 'Suggested by the AI model, not found on Wikipedia' : 'Found on the web, not on Wikipedia'}>{c.badge}</span>}
                    <span className="title" style={c.titleStyle}>{c.n.label}</span>
                    {c.body && <span className="body" style={{ WebkitLineClamp: c.lines }}>{c.body}</span>}
                  </button>
                  {c.n.status === 'ghost' && (
                    <button type="button" className="card-x" aria-label={`Dismiss ${c.n.label}`} onClick={() => dismiss(c.n.id)}><X /></button>
                  )}
                </div>
              ))}
            </div>
          )}
          {mini && (
            <svg className="minimap" width="160" height="110" viewBox="0 0 160 110" aria-hidden="true" onPointerDown={onMiniClick}>
              {mini.dots.map((d) => <rect key={d.id} x={d.x} y={d.y} width="4" height="3" fill={d.hot ? 'var(--path)' : 'var(--muted)'} />)}
              <rect x={mini.box.x} y={mini.box.y} width={mini.box.w} height={mini.box.h} fill="none" stroke="var(--active)" strokeWidth="1" />
            </svg>
          )}
        </main>

        {graph && a && (
          <aside className="panel" aria-label="Node details">
            {a.steer && (
              <p className="steer-chip">
                <span className="signal" aria-hidden="true" />
                <span className="grow">Narrowed to <b>{a.steer}</b></span>
                <button type="button" className="link-btn" aria-label={`Clear the steer "${a.steer}"`} onClick={() => narrow(a.id, '')}>Clear</button>
              </p>
            )}
            <div>
              <div className="label">{a.parent ? `Depth ${pathOf(graph, a.id).length - 1}` : 'Seed'}</div>
              <h1>{a.label}</h1>
              {a.parent && <div className="path">{pathOf(graph, a.id).slice(0, -1).map((n) => n.label).join(' › ')}</div>}
            </div>
            {a.ref && (
              <div className="segmented tabs" role="tablist" aria-label="Panel">
                <button type="button" role="tab" aria-selected={tab === 'notes'} aria-pressed={tab === 'notes'} onClick={() => setTab('notes')}>Notes</button>
                <button type="button" role="tab" aria-selected={tab === 'read'} aria-pressed={tab === 'read'} onClick={() => setTab('read')}>Read</button>
              </div>
            )}
            {error && <p className="error" role="alert">{error} <button type="button" className="btn" onClick={() => setError(null)}>Dismiss</button></p>}

            {tab === 'read' && a.ref ? <Reader title={a.ref} onBranch={branch} onGraph={onGraph} /> : (<>
            <form className="steer" onSubmit={steer}>
              <label className="sr-only" htmlFor="steer">Narrow this node with your own words</label>
              <input id="steer" ref={steerRef} className="field" placeholder={a.steer ? 'Narrow it differently' : `Narrow ${a.label}: a kind, an era, a place`} value={steerText} onChange={(e) => setSteerText(e.target.value)} />
              <button type="submit" className="btn" disabled={!steerText.trim()}>Steer</button>
            </form>

            <section>
              <h2>Summary</h2>
              {a.researching && !a.research ? <p className="muted pulse">Researching {a.label}…</p> : <p>{a.research ? cited(a.research.summary, a.research.sources) : a.teaser ?? 'No research yet.'}</p>}
            </section>
            {!!a.research?.facts.length && (
              <section>
                <h2>Key facts</h2>
                <dl className="facts">{a.research.facts.map((f) => <div key={f.k}><dt>{f.k}</dt><dd>{f.v}</dd></div>)}</dl>
              </section>
            )}
            <section>
              <h2>Suggestions</h2>
              {a.loading ? <p className="muted pulse">Finding where to go next…</p> : null}
              {!a.loading && !kidsOf(graph, a.id).some((n) => n.status === 'ghost') && <p className="muted">No suggestions left. Re-roll or steer to get more.</p>}
              <ul className="list">
                {kidsOf(graph, a.id).filter((n) => n.status === 'ghost').map((n) => (
                  <li key={n.id} className="sugg">
                    <button type="button" className="open" onClick={() => select(n.id)}>
                      <b style={{ fontStyle: n.tangent ? 'italic' : 'normal' }}>{n.label}{n.tangent && <span> · tangent</span>}</b>
                      <span>{n.teaser}</span>
                    </button>
                    <button type="button" className="x" aria-label={`Dismiss ${n.label}`} onClick={() => dismiss(n.id)}><X /></button>
                  </li>
                ))}
              </ul>
            </section>
            {!!a.research?.web?.length && (
              <section>
                <h2>From the web</h2>
                <ul className="list web">
                  {a.research.web.map((w) => (
                    <li key={w.url}>
                      <a href={w.url} target="_blank" rel="noreferrer noopener">{w.title}</a>
                      <span className="host">{new URL(w.url).hostname.replace(/^www\./, '')}</span>
                      {w.snippet && <p>{w.snippet}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {!!a.research?.news?.length && (
              <section>
                <h2>Latest news</h2>
                <ul className="list news">
                  {a.research.news.map((n) => (
                    <li key={n.url}>
                      <a href={n.url} target="_blank" rel="noreferrer noopener">{n.title}</a>
                      <span className="host">{[n.source, Number.isFinite(Date.parse(n.date)) && ago(Date.parse(n.date))].filter(Boolean).join(' · ')}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {!!a.research?.sources.length && (
              <section>
                <h2>Sources</h2>
                <ul className="list">{a.research.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a></li>)}</ul>
              </section>
            )}
            <section>
              <label className="h2" htmlFor="notes">Your notes</label>
              <textarea id="notes" className="field" rows={3} placeholder="Write your own notes on this node." value={graph.notes[a.id] ?? ''}
                onChange={(e) => { const v = e.target.value; commit((g) => { g.notes[a.id] = v }) }} />
            </section>
            <div className="quiet-actions">
              <button type="button" className="link-btn" onClick={() => doResearch(a.id)} disabled={!!a.researching}>Research again</button>
              <button type="button" className="link-btn" onClick={() => dismiss(a.id)} disabled={!a.parent}>Dismiss node</button>
              <button type="button" className="link-btn" onClick={() => setExportMode('md')}>Export dive…</button>
            </div>
            </>)}
          </aside>
        )}
      </div>
        <footer className="status" aria-label="Status">
          {graph && a ? <><span>depth {pathOf(graph, a.id).length - 1}</span><span>{graph.nodes.filter((n) => n.status === 'solid').length} opened</span></> : <span>{allDives.length} dives</span>}
          <span>{(settings?.search ?? 'web') === 'web' ? 'web search on' : `search: ${settings?.search ?? 'wikipedia'}`}</span>
        </footer>
      </div>

      {exportMode && graph && (
        <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) setExportMode(null) }}>
          <div className="dialog" role="dialog" aria-modal="true" aria-label={exportMode === 'md' ? 'Markdown trail' : 'Obsidian vault'}>
            <div className="dialog-head">
              <h2>Export</h2>
              <div className="segmented" role="group" aria-label="Export format">
                <button type="button" aria-pressed={exportMode === 'md'} onClick={() => setExportMode('md')}>Markdown</button>
                <button type="button" aria-pressed={exportMode === 'vault'} onClick={() => setExportMode('vault')}>Obsidian vault</button>
              </div>
              <button type="button" className="btn" onClick={() => setExportMode(null)}>Close</button>
            </div>
            <p className="muted">
              {exportMode === 'md'
                ? 'Every opened node as a nested outline, with summaries and your notes.'
                : 'One note per opened node, linked with [[wikilinks]]. Pick your vault folder and the notes are written into it.'}
            </p>
            <pre>{exportMode === 'md' ? exportMarkdown(graph) : exportVault(graph).map((f) => `# ${f.name}\n${f.text}`).join('\n')}</pre>
            <div className="dialog-actions">
              {exportMode === 'md'
                ? <button type="button" className="btn btn-primary" onClick={() => download(`${graph.nodes[0].label}.md`, exportMarkdown(graph))}>Download .md</button>
                : <button type="button" className="btn btn-primary" onClick={saveVault}>Save to vault folder</button>}
            </div>
          </div>
        </div>
      )}
      <dialog ref={keysRef} className="keys" aria-labelledby="keys-title">
        <div className="dialog-head">
          <h2 id="keys-title">Keyboard shortcuts</h2>
          <button type="button" className="btn" onClick={() => keysRef.current?.close()}>Close</button>
        </div>
        <dl>
          {([['↓ ↑', 'Move between suggestions'], ['→ or Space', 'Go deeper'], ['←', 'Go up'], ['Enter', 'Open the focused card'], ['X or Delete', 'Dismiss the focused card'], ['R', 'Re-roll'], ['S', 'Steer'], ['F', 'Fit the path on screen'], ['⌘Z / Ctrl+Z', 'Undo'], ['?', 'Show or hide this list']] as const).map(([k, d]) => (
            <Fragment key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></Fragment>
          ))}
        </dl>
      </dialog>
    </div>
  )
}

// Wikipedia suggestions: an item Wikidata knows but Wikipedia lacks is researched from the web.
function wikiItems(items: Suggestion[]): Suggestion[] {
  return items.map((s) => ({ ...s, origin: s.offWiki ? 'web' : 'wiki' }))
}

// Positions, edges and card styles for one render of the graph.
function buildView(g: Graph, unfolded: Set<string>) {
  const { pos, folds: foldCounts } = relayout(g, unfolded)
  const onPath = new Set(pathOf(g, g.active).map((n) => n.id))
  const byId = new Map(g.nodes.map((n) => [n.id, n]))

  const edges = g.nodes.filter((n) => n.parent && pos[n.parent] && pos[n.id]).map((n) => {
    const p = pos[n.parent!], q = pos[n.id]
    const dx = q.x - p.x, dy = q.y - p.y
    const border = onPath.has(n.id) && onPath.has(n.parent!) ? '2px solid var(--path)'
      : n.status === 'dismissed' ? '1px dotted var(--edge-faint)'
      : n.status === 'ghost' ? `1px dashed ${n.tangent ? 'var(--tangent)' : n.parent === g.active ? 'var(--edge)' : 'var(--edge-faint)'}`
      : '1.5px solid var(--edge)'
    return {
      id: n.id,
      style: {
        left: p.x, top: p.y, width: Math.hypot(dx, dy), borderTop: border,
        transform: `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`,
        opacity: n.status === 'ghost' && n.parent !== g.active ? 0.5 : 1,
      },
    }
  })
  // Placeholder cards (and their edges) for a node whose suggestions are loading.
  const skeletons = g.nodes.filter((n) => n.loading).flatMap((n) =>
    Array.from({ length: SKELETONS }, (_, i) => ({ id: `${n.id}~sk${i}`, from: pos[n.id], at: pos[`${n.id}~sk${i}`] })).filter((s) => s.at))
  for (const s of skeletons) {
    const dx = s.at.x - s.from.x, dy = s.at.y - s.from.y
    edges.push({ id: s.id, style: { left: s.from.x, top: s.from.y, width: Math.hypot(dx, dy), borderTop: '1px dashed var(--edge-faint)', transform: `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`, opacity: 1 } })
  }

  const cards = g.nodes.filter((n) => pos[n.id]).map((n: GraphNode) => {
    const ghost = n.status === 'ghost', dis = n.status === 'dismissed'
    const isActive = n.id === g.active, isRoot = !n.parent
    const busy = !!(n.loading || n.researching)
    const border = isActive ? 'var(--active-border)'
      : ghost ? `1.5px dashed ${n.tangent ? 'var(--tangent)' : 'var(--muted)'}`
      : dis ? '1px dotted var(--muted)'
      : n.steered ? '2px solid var(--steer-ring)'
      : isRoot ? '2px solid var(--node-solid)' : '1px solid var(--ctrl-border)'
    const aspect = kindOf(n) === 'aspect'
    const tag = busy ? (n.loading ? 'thinking' : 'researching') : isActive ? (n.steer ? `active · ${n.steer}` : 'active') : n.steer ? n.steer : n.steered ? 'steered' : n.tangent ? 'tangent' : dis ? 'dismissed' : aspect ? 'aspect' : isRoot ? 'seed' : ''
    return {
      n, busy, tag, aspect,
      badge: n.origin === 'model' ? 'AI' : n.origin === 'web' ? 'Web' : '',
      tagColor: isActive ? 'var(--active-fg2)' : n.steered ? 'var(--eyebrow)' : 'var(--text2)',
      aria: `${ghost ? 'Open suggestion' : dis ? 'Restore' : 'Focus'} ${n.label}`,
      body: dis || (ghost && n.parent !== g.active) ? '' : ghost ? n.teaser ?? '' : (n.research ? stripCites(n.research.summary) : n.teaser ?? ''),
      cls: `card${aspect ? ' aspect' : ''}${isActive ? ' is-active' : ''}${ghost ? ' is-ghost' : ''}${dis ? ' is-dismissed' : ''}${isRoot ? ' is-root' : ''}`,
      lines: isActive ? 5 : 2,
      wrap: {
        left: pos[n.id].x, top: pos[n.id].y,
        width: isActive ? 250 : isRoot ? 220 : dis ? 130 : ghost ? 180 : 200,
        // Text keeps full contrast everywhere; distance is shown by size and border, not fading.
        opacity: 1,
      },
      style: {
        padding: dis ? '6px 10px' : isActive ? '14px 16px' : '10px 12px',
        border, background: ghost || dis ? 'var(--ghost-bg)' : isActive ? 'var(--active-bg)' : 'var(--surface)', boxShadow: isActive ? 'var(--halo)' : undefined,
      },
      titleStyle: {
        fontFamily: isActive || isRoot ? 'var(--display)' : 'var(--sans)',
        fontSize: isActive ? 'var(--title-size)' : dis ? 12 : 14,
        fontWeight: ghost || dis ? 400 : isActive || isRoot ? 600 : 500,
        fontStyle: n.tangent ? 'italic' : 'normal',
        color: isActive ? 'var(--active-fg)' : ghost ? (n.tangent ? 'var(--tangent-text)' : 'var(--text2)') : dis ? 'var(--text2)' : 'var(--text)',
        textDecoration: 'none',
      },
    }
  })

  // Depth rail: a label above each column, saying what that depth holds.
  const cols = new Map<number, { top: number; opened: number; suggested: number }>()
  for (const n of g.nodes) {
    const p = pos[n.id]
    if (!p || n.status === 'dismissed') continue
    const d = Math.round(p.x / COLUMN)
    const c = cols.get(d) ?? { top: Infinity, opened: 0, suggested: 0 }
    c.top = Math.min(c.top, p.y - (n.id === g.active ? 100 : 60))
    if (n.status === 'ghost') c.suggested++; else c.opened++
    cols.set(d, c)
  }
  const rail = [...cols.entries()].map(([depth, c]) => ({
    depth, x: depth * COLUMN, y: c.top - 28, name: depth ? `Depth ${depth}` : 'Seed',
    count: depth ? [c.opened && `${c.opened} opened`, c.suggested && `${c.suggested} suggested`].filter(Boolean).join(' · ') : '',
  }))
  const folds = Object.entries(foldCounts).map(([id, count]) => ({ id, count, label: byId.get(id)!.label, at: { x: pos[id].x, y: pos[id].y + 70 } }))
  return { pos, folds, edges, cards, skeletons, rail }
}
