import { useCallback } from 'react';

import { useConnectionMode, type ConnectionMode } from '@ci/common';
import { Badge, Tooltip, cn } from '@ci/shadcn';
import { useTranslation } from 'react-i18next';

// Dot color per mode. Kept local rather than pulled from the design system's
// semantic palette — this is the only place that needs a fixed red/amber/…
// mapping to a functional state rather than to intent (destructive, warning…).
const DOT_CLASS: Record<ConnectionMode, string> = {
  connected: 'bg-emerald-500',
  local: 'bg-sky-500',
  cached: 'bg-amber-500',
  fresh: 'bg-muted-foreground',
};

const LABEL_KEY: Record<ConnectionMode, string> = {
  connected: 'CONNECTION_MODE_CONNECTED',
  local: 'CONNECTION_MODE_LOCAL',
  cached: 'CONNECTION_MODE_CACHED',
  fresh: 'CONNECTION_MODE_FRESH',
};

// The label names the state; the hint says what it means for the user. A bare
// dot is unreadable without one — nothing on screen says what a green dot is.
const HINT_KEY: Record<ConnectionMode, string> = {
  connected: 'CONNECTION_MODE_CONNECTED_HINT',
  local: 'CONNECTION_MODE_LOCAL_HINT',
  cached: 'CONNECTION_MODE_CACHED_HINT',
  fresh: 'CONNECTION_MODE_FRESH_HINT',
};

/**
 * Small persistent chip showing the current {@link ConnectionMode}: a solid
 * dot plus a short label ("On this phone", "Offline copy", "Not synced yet"),
 * except "Connected" which — per the design doc — is kept to just the dot,
 * with the label present only for screen readers.
 *
 * That dot-only state needs the hover/focus tooltip to be legible at all: on
 * screen it is an unexplained coloured dot, and the `aria-label` that carries
 * its meaning reaches screen readers only. The badge's own border is dropped
 * in that state too — a pill drawn around a lone dot reads as a chip whose
 * contents failed to load, rather than as a status light.
 *
 * Tapping it re-runs the health check; the design doc calls for a detail
 * sheet (breakdown of what's reachable, last-synced time, manual refresh)
 * in a future pass.
 */
export function ConnectionModeIndicator() {
  const { mode, isResolved, refresh } = useConnectionMode();
  const { t } = useTranslation();

  const label = t(LABEL_KEY[mode]);
  const hint = t(HINT_KEY[mode]);
  // "Connected" is the state the design doc keeps to a bare dot.
  const showsLabel = mode !== 'connected';

  const handleClick = useCallback(() => {
    // TODO: open the connection-mode detail sheet (future pass). For now,
    // tapping just re-runs the raced health check.
    console.log(`[ConnectionModeIndicator] tapped, mode=${mode}`);
    refresh();
  }, [mode, refresh]);

  // Nothing to report until the first probe answers: the pre-probe mode is
  // "fresh", and rendering it would tell the user the app has never synced
  // every time a page loads, moments before the health check says otherwise.
  if (!isResolved) {
    return null;
  }

  return (
    <Tooltip delayDuration={300}>
      <Tooltip.Content>{hint}</Tooltip.Content>
      <Tooltip.Trigger asChild>
        <Badge
          variant="outline"
          role="button"
          tabIndex={0}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleClick();
            }
          }}
          className={cn(
            'cursor-pointer select-none gap-1.5',
            // Without a label there is nothing for the pill to enclose, so the
            // border and padding are dropped and the dot stands on its own.
            !showsLabel && 'border-transparent bg-transparent px-1',
          )}
          aria-label={label}
        >
          <span
            className={cn('inline-block size-1.5 shrink-0 rounded-full', DOT_CLASS[mode])}
            aria-hidden="true"
          />
          <span className={showsLabel ? undefined : 'sr-only'}>{label}</span>
        </Badge>
      </Tooltip.Trigger>
    </Tooltip>
  );
}
