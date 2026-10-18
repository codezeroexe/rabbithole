// One queue for every Wikipedia and Wikidata request. Wikimedia asks anonymous clients to keep a
// few requests in flight; past that it answers 429, so wait and retry instead of failing the node.
const MAX = 4
let active = 0
const waiting: (() => void)[] = []

export async function wikimedia(url: string, headers: Record<string, string>): Promise<Response> {
  if (active >= MAX) await new Promise<void>((go) => waiting.push(go))
  active++
  try {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
      if (r.status !== 429 || attempt === 3) return r
      const after = Number(r.headers.get('retry-after'))
      await new Promise((ok) => setTimeout(ok, after > 0 ? after * 1000 : 800 * 2 ** attempt))
    }
  } finally {
    active--
    waiting.shift()?.()
  }
}
