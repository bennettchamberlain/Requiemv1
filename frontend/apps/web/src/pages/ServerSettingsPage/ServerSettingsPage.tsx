import { type FormEvent, useState } from 'react';

import { buildApiUrl, getApiBaseUrl, persistApiBaseUrl } from '@ci/common';
import { Button, Card, Input, Label } from '@ci/shadcn';
import { useNavigate } from 'react-router-dom';

type Status = 'idle' | 'testing' | 'error';

/**
 * Native-only screen for pointing the app at a self-hosted CI-Server. Because the
 * appliance has no single cloud URL, the native client must be told where its
 * server lives. The entered origin is health-checked before being persisted (via
 * `persistApiBaseUrl`, which stores it in localStorage and applies it for the
 * session). On web this screen is inert — the API origin is always same-origin.
 */
export function ServerSettingsPage() {
  const navigate = useNavigate();

  const [url, setUrl] = useState<string>(() => getApiBaseUrl());
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  function normalize(value: string): string {
    return value.trim().replace(/\/+$/, '');
  }

  function isValidOrigin(value: string): boolean {
    try {
      const parsed = new URL(value);

      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    const candidate = normalize(url);

    if (!isValidOrigin(candidate)) {
      setStatus('error');
      setError('Enter a full server URL, e.g. https://ci-server.example.com');

      return;
    }

    setStatus('testing');
    setError(null);

    try {
      // Health-check the candidate origin directly (not via buildApiUrl, since we
      // are validating a URL the user has not committed to yet). `/api/health` is
      // unauthenticated, so a 2xx confirms reachability before we save.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`${candidate}/api/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      persistApiBaseUrl(candidate);

      // Hand off to the normal flow; the splash route routes to login or feed.
      navigate('/', { replace: true });
    } catch (err) {
      setStatus('error');
      setError(
        err instanceof Error && err.name === 'AbortError'
          ? 'Could not reach the server (timed out). Check the URL and your network.'
          : `Could not reach the server. ${err instanceof Error ? err.message : ''}`.trim(),
      );
    }
  };

  // buildApiUrl reflects the currently-applied origin, shown as a hint.
  const currentTarget = buildApiUrl('/api');

  return (
    <div className="w-full max-w-sm">
      <Card>
        <Card.Header>
          <Card.Title>Connect to your server</Card.Title>
          <Card.Description>Enter the address of your CI-Server appliance.</Card.Description>
        </Card.Header>

        <Card.Content>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="server-url">Server URL</Label>
              <Input
                id="server-url"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="https://ci-server.example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={status === 'testing'}
              />
              <p className="text-muted-foreground text-xs">
                Currently targeting: {currentTarget || '(same origin)'}
              </p>
            </div>

            {status === 'error' && error && <p className="text-destructive text-sm">{error}</p>}

            <Button type="submit" className="w-full" disabled={status === 'testing'}>
              {status === 'testing' ? 'Testing…' : 'Test & Connect'}
            </Button>
          </form>
        </Card.Content>
      </Card>
    </div>
  );
}
