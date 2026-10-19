// The Dock icon follows the theme (macOS): the app mark drawn with the live theme colors.
import { bridge } from './ai.ts'
import { prefs } from './prefs.ts'

let sent: string | null | undefined // last value sent, so repeated calls don't spam the main process

const send = (url: string | null) => {
  if (url === sent) return
  sent = url
  bridge?.setDockIcon?.(url).catch(() => { sent = undefined })
}

export function applyDockIcon() {
  if (bridge?.platform !== 'darwin' || !bridge.setDockIcon) return
  if (!prefs().dockIcon) return send(null)
  // Wait a frame: the theme effect has just written the CSS variables.
  requestAnimationFrame(() => {
    const css = getComputedStyle(document.documentElement)
    const v = (n: string) => css.getPropertyValue(n).trim()
    const c = document.createElement('canvas')
    c.width = c.height = 1024
    const g = c.getContext('2d')
    if (!g) return
    // macOS icon grid: 824 px rounded square centred in 1024.
    g.beginPath()
    g.roundRect(100, 100, 824, 824, 185)
    g.fillStyle = v('--bg') || v('--panel') || '#ffffff'
    g.fill()
    const sheen = g.createLinearGradient(0, 100, 0, 924)
    sheen.addColorStop(0, 'rgba(255,255,255,0.12)')
    sheen.addColorStop(1, 'rgba(0,0,0,0.08)')
    g.fillStyle = sheen
    g.fill()
    // The mark's 120 box scaled to 520 px, centred.
    const k = 520 / 120
    g.translate(512 - 60 * k, 512 - 60 * k)
    g.scale(k, k)
    g.strokeStyle = v('--text') || '#1d1d1f'
    g.lineWidth = 4.5
    for (const [x, y, r] of [[60, 60, 54], [65, 63, 33], [70, 66, 15]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke() }
    g.fillStyle = v('--active') || '#0071e3'
    g.beginPath()
    g.arc(70, 66, 9, 0, Math.PI * 2)
    g.fill()
    send(c.toDataURL('image/png'))
  })
}
