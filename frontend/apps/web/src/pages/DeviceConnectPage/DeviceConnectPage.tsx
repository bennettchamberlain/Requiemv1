import { type FormEvent, useState } from 'react';

import { persistApiBaseUrl } from '@ci/common';
import { Button, Card, Input, Label } from '@ci/shadcn';
import { useNavigate } from 'react-router-dom';

import {
  DEFAULT_PORTAL_URL,
  listMemoryServers,
  signInToPortal,
  type MemoryServerDevice,
  type PortalAuth,
} from './portal-client';

type Step = 'sign-in' | 'pick';
type Status = 'idle' | 'busy' | 'error';

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
 * Native-only Hub-style picker: sign into CI-Portal, list `ci-memory` apps, persist
 * that origin, then hand off to the existing Memory login. Named `/device-connect`
 * because `/connect` already means Sources.
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
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

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

    setStatus('busy');
    setError(null);

    try {
      await loadDevices(await signInToPortal(email, password, portalUrl));
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  };

  const handleRefresh = async () => {
    if (!auth) {
      return;
    }

    setStatus('busy');
    setError(null);

    try {
      setDevices(await listMemoryServers(auth, portalUrl));
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Could not refresh Memory Servers.');
    }
  };

  const handleConnect = async (device: MemoryServerDevice) => {
    if (!device.memoryUrl) {
      return;
    }

    setConnectingId(device.id);
    setError(null);

    try {
      const origin = new URL(device.memoryUrl).origin;
      await healthCheckOrigin(origin);
      persistApiBaseUrl(origin);
      navigate('/login', { replace: true });
    } catch (err) {
      setError(
        err instanceof Error && err.name === 'AbortError'
          ? 'Could not reach your Companion Memory (timed out).'
          : `Could not reach your Companion Memory. ${err instanceof Error ? err.message : ''}`.trim(),
      );
      setConnectingId(null);
    }
  };

  return (
    <div className="flex min-h-dvh w-full flex-col items-stretch justify-start overflow-y-auto sm:items-center sm:justify-center">
      <Card className="mx-auto w-full max-w-sm">
        <Card.Header>
          <Card.Title>{step === 'sign-in' ? 'Connect this device' : 'Pick a Memory Server'}</Card.Title>
          <Card.Description>
            {step === 'sign-in'
              ? 'Sign in to your Companion account to find the Memory Server on your computer.'
              : 'Choose the Companion Memory instance this phone should talk to.'}
          </Card.Description>
        </Card.Header>

        <Card.Content>
          {step === 'sign-in' ? (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="device-connect-email">Email</Label>
                <Input
                  id="device-connect-email"
                  type="email"
                  className={TOUCH}
                  autoComplete="username"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="device-connect-password">Password</Label>
                <Input
                  id="device-connect-password"
                  type="password"
                  className={TOUCH}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {showAdvanced ? (
                <div className="space-y-2">
                  <Label htmlFor="device-connect-portal">Portal URL</Label>
                  <Input
                    id="device-connect-portal"
                    type="url"
                    className={TOUCH}
                    inputMode="url"
                    value={portalUrl}
                    onChange={(e) => setPortalUrl(e.target.value)}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className={`self-start py-2 text-xs text-muted-foreground underline ${TOUCH}`}
                  onClick={() => setShowAdvanced(true)}
                >
                  Advanced Portal URL
                </button>
              )}
              {status === 'error' && error ? <p className="text-destructive text-sm">{error}</p> : null}
              <Button type="submit" className={`w-full ${TOUCH}`} disabled={status === 'busy' || !email || !password}>
                {status === 'busy' ? 'Signing in…' : 'Sign in and find servers'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className={`w-full ${TOUCH}`}
                onClick={() => navigate('/server')}
              >
                Enter a Memory Server URL instead
              </Button>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              {devices.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  No Memory Servers on this account. Install Companion Memory on your Hub, or enter a URL.
                </p>
              ) : (
                devices.map((device) => {
                  const reachable = Boolean(device.memoryUrl);

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
                      <span className="bg-muted text-foreground/80 shrink-0 rounded-full px-2 py-0.5 text-sm">
                        {connectingId === device.id ? 'Connecting…' : reachable ? device.status : 'unreachable'}
                      </span>
                    </button>
                  );
                })
              )}
              {error ? <p className="text-destructive text-sm">{error}</p> : null}
              <div className="mt-2 flex items-center justify-between">
                <Button variant="ghost" size="sm" className={TOUCH} onClick={() => setStep('sign-in')} disabled={connectingId !== null}>
                  Back
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={TOUCH}
                  onClick={() => void handleRefresh()}
                  disabled={status === 'busy' || connectingId !== null}
                >
                  Refresh
                </Button>
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
