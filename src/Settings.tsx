import { Fragment, useEffect, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, KeyboardEvent, ReactNode } from 'react'
import { bridge, searchFor } from './ai.ts'
import { wikiSearch } from './wiki.ts'
import type { LocalModel, Settings } from './ai.ts'
import type { Graph } from './graph.ts'
import { applyM3, DEFAULT_SEED, hslHex, hueSat, m3Vars, SEEDS } from './m3.ts'
import { forgetCache } from './net.ts'
import { applyCustom } from './custom.ts'
import { interests } from './interests.ts'
import { applyGlass, BREADTH, prefs, request, setPrefs, SHORTCUTS } from './prefs.ts'
import type { Prefs } from './prefs.ts'
import { Mark } from './App.tsx'

declare const __APP_VERSION__: string

export type Theme = 'glass' | 'winui' | 'obsidian' | 'warm' | 'nothing' | 'm3'
// The theme that matches the system: Liquid Glass on a Mac, WinUI 3 on Windows.
export const nativeTheme = (): Theme => /Mac/.test(navigator.userAgent) ? 'glass' : /Windows/.test(navigator.userAgent) ? 'winui' : 'obsidian'
// Each theme has light and dark palettes that follow the system appearance.
export const THEMES: { value: Theme; label: string }[] = [
  { value: 'glass', label: 'Liquid Glass' },
  { value: 'winui', label: 'WinUI 3' },
  { value: 'obsidian', label: 'Obsidian' },
  { value: 'warm', label: 'Claude Warm' },
  { value: 'nothing', label: 'Nothing OS 5' },
  { value: 'm3', label: 'Material 3 Expressive' },
]
const ACCENTS = ['#0A84FF', '#30B0C7', '#34C759', '#FF9F0A', '#FF375F', '#BF5AF2', '#8E8E93', '#C96442']
const loadSeed = () => { try { return JSON.parse(localStorage.getItem('rh.seed') ?? 'null') ?? DEFAULT_SEED } catch { return DEFAULT_SEED } }

const HINTS: Record<string, string> = {
  local: 'A small model that runs inside the app: no LM Studio, Ollama or key. Download one once (it then works offline); web research uses keyless Wikipedia search.',
  free: 'Suggestions and notes come straight from Wikipedia: real, on-topic articles, no key and no model. For a light local model instead, use Ollama with a small one such as qwen2.5:0.5b or llama3.2:1b.',
  offline: 'Canned demo data about cars. Nothing leaves this computer.',
  ollama: 'Free and private. Install Ollama, run "ollama pull <model>", then load models here.',
  lmstudio: 'Free and private. Start the local server in LM Studio, then load models here.',
}

