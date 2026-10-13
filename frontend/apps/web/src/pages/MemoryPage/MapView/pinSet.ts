/**
 * Set-level arithmetic on map pins.
 *
 * These three used to be implicit properties of "the map draws the current page
 * of 30". Now that it draws the whole located set — ten thousand pins on a real
 * library — each one is load-bearing and cheap to get wrong, so they live here
 * as pure functions with tests rather than inline in the view.
 */

/** Minimum a pin has to carry to be placed, ordered or keyed. */
export type PinPoint = { id: string; coords: { lat: number; lng: number } };

/** A placed pin with a real domain timestamp; zero denotes an undated/import-only row. */
export type TimedPinPoint = PinPoint & { sortTime: number };

/** The slice of Leaflet's LatLngBounds this module needs (keeps it DOM-free). */
export interface BoundsLike {
  contains(point: [number, number]): boolean;
}

/**
 * The pins inside `bounds`.
 *
 * Clustering is quadratic in the number of clusters it has to de-overlap, and a
 * grid over the whole world at street zoom produces one cluster per pin. Scoping
 * to the viewport bounds that count by the screen instead of by the library:
 * a screen holds a few hundred 80px cells however many pins exist.
 */
export function pinsInBounds<T extends PinPoint>(pins: T[], bounds: BoundsLike): T[] {
  return pins.filter((pin) => bounds.contains([pin.coords.lat, pin.coords.lng]));
}

/**
 * The last `max` pins as [lat, lng] pairs, for the route line.
 *
 * `pins` is time-ascending, so this is the most recent stretch. The cap is not
 * cosmetic: the route layer issues one billed Google Directions request per
 * consecutive pair, so an uncapped set would fire one per pin on every load.
 */
export function routePoints(pins: PinPoint[], max: number): Array<[number, number]> {
  return pins.slice(-Math.max(max, 0)).map((pin) => [pin.coords.lat, pin.coords.lng]);
}

/**
 * The latest genuinely dated location.
 *
 * Map pins normally arrive time-ascending, but scanning by timestamp keeps the
 * mobile opening camera correct if an undated/import-only pin is appended.
 */
export function mostRecentDatedPin<T extends TimedPinPoint>(pins: readonly T[]): T | null {
  let latest: T | null = null;

  for (const pin of pins) {
    if (pin.sortTime > 0 && (latest == null || pin.sortTime > latest.sortTime)) {
      latest = pin;
    }
  }

  return latest;
}

/**
 * Identity of a pin set, for deciding whether the viewport should be re-fitted.
 *
 * Changes when the filters change the set, stays put while the user pans within
 * one — the map used to fit its first page and never move again, so every later
 * page landed off-screen. Size plus both endpoints is enough: the set is
 * time-ordered, so a different filter that returned the same count and the same
 * first and last event is the same set for viewport purposes.
 */
export function fitSignature(pins: PinPoint[]): string {
  if (pins.length === 0) {
    return '';
  }

  return `${pins.length}:${pins[0].id}:${pins[pins.length - 1].id}`;
}
