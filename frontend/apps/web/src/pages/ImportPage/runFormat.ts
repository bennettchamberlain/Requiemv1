/**
 * The one place that owns import run/stage labelling and the small number
 * formatters the progress UI shares.
 *
 * Upstream this file carried twelve stage kinds, because the standalone app also
 * owned graph extraction, geocoding and search indexing. Here an import ends
 * when the user's data is in `ci.*`; what the appliance then does with it is
 * `ci.pipeline_runs`' business and has its own surface. So this is three stages,
 * deliberately.
 */

/** Human label per stage kind, for the stage bar. */
export const STAGE_LABELS: Record<string, string> = {
  unpack: 'Unpack',
  parse: 'Read',
  push: 'Save',
};

/** One line saying what each stage is doing, in the user's terms rather than ours. */
export const STAGE_BLURBS: Record<string, string> = {
  unpack: 'Expand the archive you uploaded',
  parse: 'Read what is inside it',
  push: 'Save it into your Companion Memory',
};

/** Order and short labels for the per-destination breakdown the push stage records. */
export const DESTINATION_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['events', 'events'],
  ['communications', 'messages'],
  ['content', 'documents'],
  ['inventory', 'things'],
  ['browser_activity', 'browsing'],
  ['position', 'locations'],
];

export function stageLabel(kind: string): string {
  return STAGE_LABELS[kind] ?? kind;
}

/**
 * `processed / total` clamped to 0..1, or null when there is no denominator.
 *
 * Null is the important case: it means indeterminate, and the bar must animate
 * rather than invent a width. A parse does not know how many records an archive
 * holds until it has read it.
 */
export function computeFraction(processed: number, total: number | null | undefined): number | null {
  if (total == null || total <= 0) {
    return null;
  }

  const fraction = processed / total;

  if (!Number.isFinite(fraction)) {
    return null;
  }

  return Math.min(1, Math.max(0, fraction));
}

/** 12_400 → "12.4k". Real imports run to hundreds of thousands of records. */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  const abs = Math.abs(value);

  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }

  return String(Math.round(value));
}

/** "4m 12s" — coarse on purpose, because a second-accurate ETA over 40GB is a fiction. */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ${Math.round(seconds % 60)}s`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatEta(seconds: number | null | undefined): string | null {
  const text = formatDuration(seconds);

  return text ? `${text} left` : null;
}

/**
 * A run's status in words a person can act on.
 *
 * `partial` is the one worth spelling out: it is a terminal SUCCESS, not a
 * failure, and calling it "Failed" is what teaches people to re-upload a 40GB
 * archive over one parser that choked.
 */
export const RUN_STATUS_LABELS: Record<string, string> = {
  queued: 'Waiting to start',
  running: 'Importing',
  completed: 'Imported',
  partial: 'Imported, with some items skipped',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status] ?? status;
}

/**
 * Turn a run's detected data-source names into what the catalogue calls them.
 *
 * Falls back to a de-underscored version of the raw name rather than hiding a
 * source the catalogue does not know about: a parser can outlive its catalogue
 * entry, and "kindle_reading" read badly but read.
 */
export function serviceLabels(
  names: readonly string[],
  sources: readonly { readonly name: string; readonly title: string }[],
): string[] {
  const titles = new Map(sources.map((source) => [source.name, source.title]));

  return names.map((name) => titles.get(name) ?? name.replace(/_/g, ' '));
}