// "provider/model" ids are grouped by provider; plain ids (Ollama, LM Studio) go in one group.
function groupModels(ids: string[]): [string, string[]][] {
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const i = id.indexOf('/')
    const g = i > 0 ? id.slice(0, i) : ''
    groups.set(g, [...(groups.get(g) ?? []), id])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

// ---------- Window ----------
// One toolbar of panes, as Mac settings windows have; on Windows the same panes sit in a left rail.
type Pane = 'general' | 'interests' | 'appearance' | 'research' | 'data' | 'about'
const ic = (d: string) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
const PANES: { id: Pane; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', icon: ic('M4 7h10M18 7h2M4 17h2M10 17h10M14 4.5v5M6 14.5v5M16 7a2 2 0 1 0 0 .01M8 17a2 2 0 1 0 0 .01') },
  { id: 'interests', label: 'Interests', icon: ic('M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z') },
  { id: 'appearance', label: 'Appearance', icon: ic('M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.8-.6-1.3-.6-2.1 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01') },
  { id: 'research', label: 'Research', icon: ic('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6') },
  { id: 'data', label: 'Data', icon: ic('M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3') },
  { id: 'about', label: 'About', icon: ic('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 7.5h.01') },
]

// The desktop app's Settings window (index.html#settings).
export function SettingsWindow() {
  const [initial, setInitial] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  // People adjust related settings more than once, so the window reopens on the last pane.
  const [pane, setPane] = useState<Pane>(() => { try { return (JSON.parse(localStorage.getItem('rh.settingsPane') ?? '"general"') as Pane) } catch { return 'general' } })
  const [theme, setTheme] = useState<Theme>(() => {
    let t = nativeTheme()
    try { t = (JSON.parse(localStorage.getItem('rh.theme') ?? JSON.stringify(t)) as string).replace(/^dark$/, 'obsidian') as Theme } catch { /* storage unavailable */ }
    return t
  })
  const [seed, setSeed] = useState<string>(loadSeed)
  useEffect(() => {
    document.documentElement.dataset.platform = bridge?.platform ?? 'web'
    bridge?.getSettings().then(setInitial).catch((e) => setError((e as Error).message))
  }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme; applyM3(theme, seed); applyGlass(); applyCustom() }, [theme, seed])
  const label = PANES.find((p) => p.id === pane)!.label
  // The title names the visible pane.
  useEffect(() => {
    document.title = label
    try { localStorage.setItem('rh.settingsPane', JSON.stringify(pane)) } catch { /* storage unavailable */ }
  }, [pane, label])

  // Arrow keys move between panes, as in any tab bar.
  const onTabKey = (e: KeyboardEvent) => {
    const i = PANES.findIndex((p) => p.id === pane)
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = PANES[(i + step + PANES.length) % PANES.length].id
    setPane(next)
    document.getElementById(`tab-${next}`)?.focus()
  }

  return (
    <div className="settings-shell">
      <header className="settings-bar">
        <h1 className="settings-title">{label}</h1>
        <nav role="tablist" aria-label="Settings" onKeyDown={onTabKey}>
          {PANES.map((p) => (
            <button key={p.id} id={`tab-${p.id}`} type="button" role="tab" aria-selected={pane === p.id} aria-controls="settings-pane" tabIndex={pane === p.id ? 0 : -1} onClick={() => setPane(p.id)}>
              {p.icon}<span>{p.label}</span>
            </button>
          ))}
        </nav>
      </header>
      <main id="settings-pane" className="settings-body" role="tabpanel" aria-labelledby={`tab-${pane}`}>
        {pane === 'general' && <General />}
        {pane === 'interests' && <Interests />}
        {pane === 'appearance' && <Appearance theme={theme} setTheme={setTheme} seed={seed} setSeed={setSeed} settings={initial} onSaved={setInitial} />}
        {pane === 'research' && <Sources />}
        {pane === 'research' && (error ? <p className="error" role="alert">{error}</p>
          : initial ? <Research initial={initial} onSaved={setInitial} />
          : <p className="muted">{bridge ? 'Loading…' : 'Choosing a backend needs the desktop app.'}</p>)}
        {pane === 'data' && <Data />}
        {pane === 'about' && <About />}
      </main>
    </div>
  )
}

// ---------- Building blocks ----------
// Settings come in rounded groups of rows: the label and its hint on the left, the control on the right.
const Group = ({ title, children, foot }: { title?: string; children: ReactNode; foot?: ReactNode }) => (
  <section className="group">
    {title && <h2 className="group-h">{title}</h2>}
    <div className="group-box">{children}</div>
    {foot && <p className="group-foot">{foot}</p>}
  </section>
)
const Row = ({ label, hint, htmlFor, children }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children?: ReactNode }) => (
  <div className="srow">
    <div className="srow-text">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
      {hint && <p>{hint}</p>}
    </div>
    {children && <div className="srow-ctl">{children}</div>}
  </div>
)
const Switch = ({ id, on, set }: { id: string; on: boolean; set: (v: boolean) => void }) => (
  <input id={id} type="checkbox" role="switch" className="switch" checked={on} onChange={(e) => set(e.target.checked)} />
)

