import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor wraps the built web app (dist/) inside a native shell.
 *
 * The same React code runs on the web, on Android and on iOS. What changes is
 * how push notifications are delivered: on the web through a service worker and
 * the Push API, natively through APNs and FCM — which is why the iPhone
 * "add to Home Screen first" requirement disappears once wrapped.
 */
const config: CapacitorConfig = {
  // Reverse-domain form, and it must be unique across each store. Once an app
  // is published this CANNOT be changed without shipping a new listing and
  // losing every existing install, so it's worth being sure now.
  appId: 'com.alotoprediction.app',
  appName: 'ALOTO Prediction Pro',

  // Vite's build output. `npx cap sync` copies this into the native projects,
  // so `npm run build` must run before every sync.
  webDir: 'dist',

  server: {
    // Served over https inside the shell rather than the file: scheme, so that
    // browser APIs which require a secure context — notifications, storage,
    // service workers — behave as they do on the live site.
    androidScheme: 'https',
    iosScheme: 'https',
  },

  plugins: {
    PushNotifications: {
      // Ask for permission when the participant turns reminders on in Settings,
      // not on first launch. A permission prompt before someone knows what the
      // app does gets denied, and on iOS a denial is close to permanent.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },

  android: {
    // Keeps the on-screen keyboard from resizing the whole layout when
    // predicting scores — the inputs are near the bottom of long lists.
    adjustMarginsForEdgeToEdge: 'auto',
  },
}

export default config
