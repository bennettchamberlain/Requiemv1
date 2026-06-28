import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  addAppUrlOpenListener,
  buildApiUrl,
  createHookContext,
  fetchJson,
  isNativePlatform,
  parseOidcCallbackUrl,
  secureStorageGet,
  secureStorageRemove,
  secureStorageSet,
  setApiKey,
} from '@ci/common';
import { jwtDecode } from 'jwt-decode';
import { useNavigate, useLocation } from 'react-router-dom';

const authChannel = new BroadcastChannel('auth');

// On native the durable credential is an API key kept in the OS keystore — the
// cookie/JWT session does not survive cross-origin inside a webview. We store the
// raw key (sent as x-api-key) and its server id (for reference/future revocation).
const API_KEY_STORAGE = 'ci.apiKey';
const API_KEY_ID_STORAGE = 'ci.apiKeyId';

const CSRF_COOKIE_NAME = 'csrfToken';

// Native clients run in a cross-origin webview and can neither read nor send the
// SameSite=Strict CSRF cookie, so they capture the token from the
// `/api/authenticate/csrf` response body and echo it as the header instead.
let nativeCsrfToken: string | null = null;

function getCsrfToken(): string | undefined {
  if (isNativePlatform()) {
    return nativeCsrfToken ?? undefined;
  }

  const match = document.cookie.split('; ').find((row) => row.startsWith(`${CSRF_COOKIE_NAME}=`));

  return match?.split('=').slice(1).join('=');
}

function withCsrfHeader(headers?: HeadersInit): HeadersInit {
  const token = getCsrfToken();

  if (!token) {
    return headers ?? {};
  }

  return {
    ...headers,
    'X-CSRF-Token': token,
  };
}

interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
}

interface AuthResponse {
  accessToken: string;
}

interface CreateApiKeyResponse {
  id: string;
  key: string;
}

// Exchange a freshly-issued JWT for a long-lived API key (the /api/keys endpoint is
// JWT-guarded, so this must run while we still hold the login JWT), persist it to the
// keystore, and activate it for subsequent requests. Returns the raw key, or null.
async function mintAndStoreApiKey(jwt: string): Promise<string | null> {
  const created = await fetchJson<CreateApiKeyResponse>('/api/keys', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      name: `Companion mobile · ${new Date().toISOString().slice(0, 10)}`,
    }),
  });

  if (!created?.key) {
    return null;
  }

  await secureStorageSet(API_KEY_STORAGE, created.key);
  await secureStorageSet(API_KEY_ID_STORAGE, created.id);
  setApiKey(created.key);

  return created.key;
}

interface OidcNativeExchangeResponse {
  accessToken: string;
}

// Native OIDC return path: exchange the short-lived one-time code carried by the
// `companion://oidc/callback?code=...` deep link for a real JWT, then trade that JWT
// for a durable API key — identical to the password path. The one-time code is single
// use and short-lived; no long-lived secret ever travels in the deep-link URL.
async function completeOidcNativeSignIn(code: string): Promise<string | null> {
  const data = await fetchJson<OidcNativeExchangeResponse>('/api/authenticate/oidc/native/exchange', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });

  const jwt = data?.accessToken ?? null;

  if (!jwt) {
    return null;
  }

  return mintAndStoreApiKey(jwt);
}

type ReturnValue = [
  {
    expired: boolean;
    authToken?: string | null;
    /** True when authenticated by EITHER a web JWT session or a native API key. */
    authenticated: boolean;
    loading: boolean;
    error: unknown | null;
  },
  {
    login: (username: string, password: string) => Promise<void>;
    logout: () => void;
    signup: (name: string, email: string, password: string, signup_code?: string) => Promise<void>;
  },
];