// ---------- General ----------
function General() {
  const [p, setP] = useState<Prefs>(prefs)
  const set = (patch: Partial<Prefs>) => setP(setPrefs(patch))
  return (
    <>
      <Group title="Dives">
        <Row label="Reopen your last dive at launch" hint="Off: Rabbithole opens on Home." htmlFor="open-last"><Switch id="open-last" on={p.openLast} set={(v) => set({ openLast: v })} /></Row>
        <Row label="New dives start at" hint="How many sideways jumps each level offers. You can change it in any dive." htmlFor="breadth">
          <select id="breadth" className="field" value={BREADTH.find((b) => b.spread === p.breadth)?.spread ?? 20} onChange={(e) => set({ breadth: Number(e.target.value) })}>
            {BREADTH.map((b) => <option key={b.label} value={b.spread}>{b.label}</option>)}
          </select>
        </Row>
      </Group>
      <Group title="Research">
        <Row label="Add recent news to notes" hint="Headlines about the topic, from the free web search." htmlFor="news"><Switch id="news" on={p.news} set={(v) => set({ news: v })} /></Row>
        <Row label="Load the next level ahead of time" hint="With Wikipedia as the backend, Go deeper is then usually instant." htmlFor="prefetch"><Switch id="prefetch" on={p.prefetch} set={(v) => set({ prefetch: v })} /></Row>
      </Group>
      <Group>
        <Row label="Sounds" hint="Play a soft sound when you go deeper or open a node." htmlFor="sounds"><Switch id="sounds" on={p.sounds} set={(v) => set({ sounds: v })} /></Row>
      </Group>
      {bridge?.platform === 'darwin' && (
        <Group foot="Shown while Rabbithole is open. macOS keeps the standard icon in Finder.">
          <Row label="Dock icon follows the theme" htmlFor="dock-icon"><Switch id="dock-icon" on={p.dockIcon} set={(v) => set({ dockIcon: v })} /></Row>
        </Group>
      )}
    </>
  )
}

// A row of exclusive choices, as the Appearance control.
function Seg<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: readonly (readonly [T, string])[]; onPick: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onPick(v)}>{text}</button>)}
    </div>
  )
}

