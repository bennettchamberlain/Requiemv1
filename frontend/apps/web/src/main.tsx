import { StrictMode } from 'react';

import { createRoot } from 'react-dom/client';

import './styles/index.css';
import App from './App.tsx';
import { initTelemetry } from './lib/telemetry';

// No-op unless VITE_SENTRY_DSN was baked in at build time.
initTelemetry();

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
