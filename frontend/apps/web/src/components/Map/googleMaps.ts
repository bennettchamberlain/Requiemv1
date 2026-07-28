// Google Maps utility functions

// Optional build-time key (local Vite). Hub-installed Memory images have no
// baked key — they resolve GOOGLE_MAPS_KEY at runtime via GET /api/config/maps.
const BUILD_TIME_GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

let resolvedApiKey: string | null =
  typeof BUILD_TIME_GOOGLE_MAPS_API_KEY === 'string' && BUILD_TIME_GOOGLE_MAPS_API_KEY.length > 0
    ? BUILD_TIME_GOOGLE_MAPS_API_KEY
    : null;

let resolveKeyPromise: Promise<string | null> | null = null;
let googleMapsLoadingPromise: Promise<void> | null = null;

/**
 * Resolve the Maps JS API key: Vite env first, otherwise authenticated
 * GET /api/config/maps (Hub-injected GOOGLE_MAPS_KEY on the api container).
 */
export async function resolveGoogleMapsApiKey(authToken?: string | null): Promise<string | null> {
  if (resolvedApiKey) {
    return resolvedApiKey;
  }

  if (!authToken) {
    return null;
  }

  if (resolveKeyPromise) {
    return resolveKeyPromise;
  }

  resolveKeyPromise = (async () => {
    try {
      const res = await fetch('/api/config/maps', {
        headers: { Authorization: `Bearer ${authToken}` },
        credentials: 'include',
      });

      if (!res.ok) {
        return null;
      }

      const data = (await res.json()) as { configured?: boolean; apiKey?: string };

      if (data.configured && typeof data.apiKey === 'string' && data.apiKey.trim()) {
        resolvedApiKey = data.apiKey.trim();

        return resolvedApiKey;
      }

      return null;
    } catch {
      return null;
    } finally {
      resolveKeyPromise = null;
    }
  })();

  return resolveKeyPromise;
}

/**
 * Whether a Google Maps API key is already known synchronously (Vite or a
 * previous runtime resolve). Callers that can await should prefer
 * {@link resolveGoogleMapsApiKey}.
 */
export function isGoogleMapsConfigured(): boolean {
  return typeof resolvedApiKey === 'string' && resolvedApiKey.length > 0;
}

/**
 * Load Google Maps API and return a promise that resolves when ready.
 * Pass the session access token so Hub-deployed Memory can fetch the key
 * from `/api/config/maps` when Vite did not bake one in.
 */
export async function loadGoogleMaps(authToken?: string | null): Promise<void> {
  const apiKey = await resolveGoogleMapsApiKey(authToken);

  if (!apiKey) {
    throw new Error('Google Maps API key is not configured (VITE_GOOGLE_MAPS_API_KEY / GET /api/config/maps).');
  }

  // If already loading or loaded, return the existing promise
  if (googleMapsLoadingPromise) {
    return googleMapsLoadingPromise;
  }

  // Check if already loaded
  if (
    typeof window.google !== 'undefined' &&
    window.google.maps &&
    typeof window.google.maps.DirectionsService === 'function'
  ) {
    return Promise.resolve();
  }

  // Create loading promise
  googleMapsLoadingPromise = new Promise((resolve, reject) => {
    // Check if script is already loading
    const existingScripts = document.querySelectorAll('script[src*="maps.googleapis.com"]');
    if (existingScripts.length > 0) {
      // Script is already loading, wait for it
      const checkInterval = setInterval(() => {
        if (
          typeof window.google !== 'undefined' &&
          window.google.maps &&
          typeof window.google.maps.DirectionsService === 'function'
        ) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Google Maps failed to load within 10 seconds'));
      }, 10000);

      return;
    }

    // Load the script
    console.log('Loading Google Maps API...');
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      console.log('Google Maps script loaded successfully');
      // Wait for the API to be ready
      const checkInterval = setInterval(() => {
        if (
          typeof window.google !== 'undefined' &&
          window.google.maps &&
          typeof window.google.maps.DirectionsService === 'function'
        ) {
          clearInterval(checkInterval);
          console.log('Google Maps API is ready');
          resolve();
        }
      }, 100);

      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Google Maps API failed to initialize within 10 seconds'));
      }, 10000);
    };

    script.onerror = () => {
      console.error('Failed to load Google Maps script');
      reject(new Error('Failed to load Google Maps script'));
    };

    document.head.appendChild(script);
  });

  return googleMapsLoadingPromise;
}

/**
 * Check if Google Maps is ready
 */
export function isGoogleMapsReady(): boolean {
  return (
    typeof window.google !== 'undefined' &&
    window.google.maps &&
    typeof window.google.maps.DirectionsService === 'function'
  );
}