function useAuth(): ReturnValue {
  const navigate = useNavigate();
  const location = useLocation();

  const [loginLoading, setLoginLoading] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<unknown | null>(null);
  const [refreshError, setRefreshError] = useState<unknown | null>(null);
  const [initializing, setInitializing] = useState<boolean>(true);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  // Native-only: present once the keystore API key is loaded/minted. Drives the
  // authenticated state on native, where there is no JWT in `accessToken`.
  const [nativeApiKey, setNativeApiKey] = useState<string | null>(null);

  const decoded = useMemo(() => (accessToken ? jwtDecode<JwtPayload>(accessToken) : null), [accessToken]);
  const isExpired = useCallback(() => (decoded ? Date.now() >= decoded.exp * 1000 : true), [decoded]);

  const login = useCallback(
    async (email: string, password: string) => {
      setLoginLoading(true);
      setLoginError(null);

      try {
        // Obtain a pre-auth CSRF token before submitting credentials. Native clients
        // are cookie-less: they read the signed token from the response body and send
        // it as the header, with `credentials: 'omit'` so the request isn't a
        // credentialed cross-origin call (which would require
        // Access-Control-Allow-Credentials the appliance/proxy may not send).
        const native = isNativePlatform();
        const csrfResponse = await fetch(buildApiUrl('/api/authenticate/csrf'), {
          credentials: native ? 'omit' : 'include',
        });

        if (native) {
          const csrfBody = (await csrfResponse.json().catch(() => null)) as { csrfToken?: string } | null;
          nativeCsrfToken = csrfBody?.csrfToken ?? null;
        }

        const data = await fetchJson<AuthResponse>('/api/authenticate', {
          method: 'POST',
          headers: withCsrfHeader({
            'Content-Type': 'application/json',
          }),
          credentials: native ? 'omit' : 'include',
          body: JSON.stringify({
            username: email,
            password,
          }),
        });

        const jwt = data?.accessToken ?? null;

        if (jwt && isNativePlatform()) {
          // Native: trade the JWT for a durable API key and authenticate via that.
          setNativeApiKey(await mintAndStoreApiKey(jwt));
        } else {
          setAccessToken(jwt);
        }

        const returnTo = (location.state as { from?: string })?.from ?? '/';
        navigate(returnTo, { replace: true });
      } catch (err: unknown) {
        setLoginError(err);
      } finally {
        setLoginLoading(false);
      }
    },
    [navigate, location.state],
  );

  const logout = useCallback(async () => {
    if (isNativePlatform()) {
      // No cookie session to revoke. Clear the local credential; the API key stays
      // valid server-side (the /api/keys revoke endpoint is JWT-only, and we hold no
      // JWT here) and can be revoked from Settings → API Keys after re-login.
      setApiKey(null);
      await secureStorageRemove(API_KEY_STORAGE);
      await secureStorageRemove(API_KEY_ID_STORAGE);
      setNativeApiKey(null);
      setAccessToken(null);
      setLoginLoading(false);
      setLoginError(null);
      navigate('/');

      return;
    }

    try {
      const response = await fetch(buildApiUrl('/api/authenticate/logout'), {
        method: 'POST',
        headers: withCsrfHeader(),
        credentials: 'include',
      });

      if (!response.ok) {
        console.error('Logout request failed with status:', response.status);
      }
    } catch (error) {
      console.error('Logout failed on server:', error);
    }

    setAccessToken(null);
    setLoginLoading(false);
    setLoginError(null);

    authChannel.postMessage('logout');

    navigate('/');
  }, [navigate]);

  const signup = useCallback(
    async (name: string, email: string, password: string, signup_code?: string) => {
      setLoginLoading(true);
      setLoginError(null);

      try {
        // Obtain a pre-auth CSRF token before submitting signup
        await fetch(buildApiUrl('/api/authenticate/csrf'), {
          credentials: 'include',
        });

        const data = await fetchJson<AuthResponse>('/api/signup', {
          method: 'POST',
          headers: withCsrfHeader({
            'Content-Type': 'application/json',
          }),
          credentials: 'include',
          body: JSON.stringify({
            name,
            email,
            password,
            signup_code,
          }),
        });

        const jwt = data?.accessToken ?? null;

        if (jwt && isNativePlatform()) {
          setNativeApiKey(await mintAndStoreApiKey(jwt));
        } else {
          setAccessToken(jwt);
        }

        navigate('/');
      } catch (err: unknown) {
        setLoginError(err);
      } finally {
        setLoginLoading(false);
      }
    },
    [navigate],
  );

  const refresh = useCallback(async () => {
    setRefreshError(null);

    try {
      const data = await fetchJson<AuthResponse>('/api/authenticate/refresh', {
        method: 'POST',
        headers: withCsrfHeader(),
        credentials: 'include',
      });

      setAccessToken(data?.accessToken ?? null);
    } catch (err: unknown) {
      setRefreshError(err);
      setAccessToken(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (isNativePlatform()) {
          // Native restore: load the stored API key. No cookie refresh applies here.
          const storedKey = await secureStorageGet(API_KEY_STORAGE);

          if (storedKey) {
            setApiKey(storedKey);
            setNativeApiKey(storedKey);
          }

          return;
        }

        const data = await fetchJson<AuthResponse>('/api/authenticate/refresh', {
          method: 'POST',
          headers: withCsrfHeader(),
          credentials: 'include',
        });

        setAccessToken(data?.accessToken ?? null);
      } catch {
        // No valid session cookie, user will need to log in
      } finally {
        setInitializing(false);
      }
    })();
  }, []);

  useAutoRefreshToken(accessToken, refresh);

  // Native only: complete "Sign in with CI Portal" when the system browser redirects
  // back into the app via the `companion://oidc/callback?...` deep link. Unrelated
  // deep links (other schemes/paths) parse to null and are ignored.
  useEffect(() => {
    if (!isNativePlatform()) {
      return;
    }

    let unsubscribe = () => {};

    let cancelled = false;

    void addAppUrlOpenListener((url) => {
      const params = parseOidcCallbackUrl(url);

      if (!params) {
        return;
      }

      if (params.error || !params.code) {
        setLoginError(new Error(params.error || 'oidc_failed'));

        return;
      }

      const { code } = params;

      void (async () => {
        try {
          const key = await completeOidcNativeSignIn(code);

          if (!key) {
            setLoginError(new Error('oidc_exchange_failed'));

            return;
          }

          setNativeApiKey(key);
          navigate('/', { replace: true });
        } catch (err: unknown) {
          setLoginError(err);
        }
      })();
    }).then((cleanup) => {
      if (cancelled) {
        cleanup();
      } else {
        unsubscribe = cleanup;
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [navigate]);

  useEffect(() => {
    const handleAuthMessage = (event: MessageEvent) => {
      if (event.data === 'logout') {
        setAccessToken(null);
      }
    };

    authChannel.addEventListener('message', handleAuthMessage);

    return () => {
      authChannel.removeEventListener('message', handleAuthMessage);
    };
  }, []);

  return [
    {
      // A native API key never "expires" from the client's point of view (there is
      // no short-lived JWT to age out); web keeps the JWT expiry check.
      expired: nativeApiKey ? false : isExpired(),
      authToken: accessToken,
      authenticated: Boolean(accessToken) || Boolean(nativeApiKey),
      loading: loginLoading || initializing,
      error: loginError ?? refreshError,
    },
    {
      login,
      logout,
      signup,
    },
  ];
}

function useAutoRefreshToken(accessToken: string | null | undefined, onRefresh: () => Promise<void>) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    const decoded = jwtDecode<JwtPayload>(accessToken);
    const exp = (decoded.exp || 0) * 1000;
    const now = Date.now();
    const refreshAt = exp - 60 * 1000;
    const delay = Math.max(refreshAt - now, 0);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      onRefresh();
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [accessToken, onRefresh]);
}

const { Provider, useHookContext } = createHookContext(useAuth);

export { Provider as AuthProvider, useHookContext as useAuth };
