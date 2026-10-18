import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { bridge } from './ai.ts'
import { wikiSearch } from './wiki.ts'
import type { LocalModel, Settings } from './ai.ts'

const HINTS: Record<string, string> = {
  local: 'A small model that runs inside the app: no LM Studio, Ollama or key. Download one once (it then works offline); web research uses keyless Wikipedia search.',
  free: 'Suggestions and notes come straight from Wikipedia: real, on-topic articles, no key and no model. For a light local model instead, use Ollama with a small one such as qwen2.5:0.5b or llama3.2:1b.',
  offline: 'Canned demo data about cars. Nothing leaves this computer.',
  anthropic: 'Claude models. Get a key at console.anthropic.com.',
  openai: 'Get a key at platform.openai.com.',
  gemini: 'Get a key at aistudio.google.com.',
  openrouter: 'One key for hundreds of models, some of them free. Get one at openrouter.ai.',
  ollama: 'Free and private. Install Ollama, run "ollama pull <model>", then load models here.',
  lmstudio: 'Free and private. Start the local server in LM Studio, then load models here.',
  custom: 'Any server with an OpenAI-style /chat/completions endpoint.',
  opencode: 'Uses the providers you set up in OpenCode. The app starts OpenCode for you; it must be installed (opencode.ai).',
}

// "provider/model" ids (OpenCode, OpenRouter) are grouped by provider; plain ids go in one group.
function groupModels(ids: string[]): [string, string[]][] {
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const i = id.indexOf('/')
    const g = i > 0 ? id.slice(0, i) : ''
    groups.set(g, [...(groups.get(g) ?? []), id])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

// The desktop app's Settings window (index.html#settings): the same form, as the whole page.
export function SettingsWindow() {
  const [initial, setInitial] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    try { document.documentElement.dataset.theme = (JSON.parse(localStorage.getItem('rh.theme') ?? '"obsidian"') as string).replace(/^dark$/, 'obsidian') } catch { document.documentElement.dataset.theme = 'obsidian' }
    document.title = 'Settings'
    bridge?.getSettings().then(setInitial).catch((e) => setError((e as Error).message))
  }, [])
  if (error) return <p className="error" role="alert" style={{ padding: 24 }}>{error}</p>
  if (!initial) return null
  return <SettingsDialog standalone initial={initial} onClose={() => window.close()} onSaved={() => {}} />
}