// ---------- Appearance ----------
function Appearance({ theme, setTheme, seed, setSeed, settings, onSaved }: { theme: Theme; setTheme: (t: Theme) => void; seed: string; setSeed: (s: string) => void; settings: Settings | null; onSaved: (s: Settings) => void }) {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  const [glass, setGlass] = useState(() => prefs().glass)
  const [p, setP] = useState<Prefs>(prefs)
  // Accent, font, density and layout apply at once, here and in the main window.
  const pick = (patch: Partial<Prefs>) => { setP(setPrefs(patch)); applyCustom() }
  const pickGlass = (v: number) => { setGlass(v); setPrefs({ glass: v }); applyGlass() }
  // Light and Dark pin the appearance for this app only; the main process applies it to every window.
  const pickAppearance = (a: 'system' | 'light' | 'dark') => { bridge?.setSettings({ appearance: a }).then(onSaved).catch(() => {}) }
  const appearance = settings?.appearance ?? 'system'
  // The theme applies at once, here and in the main window.
  const pickTheme = (t: Theme) => {
    setTheme(t)
    try { localStorage.setItem('rh.theme', JSON.stringify(t)) } catch { /* storage unavailable */ }
    bridge?.setMenuState({ theme: t }).catch(() => {})
  }
  // Material 3: one seed color makes every color role. The main window follows the saved value.
  const pickSeed = (hex: string) => {
    setSeed(hex)
    try { localStorage.setItem('rh.seed', JSON.stringify(hex)) } catch { /* storage unavailable */ }
  }
  return (
    <>
      {bridge && (
        <Group foot={appearance === 'system' ? 'Matches your Mac or PC, and switches when it does.' : `Rabbithole stays ${appearance} whatever the system uses.`}>
          <Row label="Appearance">
            <div className="segmented" role="radiogroup" aria-label="Appearance">
              {(['system', 'light', 'dark'] as const).map((a) => (
                <button key={a} type="button" role="radio" aria-checked={appearance === a} onClick={() => pickAppearance(a)}>{a === 'system' ? 'System' : a === 'light' ? 'Light' : 'Dark'}</button>
              ))}
            </div>
          </Row>
        </Group>
      )}
      <Group title="Theme">
        {/* Each tile is drawn in its own theme's colors. */}
        <div className="themes" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.value} type="button" role="radio" aria-checked={theme === t.value} className="theme-tile" onClick={() => pickTheme(t.value)}>
              <span className="theme-mini" data-theme={t.value} style={t.value === 'm3' ? (m3Vars(seed, dark) as CSSProperties) : undefined} aria-hidden="true">
                <span className="mini-side" /><span className="mini-card" /><span className="mini-go" />
              </span>
              <span className="theme-name">{t.label}</span>
            </button>
          ))}
        </div>
      </Group>
      <Group title="Make it yours" foot="Works with every theme. Theme default keeps the theme's own look.">
        <Row label="Accent">
          <div className="accent-picker" role="group" aria-label="Accent">
            <button type="button" className="btn" aria-pressed={p.accent === null} onClick={() => pick({ accent: null })}>Theme default</button>
            {ACCENTS.map((hex) => <button key={hex} type="button" className="swatch-btn" aria-label={hex} title={hex} aria-pressed={p.accent?.toLowerCase() === hex.toLowerCase()} style={{ background: hex }} onClick={() => pick({ accent: hex })} />)}
            <label className="sr-only" htmlFor="accent-custom">Any color</label>
            <input id="accent-custom" type="color" value={p.accent ?? '#0a84ff'} onChange={(e) => pick({ accent: e.target.value })} title="Any color" />
          </div>
        </Row>
        <Row label="Font">
          <Seg label="Font" value={p.font} onPick={(font) => pick({ font })} options={[['theme', 'Theme'], ['system', 'System'], ['serif', 'Serif'], ['mono', 'Mono'], ['rounded', 'Rounded']]} />
        </Row>
        <Row label="Density">
          <Seg label="Density" value={p.density} onPick={(density) => pick({ density })} options={[['compact', 'Compact'], ['regular', 'Regular'], ['roomy', 'Roomy']]} />
        </Row>
        <Row label="Graph layout">
          <Seg label="Graph layout" value={p.layout} onPick={(layout) => pick({ layout })} options={[['tree', 'Tree'], ['down', 'Top-down'], ['radial', 'Radial']]} />
        </Row>
      </Group>
      {theme === 'glass' && (
        <Group title="Liquid Glass" foot="Clear shows more of what is behind the sidebar and inspector; Tinted makes them more opaque and easier to read. On macOS 27 the window material also follows the slider in System Settings › Appearance.">
          <div className="glass-slider">
            <input id="glass" type="range" min={0} max={1} step={0.05} list="glass-notches" value={glass} aria-label="Liquid Glass" aria-valuetext={glass < 0.25 ? 'Clear' : glass > 0.75 ? 'Tinted' : 'Medium'} onChange={(e) => pickGlass(Number(e.target.value))} />
            <datalist id="glass-notches"><option value="0" /><option value="0.5" /><option value="1" /></datalist>
            <div className="glass-labels" aria-hidden="true"><span>Clear</span><span>Medium</span><span>Tinted</span></div>
          </div>
        </Group>
      )}
      {theme === 'm3' && (
        <Group title="Seed color" foot="Every color in the app is a tone of this one, as on Android. Pick Monochrome, or any gray, for an all-grayscale look.">
          <div className="seed-picker">
            <div className="wheel" role="group" aria-label="Seed color wheel">
              {Array.from({ length: 12 }, (_, i) => {
                const hex = hslHex(i * 30, 0.6, 0.5), a = (i * 30 * Math.PI) / 180
                return <button key={hex} type="button" aria-label={`Hue ${i * 30}°`} aria-pressed={hueSat(seed).s >= 0.06 && hueSat(seed).h === hueSat(hex).h}
                  style={{ left: 110 + 93 * Math.cos(a), top: 110 + 93 * Math.sin(a), background: hex }} onClick={() => pickSeed(hex)} />
              })}
              <span className="seed">{seed.toUpperCase()}</span>
            </div>
            <div className="presets" role="group" aria-label="Wallpaper colors">
              {SEEDS.map(([name, hex]) => <button key={hex} type="button" aria-label={name} title={name} aria-pressed={seed.toLowerCase() === hex.toLowerCase()} style={{ background: hex }} onClick={() => pickSeed(hex)} />)}
              <label className="sr-only" htmlFor="seed-custom">Any color</label>
              <input id="seed-custom" type="color" value={seed} onChange={(e) => pickSeed(e.target.value)} title="Any color" />
            </div>
          </div>
        </Group>
      )}
      <Group title="Reading the graph">
        <ul className="key">
          <li><span className="swatch" style={{ border: '2px solid var(--active)' }} />Active: the node you are on.</li>
          <li><span className="swatch" style={{ border: '1px solid var(--ctrl-border)', background: 'var(--surface)' }} />Opened: a node you visited.</li>
          <li><span className="swatch" style={{ border: '1.5px dashed var(--ctrl-border)' }} />Suggestion: click to open it.</li>
          <li><span className="swatch" style={{ border: '1.5px dashed var(--tangent)' }} />Tangent: a sideways jump, in italics.</li>
          <li><span className="swatch" style={{ border: '2px solid var(--steer-ring)' }} />Steered: narrowed with your own words.</li>
        </ul>
      </Group>
    </>
  )
}

