import { useCallback, useEffect, useState } from 'react';

import { fetchJson } from '@ci/common';
import { AlertDialog, Button, Card, Switch } from '@ci/shadcn';
import { MapPin } from '@ci/shadcn/icons';

import { useAuth, useLocationTracking } from '@/hooks';

interface PositionStats {
  total: number;
  byProvider: Record<string, number>;
  lastFixAt: string | null;
}

/**
 * Settings -> Location: browser location tracking (issue #1811). Enable/disable
 * recording of ci.position fixes from this browser, with live counts — the
 * LifeScope locations settings rebuilt on the position store.
 */
export function LocationSection() {
  const [{ authToken, authenticated }] = useAuth();
  // State-only: the app-level instance in AppRoutes owns the geolocation
  // watcher. Registering a second watcher here would double-post every fix
  // while this page is open.
  const { enabled, setEnabled } = useLocationTracking({ watch: false });
  const [stats, setStats] = useState<PositionStats | null>(null);
  const [confirming, setConfirming] = useState(false);

  const refreshStats = useCallback(async () => {
    // Native authenticates by API key with no JWT — gate on `authenticated`.
    if (!authenticated) {
      return;
    }

    try {
      const data = await fetchJson<PositionStats>('/api/position/stats', {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });
      if (data) {
        setStats(data);
      }
    } catch {
      // Stats are informational; leave the section usable without them.
    }
  }, [authToken, authenticated]);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats, enabled]);

  const trackedCount = stats?.byProvider?.browser ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MapPin className="h-5 w-5" />
          Location
        </h2>
        <p className="text-sm text-muted-foreground">
          Track where you are so your memory can place events, photos and messages on the map.
        </p>
      </div>

      <Card>
        <Card.Header>
          <Card.Title className="text-base">Browser location tracking</Card.Title>
          <Card.Description>
            While enabled, this browser records your location as you use Companion — throttled to meaningful
            movement. Fixes are stored privately in your position history and improve location estimates for
            everything else in your memory.
          </Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">
              {enabled ? 'Tracking is on for this browser' : 'Tracking is off'}
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={(next) => {
                if (next) {
                  setConfirming(true);
                } else {
                  setEnabled(false);
                }
              }}
              aria-label="Toggle browser location tracking"
            />
          </div>

          <div className="text-sm text-muted-foreground">
            <div>{trackedCount} fixes recorded from browsers</div>
            <div>{stats ? `${stats.total} position fixes total` : 'Loading position stats…'}</div>
            {stats?.lastFixAt && <div>Last fix {new Date(stats.lastFixAt).toLocaleString()}</div>}
          </div>

          <div>
            <Button variant="outline" size="sm" onClick={() => void refreshStats()}>
              Refresh stats
            </Button>
          </div>
        </Card.Content>
      </Card>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialog.Content>
          <AlertDialog.Header>
            <AlertDialog.Title>Enable location tracking?</AlertDialog.Title>
            <AlertDialog.Description>
              Companion will record this browser&apos;s location while you use it. Your browser will ask for
              permission. Recorded locations stay in your private position history until you delete them;
              disabling tracking stops new recordings.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={() => {
                setEnabled(true);
                setConfirming(false);
              }}
            >
              Enable
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog>
    </div>
  );
}
