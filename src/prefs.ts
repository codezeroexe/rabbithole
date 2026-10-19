// App preferences from the Settings window's General pane. Both windows share localStorage, so the
// main window reads them when it needs them; nothing has to be pushed across.

export type Prefs = {
  openLast: boolean // reopen the last dive at launch, instead of Home
  breadth: number // spread a new dive starts with
  news: boolean // add recent headlines to research notes
  prefetch: boolean // load the next level ahead of time (free engine only)
  glass: number // Liquid Glass from clear (0) to tinted (1), as macOS 27's slider
}
export const BREADTH = [{ label: 'Focus', spread: 20 }, { label: 'Balanced', spread: 50 }, { label: 'Wide', spread: 75 }, { label: 'Spread', spread: 100 }]
const DEFAULTS: Prefs = { openLast: true, breadth: 20, news: true, prefetch: true, glass: 0.5 }

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
  ['X or Delete', 'Dismiss the focused card'], ['R', 'Re-roll'], ['S', 'Steer'], ['F', 'Fit the path on screen'],
  [`${MOD}Z`, 'Undo'], [`${MOD === '⌘' ? '⇧⌘' : 'Ctrl+Shift+'}Z`, 'Redo'], [`${MOD}N`, 'New dive'], [`${MOD},`, 'Settings'], ['?', 'Show or hide this list'],
]

// The glass theme reads --glass for its fill and blur.
export const applyGlass = () => document.documentElement.style.setProperty('--glass', String(prefs().glass))
