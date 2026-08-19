import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the iOS shell. The app ships the @ci/fe-web Vite build
 * (webDir → ../web/dist); build it with the PWA service worker disabled
 * (VITE_DISABLE_PWA=true) so Workbox doesn't fight Capacitor's local asset serving.
 *
 * First launch with no server origin routes to `/device-connect` (Portal picker).
 * `/server` remains the Advanced URL fallback. Do not reuse `/connect` — that is Sources.
 */
const config: CapacitorConfig = {
  appId: 'com.companionintelligence.app',
  appName: 'Companion',
  webDir: '../web/dist',
  server: {
    ...(process.env.CAP_SERVER_URL ? { url: process.env.CAP_SERVER_URL, cleartext: true } : {}),
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#ffffff',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#ffffff',
      overlaysWebView: false,
    },
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/LocalDatabase',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
