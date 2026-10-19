// Electron main process: the window, settings and secrets, and every call to a model backend.
// Prompts and parsing live in the renderer (src/ai.ts); this file only moves text in and out,
// so API keys never reach the page.
const { app, BrowserWindow, Menu, ipcMain, nativeTheme, safeStorage, shell } = require('electron')
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
  free: { label: 'Free: Wikipedia (no key, no model)' },
  offline: { label: 'Offline demo' },
  local: { label: 'Built-in tiny model (no install)', defaultModel: 'qwen3-0.6b' },
  anthropic: { label: 'Anthropic (Claude)', key: true, defaultModel: 'claude-opus-5-5' },
  openai: { label: 'OpenAI', key: true, baseUrl: 'https://api.openai.com/v1' },
  gemini: { label: 'Google Gemini', key: true, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  openrouter: { label: 'OpenRouter', key: true, baseUrl: 'https://openrouter.ai/api/v1' },
  ollama: { label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', editableUrl: true },
  lmstudio: { label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', editableUrl: true },
  custom: { label: 'Custom OpenAI-compatible', key: 'optional', baseUrl: '', editableUrl: true },
  opencode: { label: 'OpenCode' },
}
// wikipedia is searched from the renderer (public API, no key); the others need a key and run here.
const SEARCH = { web: 'Web: Bing + DuckDuckGo + Google News, pages read (free, no key)', wikipedia: 'Wikipedia only (free, no key)', none: 'No web search', tavily: 'Tavily', brave: 'Brave Search' }

// ---------- Settings (secrets encrypted with the OS keychain via safeStorage) ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
let settings = { backend: 'free', models: {}, urls: {}, search: 'web', secrets: {} }

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

// ---------- Built-in tiny model (llama.cpp via node-llama-cpp) ----------
// Downloaded once into userData/models, then runs on this computer: Metal, CUDA, Vulkan or CPU.
const LOCAL = {
// Benchmarked on an M4 (4 topics, suggest + research): Qwen3 0.6B 1.3 s per reply with good picks;
// Qwen2.5 1.5B 2.9 s with the best picks. SmolLM2 360M was dropped: it repeated one label 4 times.
  'qwen3-0.6b': { label: 'Qwen3 0.6B (fast)', size: '400 MB', uri: 'hf:unsloth/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf' },
  'qwen2.5-1.5b': { label: 'Qwen2.5 1.5B (better, slower)', size: '1.1 GB', uri: 'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF/qwen2.5-1.5b-instruct-q4_k_m.gguf' },
}
const modelsDir = () => path.join(app.getPath('userData'), 'models')
const localFile = (id) => path.join(modelsDir(), LOCAL[id].uri.split('/').pop())
let nlc = null // the node-llama-cpp module (ESM, so loaded lazily)
let llama = null
let loaded = null // { id, model, context, grammar }
let downloading = null

async function localLib() {
  nlc ??= await import('node-llama-cpp')
  llama ??= await nlc.getLlama()
  return nlc
}
function localModels() {
  return Object.entries(LOCAL).map(([id, m]) => ({ id, label: m.label, size: m.size, downloaded: fs.existsSync(localFile(id)) }))
}
async function downloadLocal(id, onProgress) {
  if (!LOCAL[id]) throw new Error(`Unknown model ${id}.`)
  if (downloading) throw new Error('A download is already running.')
  const { createModelDownloader } = await localLib()
  fs.mkdirSync(modelsDir(), { recursive: true })
  try {
    downloading = await createModelDownloader({
      modelUri: LOCAL[id].uri, dirPath: modelsDir(), fileName: path.basename(localFile(id)), showCliProgress: false, skipExisting: true,
      onProgress: ({ totalSize, downloadedSize }) => onProgress(totalSize ? downloadedSize / totalSize : 0),
    })
    await downloading.download()
  } finally { downloading = null }
  return localModels()
}
async function localComplete(prompt, schema) {
  const id = LOCAL[modelFor('local')] ? modelFor('local') : 'qwen3-0.6b'
  if (!fs.existsSync(localFile(id))) throw new Error(`Download ${LOCAL[id].label} in Settings first.`)
  const { LlamaChatSession } = await localLib()
  if (loaded?.id !== id) {
    await loaded?.model.dispose()
    const model = await llama.loadModel({ modelPath: localFile(id) })
    loaded = { id, model, context: await model.createContext({ contextSize: 4096, sequences: 2 }), json: await llama.getGrammarFor('json') }
  }
  // ponytail: 2 sequences, so a third parallel call waits for a free one.
  let seq
  while (!(seq = tryGetSequence(loaded.context))) await new Promise((ok) => setTimeout(ok, 100))
  try {
    const session = new LlamaChatSession({ contextSequence: seq, systemPrompt: SYSTEM })
    // The grammar holds even a tiny model to the reply's JSON shape; thinking is off for speed.
    const grammar = schema ? await llama.createGrammarForJsonSchema(schema) : loaded.json
    return await session.prompt(prompt, { grammar, maxTokens: 700, temperature: 0.7, budgets: { thoughtTokens: 0 } })
  } finally { seq.dispose() }
}
function tryGetSequence(context) {
  try { return context.sequencesLeft > 0 ? context.getSequence() : null } catch { return null }
}

// ---------- Web search add-on ----------
// ---------- Keyless web search: DuckDuckGo's HTML results, then the top pages read as text ----------
// ponytail: scrapes DuckDuckGo's no-JS page; if it starts asking for a captcha, research falls back
// to Wikipedia. Upgrade path: a Brave or Tavily key in Settings.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36'
const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
async function ddgSearch(query, n = 6) {
  const r = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': BROWSER_UA },
    body: new URLSearchParams({ q: query }), signal: AbortSignal.timeout(12_000),
  })
  const html = await r.text()
  if (!r.ok || /anomaly-modal|bots use DuckDuckGo/i.test(html)) throw new Error('DuckDuckGo is asking for a captcha right now.')
  const out = []
  for (const block of html.split(/<div class="result results_links/).slice(1)) {
    if (/result--ad/.test(block.slice(0, 200))) continue
    const a = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!a) continue
    let url = decode(a[1])
    const wrapped = url.match(/[?&]uddg=([^&]+)/)
    if (wrapped) url = decodeURIComponent(wrapped[1])
    if (url.startsWith('//')) url = `https:${url}`
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue
    const snip = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)
    out.push({ title: decode(a[2]), url, snippet: snip ? decode(snip[1]) : '' })
    if (out.length >= n) break
  }
  return out
}
// Bing and Google News publish their results as RSS: keyless, current, and dated.
function rssItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const tag = (t) => { const x = m[1].match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\/${t}>`)); return x ? decode(x[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')) : '' }
    return { title: tag('title'), url: tag('link'), snippet: tag('description'), date: tag('pubDate'), source: tag('source') }
  }).filter((i) => i.title && /^https?:\/\//.test(i.url))
}
async function rss(url) {
  const r = await fetch(url, { headers: { 'user-agent': BROWSER_UA, accept: 'application/rss+xml, text/xml' }, signal: AbortSignal.timeout(10_000) })
  if (!r.ok) throw new Error(`${new URL(url).hostname} answered ${r.status}`)
  return rssItems(await r.text())
}
const bingSearch = async (query, n = 8) => (await rss(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`)).slice(0, n)
// Google News first (headlines from many outlets, newest included); Bing News if it fails.
async function newsSearch(query, n = 8) {
  const google = await rss(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`).catch(() => [])
  const items = google.length ? google.map((i) => ({ ...i, title: i.source ? i.title.replace(new RegExp(`\\s+-\\s+${i.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '') : i.title, snippet: '' }))
    : await rss(`https://www.bing.com/news/search?format=rss&q=${encodeURIComponent(query)}`).catch(() => [])
  return items.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)).slice(0, n)
}

