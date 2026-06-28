import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the native shell. The app ships the @ci/fe-web Vite build
 * (webDir → ../web/dist); build it with the PWA service worker disabled
 * (VITE_DISABLE_PWA=true, handled by the `build:web` script) so Workbox doesn't
 * fight Capacitor's local asset serving.
 *
 * The web app detects the native runtime via the injected `window.Capacitor`
 * global and reads its configured server origin from localStorage (see
 * `@ci/common` apiBase + the in-app /server settings screen), so no extra native
 * bridge is needed for Phase 1.
 *
 * OIDC deep link ("Sign in with CI Portal"): the app registers the custom URL
 * scheme `companion://` so the OIDC callback can return into the app. iOS is wired
 * via `CFBundleURLTypes` in `ios/App/App/Info.plist`. When the Android project is
 * generated (`npx cap add android`), add the matching intent-filter to
 * `android/app/src/main/AndroidManifest.xml`, inside the main `<activity>`:
 *
 *   <intent-filter>
 *     <action android:name="android.intent.action.VIEW" />
 *     <category android:name="android.intent.category.DEFAULT" />
 *     <category android:name="android.intent.category.BROWSABLE" />
 *     <data android:scheme="companion" android:host="oidc" />
 *   </intent-filter>
 *
 * Keep the scheme in sync with `OIDC_NATIVE_SCHEME` in `@ci/common`
 * (src/utils/oidcNative.ts) and the backend's `auth.oidc.nativeRedirectScheme`
 * config. `@capacitor/app` surfaces the inbound URL as an `appUrlOpen` event,
 * which `useAuth` handles via `addAppUrlOpenListener`.
 */
const config: CapacitorConfig = {
  appId: 'com.companionintelligence.app',
  appName: 'Companion',
  // Relative to this config file: the @ci/fe-web build output.
  webDir: '../web/dist',
  server: {
    // Serve Android from https://localhost so requests to an HTTPS API are not
    // blocked as mixed content (iOS WKWebView already serves from capacitor://).
    androidScheme: 'https',
    // On-device live reload during development: set CAP_SERVER_URL to the
    // LAN/Tailscale URL of the running Vite dev server (e.g.
    // http://192.168.1.20:5173) and run `cap run ios|android`. Unset for a
    // bundled (production) build that serves the local web assets.
    ...(process.env.CAP_SERVER_URL ? { url: process.env.CAP_SERVER_URL, cleartext: true } : {}),
  },
};

export default config;
