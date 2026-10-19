// One queue for every Wikipedia and Wikidata request. Wikimedia asks anonymous clients to keep a
// few requests in flight; past that it answers 429, so wait and retry instead of failing the node.
const MAX = 4
let active = 0
const waiting: (() => void)[] = []

// Responses are kept as text in IndexedDB (the Cache API is unreliable on file://), with a Map in
// front. Any IndexedDB failure falls back to the Map alone. Entries over 30 days old go on first use.
type Hit = { t: number, body: string, status: number }
const FRESH = 7 * 864e5
const mem = new Map<string, Hit>()
const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
let db: Promise<IDBDatabase | null> | undefined
const store = () => db ??= new Promise((ok) => {
  try {
    const q = indexedDB.open('rh-cache', 1)
    q.onupgradeneeded = () => q.result.createObjectStore('http')
    q.onerror = q.onblocked = () => ok(null)
    q.onsuccess = () => {
      const d = q.result
      // Settings is deleting the cache: let go so the delete can finish.
      d.onversionchange = () => { d.close(); db = undefined }
      try {
        const c = d.transaction('http', 'readwrite').objectStore('http').openCursor()
        c.onsuccess = () => {
          const cur = c.result
          if (!cur) return
          if (Date.now() - cur.value.t > 30 * 864e5) cur.delete()
          cur.continue()
        }
      } catch { /* prune is best effort */ }
      ok(d)
    }
  } catch { ok(null) }
})
// Forget everything cached in this window; with deleteDb, also remove the stored copy.
export function forgetCache(deleteDb = false): Promise<void> {
  mem.clear()
  void db?.then((d) => d?.close())
  db = undefined
  if (!deleteDb) return Promise.resolve()
  return new Promise((ok) => { try { const q = indexedDB.deleteDatabase('rh-cache'); q.onsuccess = q.onerror = q.onblocked = () => ok() } catch { ok() } })
}
async function recall(url: string): Promise<Hit | undefined> {
  const m = mem.get(url)
  if (m) return m
  try {
    const d = await store()
    const h: Hit | undefined = d && await req(d.transaction('http').objectStore('http').get(url))
    if (h) mem.set(url, h)
    return h
  } catch { return undefined }
}
async function remember(url: string, hit: Hit) {
  mem.set(url, hit)
  try { await req((await store())!.transaction('http', 'readwrite').objectStore('http').put(hit, url)) } catch { /* Map only */ }
}

export async function wikimedia(url: string, headers: Record<string, string>): Promise<Response> {
  const hit = await recall(url)
  if (hit && Date.now() - hit.t < FRESH) return new Response(hit.body, { status: hit.status })
  if (active >= MAX) await new Promise<void>((go) => waiting.push(go))
  active++
  try {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
      if (r.status !== 429 || attempt === 3) {
        if (r.ok) void r.clone().text().then((body) => remember(url, { t: Date.now(), body, status: r.status })).catch(() => {})
        // Still rate-limited or a server error: a stale copy beats a failed node.
        return !r.ok && hit ? new Response(hit.body, { status: hit.status }) : r
      }
      const after = Number(r.headers.get('retry-after'))
      await new Promise((ok) => setTimeout(ok, after > 0 ? after * 1000 : 800 * 2 ** attempt))
    }
  } catch (e) {
    if (hit) return new Response(hit.body, { status: hit.status }) // offline or timed out: any age beats nothing
    throw e
  } finally {
    active--
    waiting.shift()?.()
  }
}
