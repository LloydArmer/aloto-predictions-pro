# Capacitor configuration notes

`capacitor.config.json` has no comments — JSON can't carry them — so the
reasoning behind each setting lives here.

## Why JSON and not .ts or .js

Capacitor reads `capacitor.config.ts`, `.js` or `.json`.

`.ts` needs TypeScript installed, and this project has none. Adding a compiler
purely to read one config file isn't worth it.

`.js` is worse in a subtle way: `package.json` sets `"type": "module"`, so a
`.js` file is an ES module, while Capacitor's `.js` loader expects CommonJS.
That mismatch fails at build time with a confusing error.

JSON sidesteps both. It's eight keys — it doesn't need to be code.

## The settings

**`appId: com.alotoprediction.app`**

Reverse-domain form, unique per store. Once the app is published this **cannot
be changed** without shipping a new listing and losing every existing install.
It must match the App ID in Apple's developer portal and the bundle ID in
Firebase exactly.

**`webDir: dist`**

Vite's build output. `npx cap sync` copies this into the native project, so
`npm run build` must run before every sync. The Codemagic workflow does both in
the right order.

**`server.androidScheme` / `iosScheme: https`**

Serves the app over `https://` inside the shell rather than the `file://`
scheme. Browser APIs that require a secure context — notifications, storage,
service workers — then behave exactly as they do on the live site. Without this
they silently fail in ways that are hard to trace.

**`plugins.PushNotifications.presentationOptions`**

Controls what a notification does when it arrives with the app already open:
badge, sound, alert.

Permission itself is requested when someone turns reminders on in Settings, not
on first launch. A prompt shown before anyone knows what the app does gets
denied, and on iOS a denial is close to permanent — the person has to go into
system settings to undo it.

**`android.adjustMarginsForEdgeToEdge: auto`**

Stops the on-screen keyboard resizing the whole layout while predicting scores.
The inputs sit near the bottom of long fixture lists, so without it the page
jumps every time the keyboard opens.

## What isn't here

The native projects (`ios/`, `android/`) aren't committed. Codemagic runs
`npx cap add` on every build, so they're regenerated from this file and `dist/`
each time — no scaffolding in git, and no chance of them drifting out of step
with the web build.
