// Electron main process: the window, settings and secrets, and every call to a model backend.
// Prompts and parsing live in the renderer (src/ai.ts); this file only moves text in and out,
// so API keys never reach the page.
const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const Anthropic = require('@anthropic-ai/sdk').default

const SYSTEM = 'You are the research engine of Rabbithole, a graph explorer for deep dives. Answer with one JSON object only: no prose, no markdown fences.'
const TIMEOUT_MS = 300_000

// Every backend the settings screen offers. OpenAI-compatible ones share one code path.
const BACKENDS = {
  offline: { label: 'Offline demo' },
  anthropic: { label: 'Anthropic (Claude)', key: true, defaultModel: 'claude-opus-5-5' },
  openai: { label: 'OpenAI', key: true, baseUrl: 'https://api.openai.com/v1' },
  gemini: { label: 'Google Gemini', key: true, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  openrouter: { label: 'OpenRouter', key: true, baseUrl: 'https://openrouter.ai/api/v1' },
  ollama: { label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', editableUrl: true },
  lmstudio: { label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', editableUrl: true },
  custom: { label: 'Custom OpenAI-compatible', key: 'optional', baseUrl: '', editableUrl: true },
  opencode: { label: 'OpenCode' },
}
const SEARCH = { none: 'No web search', tavily: 'Tavily', brave: 'Brave Search' }

// ---------- Settings (secrets encrypted with the OS keychain via safeStorage) ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
let settings = { backend: 'offline', models: {}, urls: {}, search: 'none', secrets: {} }

function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) } } catch { /* first run */ }
}
function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), { mode: 0o600 })
}
function setSecret(name, value) {
  if (!value) { delete settings.secrets[name]; return }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This system has no secure storage, so the key cannot be saved.')
  settings.secrets[name] = safeStorage.encryptString(value).toString('base64')
}
function getSecret(name) {
  const v = settings.secrets[name]
  if (!v) return ''
  try { return safeStorage.decryptString(Buffer.from(v, 'base64')) } catch { return '' }
}
const baseUrlFor = (b) => (settings.urls[b] || BACKENDS[b].baseUrl || '').replace(/\/+$/, '')
const modelFor = (b) => settings.models[b] || BACKENDS[b].defaultModel || ''

// What the renderer may see: never the secrets themselves, only whether each is set.
function publicSettings() {
  return {
    backend: settings.backend,
    models: settings.models,
    urls: Object.fromEntries(Object.keys(BACKENDS).map((b) => [b, baseUrlFor(b)])),
    search: settings.search,
    keysSet: Object.fromEntries(Object.keys(settings.secrets).map((k) => [k, true])),
    backends: Object.entries(BACKENDS).map(([id, b]) => ({ id, label: b.label, key: b.key ?? false, editableUrl: !!b.editableUrl, defaultModel: b.defaultModel ?? '' })),
    searchProviders: Object.entries(SEARCH).map(([id, label]) => ({ id, label })),
    encryption: safeStorage.isEncryptionAvailable(),
  }
}

// ---------- HTTP helpers ----------
async function fetchJson(url, init = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal })
    const text = await r.text()
    if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}: ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : {}
  } catch (e) {
    if (ctl.signal.aborted) throw new Error(`No answer after ${TIMEOUT_MS / 1000} s.`)
    if (e.cause?.code === 'ECONNREFUSED') throw new Error(`Nothing is listening at ${new URL(url).origin}. Is the server running?`)
    if (e.cause) throw new Error(`${e.message} (${e.cause.code ?? e.cause.message})`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// ---------- Anthropic ----------
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])
function anthropicClient() {
  const apiKey = getSecret('anthropic')
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings.')
  return new Anthropic({ apiKey, timeout: TIMEOUT_MS })
}
async function anthropicComplete(prompt) {
  const client = anthropicClient()
  const model = modelFor('anthropic')
  const params = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: 'low' }, // short structured answers: speed matters more than depth
    messages: [{ role: 'user', content: prompt }],
  }
  // Server-side fallback on a refusal, where the model supports it.
  const res = FALLBACK_MODELS.has(model)
    ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : await client.messages.create(params)
  if (res.stop_reason === 'refusal') throw new Error('The model declined this request.')
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
}
async function anthropicModels() {
  const out = []
  for await (const m of anthropicClient().models.list()) out.push(m.id)
  return out
}