// The readable text of a page: its paragraphs, without scripts, menus or markup. Text only, capped.
async function readPage(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': BROWSER_UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(8_000) })
    if (!r.ok || !/text\/html/.test(r.headers.get('content-type') ?? '')) return ''
    const html = (await r.text()).slice(0, 600_000).replace(/<(script|style|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, '')
    const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => decode(m[1])).filter((p) => p.length > 60)
    return paras.join(' ').slice(0, 1400)
  } catch { return '' }
}

async function webSearch(query) {
  if (settings.search === 'web') {
    // Two engines, so one blocking or missing a page does not leave research with nothing.
    const [bing, ddg] = await Promise.all([bingSearch(query).catch(() => []), ddgSearch(query).catch(() => [])])
    const seen = new Set()
    const key = (u) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/[#?].*$/, '').replace(/\/$/, '')
    const results = [...bing, ...ddg].filter((r) => !seen.has(key(r.url)) && seen.add(key(r.url))).slice(0, 8)
    if (!results.length) throw new Error('Web search found nothing (Bing and DuckDuckGo).')
    // Read the top three pages so research rests on more than one-line snippets.
    const texts = await Promise.all(results.slice(0, 3).map((r) => readPage(r.url)))
    return results.map((r, i) => ({ ...r, snippet: [r.snippet, texts[i]].filter(Boolean).join(' ').slice(0, 1600) }))
  }
  const key = getSecret(settings.search)
  if (settings.search === 'none' || settings.search === 'wikipedia') return []
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
function complete(prompt, schema) {
  const b = settings.backend
  if (b === 'anthropic') return anthropicComplete(prompt)
  if (b === 'opencode') return opencodeComplete(prompt)
  if (b === 'local') return localComplete(prompt, schema)
  if (BACKENDS[b]?.baseUrl !== undefined) return compatComplete(b, prompt)
  throw new Error('Pick a backend in Settings.')
}
function listModels(b) {
  if (b === 'anthropic') return anthropicModels()
  if (b === 'opencode') return opencodeModels()
  if (b === 'local') return Promise.resolve(Object.keys(LOCAL))
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
  // The Settings window and the main window each hold a copy; keep them in step.
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings:changed', publicSettings())
  return publicSettings()
})
handle('settings:open', () => openSettings())
// The theme can change in the main window or in Settings; whichever changes it, the other follows.
handle('menu:state', (state) => {
  if (typeof state?.theme !== 'string' || state.theme === menuState.theme) return
  menuState.theme = state.theme
  buildMenu()
  mainWin?.webContents.send('menu', `theme:${state.theme}`)
})
handle('models:list', (b) => listModels(b))
handle('ai:complete', (prompt, schema) => complete(prompt, schema))
// In-memory memo for search results, oldest key out past 200. Failures throw, so they are never kept.
const memo = new Map()
async function memoized(key, ttl, fn) {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.t < ttl) return hit.value
  const value = await fn()
  memo.delete(key)
  memo.set(key, { t: Date.now(), value })
  if (memo.size > 200) memo.delete(memo.keys().next().value)
  return value
}
handle('search:web', (query) => memoized(`web|${settings.search}|${query}`, 3_600_000, () => webSearch(query)))
handle('search:news', (query) => memoized(`news|${query}`, 900_000, () => newsSearch(query)))
handle('local:list', () => localModels())
ipcMain.handle('local:download', async (e, id) => {
  try { return { ok: true, value: await downloadLocal(id, (p) => e.sender.send('local:progress', id, p)) } } catch (err) { return { ok: false, error: err.message ?? String(err) } }
})

