import type { GraphNode } from './graph.ts'

// Small pieces of the node work: star glyph, hover preview, trail-replay chip.
export const StarIcon = ({ on, size = 16 }: { on: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" />
  </svg>
)

const FROM = { wiki: 'From Wikipedia', model: 'Suggested by the AI model', web: 'From the web' }

// x and y are the card's world position, so the popover scales and pans with the camera.
export function CardPreview({ node, x, y }: { node: GraphNode; x: number; y: number }) {
  return (
    <div className="card-preview" id="card-preview" role="tooltip" style={{ left: x, top: y }}>
      <b>{node.label}</b>
      {node.teaser && <p>{node.teaser}</p>}
      {node.origin && <span className="muted">{FROM[node.origin]}</span>}
      {node.tangent && <span className="muted">Tangent: a side step from the main thread</span>}
      <span className="hint">Click to open · X to dismiss</span>
    </div>
  )
}

export function ReplayChip({ at, total, label, onStop }: { at: number; total: number; label: string; onStop: () => void }) {
  return (
    <div className="replay-chip" role="status">
      <span>Replaying {at} of {total} · {label}</span>
      <button type="button" className="link-btn" onClick={onStop}>Stop</button>
    </div>
  )
}
