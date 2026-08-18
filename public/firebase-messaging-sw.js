/* global importScripts, firebase, clients */

// Firebase Cloud Messaging service worker.
//
// This file MUST live at the site root (/firebase-messaging-sw.js) — the FCM
// web SDK looks for it there by name and nowhere else. It is served straight
// from public/ rather than bundled, so it can't import from src/: the config
// below is duplicated deliberately.
//
// These values are not secrets. Firebase web config is public by design;
// access is controlled by security rules and by the server key, which lives
// only in the edge function.

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey:            'AIzaSyDoQjRNxR-u6V9SAkxZ8rSl8-QOkfemUPY',
  authDomain:        'aloto-prediction-pro-5b769.firebaseapp.com',
  projectId:         'aloto-prediction-pro-5b769',
  storageBucket:     'aloto-prediction-pro-5b769.appspot.com',
  messagingSenderId: '1081450324324',
  appId:             '1:1081450324324:web:1234567890abcdef',
  vapid_key:         'BHawYa4Tq2c84QHXGvUCgRu1s1-Cgp1HkXZNt0y_hparqwGNGyrscKz43qAyqVrRvMdsanQhIedxJnqMJJD4TGE',
})

const messaging = firebase.messaging()

// Fired when a push arrives while the app is closed or backgrounded.
messaging.onBackgroundMessage(payload => {
  const d = payload.data || {}
  self.registration.showNotification(d.title || 'ALOTO Prediction Pro', {
    body: d.body || '',
    icon: '/icons/android-icon-512x512.png',
    badge: '/icons/favicon.ico',
    // Tagging by notification type means a newer reminder REPLACES an older one
    // rather than stacking. Someone who ignores the 24h nudge shouldn't come
    // back to a wall of notifications.
    tag: d.kind || 'aloto-reminder',
    renotify: true,
    data: { url: d.url || '/predict' },
  })
})

// Tapping the notification should focus an open tab rather than spawning a new
// one every time.
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = event.notification.data?.url || '/predict'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return clients.openWindow(target)
    }),
  )
})
