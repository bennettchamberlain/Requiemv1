# @ci/fe-mobile — Native iOS + Android shell (Capacitor)

A thin native shell that wraps the existing **`@ci/fe-web`** React/Vite build and
points it at a remote, self-hosted **CI-Server**. The server stays the brain; the
app is a thin client. (Local-first SQLite sync via PowerSync is a later phase — see
the project plan.)

## How it works

- `capacitor.config.ts` sets `webDir: '../web/dist'`, so the app ships the
  `@ci/fe-web` production build. No separate mobile UI codebase.
- The web app detects the native runtime via the injected `window.Capacitor`
  global (`isNativePlatform()` in `@ci/common`) and reads its **configured server
  origin from `localStorage`**. On first launch with no server set, the app routes
  to the in-app `/server` screen to enter + health-check a CI-Server URL.
- All `/api/...` calls resolve through `buildApiUrl()` (`@ci/common`): `''` on web
  (same-origin), the configured origin on native.
- The web build for native sets `VITE_DISABLE_PWA=true` so the Workbox service
  worker doesn't fight Capacitor's local asset serving.

## Prerequisites

- macOS with **Xcode** (iOS) and/or **Android Studio + JDK 17** (Android).
- CocoaPods (`sudo gem install cocoapods`) for iOS.
- The backend must allow the native origin via CORS — already wired in
  `backend/apps/api/src/main.ts` (`capacitor://localhost`, `http(s)://localhost`).
  Add more origins with `CORS_ALLOWED_ORIGINS` (comma-separated).

## Standalone project (not a yarn workspace)

The monorepo uses Yarn **PnP**, but the Capacitor CLI / CocoaPods / Gradle need a
real `node_modules` tree. Rather than fight PnP, this package is deliberately
**excluded** from the root workspaces (`"!frontend/apps/mobile"` in the root
`package.json`) and installed on its own. Its `.yarnrc.yml` sets
`nodeLinker: node-modules`, so `yarn install` *inside this directory* produces a
conventional `node_modules` + its own `yarn.lock` here — the root PnP install is
untouched. It depends on the web app only as a build artifact (`webDir`), never as
an npm import.

## First-time setup

```bash
# Build the web bundle once (from the repo root, PWA SW disabled):
VITE_DISABLE_PWA=true yarn workspace @ci/fe-web build

# Then, in THIS directory — its own isolated install:
cd frontend/apps/mobile
yarn install            # creates node_modules + yarn.lock here only
yarn add:ios            # generates ios/  (commit it)
yarn add:android        # generates android/  (commit it)
yarn sync               # copies web assets + installs native plugin code
```

`yarn build:web` is a convenience that runs the repo-root web build for you, so
`yarn build` (= build:web + sync) works from this directory too.

## Day-to-day

```bash
yarn build              # build:web + cap sync  (bundled assets)
yarn open:ios           # open Xcode
yarn open:android       # open Android Studio
yarn run:ios            # build + run on simulator/device
yarn run:android        # build + run on emulator/device
```

## On-device live reload

Run the web dev server (`yarn workspace @ci/fe-web dev`, bound to `0.0.0.0`), then:

```bash
CAP_SERVER_URL=http://<your-lan-or-tailscale-ip>:5173 yarn run:ios   # or run:android
```

`CAP_SERVER_URL` makes the shell load from the live dev server (hot reload). Point
the in-app `/server` setting at your API origin (the backend host/port) so data
calls resolve. Unset `CAP_SERVER_URL` for a bundled build.

## Versions

Capacitor deps are pinned to `^7.0.0` as a starting point. If a newer major is
current when you set this up, bump `@capacitor/*` together (core, cli, ios,
android, app) and re-run `yarn sync`.

## Native auth (wired)

Email/password sign-in works on native without cookies: after login the app mints a
long-lived **API key** (`POST /api/keys`) and stores it in the OS keystore
(`capacitor-secure-storage-plugin`); every request then carries `x-api-key`. The key
is loaded from the keystore on startup, so sessions persist across launches. Logout
clears the local key (server-side revocation is in Settings → API Keys, since the
`/api/keys` revoke endpoint is JWT-only).

"Sign in with CI Portal" (OIDC) opens the **system browser** (`@capacitor/browser`)
on native. ⚠️ Completing OIDC still needs the IdP to redirect back into the app via a
deep link (custom URL scheme + `@capacitor/app` `appUrlOpen`) — a follow-up. Use
email/password on native until that lands.

## Not yet wired (later phases)

- Camera capture into the upload flow (`@capacitor/camera`).
- Push notifications (needs backend APNs/FCM).
- OIDC deep-link return (custom scheme + backend redirect_uri).
- Local-first sync (PowerSync) — the on-device SQLite layer.