// ---------- Research ----------
function Research({ initial, onSaved }: { initial: Settings; onSaved: (s: Settings) => void }) {
  const [backend, setBackend] = useState(initial.backend)
  const [models, setModels] = useState(initial.models)
  const [urls, setUrls] = useState(initial.urls)
  const [search, setSearch] = useState(initial.search)
  const [options, setOptions] = useState<string[]>([])
  const [status, setStatus] = useState<{ kind: 'muted' | 'error' | 'ok'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState<LocalModel[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  useEffect(() => { if (backend === 'local') bridge!.localModels().then(setLocal).catch(() => {}) }, [backend])
  useEffect(() => bridge!.onLocalProgress((_id, p) => setProgress(p)), [])

  const info = initial.backends.find((b) => b.id === backend)!
  // Load the model list whenever the backend changes and it can be reached without typing anything.
  useEffect(() => {
    if (backend === 'offline' || backend === 'free' || backend === 'local') return
    loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend])
  const model = models[backend] ?? info.defaultModel

  // Save first, so loading models and testing use what is on screen.
  const persist = async () => {
    const s = await bridge!.setSettings({ backend, search, models: { ...models, [backend]: model }, urls })
    onSaved(s)
    return s
  }
  const run = async (label: string, fn: () => Promise<string>, kind: 'muted' | 'ok' = 'muted') => {
    setBusy(true)
    setStatus({ kind: 'muted', text: `${label}…` })
    try { setStatus({ kind, text: await fn() }) } catch (e) { setStatus({ kind: 'error', text: (e as Error).message }) } finally { setBusy(false) }
  }
  const loadModels = () => run('Loading models', async () => {
    await persist()
    const list = await bridge!.listModels(backend)
    setOptions(list)
    if (list.length && !list.includes(model)) setModels((m) => ({ ...m, [backend]: list[0] }))
    return list.length ? `${list.length} models found.` : 'No models found. Type a model name instead.'
  })
  const test = () => run('Testing', async () => {
    await persist()
    if (search !== 'none') {
      const r = search === 'wikipedia' ? await wikiSearch('rabbit hole') : await searchFor('rabbit hole', search)
      if (!r.length) throw new Error('Web search worked but returned no results.')
    }
    if (backend === 'offline') return 'Offline demo is ready.'
    if (backend === 'free') return (await wikiSearch('rabbit hole')).length ? 'Wikipedia is reachable.' : 'Wikipedia returned nothing.'
    const reply = await bridge!.complete('Reply with only this JSON: {"ok":true}')
    if (!reply.includes('ok')) throw new Error(`Unexpected reply: ${reply.slice(0, 120)}`)
    return `Connected.${search !== 'none' ? ' Web search works too.' : ''}`
  }, 'ok')
  const save = (e: FormEvent) => { e.preventDefault(); run('Saving', async () => { await persist(); return 'Saved.' }, 'ok') }

  return (
    <form className="research-form" onSubmit={save}>
      <Group title="Suggestions and notes" foot={HINTS[backend]}>
        <Row label="Backend" htmlFor="backend">
          <select id="backend" className="field" value={backend} onChange={(e) => { setBackend(e.target.value); setOptions([]); setStatus(null) }}>
            {initial.backends.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </Row>
        {info.editableUrl && (
          <Row label="Server URL" htmlFor="url">
            <input id="url" className="field" value={urls[backend] ?? ''} placeholder="http://localhost:11434/v1"
              onChange={(e) => setUrls((u) => ({ ...u, [backend]: e.target.value }))} />
          </Row>
        )}
        {backend === 'local' && (
          <Row label="Model" htmlFor="local-model" hint={progress !== null ? <progress value={progress} max={1} aria-label="Download progress" /> : undefined}>
            <select id="local-model" className="field" value={model} onChange={(e) => setModels((m) => ({ ...m, [backend]: e.target.value }))}>
              {local.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.size}{m.downloaded ? ' · downloaded' : ''}</option>)}
            </select>
            {local.find((m) => m.id === model && !m.downloaded) && (
              <button type="button" className="btn" disabled={busy} onClick={() => run('Downloading', async () => {
                setProgress(0)
                try { setLocal(await bridge!.downloadLocal(model)) } finally { setProgress(null) }
                return 'Downloaded. It runs offline from now on.'
              }, 'ok')}>Download</button>
            )}
          </Row>
        )}
        {backend !== 'offline' && backend !== 'free' && backend !== 'local' && (
          <Row label="Model" htmlFor="model-name">
            {options.length ? (
              <select id="model-name" className="field" value={model} onChange={(e) => setModels((m) => ({ ...m, [backend]: e.target.value }))}>
                {model && !options.includes(model) && <option value={model}>{model}</option>}
                {groupModels(options).map(([group, ids]) => (
                  <optgroup key={group} label={group}>
                    {ids.map((id) => <option key={id} value={id}>{id.slice(group.length ? group.length + 1 : 0)}</option>)}
                  </optgroup>
                ))}
              </select>
            ) : (
              <input id="model-name" className="field" value={model} placeholder="Model name"
                onChange={(e) => setModels((m) => ({ ...m, [backend]: e.target.value }))} />
            )}
            <button type="button" className="btn" onClick={options.length ? () => setOptions([]) : loadModels} disabled={busy}>{options.length ? 'Type a name' : 'Load models'}</button>
          </Row>
        )}
      </Group>

      <Group title="Web search" foot={search === 'none'
        ? 'Notes come from the model’s memory, and their sources are not checked.'
        : 'Each note is based on the top search results, and only those pages are listed as sources.'}>
        <Row label="Search with" htmlFor="search">
          <select id="search" className="field" value={search} onChange={(e) => setSearch(e.target.value)}>
            {initial.searchProviders.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Row>
      </Group>

      <p className="group-foot">Every backend here is free and needs no key or account.</p>

      <div className="settings-actions">
        {status && <p className={`grow ${status.kind}`} role="status">{status.text}</p>}
        <button type="button" className="btn" onClick={test} disabled={busy}>Test connection</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>Save</button>
      </div>
    </form>
  )
}

// ---------- Sources ----------
// "https://www.example.com/page" becomes "example.com"; anything without a dot is not a site.
function siteOf(input: string): string | null {
  const raw = input.trim()
  if (!raw || /\s/.test(raw)) return null
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '').toLowerCase()
    return host.includes('.') && !host.startsWith('.') && !host.endsWith('.') ? host : null
  } catch { return null }
}

