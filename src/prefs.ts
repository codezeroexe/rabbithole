// App preferences from the Settings window's General pane. Both windows share localStorage, so the
// main window reads them when it needs them; nothing has to be pushed across.

export type Prefs = {
  openLast: boolean // reopen the last dive at launch, instead of Home
  breadth: number // spread a new dive starts with
  news: boolean // add recent headlines to research notes
  prefetch: boolean // load the next level ahead of time (free engine only)
  glass: number // Liquid Glass from clear (0) to tinted (1), as macOS 27's slider
  readingLevel: 'quick' | 'standard' | 'deep' // how much of a node's notes to show
  web: boolean // add pages from the open web to research notes
  blocked: string[] // domains never shown or cited ("example.com")
  muted: string[] // interest topics the user turned off (lowercase labels)
  accent: string | null // overrides the theme's accent color; null keeps the theme's
  font: 'theme' | 'system' | 'serif' | 'mono' | 'rounded' // reading and display font; 'theme' keeps the theme's
  density: 'compact' | 'regular' | 'roomy'
  layout: 'tree' | 'down' | 'radial' // how the graph is drawn
  sounds: boolean // soft sounds on Go deeper and opening a node
  dockIcon: boolean // the Dock icon follows the theme (macOS)
}
export const BREADTH = [{ label: 'Focus', spread: 20 }, { label: 'Balanced', spread: 50 }, { label: 'Wide', spread: 75 }, { label: 'Spread', spread: 100 }]
const DEFAULTS: Prefs = {
  openLast: true, breadth: 20, news: true, prefetch: true, glass: 0.5, readingLevel: 'standard', web: true, blocked: [], muted: [],
  accent: null, font: 'theme', density: 'regular', layout: 'tree', sounds: false, dockIcon: false,
}

export function prefs(): Prefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('rh.prefs') ?? '{}') } } catch { return DEFAULTS }
}
export function setPrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...prefs(), ...patch }
  try { localStorage.setItem('rh.prefs', JSON.stringify(next)) } catch { /* storage unavailable */ }
  return next
}

// The Settings window asks the main window to act through this key: 'reload' after it changed the
// saved dives (import, delete all), 'cache-cleared' after it emptied the page cache.
export function request(type: 'reload' | 'cache-cleared') {
  try { localStorage.setItem('rh.request', JSON.stringify({ type, t: Date.now() })) } catch { /* storage unavailable */ }
}

// Shortcut glyphs as the platform writes them.
export const MOD = /Mac/.test(navigator.userAgent) ? '⌘' : 'Ctrl+'

// Every shortcut in the main window, for the shortcuts sheet and the About pane.
export const SHORTCUTS: [string, string][] = [
  ['↓ ↑', 'Move between suggestions'], ['→ or Space', 'Go deeper'], ['←', 'Go up'], ['Enter', 'Open the focused card'],
  ['X or Delete', 'Dismiss the focused card'], ['R', 'Re-roll'], ['S', 'Steer'], ['B', 'Star or unstar this node'], ['F', 'Fit the path on screen'],
  [`${MOD}Z`, 'Undo'], [`${MOD === '⌘' ? '⇧⌘' : 'Ctrl+Shift+'}Z`, 'Redo'], [`${MOD}N`, 'New dive'], [`${MOD},`, 'Settings'], ['?', 'Show or hide this list'],
]

// The glass theme reads --glass for its fill and blur.
export const applyGlass = () => document.documentElement.style.setProperty('--glass', String(prefs().glass))
