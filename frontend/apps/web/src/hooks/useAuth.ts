import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createHookContext, fetchJson } from '@ci/common';
import { jwtDecode } from 'jwt-decode';
import { useNavigate } from 'react-router-dom';

const ACCESS_TOKEN_KEY = 'accessToken';
const SESSION_TOKEN_KEY = 'sessionToken';
const ACCESS_TOKEN_COOKIE = 'CI_accessToken';
const SESSION_TOKEN_COOKIE = 'CI_sessionToken';

const authChannel = new BroadcastChannel('auth');

interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
}

interface AuthResponse {
  sessionToken: string;
  accessToken: string;
}

type ReturnValue = [
  {
    expired: boolean;
    authToken?: string | null;
    loading: boolean;
    error: unknown | null;
  },
  {
    login: (username: string, password: string) => Promise<void>;
    logout: () => void;
    signup: (name: string, email: string, password: string, signup_code: string) => Promise<void>;
  },
];

function useAuth(): ReturnValue {
  const navigate = useNavigate();

  const [loginLoading, setLoginLoading] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<unknown | null>(null);
  const [refreshError, setRefreshError] = useState<unknown | null>(null);

  const [accessToken, setAccessToken] = useState<string | null>(
    localStorage.getItem(ACCESS_TOKEN_KEY) ?? null,
  );

  const [sessionToken, setSessionToken] = useState<string | null>(
    localStorage.getItem(SESSION_TOKEN_KEY) ?? null,
  );

  const decoded = useMemo(() => (accessToken ? jwtDecode<JwtPayload>(accessToken) : null), [accessToken]);
  const isExpired = useCallback(() => (decoded ? Date.now() >= decoded.exp * 1000 : true), [decoded]);

  const updateAccessToken = useCallback((token: string | null) => {
    if (token) {
      const decoded = jwtDecode<JwtPayload>(token);

      setAccessToken(token);
      localStorage.setItem(ACCESS_TOKEN_KEY, token);
      document.cookie = `${ACCESS_TOKEN_COOKIE}=${token}; SameSite=None; Secure; expires=${new Date(decoded.exp * 1000).toUTCString()}`;
    } else {
      setAccessToken(null);
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      deleteCookie(ACCESS_TOKEN_COOKIE);
    }
  }, []);

  const updateSessionToken = useCallback((token: string | null) => {
    if (token) {
      const decoded = jwtDecode<JwtPayload>(token);

      setSessionToken(token);
      localStorage.setItem(SESSION_TOKEN_KEY, token);
      document.cookie = `${SESSION_TOKEN_COOKIE}=${token}; SameSite=None; Secure; expires=${new Date(decoded.exp * 1000).toUTCString()}`;
    } else {
      setSessionToken(null);
      localStorage.removeItem(SESSION_TOKEN_KEY);
      deleteCookie(SESSION_TOKEN_COOKIE);
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      setLoginLoading(true);
      setLoginError(null);

      try {
        const data: AuthResponse = await fetchJson('/api/authenticate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: email,
            password,
          }),
        });

        updateAccessToken(data.accessToken);
        updateSessionToken(data.sessionToken);

        navigate('/');
      } catch (err: unknown) {
        setLoginError(err);
      } finally {
        setLoginLoading(false);
      }
    },
    [navigate, updateAccessToken, updateSessionToken],
  );

  const logout = useCallback(async () => {
    if (sessionToken) {
      try {
        const response = await fetch('/api/authenticate/logout', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        });

        if (!response.ok) {
          console.error('Logout request failed with status:', response.status);
        }
      } catch (error) {
        console.error('Logout failed on server:', error);
      }
    }

    updateAccessToken(null);
    updateSessionToken(null);

    setLoginLoading(false);
    setLoginError(null);

    authChannel.postMessage('logout');

    navigate('/');
  }, [navigate, sessionToken, updateAccessToken, updateSessionToken]);

  const signup = useCallback(
    async (name: string, email: string, password: string, signup_code: string) => {
      setLoginLoading(true);
      setLoginError(null);

      try {
        const data: AuthResponse = await fetchJson('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email,
            password,
            signup_code,
          }),
        });

        updateAccessToken(data.accessToken);
        updateSessionToken(data.sessionToken);

        navigate('/');
      } catch (err: unknown) {
        setLoginError(err);
      } finally {
        setLoginLoading(false);
      }
    },
    [updateAccessToken, updateSessionToken, navigate],
  );

  const refresh = useCallback(async () => {
    setRefreshError(null);

    try {
      const data: AuthResponse = await fetchJson('/api/authenticate/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
      });

      updateAccessToken(data.accessToken);
      updateSessionToken(data.sessionToken);
    } catch (err: unknown) {
      setRefreshError(err);
      updateAccessToken(null);
      updateSessionToken(null);
    }
  }, [sessionToken, updateAccessToken, updateSessionToken]);

  useAutoRefreshToken(accessToken, sessionToken, refresh);

  useEffect(() => {
    const handleAuthMessage = (event: MessageEvent) => {
      if (event.data === 'logout') {
        updateAccessToken(null);
        updateSessionToken(null);
      }
    };

    authChannel.addEventListener('message', handleAuthMessage);

    return () => {
      authChannel.removeEventListener('message', handleAuthMessage);
    };
  }, [updateAccessToken, updateSessionToken]);

  return [
    {
      expired: isExpired(),
      authToken: accessToken,
      loading: loginLoading,
      error: loginError ?? refreshError,
    },
    {
      login,
      logout,
      signup,
    },
  ];
}

function useAutoRefreshToken(
  accessToken: string | null | undefined,
  refreshToken: string | null | undefined,
  onRefresh: () => Promise<void>,
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!accessToken || !refreshToken) {
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
  }, [accessToken, refreshToken, onRefresh]);
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=None; Secure;`;
}

const { Provider, useHookContext } = createHookContext(useAuth);

export { Provider as AuthProvider, useHookContext as useAuth };
