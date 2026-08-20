/**
 * Turning what the API returns into what the ask components require.
 *
 * This file exists because the two do not line up, and the gap is the honest
 * part of this page. The components were designed against a mock that assumed
 * a display NAME for each party, a trust TIER, an `autoAnswered` discriminator
 * and per-item LABELS. None of those exist on the schema today.
 *
 * The temptation is to pass plausible-looking values so the UI looks finished.
 * That is exactly the defect an audit already found in these components: `tier`
 * is an untyped display string, so the badge asserts whatever the caller says —
 * rendering `tier="ceo-of-everything"` produced a convincing trust badge. A
 * consent surface that displays an unearned claim is worse than one that admits
 * it does not know, because the whole point is that the owner can trust what it
 * says. So every helper below either DERIVES its answer from a field that
 * actually exists, or returns an explicitly unknown value.
 */

/** A party we can only identify opaquely. */
export function partyLabel(handle: string | null | undefined, id: string | null | undefined): string {
  if (handle) {
    return handle;
  }

  if (!id) {
    return 'Unknown';
  }

  // A GlobalUID is base64-ish and long; the tail is the discriminating part for
  // a human comparing two of them. Never invented, just shortened.
  return `Peer ${id.slice(-6)}`;
}

/**
 * The only trust signal the API actually supports today.
 *
 * `consentBasis` is set when a standing grant matched the ask, so its presence
 * proves the asker is someone the owner has already made a decision about. That
 * is a real two-value fact. It is NOT the mock's five-tier vocabulary
 * (household/family/trusted/peer/stranger) — no tier reaches this client — so
 * this deliberately does not use those words.
 */
export function knownAskerLabel(consentBasis: string | null | undefined): string {
  return consentBasis ? 'known contact' : 'no standing grant';
}

/** True when no grant matched — the mock's "quarantined" case, as far as we can tell. */
export function isUnknownAsker(consentBasis: string | null | undefined): boolean {
  return !consentBasis;
}

/**
 * A legible rendering of the structured ask.
 *
 * The mock claims this rendering IS the wire format. Today that is nearly true
 * by accident: the wire carries exactly queryType/dataClass/prompt, so showing
 * all three shows everything that is sent. It stops being true the moment
 * who/when/where are added to the input without being added here.
 */
export function scopeSummary(query: { queryType: string; dataClass?: string | null }): string {
  return query.dataClass ? `${query.queryType} · ${query.dataClass}` : query.queryType;
}

/**
 * A label for a disclosed item.
 *
 * `DisclosedItemType` is `{id, type}` — there is no title, name or caption on
 * the wire. Showing the type plus a short id is the most that can be said
 * truthfully; a real label needs the backend to resolve the entity.
 */
export function itemLabel(item: { id: string; type: string }): string {
  return `${item.type} ${item.id.slice(-6)}`;
}

/** Owner-facing words for a data class + query type pair on a grant. */
export function grantLabel(queryType: string, dataClass: string | null | undefined): string {
  return dataClass ? `${queryType} · ${dataClass}` : `${queryType} · all classes`;
}
