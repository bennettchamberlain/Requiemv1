import { StrictMode } from 'react';

import { initApiBaseUrl } from '@ci/common';
import { createRoot } from 'react-dom/client';

import './styles/index.css';
import App from './App.tsx';
import { initTelemetry } from './lib/telemetry';

// No-op unless VITE_SENTRY_DSN was baked in at build time AND the appliance
// confirms the user has consented. Deliberately not awaited: reporting must
// never delay first render.
void initTelemetry();

// Resolve the API origin before anything renders. No-op on web (stays same-origin);
// on the native Capacitor shell this loads the user-configured server URL so Apollo
// and the auth/fetch layer target the right host from the first request.
initApiBaseUrl();

// Facebook OAuth appends #_=_ to redirect URLs; it can break React Router and cause blank screens.
// Clear it as early as possible so routing works correctly.
if (typeof window !== 'undefined' && window.location.hash === '#_=_') {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
