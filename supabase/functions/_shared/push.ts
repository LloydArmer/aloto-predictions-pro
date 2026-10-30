// Sending a push notification, for whichever function needs to.
//
// The machinery here was proven in send-reminders and is reproduced rather
// than re-invented: FCM's HTTP v1 API for the web, APNs directly for iPhones,
// both signed with Web Crypto so nothing Node-oriented has to run under Deno.
//
// Why iPhones go straight to Apple: the app registers with
// @capacitor/push-notifications, which on iOS hands back an APPLE device token.
// Firebase only accepts Firebase tokens, so sending an iPhone's token to FCM
// gets it rejected as invalid — and then deleted as stale, which is how an
// iPhone ends up never receiving anything however correctly it registered.
//
// NOTE: send-reminders still carries its own copy of this code. Moving it over
// is worth doing, but it is a live function that sends every reminder in the
// app, and it should be changed on its own with its own test rather than as a
// side effect of adding chat.

export type SendResult = 'sent' | 'stale' | 'failed'

// ---------------------------------------------------------------------------
// Firebase Cloud Messaging — the web
// ---------------------------------------------------------------------------

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  // Supabase secrets store newlines escaped, so restore them before parsing.
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  const raw = atob(body)
  const buf = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)
  return buf.buffer
}

let cachedToken: { value: string; expiresAt: number } | null = null

export async function getAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  // Tokens last an hour; reuse across warm invocations.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value

  const now = Math.floor(Date.now() / 1000)
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)))
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`FCM auth failed: ${data.error_description || data.error || res.status}`)

  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 }
  return data.access_token
}

export async function sendFcmPush(
  projectId: string,
  accessToken: string,
  token: string,
  title: string,
  body: string,
  link: string,
  kind: string,
  // Lets the caller stop two notifications collapsing into one. The service
  // worker tags by this when given it, and falls back to kind when not.
  tag?: string,
): Promise<SendResult> {
  // DATA-ONLY. There is deliberately no `notification` block.
  //
  // A message carrying a `notification` payload is displayed automatically by
  // the Firebase SDK, and the service worker's onBackgroundMessage handler then
  // displays it a SECOND time — so every notification arrives twice, and the
  // two copies do not collapse because the auto-displayed one carries no tag.
  //
  // With data only, the service worker is the single place a notification is
  // created. Every value in `data` must be a string; FCM rejects anything else.
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        data: { title, body, url: link, kind, tag: tag ?? kind },
        webpush: { headers: { Urgency: 'high' } },
      },
    }),
  })
  if (res.ok) return 'sent'

  const err = await res.json().catch(() => ({}))
  const status = err?.error?.status
  if (res.status === 404 || status === 'NOT_FOUND' || status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT') return 'stale'
  return 'failed'
}

// ---------------------------------------------------------------------------
// Apple Push Notification service — iPhones
// ---------------------------------------------------------------------------

const APNS_KEY_ID  = Deno.env.get('APNS_KEY_ID') ?? ''
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID') ?? ''
const APNS_KEY_P8  = Deno.env.get('APNS_KEY_P8') ?? ''
const APNS_BUNDLE  = Deno.env.get('APNS_BUNDLE_ID') ?? 'com.alotoprediction.app'

// Apple's live servers serve TestFlight and App Store builds. Only a build run
// straight from Xcode needs the sandbox.
const APNS_HOST = (Deno.env.get('APNS_ENVIRONMENT') ?? 'production') === 'sandbox'
  ? 'https://api.sandbox.push.apple.com'
  : 'https://api.push.apple.com'

let apnsJwtCache: { token: string; madeAt: number } | null = null

async function apnsJwt(): Promise<string> {
  // Apple rejects tokens refreshed more often than once every 20 minutes.
  if (apnsJwtCache && Date.now() - apnsJwtCache.madeAt < 30 * 60 * 1000) return apnsJwtCache.token

  const enc = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const unsigned = `${enc({ alg: 'ES256', kid: APNS_KEY_ID })}.${enc({ iss: APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })}`

  const pem = APNS_KEY_P8
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')

  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned))

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const token = `${unsigned}.${sigB64}`
  apnsJwtCache = { token, madeAt: Date.now() }
  return token
}

export async function sendApnsPush(
  deviceToken: string, title: string, body: string, link: string, kind: string,
): Promise<SendResult> {
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_KEY_P8) return 'failed'

  try {
    const jwt = await apnsJwt()
    const res = await fetch(`${APNS_HOST}/3/device/${deviceToken}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${jwt}`,
        // No ".push-type.liveactivity" suffix: this is an ordinary alert.
        'apns-topic': APNS_BUNDLE,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      // url and kind sit alongside aps, not inside it, which is where the app
      // reads them from when someone taps the notification.
      body: JSON.stringify({
        aps: { alert: { title, body }, sound: 'default' },
        url: link,
        kind,
      }),
    })

    if (res.ok) return 'sent'

    const reason = await res.text()
    if (res.status === 410 || reason.includes('BadDeviceToken') || reason.includes('Unregistered')) return 'stale'
    console.warn('APNs push failed:', res.status, reason.slice(0, 160))
    return 'failed'
  } catch (err) {
    console.warn('APNs push threw:', String(err).slice(0, 160))
    return 'failed'
  }
}
