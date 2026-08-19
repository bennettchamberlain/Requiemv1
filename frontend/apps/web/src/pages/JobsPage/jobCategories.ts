/**
 * One source of truth for how a job CATEGORY is named and coloured.
 *
 * The taxonomy already says which part of the appliance a job belongs to; this
 * turns that into something scannable. A wall of 8,000 identically-styled rows
 * hides exactly the thing an operator is looking for — "which subsystem is
 * busy/stuck?" — so category carries a colour in the table, in the filters and
 * on the schedules.
 *
 * Colours are Tailwind `-400` foregrounds on a `/10` tint of the same hue. That
 * pairing clears WCAG AA (≥4.5:1) on this dark surface, and every swatch is
 * ALWAYS accompanied by its text label — colour is a second channel here, never
 * the only one (WCAG 1.4.1).
 */
export const CATEGORY_LABELS: Record<string, string> = {
  search: 'Search index',
  ingest: 'Ingest',
  enrich: 'Enrichment',
  graph: 'Life graph',
  pipeline: 'Pipeline',
  import: 'Import / sync',
  llm: 'Model',
  personalization: 'Personalization',
  planning: 'Planning',
  maintenance: 'Maintenance',
  unclassified: 'Unclassified',
};

/** Badge/pill classes per category: text + tint + border, one hue each. */
export const CATEGORY_STYLES: Record<string, string> = {
  search: 'text-sky-400 bg-sky-400/10 border-sky-400/30',
  ingest: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  enrich: 'text-violet-400 bg-violet-400/10 border-violet-400/30',
  graph: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  pipeline: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30',
  import: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  llm: 'text-fuchsia-400 bg-fuchsia-400/10 border-fuchsia-400/30',
  personalization: 'text-rose-400 bg-rose-400/10 border-rose-400/30',
  planning: 'text-teal-400 bg-teal-400/10 border-teal-400/30',
  maintenance: 'text-slate-400 bg-slate-400/10 border-slate-400/30',
  unclassified: 'text-muted-foreground bg-muted/40 border-border',
};

/** Just the dot colour, for compact rows where a full pill is too heavy. */
export const CATEGORY_DOT: Record<string, string> = {
  search: 'bg-sky-400',
  ingest: 'bg-emerald-400',
  enrich: 'bg-violet-400',
  graph: 'bg-amber-400',
  pipeline: 'bg-cyan-400',
  import: 'bg-orange-400',
  llm: 'bg-fuchsia-400',
  personalization: 'bg-rose-400',
  planning: 'bg-teal-400',
  maintenance: 'bg-slate-400',
  unclassified: 'bg-muted-foreground',
};

export function categoryLabel(category: string | null | undefined): string {
  return CATEGORY_LABELS[category ?? ''] ?? category ?? 'Unclassified';
}

export function categoryStyle(category: string | null | undefined): string {
  return CATEGORY_STYLES[category ?? ''] ?? CATEGORY_STYLES.unclassified;
}

export function categoryDot(category: string | null | undefined): string {
  return CATEGORY_DOT[category ?? ''] ?? CATEGORY_DOT.unclassified;
}
