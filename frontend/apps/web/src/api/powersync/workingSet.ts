/**
 * On-device PowerSync working set: one SQLite file that holds a rolling window of
 * notes/messages/threads, not a clone of the appliance. Eviction is unsubscribe
 * (a later cutoff), never a local DELETE that the next sync would restore.
 */

export const POWER_SYNC_CACHE_BUDGET_BYTES = 8 * 1024 * 1024 * 1024;
export const POWER_SYNC_DEFAULT_LOOKBACK_DAYS = 14;
export const POWER_SYNC_MIN_LOOKBACK_DAYS = 1;
export const POWER_SYNC_MAX_LOOKBACK_DAYS = 3650;

const LOOKBACK_KEY = 'ci.powersync.lookbackDays';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* session-only */
  }
}

export function clampLookbackDays(days: number): number {
  if (!Number.isFinite(days)) {
    return POWER_SYNC_DEFAULT_LOOKBACK_DAYS;
  }

  return Math.min(POWER_SYNC_MAX_LOOKBACK_DAYS, Math.max(POWER_SYNC_MIN_LOOKBACK_DAYS, Math.round(days)));
}

export function getLookbackDays(): number {
  const raw = readStorage(LOOKBACK_KEY);

  if (!raw) {
    return POWER_SYNC_DEFAULT_LOOKBACK_DAYS;
  }

  return clampLookbackDays(Number(raw));
}

export function setLookbackDays(days: number): number {
  const next = clampLookbackDays(days);
  writeStorage(LOOKBACK_KEY, String(next));

  return next;
}

/** ISO cutoff the token endpoint embeds so sync rules can window the replica. */
export function getWorkingSetCutoffIso(now = Date.now()): string {
  return new Date(now - getLookbackDays() * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Expand the window so `iso` is covered (opening an older thread/search hit).
 * Returns whether the cutoff changed.
 */
export function ensureCutoffCovers(iso: string, now = Date.now()): boolean {
  const target = Date.parse(iso);

  if (!Number.isFinite(target)) {
    return false;
  }

  const neededDays = Math.ceil((now - target) / (24 * 60 * 60 * 1000));

  if (neededDays <= getLookbackDays()) {
    return false;
  }

  setLookbackDays(neededDays);

  return true;
}

/**
 * Shrink lookback until `sizeBytes` is under the 8 GB budget, or until the
 * minimum window. Returns the lookback actually applied.
 */
export function shrinkToBudget(sizeBytes: number): number {
  let days = getLookbackDays();

  while (sizeBytes > POWER_SYNC_CACHE_BUDGET_BYTES && days > POWER_SYNC_MIN_LOOKBACK_DAYS) {
    days = clampLookbackDays(Math.max(POWER_SYNC_MIN_LOOKBACK_DAYS, Math.floor(days / 2)));
    setLookbackDays(days);
    // Caller reconnects and re-measures; we only move the window here.
    break;
  }

  return days;
}

export function formatCacheBudget(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);

  return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
}
