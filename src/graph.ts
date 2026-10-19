// Pure graph state and helpers. No React, no network: easy to test with `npm run check`.

export type Status = 'solid' | 'ghost' | 'dismissed'
export type Fact = { k: string; v: string }
export type Source = { title: string; url: string }
// ref: the exact Wikipedia title a suggestion came from, when it came from Wikipedia.
// offWiki: a real thing (from Wikidata) with no Wikipedia article yet; it is researched from the web.
// origin: where the branch came from. 'wiki' = a Wikipedia article, 'model' = invented by the AI model, 'web' = off-Wikipedia.
export type Suggestion = { label: string; teaser: string; tangent: boolean; ref?: string; kind?: Kind; facet?: Facet; offWiki?: boolean; origin?: 'wiki' | 'model' | 'web' }
// What a node is, which decides how it narrows:
// thing:  a real article (the seed, a member of an aspect, a link from the reader). It splits into aspects.
// aspect: one slice of the thing above it (its products, members, works). It lists its members.
// cross:  a related article reached from a thing ("YouTube" under "Minecraft"). It means both at once,
//         so what comes under it has to fit the thing above as well (Minecraft YouTubers).
export type Kind = 'thing' | 'aspect' | 'cross'
// Where an aspect's members come from: a Wikidata relation ("P176<" = things whose manufacturer is
// the anchor, "P112>" = the anchor's founders) or a section of the anchor's article.
export type Facet = { src: 'wd' | 'section'; key: string; of: string }
// verified: sources came from a real web search rather than the model's memory.
// web: what the web search found, shown under the summary (title, page, snippet).
// news: recent headlines about the node read in its path, newest first.
export type Research = { image?: string; summary: string; facts: Fact[]; sources: Source[]; verified?: boolean; web?: { title: string; url: string; snippet: string }[]; news?: { title: string; url: string; source: string; date: string }[] }

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
  via?: 'suggestion' | 'link' | 'steer' // how the user reached it; unset on older dives and on suggestions
  kind?: Kind // unset on older dives: the seed is a thing, everything else a cross
  facet?: Facet
  steer?: string // the user's words narrowing this node ("tech brand"); applies to everything under it
  offWiki?: boolean
  origin?: 'wiki' | 'model' | 'web' // unset on suggestions from the offline mock and on older dives
  research?: Research
  loading?: number // request id while suggestions are in flight
  researching?: number // request id while research is in flight
  starred?: boolean // the user marked it to come back to
}

export type Graph = {
  nodes: GraphNode[]
  active: string
  spread: number
  notes: Record<string, string>
  updated?: number // last change, for the list of dives
  visits?: { id: string; t: number }[] // every node opened, in the order the user opened them, for trail replay
}

