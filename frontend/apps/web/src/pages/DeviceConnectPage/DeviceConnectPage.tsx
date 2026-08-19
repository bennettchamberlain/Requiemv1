import { type FormEvent, useEffect, useState } from 'react';

import { persistApiBaseUrl } from '@ci/common';
import { Button, Card, Input, LoadingButton, PasswordInput } from '@ci/shadcn';
import { useNavigate } from 'react-router-dom';

import { loginWithPortalOidc, OidcCancelledError, resumePendingOidcLogin } from './oidc';
import {
  DEFAULT_PORTAL_URL,
  listMemoryServers,
  signInToPortal,
  type MemoryServerDevice,
  type PortalAuth,
} from './portal-client';

type Step = 'sign-in' | 'pick';

const TOUCH = 'min-h-[44px]';

async function healthCheckOrigin(origin: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${origin}/api/health`, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Memory Server responded with ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Native-only Hub-style picker: Portal OIDC (system browser + companion://auth/callback)
 * or email, list `ci-memory` apps, persist that origin, then hand off to Memory login.
 * Named `/device-connect` because `/connect` already means Sources.
 */
export function DeviceConnectPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [portalUrl, setPortalUrl] = useState(DEFAULT_PORTAL_URL);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [auth, setAuth] = useState<PortalAuth | null>(null);
  const [devices, setDevices] = useState<MemoryServerDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [oidcController, setOidcController] = useState<AbortController | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  // Safari → "Open with Companion" often cold-starts the app. PKCE state lives in
  // localStorage; Capacitor stashed the callback URL. Finish the exchange on mount
  // and when we become visible again.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const finish = async () => {
      if (cancelled || inFlight) {
        return;
      }

      inFlight = true;

      try {
        const tokens = await resumePendingOidcLogin();

        if (cancelled || !tokens) {
          return;
        }

        setBusy(true);
        setSignInError(null);
        const portalAuth: PortalAuth = { token: tokens.accessToken, cookie: null, kind: 'oauth' };
        setAuth(portalAuth);
        const servers = await listMemoryServers(portalAuth, portalUrl);

        if (cancelled) {
          return;
        }

        setDevices(servers);
        setStep('pick');
      } catch (err) {
        if (!cancelled && !(err instanceof OidcCancelledError)) {
          const message = err instanceof Error ? err.message : 'Sign-in failed';

          if (/invalid.?code|invalid_grant/i.test(message)) {
            return;
          }

          setSignInError(message);
        }
      } finally {
        inFlight = false;

        if (!cancelled) {
          setBusy(false);
        }
      }
    };

    void finish();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void finish();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [portalUrl]);

  const loadDevices = async (portalAuth: PortalAuth) => {
    setAuth(portalAuth);
    const servers = await listMemoryServers(portalAuth, portalUrl);
    setDevices(servers);
    setStep('pick');
  };

  const handleSignIn = async (event: FormEvent) => {
    event.preventDefault();

    if (!email || !password) {
      return;
    }

    setBusy(true);
    setSignInError(null);

    try {
      await loadDevices(await signInToPortal(email, password, portalUrl));
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const handleOidcLogin = async () => {
    const controller = new AbortController();
    setOidcController(controller);
    setBusy(true);
    setSignInError(null);

    try {
      const tokens = await loginWithPortalOidc(portalUrl, { signal: controller.signal });
      await loadDevices({ token: tokens.accessToken, cookie: null, kind: 'oauth' });
    } catch (err) {
      if (!(err instanceof OidcCancelledError)) {
        setSignInError(err instanceof Error ? err.message : 'Sign-in failed');
      }
    } finally {
      setBusy(false);
      setOidcController(null);
    }
  };

  const handleRefresh = async () => {
    if (!auth) {
      return;
    }

    setBusy(true);
    setSignInError(null);

    try {
      setDevices(await listMemoryServers(auth, portalUrl));
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Could not refresh Memory Servers.');
    } finally {
      setBusy(false);
    }
  };

  const handleConnect = async (device: MemoryServerDevice) => {
    if (!device.memoryUrl) {
      return;
    }

    setConnectingId(device.id);
    setSignInError(null);

    try {
      const origin = new URL(device.memoryUrl).origin;
      await healthCheckOrigin(origin);
      persistApiBaseUrl(origin);
      navigate('/login', { replace: true });
    } catch (err) {
      setSignInError(
        err instanceof Error && err.name === 'AbortError'
          ? 'Could not reach your Companion Memory (timed out).'
          : `Could not reach your Companion Memory. ${err instanceof Error ? err.message : ''}`.trim(),
      );
      setConnectingId(null);
    }
  };

  return (
    <div className="w-full max-w-md">
      <Card>
        <Card.Header>
          <Card.Title>{step === 'sign-in' ? 'Connect to your Memory' : 'Pick a Memory Server'}</Card.Title>
          <Card.Description>
            {step === 'sign-in'
              ? 'Sign in to your Companion Intelligence account to find the Memory Servers you own.'
              : 'Choose the Companion Memory instance this phone should talk to.'}
          </Card.Description>
        </Card.Header>

        <Card.Content>
          {step === 'sign-in' ? (
            <div className="flex flex-col gap-4">
              <LoadingButton
                type="button"
                className={TOUCH}
                onClick={() => void handleOidcLogin()}
                loading={busy}
                disabled={busy}
                data-testid="oidc-login-btn"
              >
                Sign in with Companion Intelligence
              </LoadingButton>
              {signInError ? (
                <p className="text-destructive text-sm" data-testid="connect-signin-error" role="alert">
                  {signInError}
                </p>
              ) : null}

              {oidcController ? (
                <div className="bg-muted/40 flex flex-col items-center gap-2 rounded-md p-3 text-center text-xs text-muted-foreground">
                  <span>Finish signing in in your browser, then come back to the app.</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={TOUCH}
                    onClick={() => oidcController.abort()}
                    data-testid="cancel-oidc-btn"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  <div className="text-muted-foreground flex items-center gap-3 text-xs">
                    <span className="bg-border h-px flex-1" />
                    or use email
                    <span className="bg-border h-px flex-1" />
                  </div>
                  <form onSubmit={handleSignIn} className="flex flex-col gap-4">
                    <Input
                      type="email"
                      className={TOUCH}
                      aria-label="Email"
                      placeholder="you@example.com"
                      autoComplete="username"
                      inputMode="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                    <PasswordInput
                      className={TOUCH}
                      aria-label="Password"
                      placeholder="Password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    {showAdvanced ? (
                      <Input
                        type="url"
                        className={TOUCH}
                        aria-label="Portal URL"
                        placeholder="Portal URL"
                        inputMode="url"
                        value={portalUrl}
                        onChange={(e) => setPortalUrl(e.target.value)}
                      />
                    ) : (
                      <button
                        type="button"
                        className={`text-muted-foreground self-start py-2 text-xs underline ${TOUCH}`}
                        onClick={() => setShowAdvanced(true)}
                      >
                        Advanced
                      </button>
                    )}
                    <LoadingButton
                      type="submit"
                      variant="outline"
                      className={TOUCH}
                      loading={busy}
                      disabled={busy || !email || !password}
                    >
                      Sign in with email
                    </LoadingButton>
                  </form>
                </>
              )}
              <Button
                type="button"
                variant="ghost"
                className={`w-full ${TOUCH}`}
                onClick={() => navigate('/server')}
              >
                Enter a Memory Server URL instead
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {devices.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  No Memory Servers on this account. Install Companion Memory on your Hub, or enter a URL.
                </p>
              ) : (
                devices.map((device) => {
                  const reachable = Boolean(device.memoryUrl);
                  const active = reachable && device.status === 'active';

                  return (
                    <button
                      key={device.id}
                      type="button"
                      disabled={connectingId !== null || !reachable}
                      onClick={() => void handleConnect(device)}
                      data-testid={`memory-row-${device.id}`}
                      className="border-input flex min-h-[56px] items-center justify-between gap-3 rounded-md border p-4 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{device.name}</div>
                        <div className="text-muted-foreground truncate text-xs">
                          {device.memoryUrl ?? 'No address published'}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-sm ${active ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-muted text-foreground/80'}`}
                      >
                        {connectingId === device.id
                          ? 'Connecting…'
                          : reachable
                            ? device.status
                            : 'unreachable'}
                      </span>
                    </button>
                  );
                })
              )}
              {signInError ? <p className="text-destructive text-sm">{signInError}</p> : null}
              <div className="mt-2 flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  className={TOUCH}
                  onClick={() => setStep('sign-in')}
                  disabled={connectingId !== null}
                >
                  Back
                </Button>
                <LoadingButton
                  type="button"
                  variant="outline"
                  size="sm"
                  className={TOUCH}
                  onClick={() => void handleRefresh()}
                  loading={busy}
                  disabled={busy || connectingId !== null}
                >
                  Refresh
                </LoadingButton>
              </div>
              <Button type="button" variant="ghost" className={TOUCH} onClick={() => navigate('/server')}>
                Enter a URL instead
              </Button>
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}
