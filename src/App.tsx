import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  addGhosts, clearGhosts, contextFor, dismissNode, exportMarkdown, exportVault, find, kidsOf, liveKids,
  modeFor, newGraph, pathOf, relayout, steerNode, tangentsFor,
} from './graph.ts'
import type { Graph, GraphNode, Research, Suggestion } from './graph.ts'
import { bridge, listProxyModels, research, suggest } from './ai.ts'
import type { ModelOption, Settings } from './ai.ts'
import { SettingsDialog } from './Settings.tsx'
import { mockResearch, mockSuggest } from './mock.ts'

type Theme = 'dark' | 'warm' | 'nothing'
const THEMES: { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Obsidian dark' },
  { value: 'warm', label: 'Claude Warm' },
  { value: 'nothing', label: 'Nothing OS 5' },
]
const OFFLINE = 'offline'

// Browser storage is a per-viewer convenience only; every access is guarded.
const load = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback } catch { return fallback }
}
const save = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ } }

const clone = (g: Graph): Graph => ({ ...g, nodes: g.nodes.map((n) => ({ ...n })), notes: { ...g.notes } })
let reqSeq = 1

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

const X = () => (
  <svg width="9" height="9" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 1 7 7M7 1 1 7" stroke="currentColor" strokeWidth="1.4" /></svg>
)

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => load('rh.theme', 'dark'))
  const [model, setModel] = useState<string>(() => load('rh.model', OFFLINE))
  const [models, setModels] = useState<ModelOption[] | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const settingsRef = useRef<Settings | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [graph, setGraph] = useState<Graph | null>(() => load<Graph | null>('rh.graph', null))
  const [error, setError] = useState<string | null>(null)
  const [steerText, setSteerText] = useState('')
  const [seedText, setSeedText] = useState('')
  const [exportMode, setExportMode] = useState<'md' | 'vault' | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const ref = useRef<Graph | null>(graph)
  const modelRef = useRef(model)

  useEffect(() => { document.documentElement.dataset.theme = theme; save('rh.theme', theme) }, [theme])
  useEffect(() => { modelRef.current = model; save('rh.model', model) }, [model])
  useEffect(() => {
    // Drop in-flight markers from a previous visit before saving.
    save('rh.graph', graph && { ...graph, nodes: graph.nodes.map(({ loading: _l, researching: _r, ...n }) => n) })
  }, [graph])
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => {
    if (bridge) {
      bridge.getSettings().then((s) => { setSettings(s); if (s.backend === OFFLINE) setShowSettings(true) }).catch((e) => setServerError(e.message))
      return
    }
    listProxyModels().then(setModels).catch((e) => setServerError(`OpenCode server not reachable (${e.message}). Run "npm run opencode" for real research; the offline demo still works.`))
  }, [])
  // Desktop app: the backend chosen in Settings. Browser: the model picked in the header.
  const isOffline = () => (bridge ? (settingsRef.current?.backend ?? OFFLINE) === OFFLINE : modelRef.current === OFFLINE)

  // All writes go through commit so async callbacks always build on the latest graph.
  const commit = useCallback((fn: (g: Graph) => void): Graph | null => {
    if (!ref.current) return null
    const next = clone(ref.current)
    fn(next)
    ref.current = next
    setGraph(next)
    return next
  }, [])

  const expand = useCallback(async (id: string) => {
    const req = reqSeq++
    const g = commit((g) => { clearGhosts(g, id); const n = find(g, id); if (n) n.loading = req })
    if (!g || !find(g, id)) return
    const ctx = contextFor(g, id)
    let items: Suggestion[]
    try {
      items = isOffline() ? mockSuggest(ctx) : await suggest(modelRef.current, ctx)
    } catch (e) {
      setError(`Suggestions failed: ${(e as Error).message} Showing offline demo suggestions instead.`)
      items = mockSuggest(ctx)
    }
    commit((g) => {
      const n = find(g, id)
      if (!n || n.loading !== req) return
      n.loading = undefined
      addGhosts(g, id, items)
    })
  }, [commit])

  const doResearch = useCallback(async (id: string) => {
    const req = reqSeq++
    const g = commit((g) => { const n = find(g, id); if (n) n.researching = req })
    if (!g || !find(g, id)) return
    const path = pathOf(g, id).map((n) => n.label)
    let r: Research | undefined
    try {
      r = isOffline() ? mockResearch(path) : await research(modelRef.current, path, (settingsRef.current?.search ?? 'none') !== 'none')
    } catch (e) {
      setError(`Research failed: ${(e as Error).message}`)
    }
    commit((g) => {
      const n = find(g, id)
      if (!n || n.researching !== req) return
      n.researching = undefined
      if (r) n.research = r
    })
  }, [commit])

  const select = useCallback((id: string) => {
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
    const g = newGraph(seed)
    ref.current = g
    setGraph(g)
    setSeedText('')
    setError(null)
    select('root')
  }

  const steer = (e: FormEvent) => {
    e.preventDefault()
    const label = steerText.trim()
    if (!label || !ref.current) return
    const pid = ref.current.active
    let id = ''
    commit((g) => { id = steerNode(g, pid, label) })
    setSteerText('')
    expand(pid) // re-roll the siblings with the new hint
    select(id)
  }

  const dismiss = (id: string) => commit((g) => dismissNode(g, id))
  const reroll = () => {
    const id = ref.current?.active
    if (!id) return
    commit((g) => { const n = find(g, id); if (n) n.rolls += 1 })
    expand(id)
  }
  const setSpread = (v: number) => {
    const old = ref.current?.spread ?? v
    commit((g) => { g.spread = v })
    if (tangentsFor(v) !== tangentsFor(old) && ref.current) expand(ref.current.active)
  }
  const deeper = useCallback(() => {
    const g = ref.current
    if (!g) return
    const ghosts = kidsOf(g, g.active).filter((n) => n.status === 'ghost')
    const best = ghosts.find((n) => !n.tangent) ?? ghosts[0]
    if (best) select(best.id)
  }, [select])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key !== ' ' || el.closest('input, textarea, select, button, a, [contenteditable]')) return
      e.preventDefault()
      deeper()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deeper])

  // Drag the empty canvas to pan; a click on a card never starts a drag.
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (!graph || (e.target as HTMLElement).closest('.card-wrap, .bar, .legend, .seed')) return
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

  const view = useMemo(() => (graph ? buildView(graph) : null), [graph])
  const a = graph && view ? find(graph, graph.active)! : null

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="7" y="7" width="8" height="8" rx="2" fill="var(--active)" /><rect x="1" y="3" width="5" height="4" rx="1" fill="var(--muted)" />
            <rect x="16" y="4" width="5" height="4" rx="1" fill="var(--muted)" /><rect x="13" y="17" width="5" height="4" rx="1" fill="var(--muted)" />
            <path d="M11 11 3 5M11 11 19 6M11 11 16 19" stroke="var(--edge)" strokeWidth="1" />
          </svg>
          <span>Rabbithole</span>
        </div>
        <nav className="crumbs" aria-label="Breadcrumb">
          <ol>
            {graph && pathOf(graph, graph.active).map((n, i, all) => (
              <li key={n.id}>
                {i > 0 && <span className="sep" aria-hidden="true">›</span>}
                <button type="button" aria-current={i === all.length - 1 ? 'page' : undefined} onClick={() => select(n.id)}>{n.label}</button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="header-tools">
          {graph && <span className="stats">{graph.nodes.filter((n) => n.status !== 'dismissed').length} nodes · depth {pathOf(graph, graph.active).length - 1}</span>}
          {bridge ? (
            <button type="button" className="btn" onClick={() => setShowSettings(true)}>
              Settings · {settings?.backends.find((b) => b.id === settings.backend)?.label ?? '…'}
            </button>
          ) : <>
            <label className="sr-only" htmlFor="model">AI model</label>
            <select id="model" className="field" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value={OFFLINE}>Offline demo</option>
              {models?.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              {model !== OFFLINE && models && !models.some((m) => m.value === model) && <option value={model}>{model}</option>}
            </select>
          </>}
          <label className="sr-only" htmlFor="theme">Theme</label>
          <select id="theme" className="field" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
            {THEMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {graph && <>
            <button type="button" className="btn" onClick={() => setExportMode('md')}>Export Markdown</button>
            <button type="button" className="btn" onClick={() => setExportMode('vault')}>Export Obsidian vault</button>
          </>}
        </div>
      </header>

      <div className="body">
        <main
          className={`stage${dragging ? ' dragging' : ''}`}
          aria-label="Graph. Press Space to go deeper."
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        >
          {!graph || !view ? (
            <div className="seed">
              <form onSubmit={startTopic}>
                <h1>Start a rabbit hole</h1>
                <p>Type a topic. Rabbithole suggests where to go next, and learns from what you open, add and dismiss.</p>
                <div className="row">
                  <label className="sr-only" htmlFor="seed">Seed topic</label>
                  <input id="seed" className="field" autoFocus placeholder="e.g. Cars, Byzantine Empire, Jazz" value={seedText} onChange={(e) => setSeedText(e.target.value)} />
                  <button type="submit" className="btn btn-primary">Dive in</button>
                </div>
                {(bridge ? settings?.backend === OFFLINE : model === OFFLINE) && <p className="muted">Offline demo has car data only. {bridge ? 'Open Settings to pick a backend' : 'Pick a model in the header'} for any topic.</p>}
                {serverError && <p className="error">{serverError}</p>}
              </form>
            </div>
          ) : (
            <>
              <div className="legend">
                <span><span className="swatch" style={{ background: 'var(--surface)', border: '1px solid var(--ctrl-border)' }} />Opened</span>
                <span><span className="swatch" style={{ border: '1.5px dashed var(--muted)' }} />Suggestion</span>
                <span><span className="swatch" style={{ border: '2px solid var(--steer-ring)' }} />Steered</span>
                <span><span className="swatch" style={{ border: '1.5px dashed var(--tangent)' }} />Tangent</span>
                <span><span className="swatch" style={{ border: '1px dotted var(--muted)', opacity: 0.6 }} />Dismissed</span>
              </div>
              <div className="camera" style={{ transform: `translate(${pan.x - view.pos[graph.active].x}px, ${pan.y - view.pos[graph.active].y}px)` }}>
                {view.edges.map((e) => <div key={e.id} className="edge" style={e.style} />)}
                {view.cards.map((c) => (
                  <div key={c.n.id} className="card-wrap" style={c.wrap}>
                    <button type="button" className="card" style={c.style} onClick={() => select(c.n.id)} aria-label={c.aria}>
                      {c.tag && <span className={`tag${c.busy ? ' pulse' : ''}`} style={{ color: c.tagColor }}>{c.tag}</span>}
                      <span className="title" style={c.titleStyle}>{c.n.label}</span>
                      {c.body && <span className="body" style={{ WebkitLineClamp: c.lines }}>{c.body}</span>}
                    </button>
                    {c.n.status === 'ghost' && (
                      <button type="button" className="card-x" aria-label={`Dismiss ${c.n.label}`} onClick={() => dismiss(c.n.id)}><X /></button>
                    )}
                  </div>
                ))}
              </div>
              <div className="bar">
                <div className="slider">
                  <label htmlFor="spread">Focus</label>
                  <input id="spread" type="range" min={0} max={100} value={graph.spread} onChange={(e) => setSpread(Number(e.target.value))} aria-label="Focus to spread" />
                  <span>Spread</span>
                  <span className="mode">{modeFor(graph.spread)} · {tangentsFor(graph.spread)} tangent</span>
                </div>
                <form onSubmit={steer}>
                  <label className="sr-only" htmlFor="steer">Steer with your own node</label>
                  <input id="steer" className="field" placeholder={`Steer ${a!.label}: add your own node`} value={steerText} onChange={(e) => setSteerText(e.target.value)} />
                  <button type="submit" className="btn">Steer</button>
                </form>
                <button type="button" className="btn btn-primary" onClick={deeper}>Go deeper <kbd>Space</kbd></button>
              </div>
            </>
          )}
        </main>

        {graph && a && (
          <aside className="panel" aria-label="Node details">
            <div>
              <div className="eyebrow">Active node</div>
              <h1 style={{ margin: '6px 0' }}>{a.label}</h1>
              <div className="path">{pathOf(graph, a.id).map((n) => n.label.toLowerCase()).join(' › ')}</div>
            </div>
            {error && <p className="error" role="alert">{error} <button type="button" className="btn" onClick={() => setError(null)}>Dismiss</button></p>}
            <section>
              <h2>Summary</h2>
              {a.researching && !a.research ? <p className="muted pulse">Researching {a.label}…</p> : <p>{a.research?.summary ?? a.teaser ?? 'No research yet.'}</p>}
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
            {!!a.research?.sources.length && (
              <section>
                <h2>Sources</h2>
                <p className="muted">{a.research.verified ? 'From a web search.' : 'Suggested by the model. Not checked: open them before you rely on them.'}</p>
                <ul className="list">{a.research.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a></li>)}</ul>
              </section>
            )}
            <section>
              <label className="h2" htmlFor="notes">Your notes</label>
              <textarea id="notes" className="field" rows={3} placeholder="Write your own notes on this node." value={graph.notes[a.id] ?? ''}
                onChange={(e) => { const v = e.target.value; commit((g) => { g.notes[a.id] = v }) }} />
            </section>
            <div className="actions">
              <button type="button" className="btn btn-panel-primary" onClick={deeper}>Go deeper</button>
              <button type="button" className="btn" onClick={reroll} disabled={!!a.loading}>Re-roll suggestions</button>
              <button type="button" className="btn" onClick={() => doResearch(a.id)} disabled={!!a.researching}>Research again</button>
              <button type="button" className="btn" onClick={() => dismiss(a.id)} disabled={!a.parent}>Dismiss node</button>
              <button type="button" className="btn" onClick={() => { if (confirm('Start a new topic? This clears the current graph.')) { ref.current = null; setGraph(null); setError(null) } }}>New topic</button>
            </div>
          </aside>
        )}
      </div>

      {showSettings && settings && bridge && (
        <SettingsDialog initial={settings} onClose={() => setShowSettings(false)} onSaved={setSettings} />
      )}

      {exportMode && graph && (
        <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) setExportMode(null) }}>
          <div className="dialog" role="dialog" aria-modal="true" aria-label={exportMode === 'md' ? 'Markdown trail' : 'Obsidian vault'}>
            <div className="dialog-head">
              <h2>{exportMode === 'md' ? 'Markdown trail' : 'Obsidian vault'}</h2>
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
    </div>
  )
}

// Positions, edges and card styles for one render of the graph.
function buildView(g: Graph) {
  const pos = relayout(g)
  const onPath = new Set(pathOf(g, g.active).map((n) => n.id))
  const byId = new Map(g.nodes.map((n) => [n.id, n]))

  const edges = g.nodes.filter((n) => n.parent && byId.has(n.parent)).map((n) => {
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

  const cards = g.nodes.map((n: GraphNode) => {
    const ghost = n.status === 'ghost', dis = n.status === 'dismissed'
    const isActive = n.id === g.active, isRoot = !n.parent
    const busy = !!(n.loading || n.researching)
    const border = isActive ? '2px solid var(--active)'
      : ghost ? `1.5px dashed ${n.tangent ? 'var(--tangent)' : 'var(--muted)'}`
      : dis ? '1px dotted var(--muted)'
      : n.steered ? '2px solid var(--steer-ring)'
      : isRoot ? '2px solid var(--node-solid)' : '1px solid var(--ctrl-border)'
    const tag = busy ? (n.loading ? 'thinking' : 'researching') : isActive ? 'active' : n.steered ? 'steered' : n.tangent ? 'tangent' : dis ? 'dismissed' : isRoot ? 'seed' : ''
    return {
      n, busy, tag,
      tagColor: isActive || n.steered ? 'var(--eyebrow)' : 'var(--text2)',
      aria: `${ghost ? 'Open suggestion' : dis ? 'Restore' : 'Focus'} ${n.label}`,
      body: dis ? '' : ghost ? n.teaser ?? '' : n.research?.summary ?? n.teaser ?? '',
      lines: isActive ? 5 : 2,
      wrap: {
        left: pos[n.id].x, top: pos[n.id].y,
        width: isActive ? 250 : isRoot ? 220 : dis ? 130 : ghost ? 180 : 200,
        opacity: dis ? 0.45 : ghost ? (n.parent === g.active ? 1 : 0.4) : onPath.has(n.id) ? 1 : 0.7,
      },
      style: {
        padding: dis ? '6px 10px' : isActive ? '14px 16px' : '10px 12px',
        border, background: ghost || dis ? 'var(--bg)' : 'var(--surface)', boxShadow: isActive ? 'var(--halo)' : 'none',
      },
      titleStyle: {
        fontFamily: isActive || isRoot ? 'var(--display)' : 'var(--sans)',
        fontSize: isActive ? 'var(--title-size)' : dis ? 12 : 14,
        fontWeight: ghost || dis ? 400 : isActive || isRoot ? 600 : 500,
        fontStyle: n.tangent ? 'italic' : 'normal',
        color: ghost ? (n.tangent ? 'var(--tangent-text)' : 'var(--text2)') : dis ? 'var(--muted)' : 'var(--text)',
        textDecoration: dis ? 'line-through' : 'none',
      },
    }
  })

  return { pos, edges, cards }
}