function Sources() {
  const [p, setP] = useState<Prefs>(prefs)
  const [site, setSite] = useState('')
  const [bad, setBad] = useState(false)
  const set = (patch: Partial<Prefs>) => setP(setPrefs(patch))
  const block = (e: FormEvent) => {
    e.preventDefault()
    const host = siteOf(site)
    if (!host) return setBad(true)
    if (!p.blocked.includes(host)) set({ blocked: [...p.blocked, host] })
    setSite('')
    setBad(false)
  }
  return (
    <>
      <Group title="Notes" foot="Quick shows a short summary. Deep shows every fact, link and headline.">
        <Row label="Reading level">
          <Seg label="Reading level" value={p.readingLevel} onPick={(readingLevel) => set({ readingLevel })} options={[['quick', 'Quick'], ['standard', 'Standard'], ['deep', 'Deep']]} />
        </Row>
        <Row label="Pages from the open web" htmlFor="web"><Switch id="web" on={p.web} set={(v) => set({ web: v })} /></Row>
      </Group>
      <Group title="Blocked sites">
        <form className="block-form" onSubmit={block}>
          <label className="sr-only" htmlFor="block-site">Site to block</label>
          <input id="block-site" className="field" value={site} placeholder="example.com" autoComplete="off" aria-invalid={bad} aria-describedby={bad ? 'block-err' : undefined}
            onChange={(e) => { setSite(e.target.value); setBad(false) }} />
          {bad && <p id="block-err" className="error" role="alert">Enter a site like example.com</p>}
          <button type="submit" className="btn">Block</button>
        </form>
        {p.blocked.length ? p.blocked.map((b) => (
          <Row key={b} label={b}><button type="button" className="btn" onClick={() => set({ blocked: p.blocked.filter((x) => x !== b) })}>Remove</button></Row>
        )) : <p className="srow-empty">No blocked sites. Pages from blocked sites never appear in your notes.</p>}
      </Group>
    </>
  )
}

