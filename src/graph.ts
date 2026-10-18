// Pure graph state and helpers. No React, no network: easy to test with `npm run check`.

export type Status = 'solid' | 'ghost' | 'dismissed'
export type Fact = { k: string; v: string }
export type Source = { title: string; url: string }
// ref: the exact Wikipedia title a suggestion came from, when it came from Wikipedia.
export type Suggestion = { label: string; teaser: string; tangent: boolean; ref?: string }
// verified: sources came from a real web search rather than the model's memory.
export type Research = { summary: string; facts: Fact[]; sources: Source[]; verified?: boolean }

export type GraphNode = {
  id: string
  label: string
  parent: string | null
  status: Status
  tangent: boolean
  steered: boolean
  rolls: number
  teaser?: string
  ref?: string // Wikipedia title this node is about, once known
  research?: Research
  loading?: number // request id while suggestions are in flight
  researching?: number // request id while research is in flight
}

export type Graph = {
  nodes: GraphNode[]
  active: string
  spread: number
  notes: Record<string, string>
}

let seq = 0
export const nid = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`
const lc = (s: string) => s.toLowerCase()

export function newGraph(seed: string): Graph {
  return {
    nodes: [{ id: 'root', label: seed, parent: null, status: 'solid', tangent: false, steered: false, rolls: 0 }],
    active: 'root',
    spread: 30,
    notes: {},
  }
}

export const find = (g: Graph, id: string) => g.nodes.find((n) => n.id === id)
export const kidsOf = (g: Graph, id: string) => g.nodes.filter((n) => n.parent === id)
export const liveKids = (g: Graph, id: string) => kidsOf(g, id).filter((n) => n.status !== 'dismissed')

export function pathOf(g: Graph, id: string): GraphNode[] {
  const out: GraphNode[] = []
  for (let n = find(g, id); n; n = n.parent ? find(g, n.parent) : undefined) out.unshift(n)
  return out
}

export const tangentsFor = (spread: number) => (spread <= 35 ? 0 : spread <= 65 ? 1 : spread <= 85 ? 2 : 3)
export const modeFor = (spread: number) => ['Focus', 'Balanced', 'Wide', 'Spread'][tangentsFor(spread)]

export type ExpandContext = {
  path: string[]
  label: string
  ref?: string
  steered: string[]
  steeredRefs: string[]
  dismissed: string[]
  taste: string[]
  avoid: string[]
  focusCount: number
  tangentCount: number
  rolls: number
  hints?: string[] // on-topic article titles a model can draw from
}

// Everything the AI needs to expand one node: where it sits, what the user liked and rejected.
export function contextFor(g: Graph, pid: string): ExpandContext {
  const p = find(g, pid)!
  const kids = kidsOf(g, pid)
  const t = tangentsFor(g.spread)
  return {
    path: pathOf(g, pid).map((n) => n.label),
    label: p.label,
    ref: p.ref,
    steered: kids.filter((n) => n.steered).map((n) => n.label),
    steeredRefs: kids.filter((n) => n.steered).map((n) => n.ref ?? n.label),
    dismissed: kids.filter((n) => n.status === 'dismissed').map((n) => n.label),
    taste: g.nodes.filter((n) => n.steered && n.parent !== pid).map((n) => n.label),
    avoid: g.nodes.filter((n) => !(n.parent === pid && n.status === 'ghost')).map((n) => n.label).slice(-80),
    focusCount: 4 - t,
    tangentCount: t,
    rolls: p.rolls,
  }
}

export function clearGhosts(g: Graph, pid: string) {
  g.nodes = g.nodes.filter((n) => !(n.parent === pid && n.status === 'ghost'))
}

export function addGhosts(g: Graph, pid: string, items: Suggestion[]) {
  const taken = new Set(g.nodes.map((n) => lc(n.label)))
  for (const s of items) {
    const label = s.label.trim()
    if (!label || taken.has(lc(label))) continue
    taken.add(lc(label))
    g.nodes.push({ id: nid(), label, parent: pid, status: 'ghost', tangent: !!s.tangent, steered: false, rolls: 0, teaser: s.teaser, ref: s.ref })
  }
}

// Remove a node's whole subtree and mark it dismissed (a negative hint for its parent).
export function dismissNode(g: Graph, id: string) {
  const n = find(g, id)
  if (!n || !n.parent) return
  const gone = new Set<string>()
  const walk = (pid: string) => g.nodes.forEach((x) => { if (x.parent === pid) { gone.add(x.id); walk(x.id) } })
  walk(id)
  g.nodes = g.nodes.filter((x) => !gone.has(x.id))
  n.status = 'dismissed'
  n.steered = false
  n.research = undefined
  if (g.active === id || gone.has(g.active)) g.active = n.parent
}

// Add (or re-mark) a child the user typed in. Returns its id.
export function steerNode(g: Graph, pid: string, label: string): string {
  const existing = kidsOf(g, pid).find((x) => lc(x.label) === lc(label))
  if (existing) {
    existing.status = 'solid'
    existing.steered = true
    return existing.id
  }
  const id = nid()
  g.nodes.push({ id, label, parent: pid, status: 'solid', tangent: false, steered: true, rolls: 0 })
  return id
}

// One column per depth level, left to right. Leaves stack down their column;
// a parent sits level with the middle of its children.
// ponytail: card heights are estimates (cards clamp their text), not measured.
export const COLUMN = 300
export function relayout(g: Graph): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {}
  let cursor = 0
  const est = (n: GraphNode) =>
    n.id === g.active ? 170 : n.status === 'dismissed' ? 44 : n.status === 'ghost' ? 92 : n.parent ? 100 : 110
  const place = (n: GraphNode, depth: number) => {
    const kids = kidsOf(g, n.id)
    if (!kids.length) {
      const h = est(n)
      pos[n.id] = { x: depth * COLUMN, y: cursor + h / 2 }
      cursor += h + 14
      return
    }
    kids.forEach((k) => place(k, depth + 1))
    pos[n.id] = { x: depth * COLUMN, y: (pos[kids[0].id].y + pos[kids[kids.length - 1].id].y) / 2 }
  }
  g.nodes.filter((n) => !n.parent).forEach((r) => place(r, 0))
  return pos
}

export function exportMarkdown(g: Graph): string {
  const lines: string[] = []
  const walk = (n: GraphNode, depth: number) => {
    const pad = '  '.repeat(depth)
    lines.push(`${pad}- **${n.label}**${n.steered ? ' (steered)' : ''}`)
    if (n.research?.summary) lines.push(`${pad}  ${n.research.summary}`)
    if (g.notes[n.id]) lines.push(`${pad}  > ${g.notes[n.id]}`)
    kidsOf(g, n.id).filter((k) => k.status === 'solid').forEach((k) => walk(k, depth + 1))
  }
  const root = g.nodes.find((n) => !n.parent)
  if (root) walk(root, 0)
  return lines.join('\n') + '\n'
}

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, '-').trim() || 'Untitled'

// One note per solid node, linked with [[wikilinks]]. Duplicate labels get a numeric suffix.
export function exportVault(g: Graph): { name: string; text: string }[] {
  const solid = g.nodes.filter((n) => n.status === 'solid')
  const names = new Map<string, string>()
  const used = new Map<string, number>()
  for (const n of solid) {
    const base = fileSafe(n.label)
    const count = (used.get(lc(base)) ?? 0) + 1
    used.set(lc(base), count)
    names.set(n.id, count === 1 ? base : `${base} (${count})`)
  }
  return solid.map((n) => {
    const r = n.research
    const kids = kidsOf(g, n.id).filter((k) => k.status === 'solid')
    const parts = [
      '---',
      `path: "${pathOf(g, n.id).map((p) => p.label).join(' › ').replace(/"/g, "'")}"`,
      `steered: ${n.steered}`,
      `focus: ${g.spread}`,
      '---',
      '',
      n.parent ? `Up: [[${names.get(n.parent)}]]` : 'Seed topic.',
      '',
    ]
    if (r?.summary) parts.push(r.summary, '')
    if (r?.facts.length) parts.push(...r.facts.map((f) => `- **${f.k}:** ${f.v}`), '')
    if (kids.length) parts.push('## Branches', ...kids.map((k) => `- [[${names.get(k.id)}]]`), '')
    if (r?.sources.length) parts.push('## Sources', ...r.sources.map((s) => `- [${s.title}](${s.url})`), '')
    if (g.notes[n.id]) parts.push('## Notes', g.notes[n.id], '')
    return { name: `${names.get(n.id)}.md`, text: parts.join('\n') }
  })
}