// ---------- Windows ----------
let mainWin = null
let settingsWin = null

function makeWindow(opts, hash) {
  const win = new BrowserWindow({
    // Matches the system appearance so the window never flashes the wrong colour while loading.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161618' : '#ffffff',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    ...opts,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  // Links open in the user's browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => { if (url !== win.webContents.getURL()) e.preventDefault() })
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL + (hash ? `#${hash}` : ''))
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), hash ? { hash } : {})
  return win
}
// The app draws its own top bar. On macOS the window keeps its traffic lights and gets the real
// sidebar material behind the page (Liquid Glass theme); on Windows 11 it gets Mica and the
// system caption buttons drawn over the top bar.
const overlay = () => ({ color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#1a1a1a', height: 52 })
const chrome = () => process.platform === 'darwin'
  ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 20 }, vibrancy: 'sidebar', visualEffectState: 'active', backgroundColor: '#00000000' }
  : { titleBarStyle: 'hidden', titleBarOverlay: overlay(), ...(process.platform === 'win32' ? { backgroundMaterial: 'mica', backgroundColor: '#00000000' } : {}) }
nativeTheme.on('updated', () => { if (mainWin && process.platform !== 'darwin') mainWin.setTitleBarOverlay(overlay()) })

function createWindow() {
  mainWin = makeWindow({ width: 1440, height: 900, minWidth: 720, minHeight: 520, title: 'Rabbithole', ...chrome() })
  mainWin.on('closed', () => { mainWin = null })
}
// Settings get their own small window, opened from the app menu or with Cmd/Ctrl+comma.
function openSettings() {
  if (settingsWin) { settingsWin.focus(); return }
  settingsWin = makeWindow({
    width: 560, height: 760, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    title: 'Settings', parent: process.platform === 'darwin' ? undefined : mainWin ?? undefined,
  }, 'settings')
  settingsWin.on('closed', () => { settingsWin = null })
}

