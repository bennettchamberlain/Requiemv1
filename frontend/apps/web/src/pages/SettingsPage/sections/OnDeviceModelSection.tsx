import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getLocalLlmStatus,
  isNativePlatform,
  loadLocalLlmModel,
  startLocalLlm,
  stopLocalLlm,
  streamLocalLlmCompletion,
  type LocalLlmConnection,
  type LocalLlmStatus,
} from '@ci/common';
import { Button, Card, Input, Label } from '@ci/shadcn';
import { Cpu } from '@ci/shadcn/icons';

/**
 * On-device chat completion (Phase 3 "Thinks" of the disconnected-mode design doc): a
 * loopback LiteRT-LM sidecar the native shell runs, reached directly by this section
 * rather than through the appliance-configured `apiBaseUrl` (see `localLlm.ts`'s header
 * comment — the sidecar isn't wired in as a `buildApiUrl()` target yet, that's the
 * larger Rung-2 mode switch). This section exists to prove the sidecar contract works
 * end to end, not as the final on-device chat experience.
 */
export function OnDeviceModelSection() {
  const native = isNativePlatform();
  const [status, setStatus] = useState<LocalLlmStatus | null>(null);
  const [connection, setConnection] = useState<LocalLlmConnection | null>(null);
  const [modelPath, setModelPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [reply, setReply] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refreshStatus = useCallback(async () => {
    const next = await getLocalLlmStatus();
    setStatus(next);
  }, []);

  useEffect(() => {
    if (native) {
      void refreshStatus();
    }
  }, [native, refreshStatus]);

  const handleStart = async () => {
    setBusy(true);
    setError(null);

    try {
      const info = await startLocalLlm();

      if (info) {
        setConnection(info);
      } else {
        setError('The LocalLLM plugin is unavailable on this device.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the local model server.');
    } finally {
      await refreshStatus();
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);

    try {
      await stopLocalLlm();
      setConnection(null);
    } finally {
      await refreshStatus();
      setBusy(false);
    }
  };

  const handleLoadModel = async () => {
    if (!modelPath.trim()) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await loadLocalLlmModel(modelPath.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the model.');
    } finally {
      await refreshStatus();
      setBusy(false);
    }
  };

  const handleSendPrompt = async () => {
    if (!connection || !prompt.trim() || streaming) {
      return;
    }

    setStreaming(true);
    setReply('');
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for await (const delta of streamLocalLlmCompletion(
        connection,
        [{ role: 'user', content: prompt.trim() }],
        { signal: controller.signal },
      )) {
        setReply((current) => current + delta);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  if (!native) {
    return (
      <>
        <div className="mb-6">
          <h2 className="text-xl font-semibold">On-device model</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Local chat completion, no appliance required. Only available in the Companion mobile app.
          </p>
        </div>
        <Card>
          <Card.Content className="pt-6">
            <p className="text-sm text-muted-foreground">
              You&apos;re viewing this in a browser — on-device inference runs inside the native iOS/Android shell.
            </p>
          </Card.Content>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">On-device model</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Chat with a model running entirely on this phone — no appliance connection needed. This is an early
          preview of the local sidecar: model download and a real chat surface come later.
        </p>
      </div>

      <Card className="mb-6">
        <Card.Content className="space-y-4 pt-6">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-700 dark:text-teal-300">
              <Cpu className="h-4 w-4" />
            </div>
            <div className="space-y-1 min-w-0">
              <h3 className="text-base font-semibold text-foreground">Local sidecar</h3>
              <p className="text-sm text-muted-foreground leading-snug">
                {status?.supported === false
                  ? 'This device does not meet the minimum platform requirement (Android 12 / iOS 15).'
                  : status?.running
                    ? `Running at ${status.baseUrl}${status.modelLoaded ? ' — model loaded' : ' — no model loaded'}.`
                    : 'Not running.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button type="button" disabled={busy || status?.running} onClick={() => void handleStart()}>
              {busy ? 'Working…' : 'Start'}
            </Button>
            <Button type="button" variant="outline" disabled={busy || !status?.running} onClick={() => void handleStop()}>
              Stop
            </Button>
          </div>

          {status?.running && (
            <div className="space-y-2 border-t border-border pt-4">
              <Label htmlFor="model-path">Model file path (on-device)</Label>
              <div className="flex gap-2">
                <Input
                  id="model-path"
                  value={modelPath}
                  onChange={(event) => setModelPath(event.target.value)}
                  placeholder="/path/to/model.litertlm"
                />
                <Button type="button" variant="outline" disabled={busy || !modelPath.trim()} onClick={() => void handleLoadModel()}>
                  Load
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Automatic download isn&apos;t wired up yet — push a `.litertlm` file onto the device and paste its
                path here.
              </p>
            </div>
          )}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </Card.Content>
      </Card>

      {connection && status?.modelLoaded && (
        <Card>
          <Card.Content className="space-y-3 pt-6">
            <Label htmlFor="local-llm-prompt">Try it</Label>
            <div className="flex gap-2">
              <Input
                id="local-llm-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask the local model something"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleSendPrompt();
                  }
                }}
              />
              <Button type="button" disabled={streaming || !prompt.trim()} onClick={() => void handleSendPrompt()}>
                {streaming ? 'Generating…' : 'Send'}
              </Button>
            </div>
            {reply && <p className="whitespace-pre-wrap rounded-md border border-border p-3 text-sm">{reply}</p>}
          </Card.Content>
        </Card>
      )}
    </>
  );
}
