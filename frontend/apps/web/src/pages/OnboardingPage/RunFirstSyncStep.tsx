import { fetchJson } from '@ci/common';

import { useAuth } from '@/hooks';

import { OnboardingButton } from './OnboardingButton';
import { useOnboardService } from './useOnboardService';

export function RunFirstSyncStep() {
  const [{ authToken }] = useAuth();
  const [{ loading: submitting, error }, { onboard }] = useOnboardService();

  async function finish() {
    void fetchJson('/api/connections/sync-now', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    }).catch(() => undefined);

    await onboard();
  }

  return (
    <div className="space-y-6 py-6 w-full max-w-md mx-auto">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Your life, unclouded.</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          <span className="block">Who you know, where you go,</span>
          <span className="block">everything physical you own and interact with,</span>
          <span className="block">everything digital that you create and consume:</span>
        </p>
        <p className="text-sm text-muted-foreground">
          a private, searchable memory — one that belongs to you.
        </p>
      </div>

      {error != null && (
        <p className="text-sm text-destructive">Could not finish setup — please try again.</p>
      )}

      <OnboardingButton type="button" className="w-full" disabled={submitting} onClick={() => void finish()}>
        {submitting ? 'Finishing…' : 'Run my first sync and finish'}
      </OnboardingButton>
    </div>
  );
}