// ---------- Interests ----------
function Interests() {
  const [p, setP] = useState<Prefs>(prefs)
  const dives = readDives()
  // interests() leaves muted topics out, so add them back from the dives to let them be turned on again.
  const on = interests(dives.map((d) => d.graph), 50)
  const labels = new Map<string, string>()
  for (const d of dives) for (const n of d.graph?.nodes ?? []) if (n.status === 'solid') labels.set(n.label.toLowerCase(), n.label)
  const off = p.muted.filter((k) => labels.has(k)).map((k) => labels.get(k)!)
  const list = [...on.map((i) => i.label), ...off]
  const toggle = (label: string, shown: boolean) => {
    const key = label.toLowerCase()
    setP(setPrefs({ muted: shown ? p.muted.filter((m) => m !== key) : [...new Set([...p.muted, key])] }))
  }
  return (
    <Group foot="Rabbithole suggests new dives from the topics you open most. Turn a topic off to stop seeing it on Home.">
      {list.length ? list.map((label, i) => {
        const shown = !p.muted.includes(label.toLowerCase())
        return <Row key={label} label={label} htmlFor={`interest-${i}`}><Switch id={`interest-${i}`} on={shown} set={(v) => toggle(label, v)} /></Row>
      }) : <p className="srow-empty">Open a few dives and your topics show up here.</p>}
    </Group>
  )
}

