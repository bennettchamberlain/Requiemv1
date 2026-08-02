import { useState } from 'react';

import { fetchJson } from '@ci/common';
import { Button } from '@ci/shadcn';

import { useAuth } from '@/hooks';

import { OnboardingButton } from './OnboardingButton';
import { useOnboardService } from './useOnboardService';

interface SyncNowResponse {
  jobIds: string[];
  enqueued: number;
  skipped: number;
}

interface RunFirstSyncStepProps {
  hasConnections: boolean;
  onBack: () => void;
  onGoToConnect: () => void;
}

export function RunFirstSyncStep({ hasConnections, onBack, onGoToConnect }: RunFirstSyncStepProps) {
  const [{ authToken }] = useAuth();
  const [{ loading: submitting, error }, { onboard }] = useOnboardService();
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<{ text: string; hasError: boolean } | null>(null);

  async function runSyncNow() {
    setRunning(true);
    setSummary(null);

    try {
      const result = await fetchJson<SyncNowResponse>('/api/connections/sync-now', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (!result) {
        setSummary({ text: 'Sync failed — try again in a moment.', hasError: true });

        return;
      }

      if (result.enqueued === 0) {
        setSummary({ text: 'Nothing new to pull in right now.', hasError: false });
      } else {
        setSummary({
          text: `Sync started for ${result.enqueued} source${result.enqueued === 1 ? '' : 's'} — new memories will keep appearing in your feed.`,
          hasError: false,
        });
      }
    } catch {
      setSummary({ text: 'Sync failed — try again in a moment.', hasError: true });
    } finally {
      setRunning(false);
    }
  }

  async function finish() {
    await onboard();
  }

  const busy = running || submitting;

  return (
    <div className="space-y-6 py-6 w-full max-w-md mx-auto">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Run your first sync</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Pull in your email and calendar right now instead of waiting for tonight&apos;s sync.
        </p>
      </div>

      {!hasConnections && (
        <p className="text-sm text-muted-foreground">
          No source connected yet — this will be a no-op.{' '}
          <button type="button" className="text-teal-700 underline dark:text-teal-300" onClick={onGoToConnect}>
            Back to Connect
          </button>
        </p>
      )}

      <OnboardingButton type="button" className="w-full" disabled={busy} onClick={() => void runSyncNow()}>
        {running ? 'Syncing…' : 'Run my first sync now'}
      </OnboardingButton>

      {summary && (
        <p className={summary.hasError ? 'text-sm text-destructive' : 'text-sm text-foreground'}>{summary.text}</p>
      )}

      {error != null && (
        <p className="text-sm text-destructive">Could not finish setup — please try again.</p>
      )}

      <div className="flex justify-between items-center pt-2 gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void finish()}>
          Skip
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onBack}>
            Back
          </Button>
          <OnboardingButton type="button" size="sm" disabled={busy} onClick={() => void finish()}>
            {submitting ? 'Finishing…' : 'Finish'}
          </OnboardingButton>
        </div>
      </div>
    </div>
  );
}
