import { DEAD_EVENT_STATUSES } from '@ci/domains/memory';

/**
 * The `metadata` key a Google Takeout reservation (`google_purchases`) carries as
 * `true` when it was cancelled. Older imports left `status` at 'confirmed', so
 * for them this key is the only record of the cancellation and the calendar's
 * own status test cannot see it. A copy of the key
 * `import/datasources/google_purchases.ts` writes: if they drift, a cancelled
 * reservation gets a place link again.
 */
const RESERVATION_CANCELED_KEY = 'Canceled';

/**
 * `value`, refused unless it is a plain token. The alias is interpolated into
 * SQL, and it is always a literal this domain controls, so this is a tripwire:
 * if one is ever computed from data, the failure is a throw rather than a query
 * of a different shape.
 */
function sqlToken(kind: string, value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(
      `${kind} "${value}" is not a plain [A-Za-z0-9_] token and cannot be interpolated into SQL.`,
    );
  }

  return value;
}

/**
 * "This event happened", for a `ci.events` row aliased `alias`: not deleted, not
 * a prediction (NULL is not one), not cancelled, no_show or skipped (the
 * calendar's `LIVE_EVENT_SQL`, with the same COALESCE), and not a Takeout
 * reservation whose `metadata.Canceled` is true. The key's value decides, not
 * its presence: `Canceled: false` happened.
 *
 * `GeocodeBatchListener` asks it before it LINKS an event to a Place. A place
 * link says "this event happened there": `PlaceService.getVisitStats` counts it
 * as a visit, the Location's footprint takes its coordinate, and
 * `promote.edge_event` projects Event -LOCATED_AT-> Place from it. A coordinate
 * says something weaker, and still true of a meeting that was called off: where
 * the venue is. So the listener keeps geocoding such an event, as
 * `enrich.geocode` does, and refuses only the link.
 *
 * DUPLICATED from `eventHappenedSql` in
 * `domains/pipeline/stages/enrich/EstimateLocationStage.ts` (which
 * `promote.place` applies to the same question), and from the copy in
 * `domains/maintenance/services/LocationEstimateService.ts`. Importing either is
 * not possible from here: the pipeline imports this domain, so reaching back
 * would be a cycle, and `no-cross-domain-internals` forbids reaching past a
 * barrel. All three must produce the same text, and each domain's spec pins its
 * copy to the calendar's `LIVE_EVENT_SQL`. A change to the rule is a change in
 * all three places. The status list is shared, not copied.
 */
export function eventHappenedSql(alias: string): string {
  const row = sqlToken('alias', alias);
  const canceledKey = sqlToken('metadata key', RESERVATION_CANCELED_KEY);
  const dead = DEAD_EVENT_STATUSES.map((status) => `'${sqlToken('status', status)}'`).join(', ');

  return (
    `COALESCE(${row}.is_deleted, false) = false ` +
    `AND COALESCE(${row}.is_predicted, false) = false ` +
    `AND COALESCE(${row}.status, 'confirmed') NOT IN (${dead}) ` +
    `AND COALESCE(${row}.metadata->>'${canceledKey}', '') <> 'true'`
  );
}
