// What the user keeps diving into, read from their saved dives: every opened node's label, counted
// across dives, with seeds and repeated visits weighing more. Muted topics (Settings) are left out.
import type { Graph } from './graph.ts'
import { prefs } from './prefs.ts'

export type Interest = { label: string; ref?: string; count: number }

export function interests(graphs: Graph[], limit = 12): Interest[] {
  const muted = new Set(prefs().muted)
  const tally = new Map<string, Interest>()
  for (const g of graphs) {
    for (const n of g.nodes) {
      if (n.status !== 'solid') continue
      const key = n.label.toLowerCase()
      if (muted.has(key)) continue
      const weight = (n.parent ? 1 : 2) + (g.visits?.filter((v) => v.id === n.id).length ?? 0)
      const cur = tally.get(key) ?? { label: n.label, ref: n.ref, count: 0 }
      cur.count += weight
      tally.set(key, cur)
    }
  }
  return [...tally.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}