// ---------- Menu bar: every command in the app is here, with its shortcut ----------
const menuState = { theme: 'obsidian' }
// With no main window open (macOS), a menu command just opens one.
const send = (cmd) => { if (mainWin) mainWin.webContents.send('menu', cmd); else createWindow() }
function buildMenu() {
  const mac = process.platform === 'darwin'
  const settingsItem = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings }
  const themes = [['glass', 'Liquid Glass'], ['winui', 'WinUI 3'], ['obsidian', 'Obsidian'], ['warm', 'Claude Warm'], ['nothing', 'Nothing OS 5'], ['m3', 'Material 3 Expressive']]
  const breadth = ['Focus', 'Balanced', 'Wide', 'Spread']
  const template = [
    ...(mac ? [{ label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' }, settingsItem, { type: 'separator' },
      { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] }] : []),
    { label: 'File', submenu: [
      { label: 'New Dive', accelerator: 'CmdOrCtrl+N', click: () => send('new-topic') },
      { type: 'separator' },
      { label: 'Export Markdown…', accelerator: 'CmdOrCtrl+E', click: () => send('export-md') },
      { label: 'Export Obsidian Vault…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('export-vault') },
      { type: 'separator' },
      ...(mac ? [{ role: 'close' }] : [settingsItem, { type: 'separator' }, { role: 'quit' }]),
    ] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
      { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('redo') },
      ...(mac ? [] : [{ label: 'Redo', accelerator: 'Ctrl+Y', visible: false, acceleratorWorksWhenHidden: true, click: () => send('redo') }]),
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'Graph', submenu: [
      // Space also goes deeper when focus is not in a text field; menus cannot claim Space without breaking typing.
      { label: 'Go Deeper', accelerator: 'CmdOrCtrl+Down', click: () => send('deeper') },
      { label: 'Go Up', accelerator: 'CmdOrCtrl+Up', click: () => send('up') },
      { type: 'separator' },
      { label: 'Re-roll Suggestions', accelerator: 'CmdOrCtrl+R', click: () => send('reroll') },
      { label: 'Research Again', accelerator: 'CmdOrCtrl+Shift+R', click: () => send('research') },
      { label: 'Dismiss Node', click: () => send('dismiss') },
      { type: 'separator' },
      { label: 'Breadth', submenu: breadth.map((label, i) => ({ label, accelerator: `CmdOrCtrl+${i + 1}`, click: () => send(`breadth:${i}`) })) },
    ] },
    { label: 'View', submenu: [
      { label: 'Theme', submenu: themes.map(([id, label]) => ({ label, type: 'radio', checked: menuState.theme === id, click: () => send(`theme:${id}`) })) },
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'toggleDevTools' }]),
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Keyboard Shortcuts', click: () => send('shortcuts') }, { label: 'Rabbithole on GitHub', click: () => shell.openExternal('https://github.com/codezeroexe/rabbithole') }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => { if (!mainWin) return createWindow(); if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus() })
app.whenReady().then(() => {
  loadSettings()
  buildMenu()
  createWindow()
  app.on('activate', () => { if (!mainWin) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', stopOpencode)
