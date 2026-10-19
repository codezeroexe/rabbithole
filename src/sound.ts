// Soft sounds on Go deeper and on opening a node, when Settings turns them on.
import { prefs } from './prefs.ts'

let ctx: AudioContext | null = null

// One sine note: 5 ms attack so it never clicks, then an exponential release.
function note(c: AudioContext, freq: number, at: number, dur: number) {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.linearRampToValueAtTime(0.05, at + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(gain).connect(c.destination)
  osc.start(at)
  osc.stop(at + dur + 0.02)
}

export function chime(kind: 'deeper' | 'open') {
  try {
    if (!prefs().sounds) return
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    const t = ctx.currentTime + 0.01
    if (kind === 'deeper') { note(ctx, 520, t, 0.11); note(ctx, 780, t + 0.11, 0.11) } else note(ctx, 660, t, 0.06)
  } catch { /* audio unavailable */ }
}
