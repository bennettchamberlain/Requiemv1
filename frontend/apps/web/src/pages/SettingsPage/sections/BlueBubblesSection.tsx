import { useCallback, useEffect, useState } from 'react';

import { fetchJson } from '@ci/common';
import { Button, Card, Checkbox, Input, Label, Switch } from '@ci/shadcn';
import { AlertCircle, CheckCircle2, Clock, MessageCircle, RefreshCw } from '@ci/shadcn/icons';

import { useAuth } from '@/hooks';

type BlueBubblesConnectionStatus = 'connected' | 'error' | 'unknown';

interface BlueBubblesConfig {
  host: string;
  port: number;
  useHttps: boolean;
  hasPassword: boolean;
  hasPrivateApi: boolean;
  enabled: boolean;
  connectionStatus: BlueBubblesConnectionStatus;
  lastError?: string;
  lastSyncCursor?: string;
  lastWebhookReceivedAt?: string;
}

interface TestConnectionResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

interface SyncNowResult {
  started: boolean;
}

/**
 * Same three-state icon treatment as ConnectionPage's endpoint status rows
 * (imported from the same `@ci/shadcn/icons` re-export of lucide-react):
 * green check for a healthy state, red alert for a known failure, and a
 * neutral clock for "nothing has told us yet".
 */
function statusIcon(status: BlueBubblesConnectionStatus) {
  switch (status) {
    case 'connected':
      return <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500 flex-shrink-0" />;
    case 'error':
      return <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-500 flex-shrink-0" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
  }
}

function statusLabel(status: BlueBubblesConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'error':
      return 'Connection error';
    default:
      return 'Unknown';
  }
}

