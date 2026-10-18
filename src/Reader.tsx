import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { wikiPageUrl, wikiSection, wikiSections } from './wiki.ts'
import type { Section } from './wiki.ts'

// The article a node is about, read in place. Every article link is a way deeper: clicking one
// adds it as a child of this node. Sections load one at a time, when opened.
export function Reader({ title, onBranch, onGraph }: { title: string; onBranch: (title: string) => void; onGraph: Set<string> }) {
  const [state, setState] = useState<{ title: string; page: string; sections: Section[]; lead: string } | { title: string; error: string } | null>(null)
  const [open, setOpen] = useState<Record<string, string | 'loading' | { error: string }>>({})
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    Promise.all([wikiSections(title), wikiSection(title, '0')])
      .then(([s, lead]) => { if (live) setState({ title, page: s.title, sections: s.sections, lead }) })
      .catch((e: Error) => { if (live) setState({ title, error: e.message }) })
    return () => { live = false }
  }, [title])

  // Mark the links that are already somewhere on the graph.
  useEffect(() => {
    body.current?.querySelectorAll<HTMLAnchorElement>('a[data-wiki]').forEach((a) => a.classList.toggle('on-graph', onGraph.has(a.dataset.wiki!.toLowerCase())))
  })

  const toggle = (index: string) => {
    if (open[index]) { setOpen(({ [index]: _, ...rest }) => rest); return }
    setOpen((o) => ({ ...o, [index]: 'loading' }))
    wikiSection(title, index)
      .then((html) => setOpen((o) => (o[index] ? { ...o, [index]: html } : o)))
      .catch((e: Error) => setOpen((o) => (o[index] ? { ...o, [index]: { error: e.message } } : o)))
  }

  const click = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-wiki]')
    if (!a) return
    e.preventDefault()
    onBranch(a.dataset.wiki!)
  }

  if (!state || state.title !== title) return <p className="muted pulse">Loading {title} from Wikipedia…</p>
  if ('error' in state) return <p className="error">Couldn't load this article: {state.error}. Check your connection, then open the node again.</p>

  return (
    <div className="reader" ref={body} onClick={click}>
      <p className="muted reader-hint">Click any link to branch to it from here.</p>
      <div className="article" dangerouslySetInnerHTML={{ __html: state.lead }} />
      {state.sections.map((s) => {
        const v = open[s.index]
        return (
          <section key={s.index} className="reader-section">
            <button type="button" className="reader-h" aria-expanded={!!v} onClick={() => toggle(s.index)}>
              <span aria-hidden="true">{v ? '▾' : '▸'}</span>{s.title}
            </button>
            {v === 'loading' && <p className="muted pulse">Loading…</p>}
            {typeof v === 'object' && <p className="error">Couldn't load this section: {v.error}.</p>}
            {typeof v === 'string' && <div className="article" dangerouslySetInnerHTML={{ __html: v }} />}
          </section>
        )
      })}
      <p className="muted attribution">
        From <a href={wikiPageUrl(state.page)} target="_blank" rel="noreferrer noopener">{state.page}</a> on Wikipedia, available under{' '}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer noopener">CC BY-SA 4.0</a>.
      </p>
    </div>
  )
}
