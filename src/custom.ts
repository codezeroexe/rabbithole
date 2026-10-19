// Personal look on top of any theme: accent color, font and density from prefs.
// Everything goes into one <style id="rh-custom"> with !important, so it also beats the m3 theme's
// inline <html> variables, and clearing a choice is just leaving it out.
import { prefs } from './prefs.ts'

const STACKS = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  serif: '"New York", "Iowan Old Style", Charter, Georgia, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
}

// White or near-black text, whichever reads better on this color (WCAG relative luminance).
function onColor(hex: string) {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0
  const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return l > 0.4 ? '#111111' : '#ffffff'
}

export function applyCustom() {
  const { accent, font, density } = prefs()
  let el = document.getElementById('rh-custom')
  if (!el) {
    el = document.createElement('style')
    el.id = 'rh-custom'
    document.head.appendChild(el)
  }
  const css: string[] = []
  if (accent && /^#[0-9a-f]{6}$/i.test(accent)) {
    const on = onColor(accent)
    const v = { '--active': accent, '--path': accent, '--link': accent, '--eyebrow': accent, '--range': accent, '--primary-bg': accent, '--go-bg': accent,
      '--primary-text': on, '--go-fg': on, '--halo': `0 0 0 3px ${accent}` }
    css.push(`:root { ${Object.entries(v).map(([k, x]) => `${k}: ${x} !important;`).join(' ')} }`)
  }
  if (font !== 'theme' && STACKS[font]) css.push(`:root { --sans: ${STACKS[font]} !important; --display: ${STACKS[font]} !important; }`)
  el.textContent = css.join('\n')
  document.documentElement.dataset.density = density
}