// ---------- OpenAI-compatible (OpenAI, Gemini, OpenRouter, Ollama, LM Studio, custom) ----------
function compatHeaders(b) {
  const key = getSecret(b)
  if (BACKENDS[b].key === true && !key) throw new Error(`Add your ${BACKENDS[b].label} API key in Settings.`)
  const h = { 'content-type': 'application/json' }
  if (key) h.authorization = `Bearer ${key}`
  if (b === 'openrouter') { h['HTTP-Referer'] = 'https://github.com/rabbithole-app'; h['X-Title'] = 'Rabbithole' }
  return h
}
async function compatComplete(b, prompt) {
  const base = baseUrlFor(b)
  if (!base) throw new Error('Set the server URL in Settings.')
  const model = modelFor(b)
  if (!model) throw new Error('Pick a model in Settings.')
  const d = await fetchJson(`${base}/chat/completions`, {
    method: 'POST',
    headers: compatHeaders(b),
    body: JSON.stringify({ model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
  })
  const text = d.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error(d.error?.message ?? 'The model returned no text.')
  return text
}
async function compatModels(b) {
  const d = await fetchJson(`${baseUrlFor(b)}/models`, { headers: compatHeaders(b) })
  return (d.data ?? []).map((m) => m.id).sort()
}

// ---------- OpenCode: started on demand, stopped when the app quits ----------
let oc = null // { proc, url, ready }
const ocPath = () => {
  const extra = os.platform() === 'win32'
    ? [path.join(process.env.APPDATA ?? '', 'npm'), path.join(os.homedir(), '.opencode', 'bin')]
    : ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.opencode', 'bin'), path.join(os.homedir(), '.bun', 'bin'), path.join(os.homedir(), '.local', 'bin')]
  return [process.env.PATH, ...extra].filter(Boolean).join(path.delimiter)
}
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer()
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
  s.on('error', reject)
})
function startOpencode() {
  if (oc) return oc.ready
  const dir = path.join(app.getPath('userData'), 'opencode')
  fs.mkdirSync(dir, { recursive: true })
  // The bundled agent config: a short JSON-only prompt with every tool switched off.
  fs.copyFileSync(path.join(__dirname, '..', 'opencode.json'), path.join(dir, 'opencode.json'))
  oc = { proc: null, url: '', ready: null }
  oc.ready = (async () => {
    const port = await freePort()
    const proc = spawn('opencode', ['serve', '--pure', '--port', String(port)], {
      cwd: dir, env: { ...process.env, PATH: ocPath() }, shell: os.platform() === 'win32', windowsHide: true,
      stdio: 'ignore', // unread pipes fill up and stall the server
    })
    oc.proc = proc
    oc.url = `http://127.0.0.1:${port}`
    let failed = null
    proc.on('error', (e) => { failed = e.code === 'ENOENT' ? new Error('OpenCode is not installed, or not on PATH. Install it from opencode.ai, then try again.') : e })
    proc.on('exit', () => { oc = null })
    for (let i = 0; i < 60; i++) {
      if (failed) throw failed
      try { await fetchJson(`${oc.url}/config`); return oc.url } catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    stopOpencode()
    throw new Error('OpenCode did not start within 30 s.')
  })()
  oc.ready.catch(() => { oc = null })
  return oc.ready
}
function stopOpencode() { if (oc?.proc) oc.proc.kill(); oc = null }

async function opencodeComplete(prompt) {
  const url = await startOpencode()
  const [providerID, ...rest] = modelFor('opencode').split('/')
  if (!rest.length) throw new Error('Pick an OpenCode model in Settings.')
  const post = (p, body) => fetchJson(url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const session = await post('/session', { title: 'rabbithole' })
  try {
    const d = await post(`/session/${session.id}/message`, { agent: 'rabbithole', model: { providerID, modelID: rest.join('/') }, parts: [{ type: 'text', text: prompt }] })
    const err = d.info?.error
    if (err) {
      const msg = err.data?.message ?? err.name ?? 'The model call failed.'
      if (/free tier/i.test(msg)) throw new Error(`OpenCode's free models (${providerID}/${rest.join('/')}) only work inside the OpenCode app itself. In Settings, pick a model from another provider you have set up in OpenCode.`)
      if (/key has expired|invalid api key|unauthorized/i.test(msg)) throw new Error(`OpenCode's key for "${providerID}" was rejected: ${msg} Renew it in OpenCode, or pick another provider's model in Settings.`)
      throw new Error(msg)
    }
    return (d.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('\n')
  } finally {
    fetch(`${url}/session/${session.id}`, { method: 'DELETE' }).catch(() => {}) // the graph is the memory, not the chat
  }
}
async function opencodeModels() {
  const url = await startOpencode()
  const d = await fetchJson(`${url}/config/providers`)
  return (d.providers ?? []).flatMap((p) => Object.keys(p.models ?? {}).map((m) => `${p.id}/${m}`))
}

// ---------- Web search add-on ----------
async function webSearch(query) {
  const key = getSecret(settings.search)
  if (settings.search === 'none') return []
  if (!key) throw new Error(`Add your ${SEARCH[settings.search]} API key in Settings.`)
  if (settings.search === 'tavily') {
    const d = await fetchJson('https://api.tavily.com/search', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: 5 }),
    })
    return (d.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: (r.content ?? '').slice(0, 600) }))
  }
  const d = await fetchJson(`https://api.search.brave.com/res/v1/web/search?count=5&q=${encodeURIComponent(query)}`, {
    headers: { accept: 'application/json', 'X-Subscription-Token': key },
  })
  return (d.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: (r.description ?? '').replace(/<[^>]+>/g, '').slice(0, 600) }))
}

