import { Capacitor } from '@capacitor/core'

/**
 * Light / Dark / Match phone.
 *
 * The choice is kept on this device only (localStorage), the same as the
 * browser's own dark mode setting would be: a person can want light on the
 * iPad and dark on the phone. 'system' follows the phone and changes the
 * moment the phone switches, without a reload.
 *
 * The colours themselves live in globals.css. This file only sets
 * <html data-theme="light|dark">, the browser bar colour and, in the native
 * app, the status bar text colour so the clock stays readable.
 *
 * index.html runs a tiny copy of resolve() before the page paints, so a light
 * theme never flashes dark on start-up. Keep the two in step.
 */
export const THEME_KEY = 'aloto_theme'
export const THEME_OPTIONS = [
  { value: 'light',  label: 'Light' },
  { value: 'dark',   label: 'Dark' },
  { value: 'system', label: 'Match phone' },
]

const BAR_COLOUR = { light: '#ffffff', dark: '#161126' }
const media = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null

export function getThemePref() {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* storage blocked: fall through to the default */ }
  return 'system'
}

function resolve(pref) {
  if (pref === 'light' || pref === 'dark') return pref
  return media && !media.matches ? 'light' : 'dark'
}

function apply(pref) {
  const theme = resolve(pref)
  document.documentElement.dataset.theme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', BAR_COLOUR[theme])
  if (Capacitor.isNativePlatform()) {
    // Style.Dark = light text, for a dark background; Style.Light the reverse.
    import('@capacitor/status-bar')
      .then(({ StatusBar, Style }) => StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light }))
      .catch(() => { /* plugin missing on this build: the bar keeps its default */ })
  }
  return theme
}

export function setThemePref(pref) {
  try { localStorage.setItem(THEME_KEY, pref) } catch { /* not saved, still applied */ }
  apply(pref)
  window.dispatchEvent(new CustomEvent('aloto-theme', { detail: pref }))
}

/** Call once at start-up. Applies the saved choice and follows the phone. */
export function initTheme() {
  apply(getThemePref())
  media?.addEventListener?.('change', () => {
    if (getThemePref() === 'system') apply('system')
  })
}