export function SettingsDialog({ initial, onClose, onSaved, standalone = false }: { initial: Settings; onClose: () => void; onSaved: (s: Settings) => void; standalone?: boolean }) {
  const [backend, setBackend] = useState(initial.backend)
  const [models, setModels] = useState(initial.models)
  const [urls, setUrls] = useState(initial.urls)
  const [search, setSearch] = useState(initial.search)
  const [keys, setKeys] = useState<Record<string, string>>({}) // only keys typed in this dialog
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [options, setOptions] = useState<string[]>([])
  const [status, setStatus] = useState<{ kind: 'muted' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState<LocalModel[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  useEffect(() => { if (backend === 'local') bridge!.localModels().then(setLocal).catch(() => {}) }, [backend])
  useEffect(() => bridge!.onLocalProgress((_id, p) => setProgress(p)), [])

  const info = initial.backends.find((b) => b.id === backend)!
  // Load the model list whenever the backend changes and it can be reached without typing anything.
  useEffect(() => {
    if (backend === 'offline' || backend === 'free' || backend === 'local' || (info.key === true && !initial.keysSet[backend])) return
    loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend])
  const keySet = (name: string) => !removed.has(name) && (!!keys[name] || !!initial.keysSet[name])
  const model = models[backend] ?? info.defaultModel

  // Save first, so loading models and testing use what is on screen.
  const persist = async () => {
    const secrets: Record<string, string | undefined> = {}
    for (const name of removed) secrets[name] = ''
    for (const [name, v] of Object.entries(keys)) if (v.trim()) secrets[name] = v.trim()
    const s = await bridge!.setSettings({ backend, search, models: { ...models, [backend]: model }, urls }, secrets)
    onSaved(s)
    setKeys({})
    setRemoved(new Set())
    return s
  }
  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(true)
    setStatus({ kind: 'muted', text: `${label}…` })
    try { setStatus({ kind: 'muted', text: await fn() }) } catch (e) { setStatus({ kind: 'error', text: (e as Error).message }) } finally { setBusy(false) }
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
      const r = search === 'wikipedia' ? await wikiSearch('rabbit hole') : await bridge!.search('rabbit hole')
      if (!r.length) throw new Error('Web search worked but returned no results.')
    }
    if (backend === 'offline') return 'Offline demo is ready.'
    if (backend === 'free') return (await wikiSearch('rabbit hole')).length ? 'Wikipedia is reachable.' : 'Wikipedia returned nothing.'
    const reply = await bridge!.complete('Reply with only this JSON: {"ok":true}')
    if (!reply.includes('ok')) throw new Error(`Unexpected reply: ${reply.slice(0, 120)}`)
    return `Connected. ${search !== 'none' ? 'Web search works too.' : ''}`
  })
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try { await persist(); onClose() } catch (err) { setStatus({ kind: 'error', text: (err as Error).message }) } finally { setBusy(false) }
  }

  const keyField = (name: string, label: string) => (
    <div className="setting">
      <label htmlFor={`key-${name}`}>{label}</label>
      <div className="row">
        <input id={`key-${name}`} type="password" className="field" autoComplete="off"
          placeholder={keySet(name) ? 'Saved. Type to replace it.' : 'Paste your key'}
          value={keys[name] ?? ''} onChange={(e) => setKeys((k) => ({ ...k, [name]: e.target.value }))} />
        {keySet(name) && <button type="button" className="btn" onClick={() => { setRemoved((r) => new Set(r).add(name)); setKeys((k) => ({ ...k, [name]: '' })) }}>Remove</button>}
      </div>
    </div>
  )

  const form = (
      <form className={standalone ? 'settings-page' : 'dialog settings'} role={standalone ? undefined : 'dialog'} aria-modal={standalone ? undefined : true} aria-label="Settings" onSubmit={save}>
        {!standalone && <div className="dialog-head">
          <h2>Settings</h2>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>}

        <div className="setting">
          <label htmlFor="backend">Backend</label>
          <select id="backend" className="field" value={backend} onChange={(e) => { setBackend(e.target.value); setOptions([]); setStatus(null) }}>
            {initial.backends.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          <p className="muted">{HINTS[backend]}</p>
        </div>

        {info.editableUrl && (
          <div className="setting">
            <label htmlFor="url">Server URL</label>
            <input id="url" className="field" value={urls[backend] ?? ''} placeholder="http://localhost:11434/v1"
              onChange={(e) => setUrls((u) => ({ ...u, [backend]: e.target.value }))} />
          </div>
        )}

        {info.key && keyField(backend, info.key === 'optional' ? 'API key (optional)' : 'API key')}

        {backend === 'local' && (
          <div className="setting">
            <label htmlFor="local-model">Model</label>
            <div className="row">
              <select id="local-model" className="field" value={model} onChange={(e) => setModels((m) => ({ ...m, [backend]: e.target.value }))}>
                {local.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.size}{m.downloaded ? ' · downloaded' : ''}</option>)}
              </select>
              {local.find((m) => m.id === model && !m.downloaded) && (
                <button type="button" className="btn" disabled={busy} onClick={() => run('Downloading', async () => {
                  setProgress(0)
                  try { setLocal(await bridge!.downloadLocal(model)) } finally { setProgress(null) }
                  return 'Downloaded. It runs offline from now on.'
                })}>Download</button>
              )}
            </div>
            {progress !== null && <progress className="field" value={progress} max={1} aria-label="Download progress" />}
          </div>
        )}

        {backend !== 'offline' && backend !== 'free' && backend !== 'local' && (
          <div className="setting">
            <label htmlFor="model-name">Model</label>
            <div className="row">
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
                <input id="model-name" className="field" value={model}
                  placeholder={backend === 'opencode' ? 'provider/model' : 'Model name'}
                  onChange={(e) => setModels((m) => ({ ...m, [backend]: e.target.value }))} />
              )}
              <button type="button" className="btn" onClick={loadModels} disabled={busy}>{options.length ? 'Reload' : 'Load models'}</button>
              {options.length > 0 && <button type="button" className="btn" onClick={() => setOptions([])}>Type a name</button>}
            </div>
          </div>
        )}

        <div className="setting">
          <label htmlFor="search">Web search for research notes</label>
          <select id="search" className="field" value={search} onChange={(e) => setSearch(e.target.value)}>
            {initial.searchProviders.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <p className="muted">
            {search === 'none'
              ? 'Research notes come from the model’s memory, and their sources are not checked.'
              : 'Each research note is based on the top search results, and only those pages are listed as sources.'}
          </p>
        </div>
        {search !== 'none' && search !== 'wikipedia' && keyField(search, `${initial.searchProviders.find((p) => p.id === search)?.label} API key`)}

        {!initial.encryption && <p className="error">This system has no secure key storage, so API keys cannot be saved.</p>}
        <p className="muted">Keys are encrypted with your system keychain and stay on this computer. They are sent only to the provider they belong to.</p>
        {status && <p className={status.kind} role="status">{status.text}</p>}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={test} disabled={busy}>Test connection</button>
          {standalone && <button type="button" className="btn" onClick={onClose}>Cancel</button>}
          <button type="submit" className="btn btn-primary" disabled={busy}>Save</button>
        </div>
      </form>
  )
  if (standalone) return form
  return <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>{form}</div>
}