// ---------- IPC ----------
function complete(prompt) {
  const b = settings.backend
  if (b === 'anthropic') return anthropicComplete(prompt)
  if (b === 'opencode') return opencodeComplete(prompt)
  if (BACKENDS[b]?.baseUrl !== undefined) return compatComplete(b, prompt)
  throw new Error('Pick a backend in Settings.')
}
function listModels(b) {
  if (b === 'anthropic') return anthropicModels()
  if (b === 'opencode') return opencodeModels()
  if (BACKENDS[b]?.baseUrl !== undefined) return compatModels(b)
  return Promise.resolve([])
}
// Errors cross IPC as plain messages so the renderer can show them as written.
const handle = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => {
  try { return { ok: true, value: await fn(...args) } } catch (e) { return { ok: false, error: e.message ?? String(e) } }
})

handle('settings:get', () => publicSettings())
handle('settings:set', (patch, secrets) => {
  for (const k of ['backend', 'search']) if (typeof patch?.[k] === 'string') settings[k] = patch[k]
  if (patch?.models) Object.assign(settings.models, patch.models)
  if (patch?.urls) Object.assign(settings.urls, patch.urls)
  for (const [name, value] of Object.entries(secrets ?? {})) if (value !== undefined) setSecret(name, value)
  if (settings.backend !== 'opencode') stopOpencode()
  saveSettings()
  return publicSettings()
})
handle('models:list', (b) => listModels(b))
handle('ai:complete', (prompt) => complete(prompt))
handle('search:web', (query) => webSearch(query))

// ---------- Window ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 720, minHeight: 520,
    backgroundColor: '#161618',
    title: 'Rabbithole',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  // Links open in the user's browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => { if (url !== win.webContents.getURL()) e.preventDefault() })
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus() } })
app.whenReady().then(() => {
  loadSettings()
  createWindow()
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', stopOpencode)
