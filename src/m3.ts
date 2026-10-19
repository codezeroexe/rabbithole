// Material 3 Expressive: every color role is a tone of one seed color (an HSL stand-in for Material's HCT).

export const SEEDS = [['Violet', '#6750A4'], ['Teal', '#006A6A'], ['Rose', '#8C4A60'], ['Olive', '#5B6300'], ['Monochrome', '#5F5F5F']] as const
export const DEFAULT_SEED = '#6750A4'

export function hueSat(hex: string) {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  const l = (max + min) / 2
  return { h: Math.round(h * 60 + 360) % 360, s: d ? d / (1 - Math.abs(2 * l - 1)) : 0 }
}

export const hslHex = (h: number, s: number, l: number) => {
  const f = (n: number) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, '0') }
  return `#${f(0)}${f(8)}${f(4)}`
}

// The CSS custom properties the m3 theme reads, for one seed in one appearance.
export function m3Vars(seed: string, dark: boolean): Record<string, string> {
  const { h, s } = hueSat(seed)
  // A gray seed is Android's Monochrome style: every role is a pure gray, and primary goes to near black or white.
  const mono = s < 0.06
  // Seeds are often muted; Material keeps the primary tones vivid, so chroma is lifted to at least ~0.55.
  const k = mono ? 0 : Math.max(0.55, Math.min(1, s * 1.6))
  const t = (hue: number, sat: number, light: number) => `hsl(${(hue + 360) % 360} ${Math.round(sat * k * 100)}% ${light}%)`
  const n = (light: number, sat = 0.12) => `hsl(${h} ${mono ? 0 : Math.round(sat * 100)}% ${light}%)`
  const c = dark ? {
    primary: t(h, .75, 80), onPrimary: t(h, .6, 20), primaryC: t(h, .5, 30), onPrimaryC: t(h, .75, 90),
    secondary: t(h, .3, 78), secondaryC: t(h, .22, 28), onSecondaryC: t(h, .3, 88), tertiary: t(h + 60, .5, 78), tertiaryC: t(h + 60, .4, 30),
    surface: n(7), low: n(10), mid: n(12), high: n(16), highest: n(21), on: n(91, .1), onVar: n(79, .1), outline: n(60, .06), outlineVar: n(30, .08), error: '#f2b8b5',
  } : {
    primary: t(h, .6, 40), onPrimary: '#ffffff', primaryC: t(h, .75, 90), onPrimaryC: t(h, .6, 17),
    secondary: t(h, .22, 42), secondaryC: t(h, .32, 88), onSecondaryC: t(h, .25, 15), tertiary: t(h + 60, .45, 40), tertiaryC: t(h + 60, .65, 90),
    surface: n(98, .2), low: n(96, .18), mid: n(94, .16), high: n(92, .14), highest: n(89, .12), on: n(11, .1), onVar: n(30, .08), outline: n(47, .06), outlineVar: n(80, .1), error: '#b3261e',
  }
  if (mono) Object.assign(c, dark ? { primary: n(92), onPrimary: n(10), primaryC: n(30), onPrimaryC: n(95) } : { primary: n(15), primaryC: n(86), onPrimaryC: n(10) })
  return {
    '--bg': c.surface, '--frame': c.surface, '--stage': c.surface, '--stage-bg': c.surface, '--header': c.surface,
    '--side-bg': c.mid, '--panel': c.mid, '--insp-bg': c.mid, '--surface': c.highest, '--ghost-bg': c.surface, '--btn': 'transparent',
    '--text': c.on, '--text2': c.onVar, '--muted': c.onVar, '--border': c.outlineVar, '--ctrl-border': c.outline,
    '--active': c.primary, '--halo': `0 0 0 3px ${c.primary}`, '--path': c.primary, '--range': c.primary, '--node-solid': c.on, '--steer-ring': c.outline,
    '--active-bg': c.primaryC, '--active-fg': c.onPrimaryC, '--active-fg2': c.onPrimaryC,
    '--aspect-bg': c.secondaryC, '--on-aspect': c.onSecondaryC, '--shape-fill': c.secondary,
    '--primary-bg': c.primary, '--primary-text': c.onPrimary, '--go-bg': c.primaryC, '--go-fg': c.onPrimaryC,
    '--item-on': c.secondaryC, '--item-on-text': c.onSecondaryC, '--seg-bg': c.high, '--seg-on': c.secondaryC, '--seg-on-text': c.onSecondaryC,
    '--crumb-bg': c.secondaryC, '--crumb-color': c.onSecondaryC, '--crumb-plain': c.high, '--field-bg': c.high, '--mark-bg': c.tertiaryC,
    '--edge': c.outline, '--edge-faint': c.outlineVar, '--tangent': c.tertiary, '--tangent-text': c.tertiary,
    '--link': c.primary, '--eyebrow': c.primary, '--kbd-border': c.outline, '--scrim': 'rgba(0, 0, 0, 0.4)', '--error': c.error,
  }
}

// Material's shape library as polar curves in a 120 box: a 12-point burst, a 4-leaf clover.
export function shape(lobes: number, depth: number, r = 48, cx = 60) {
  let d = ''
  for (let i = 0; i <= 120; i++) {
    const a = (i / 120) * Math.PI * 2, rr = r * (1 + depth * Math.cos(lobes * a))
    d += `${i ? ' L ' : 'M '}${(cx + rr * Math.cos(a - Math.PI / 2)).toFixed(1)} ${(cx + rr * Math.sin(a - Math.PI / 2)).toFixed(1)}`
  }
  return `${d} Z`
}
export const BURST = shape(12, 0.09)
export const CLOVER = shape(4, 0.16)

// Keeps the m3 color roles on <html> while the theme is m3, following the system appearance.
let unwatch: (() => void) | null = null
export function applyM3(theme: string, seed: string) {
  const root = document.documentElement
  unwatch?.()
  unwatch = null
  const clear = () => { for (const k of Object.keys(m3Vars(DEFAULT_SEED, false))) root.style.removeProperty(k) }
  if (theme !== 'm3') return clear()
  const mq = matchMedia('(prefers-color-scheme: dark)')
  const paint = () => { for (const [k, v] of Object.entries(m3Vars(seed, mq.matches))) root.style.setProperty(k, v) }
  paint()
  mq.addEventListener('change', paint)
  unwatch = () => mq.removeEventListener('change', paint)
}