function formatDateTime(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * Single-config connection form for the BlueBubbles (iMessage bridge) integration —
 * same load/edit/save lifecycle as ModelSection: local form state kept in sync with the
 * loaded config via an effect, with Save disabled until the form actually differs from it.
 */
export function BlueBubblesSection() {
  const [{ authToken }] = useAuth();

  const [config, setConfig] = useState<BlueBubblesConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [host, setHost] = useState('');
  const [port, setPort] = useState('1234');
  const [useHttps, setUseHttps] = useState(false);
  // Never populated from the server — GET only ever reports `hasPassword`, a boolean.
  // Empty means "keep the existing password"; a non-empty value is sent to replace it.
  const [password, setPassword] = useState('');
  const [hasPrivateApi, setHasPrivateApi] = useState(false);
  const [enabled, setEnabled] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncNowResult | { error: string } | null>(null);

  const headers = useCallback(
    () => ({
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    }),
    [authToken],
  );

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchJson<BlueBubblesConfig>('/api/bluebubbles/config', { headers: headers() });

      if (data) {
        setConfig(data);
      }
    } catch {
      setError('Failed to load BlueBubbles settings');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    if (!config) {
      return;
    }

    setHost(config.host);
    setPort(String(config.port));
    setUseHttps(config.useHttps);
    setHasPrivateApi(config.hasPrivateApi);
    setEnabled(config.enabled);
    // Reset on every reload, including the one right after Save — the field only ever
    // holds a value the user is actively typing, never one the server echoed back.
    setPassword('');
  }, [config]);

  const dirty =
    config != null &&
    (host !== config.host ||
      port !== String(config.port) ||
      useHttps !== config.useHttps ||
      hasPrivateApi !== config.hasPrivateApi ||
      enabled !== config.enabled ||
      password.trim().length > 0);

  const busy = saving || testing || syncing;

  const handleSave = async () => {
    const parsedPort = Number.parseInt(port, 10);

    if (!host.trim() || !Number.isFinite(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      setError('Enter a host and a valid port (1-65535).');

      return;
    }

    try {
      setSaving(true);
      setError(null);

      const body: Record<string, unknown> = {
        host: host.trim(),
        port: parsedPort,
        useHttps,
        hasPrivateApi,
        enabled,
      };

      if (password.trim()) {
        body.password = password.trim();
      }

      const data = await fetchJson<BlueBubblesConfig>('/api/bluebubbles/config', {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify(body),
      });

      if (data) {
        setConfig(data);
      }

      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch {
      setError('Failed to save BlueBubbles settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      const result = await fetchJson<TestConnectionResult>('/api/bluebubbles/test-connection', {
        method: 'POST',
        headers: headers(),
      });
      setTestResult(result ?? { ok: false, error: 'No response from server' });
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'Test connection failed' });
    } finally {
      setTesting(false);
      window.setTimeout(() => setTestResult(null), 6000);
    }
  };

  const handleSyncNow = async () => {
    try {
      setSyncing(true);
      setSyncResult(null);
      const result = await fetchJson<SyncNowResult>('/api/bluebubbles/sync-now', {
        method: 'POST',
        headers: headers(),
      });
      setSyncResult(result ?? { error: 'No response from server' });
    } catch (err) {
      setSyncResult({ error: err instanceof Error ? err.message : 'Failed to start sync' });
    } finally {
      setSyncing(false);
      window.setTimeout(() => setSyncResult(null), 6000);
    }
  };

  const lastWebhook = config ? formatDateTime(config.lastWebhookReceivedAt) : null;

  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">BlueBubbles</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Bridge iMessage into Companion by connecting to a BlueBubbles server.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      <Card>
        <Card.Content className="space-y-5 pt-6">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-700 dark:text-teal-300">
              <MessageCircle className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="text-base font-semibold text-foreground">Server connection</h3>
              <p className="text-sm text-muted-foreground leading-snug">
                The macOS host running BlueBubbles Server, reachable from this appliance.
              </p>
            </div>
            {config && (
              <div className="flex shrink-0 items-center gap-1.5 text-sm">
                {statusIcon(config.connectionStatus)}
                <span className="text-muted-foreground">{statusLabel(config.connectionStatus)}</span>
              </div>
            )}
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading BlueBubbles settings…</p>
          ) : (
            <div className="space-y-4 border-t border-border pt-4">
              <div className="grid gap-2">
                <Label htmlFor="bb-host">Host</Label>
                <Input
                  id="bb-host"
                  placeholder="192.168.1.10"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  disabled={busy}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="bb-port">Port</Label>
                <Input
                  id="bb-port"
                  inputMode="numeric"
                  placeholder="1234"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  disabled={busy}
                />
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="bb-https"
                  checked={useHttps}
                  onCheckedChange={(checked) => setUseHttps(checked === true)}
                  disabled={busy}
                />
                <Label htmlFor="bb-https" className="cursor-pointer font-medium">
                  Use HTTPS
                </Label>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="bb-password">Password</Label>
                <Input
                  id="bb-password"
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  placeholder={config?.hasPassword ? 'Leave blank to keep the current password' : 'Not set'}
                />
                <p className="text-xs text-muted-foreground">
                  {config?.hasPassword
                    ? 'A password is already saved. Enter a new one only to replace it.'
                    : 'The BlueBubbles server password, used to authenticate every request.'}
                </p>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="bb-private-api"
                  checked={hasPrivateApi}
                  onCheckedChange={(checked) => setHasPrivateApi(checked === true)}
                  disabled={busy}
                />
                <div className="grid gap-0.5 text-sm leading-none">
                  <Label htmlFor="bb-private-api" className="cursor-pointer font-medium">
                    Private API enabled
                  </Label>
                  <span className="text-muted-foreground text-xs">
                    The BlueBubbles server has the Private API features turned on (reactions, typing
                    indicators, and more).
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
                <div className="space-y-0.5">
                  <Label htmlFor="bb-enabled" className="font-medium">
                    Enabled
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Turn the bridge off to stop syncing without losing this configuration.
                  </p>
                </div>
                <Switch id="bb-enabled" checked={enabled} onCheckedChange={setEnabled} disabled={busy} />
              </div>

              {(config?.lastError || config?.lastSyncCursor || lastWebhook) && (
                <div className="space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
                  {config?.lastError && (
                    <p className="text-red-600 dark:text-red-400">Last error: {config.lastError}</p>
                  )}
                  {config?.lastSyncCursor && <p>Last sync cursor: {config.lastSyncCursor}</p>}
                  {lastWebhook && <p>Last webhook received: {lastWebhook}</p>}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <Button type="button" disabled={!dirty || busy} onClick={() => void handleSave()}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void handleTestConnection()}
                >
                  {testing ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                      Testing…
                    </>
                  ) : (
                    'Test connection'
                  )}
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => void handleSyncNow()}>
                  {syncing ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                      Starting…
                    </>
                  ) : (
                    'Sync now'
                  )}
                </Button>
                {saved && <span className="text-sm text-teal-700 dark:text-teal-300">Saved</span>}
              </div>

              {testResult && (
                <p
                  className={`text-sm ${testResult.ok ? 'text-teal-700 dark:text-teal-300' : 'text-red-600 dark:text-red-400'}`}
                >
                  {testResult.ok
                    ? `Connected${testResult.latencyMs != null ? ` (${testResult.latencyMs}ms)` : ''}`
                    : (testResult.error ?? 'Test connection failed')}
                </p>
              )}

              {syncResult && (
                <p
                  className={`text-sm ${'started' in syncResult && syncResult.started ? 'text-teal-700 dark:text-teal-300' : 'text-red-600 dark:text-red-400'}`}
                >
                  {'started' in syncResult
                    ? syncResult.started
                      ? 'Sync started'
                      : 'Sync did not start'
                    : syncResult.error}
                </p>
              )}
            </div>
          )}
        </Card.Content>
      </Card>
    </>
  );
}
