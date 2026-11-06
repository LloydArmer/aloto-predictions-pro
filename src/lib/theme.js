import { Capacitor } from '@capacitor/core'

/**
 * The app is dark only (Lloyd, 6 Nov 2026: no white background). This sets
 * <html data-theme="dark"> and, in the native app, light status bar text so
 * the clock stays readable over the dark top bar.
 *
 * Kept as its own file so a light theme can come back later in one place:
 * globals.css would need a :root[data-theme="light"] block again.
 */
export function initTheme() {
  document.documentElement.dataset.theme = 'dark'
  if (Capacitor.isNativePlatform()) {
    // Style.Dark = light text, for a dark background.
    import('@capacitor/status-bar')
      .then(({ StatusBar, Style }) => StatusBar.setStyle({ style: Style.Dark }))
      .catch(() => { /* plugin missing on this build: the bar keeps its default */ })
  }
}