// ---------- Data ----------
type Dive = { id: string; updated: number; graph: Graph }
const readDives = (): Dive[] => { try { const d = JSON.parse(localStorage.getItem('rh.dives') ?? '[]'); return Array.isArray(d) ? d : [] } catch { return [] } }
const isDive = (d: unknown): d is Dive => !!d && typeof d === 'object' && typeof (d as Dive).id === 'string' && Array.isArray((d as Dive).graph?.nodes) && (d as Dive).graph.nodes.length > 0
const mb = (bytes: number) => bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`

function Data() {
  const [dives, setDives] = useState<Dive[]>(readDives)
  const [used, setUsed] = useState<number | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const measure = () => navigator.storage?.estimate?.().then((e) => setUsed(e.usage ?? null)).catch(() => {})
  useEffect(() => {
    measure()
    // The main window saves dives as you go; keep the count current.
    const onStorage = (e: StorageEvent) => { if (e.key === 'rh.dives') setDives(readDives()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const stops = dives.reduce((t, d) => t + d.graph.nodes.filter((n) => n.status === 'solid').length, 0)
  const write = (next: Dive[]) => { localStorage.setItem('rh.dives', JSON.stringify(next)); setDives(next); request('reload') }

  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ app: 'rabbithole', version: 1, dives }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `Rabbithole dives ${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const importFile = async (f: File) => {
    try {
      const d = JSON.parse(await f.text())
      const incoming = (Array.isArray(d) ? d : d?.dives ?? []).filter(isDive)
      if (!incoming.length) throw new Error('That file has no Rabbithole dives in it.')
      const have = new Set(dives.map((x) => x.id))
      const added = incoming.filter((x: Dive) => !have.has(x.id))
      write([...dives, ...added])
      setStatus({ kind: 'ok', text: added.length ? `Imported ${added.length} ${added.length === 1 ? 'dive' : 'dives'}.${incoming.length > added.length ? ` ${incoming.length - added.length} you already had were skipped.` : ''}` : 'You already have every dive in that file.' })
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof SyntaxError ? 'That file is not a Rabbithole export.' : (e as Error).message })
    }
  }
  const clearCache = async () => {
    await forgetCache(true)
    request('cache-cleared')
    setStatus({ kind: 'ok', text: 'Cache cleared. Pages load from Wikipedia again the next time you open them.' })
    measure()
  }
  const deleteAll = () => {
    if (!confirm(`Delete all ${dives.length} dives? This cannot be undone. Export them first if you may want them back.`)) return
    write([])
    setStatus({ kind: 'ok', text: 'All dives deleted.' })
  }

  return (
    <>
      <Group title="Your dives" foot="Dives are saved on this computer only.">
        <Row label={`${dives.length} ${dives.length === 1 ? 'dive' : 'dives'}, ${stops} ${stops === 1 ? 'stop' : 'stops'}`} hint="Export makes one file you can keep or move to another computer.">
          <button type="button" className="btn" onClick={exportAll} disabled={!dives.length}>Export All…</button>
          <button type="button" className="btn" onClick={() => file.current?.click()}>Import…</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = '' }} />
        </Row>
      </Group>
      <Group title="Cache">
        <Row label="Saved pages" hint={`Wikipedia pages are kept for 7 days so revisits are instant and work offline.${used !== null ? ` Rabbithole uses about ${mb(used)} on this computer.` : ''}`}>
          <button type="button" className="btn" onClick={clearCache}>Clear Cache</button>
        </Row>
      </Group>
      <Group>
        <Row label="Delete all dives" hint="Removes every dive and its notes from this computer.">
          <button type="button" className="btn btn-danger" onClick={deleteAll} disabled={!dives.length}>Delete All…</button>
        </Row>
      </Group>
      {status && <p className={status.kind} role="status">{status.text}</p>}
    </>
  )
}

// ---------- About ----------
function About() {
  return (
    <>
      <div className="about">
        <Mark />
        <div>
          <h2>Rabbithole</h2>
          <p className="muted">Version {__APP_VERSION__}</p>
          <p>A graph explorer for deep dives: open, steer and dismiss suggestions until you reach the bottom of a topic.</p>
          <a className="btn" href="https://github.com/codezeroexe/rabbithole" target="_blank" rel="noreferrer">Rabbithole on GitHub</a>
        </div>
      </div>
      <Group title="Keyboard shortcuts" foot="In the main window, press ? to see these at any time.">
        <dl className="shortcut-list">
          {SHORTCUTS.map(([k, d]) => <Fragment key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></Fragment>)}
        </dl>
      </Group>
    </>
  )
}