let seq = 0
export const nid = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`
const lc = (s: string) => s.toLowerCase()
// Citation markers ("[2]") belong in the panel and the vault, not on cards or plain Markdown.
export const stripCites = (s: string) => s.replace(/\s*\[\d+\]/g, '')
// "The Beatles" = "Beatles", "Ferrari (company)" = "Ferrari", "Cars" = "Car".
export const norm = (s: string) =>
  s.toLowerCase().replace(/\s+\([^)]*\)$/, '').replace(/^(the|a|an)\s+/, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean)
    .map((w) => (w.length > 3 ? w.replace(/(ies)$/, 'y').replace(/(?<!s)s$/, '') : w)).join(' ')

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

export const kindOf = (n: GraphNode): Kind => n.kind ?? (n.parent ? 'cross' : 'thing')
export type Anchor = { label: string; ref?: string }

export type ExpandContext = {
  path: string[]
  kind: Kind
  facet?: Facet
  steer?: string
  offWiki?: boolean
  // The narrowing so far, nearest first: every article on the path (things and crosses, not aspects)
  // and every steer. Each new level has to fit these, so the whole path is the query, not the last label.
  anchors: Anchor[]
  qualifiers: string[]
  taken: string[] // this node's children the user opened or dismissed: never offered again
  pathRefs: string[] // Wikipedia title (or label) of each node on the path, seed first
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
  const path = pathOf(g, pid)
  const above = path.slice(0, -1).reverse()
  return {
    path: path.map((n) => n.label),
    kind: kindOf(p),
    offWiki: p.offWiki,
    facet: p.facet,
    steer: p.steer,
    anchors: above.filter((n) => kindOf(n) !== 'aspect').map((n) => ({ label: n.label, ref: n.ref })),
    taken: kids.filter((n) => n.status !== 'ghost').map((n) => n.label),
    qualifiers: path.map((n) => n.steer).filter((s): s is string => !!s).reverse(),
    pathRefs: pathOf(g, pid).map((n) => n.ref ?? n.label),
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
  // Articles appear once in the whole graph; aspect names ("Members") only once per node.
  const taken = new Set(g.nodes.map((n) => norm(n.label)))
  const siblings = new Set(kidsOf(g, pid).map((n) => norm(n.label)))
  const refs = new Set(g.nodes.map((n) => n.ref).filter(Boolean))
  for (const s of items) {
    const label = s.label.trim()
    if (!label || (s.kind === 'aspect' ? siblings : taken).has(norm(label)) || (s.ref && refs.has(s.ref))) continue
    taken.add(norm(label))
    siblings.add(norm(label))
    if (s.ref) refs.add(s.ref)
    g.nodes.push({ id: nid(), label, parent: pid, status: 'ghost', tangent: !!s.tangent, steered: false, rolls: 0, teaser: s.teaser, ref: s.ref, kind: s.kind, facet: s.facet, offWiki: s.offWiki, origin: s.origin })
  }
}

// Streaming: swap a node's ghosts for a new set. Ghosts whose label is still in `items` stay (same id, no jump).
export function mergeGhosts(g: Graph, pid: string, items: Suggestion[]) {
  const keep = new Set(items.map((s) => norm(s.label)))
  g.nodes = g.nodes.filter((n) => !(n.parent === pid && n.status === 'ghost' && !keep.has(norm(n.label))))
  addGhosts(g, pid, items)
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
  g.nodes.push({ id, label, parent: pid, status: 'solid', tangent: false, steered: true, rolls: 0, via: 'steer' })
  return id
}

// A link clicked in the reader: open the matching child if there is one, or add the article as a new child.
export function linkNode(g: Graph, pid: string, title: string): string {
  const existing = kidsOf(g, pid).find((x) => x.ref === title || lc(x.label) === lc(title))
  if (existing) {
    existing.status = 'solid'
    return existing.id
  }
  const id = nid()
  g.nodes.push({ id, label: title, ref: title, parent: pid, status: 'solid', tangent: false, steered: false, rolls: 0, via: 'link', kind: 'thing' })
  return id
}

// Steering narrows the node itself: no new node. A thing is looked up again with the user's words
// ("nothing" + "tech brand" -> Nothing (company)); its suggestions are cleared for a fresh roll.
export function steerOn(g: Graph, id: string, words: string) {
  const n = find(g, id)
  if (!n) return
  n.steer = words.trim() || undefined
  if (kindOf(n) !== 'aspect' && n.via !== 'link') n.ref = undefined
  n.research = undefined
  n.rolls = 0
  clearGhosts(g, id)
}

// One column per depth level, left to right. Leaves stack down their column;
// a parent sits level with the middle of its children.
// ponytail: card heights are estimates (cards clamp their text), not measured.
export const COLUMN = 300
export const SKELETONS = 4

// Path nodes 3+ levels above the active one show only their path child; `folds` counts the rest.
export function relayout(g: Graph, unfolded: Set<string> = new Set()) {
  const pos: Record<string, { x: number; y: number }> = {}
  const folds: Record<string, number> = {}
  const path = pathOf(g, g.active)
  const pathIds = new Set(path.map((n) => n.id))
  const maxFold = path.length - 1 - 3
  let cursor = 0
  // Ghosts off the active branch show their title only, so they are shorter.
  const est = (n: GraphNode) =>
    n.id === g.active ? 170 : n.status === 'dismissed' ? 44 : n.status === 'ghost' ? (n.parent === g.active ? 92 : 48) : n.parent ? 100 : 110
  const place = (n: GraphNode, depth: number) => {
    let kids = kidsOf(g, n.id)
    if (depth <= maxFold && pathIds.has(n.id) && !unfolded.has(n.id) && kids.length > 1) {
      folds[n.id] = kids.length - 1
      kids = kids.filter((k) => pathIds.has(k.id))
    }
    // While suggestions load, reserve skeleton slots `<parent>~sk<i>` below any cards already in (i from kids.length).
    const skel = (from: number) => {
      for (let i = from; i < SKELETONS; i++) {
        pos[`${n.id}~sk${i}`] = { x: (depth + 1) * COLUMN, y: cursor + 46 }
        cursor += 92 + 14
      }
    }
    if (!kids.length && n.loading) {
      const first = cursor
      skel(0)
      pos[n.id] = { x: depth * COLUMN, y: (first + cursor - 14) / 2 }
      return
    }
    if (!kids.length) {
      const h = est(n)
      pos[n.id] = { x: depth * COLUMN, y: cursor + h / 2 }
      cursor += h + 14
      return
    }
    kids.forEach((k) => place(k, depth + 1))
    const top = pos[kids[0].id].y
    if (n.loading && kids.length < SKELETONS) { skel(kids.length); pos[n.id] = { x: depth * COLUMN, y: (top + cursor - 14 - 46) / 2 }; return }
    pos[n.id] = { x: depth * COLUMN, y: (top + pos[kids[kids.length - 1].id].y) / 2 }
  }
  g.nodes.filter((n) => !n.parent).forEach((r) => place(r, 0))
  return { pos, folds }
}

export function exportMarkdown(g: Graph): string {
  const lines: string[] = []
  const walk = (n: GraphNode, depth: number) => {
    const pad = '  '.repeat(depth)
    lines.push(`${pad}- **${n.label}**${n.steered ? ' (steered)' : ''}`)
    if (n.research?.summary) lines.push(`${pad}  ${stripCites(n.research.summary)}`)
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
    if (r?.sources.length) parts.push('## Sources', ...r.sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`), '')
    if (g.notes[n.id]) parts.push('## Notes', g.notes[n.id], '')
    return { name: `${names.get(n.id)}.md`, text: parts.join('\n') }
  })
}
