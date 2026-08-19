/**
 * Compact card geometry, applied to every card on the Jobs page.
 *
 * The shadcn default is `py-6 gap-6` — right for a page of two or three cards,
 * wrong for a monitoring view stacking four, where ~48px of dead space per card
 * pushed the table (the thing being monitored) below the fold on a laptop.
 *
 * Lives in its own module rather than on `JobsPage` so the table and the charts
 * can share it without importing their own parent.
 */
export const COMPACT_CARD = 'gap-3 py-4';

/** Phone cards: less chrome so a 375px column is content, not padding. */
export const PHONE_CARD = 'gap-2 py-3';
export const PHONE_PAD = 'px-3';
