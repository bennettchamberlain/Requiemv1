/**
 * Virtual / non-physical "locations" that calendar events carry in the location
 * field — video-call URLs, "TBD", phone numbers. These can never forward-geocode
 * to a meaningful Point, so they are NEVER sent to Google (billing + negative-
 * cache noise) and are tagged metadata.location_source = 'virtual' instead.
 */

/** Exact-match denylist tokens (compared against the canonical, lowercased form). */
const VIRTUAL_LOCATION_TOKENS = new Set<string>([
  'zoom',
  'teams',
  'microsoft teams',
  'meet',
  'google meet',
  'google hangouts',
  'hangouts',
  'discord',
  'slack',
  'webex',
  'skype',
  'online',
  'virtual',
  'remote',
  'tbd',
  'tba',
  'n/a',
  'na',
  'none',
  'phone',
  'phone call',
  'call',
  'conference call',
  'video call',
  'web conference',
]);

/**
 * Substring / pattern signals that the location is a meeting link or other
 * non-geocodable virtual venue, even when embedded in a longer string
 * (e.g. "Zoom: https://zoom.us/j/123").
 */
const VIRTUAL_LOCATION_PATTERNS: RegExp[] = [
  /\bzoom\.us\b/i,
  /\bmeet\.google\.com\b/i,
  /\bteams\.microsoft\.com\b/i,
  /\bteams\.live\.com\b/i,
  /\bwebex\.com\b/i,
  /\bdiscord\.(gg|com)\b/i,
  /\bhangouts\.google\.com\b/i,
  /\bgoto(meeting|webinar)\b/i,
  /\bhttps?:\/\//i,
  // A bare phone number ("+1 (415) 555-0100", "555-1234") is a dial-in, not an
  // address. Require >= 7 digits so house-numbered streets are never caught.
  /^[+(]?[\d][\d\s().+-]{6,}$/,
];

/**
 * Casual / relational labels people put in a calendar location field that are
 * NOT geocodable addresses ("Mom's", "the usual spot", "my place"). Google will
 * happily resolve these to a wrong APPROXIMATE centroid, so we conservatively
 * catch the unambiguous ones. Anything carrying an address signal (a digit, a
 * comma, or a street/place keyword — see hasAddressSignal) is exempt so a real
 * place is never blocked.
 */
const CASUAL_LABEL_PATTERNS: RegExp[] = [
  // Possessive with no following place noun: "Mom's", "Dave's", "grandma's".
  /^[a-z]+['’]s$/i,
  // Deictic / relational phrases that have no fixed address.
  /^(my|our|the)\s+(place|usual|usual\s+spot|spot|home|house|office|desk)$/i,
  /^(here|somewhere|anywhere|elsewhere|wherever|outside|out|home)$/i,
  /^(to\s+be\s+(determined|decided|announced|confirmed)|location\s+tbd)$/i,
];

/**
 * Signals that a free-text label is (or contains) a real address and must NOT
 * be treated as a casual non-place: any digit (house/unit/zip), a comma
 * (multi-component address), or a common street/place-type keyword. Used only
 * to EXEMPT strings from the conservative casual-label heuristic — the exact
 * token denylist and link patterns above always win.
 */
const ADDRESS_KEYWORD = new RegExp(
  '\\b(' +
    [
      'st',
      'street',
      'ave',
      'avenue',
      'blvd',
      'boulevard',
      'rd',
      'road',
      'dr',
      'drive',
      'ln',
      'lane',
      'ct',
      'court',
      'way',
      'plaza',
      'suite',
      'ste',
      'floor',
      'fl',
      'building',
      'bldg',
      'room',
      'rm',
      'hall',
      'center',
      'centre',
      'park',
      'cafe',
      'restaurant',
      'hotel',
      'office',
      'station',
      'airport',
      'school',
      'university',
      'hospital',
      'church',
      'mall',
      'store',
      'shop',
    ].join('|') +
    ')\\b',
  'i',
);

function hasAddressSignal(normalized: string): boolean {
  return /\d/.test(normalized) || normalized.includes(',') || ADDRESS_KEYWORD.test(normalized);
}

/**
 * True if `location` is a virtual / non-physical venue that must not be sent to
 * the geocoder. `value` should be the raw location string; this lowercases and
 * trims internally.
 *
 * Three layers, cheapest first:
 *   1. Exact-match token denylist (meeting apps, TBD/N/A, "phone call", …).
 *   2. Link / dial-in patterns (zoom.us, https://…, a bare phone number).
 *   3. A conservative casual-label heuristic ("Mom's", "the usual spot") that
 *      fires ONLY when the string carries no address signal (digit, comma, or a
 *      street/place keyword — see hasAddressSignal). Tuned to avoid blocking a
 *      real place; ambiguous-but-real labels fall through to the geocoder and,
 *      if they resolve only to a city centroid, are tagged low-confidence
 *      instead (see GeocodeService.LOW_CONFIDENCE_THRESHOLD).
 */
export function isVirtualLocation(location: string | null | undefined): boolean {
  if (!location) {
    return false;
  }

  const normalized = location.trim().toLowerCase();

  if (normalized.length === 0) {
    return false;
  }

  if (VIRTUAL_LOCATION_TOKENS.has(normalized)) {
    return true;
  }

  if (VIRTUAL_LOCATION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  // Layer 3: conservative casual-label heuristic. Skipped entirely when the
  // string looks like a real address so we never over-block.
  if (!hasAddressSignal(normalized)) {
    return CASUAL_LABEL_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  return false;
}
