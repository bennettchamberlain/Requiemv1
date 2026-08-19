/**
 * The one place that decides a participant string is STRUCTURALLY not a name.
 *
 * ## Why this exists
 *
 * Every path that turns a raw communication participant into a `Person` —
 * `classifyParticipant` (and through it `PersonStubBackfillService`,
 * `CommunicationLinkBackfillService`, `CommunicationParticipantLinkListener`),
 * `PersonLinkStage.classifyIdentifier`, and `EntityIdentifierService`'s
 * `name`-kind index — used to accept ANY non-email, non-phone string. A parser
 * bug therefore did not stay a parser bug: it minted contacts.
 *
 * A real appliance database showed what that costs. 3,079 `Person` rows were
 * named with a Google Voice call-log heading ("Missed call from", "Placed call
 * to\nNancy Davis"), and 241 more were named with the literal filename of a
 * Messenger/Voice export ("Group Conversation - 2024-09-25T01_45_41Z.html").
 * Migration 20260818220731 deleted those 241 rows and they came ALL the way
 * back, because it repaired the entities without repairing the string that
 * mints them and without teaching the minters to refuse it. Deleting the
 * output of a generator that is still running is theatre.
 *
 * So the rule lives here, exported once, and every minter asks it. A string
 * that is structurally not a name is refused at the door and logged, instead
 * of becoming a person in somebody's address book.
 *
 * ## What this is NOT
 *
 * Not a quality filter, not a "does this look like a human" heuristic. Only
 * three shapes, each one a known parser leak with a known blast radius:
 *
 *  1. a call-log / voicemail heading,
 *  2. an export FILENAME,
 *  3. anything containing a newline.
 *
 * A short handle, a bare phone number, a single token, an all-caps nickname —
 * all still pass. Widening this predicate widens what the system silently
 * drops, so it stays narrow on purpose.
 */

import { Logger } from '@nestjs/common';

/**
 * A Google Voice call-log heading, which is NOT a person's name.
 *
 * Call records wrap the contact in a heading and, in some exports, the heading
 * and the name share ONE `fn` span separated by a newline. The five verbs are
 * exactly what `googlevoice.ts` derives `CallType` from
 * (Missed/Placed/Received/Voicemail/Recorded), and the observed headings are
 * "Missed call from", "Placed call to", "Received call from", "Voicemail from"
 * and "Recorded call with" — hence the optional " call" and the three
 * prepositions.
 *
 * Deliberately requires WHITESPACE between the verb, the optional "call" and
 * the preposition rather than the looser "verb ... preposition somewhere on the
 * same line". An email address contains no whitespace, so this form cannot
 * match one; the looser form can ("voicemail@from.example.com" reads as a
 * heading to it), and this predicate is applied to email-shaped participants
 * too.
 *
 * Anchored at the start and matching its own trailing whitespace so it doubles
 * as the strip pattern — see {@link stripCallLogHeading}, which
 * `googlevoice.ts` uses to recover the real contact name.
 */
export const CALL_LOG_HEADING =
  /^\s*(?:missed|placed|received|recorded|voicemail)(?:\s+call)?\s+(?:from|to|with)\b\s*/i;

/**
 * An export file's own name, which is NOT a person's name.
 *
 * Two shapes, both real: a Google Voice group thread exports as a file
 * literally called "Group Conversation - <timestamp>.html" — the whole label,
 * with no contact in it — and any datasource that falls back to a basename
 * when its label parse misses hands us "<something>.html/.json/.csv/.vcf/.txt".
 * No extension in that list is a valid email TLD, so this cannot fire on an
 * address.
 */
const EXPORT_FILENAME = /\.(?:html?|json|csv|vcf|txt)$/i;
const GROUP_CONVERSATION = /^group conversation\b/i;

/** Why a participant string was refused. Also the log key, so it is countable. */
export type NonNameParticipantReason = 'call_log_heading' | 'export_filename' | 'embedded_newline';

const logger = new Logger('participantSanity');

/**
 * First occurrence of each reason is warned in full; after that only every
 * thousandth, with the running total. A corrupt import is tens of thousands of
 * rows and the signal is "this is happening and here is an example", not one
 * line per row.
 */
const seen = new Map<NonNameParticipantReason, number>();

/**
 * Why `raw` is structurally not a name, or `null` when it is acceptable.
 *
 * `null` is also the answer for null/empty input: "nothing" is not "garbage",
 * and every caller already drops empties on its own.
 */
export function nonNameParticipantReason(raw: string | null | undefined): NonNameParticipantReason | null {
  if (raw == null) {
    return null;
  }

  const value = raw.trim();
  if (value.length === 0) {
    return null;
  }

  // Newline first: it is the cheapest test and the most certain. No email,
  // phone number or display name in any export legitimately contains one, and
  // when a parser leaks markup this is what it looks like.
  if (/[\r\n]/.test(value)) {
    return 'embedded_newline';
  }

  if (CALL_LOG_HEADING.test(value)) {
    return 'call_log_heading';
  }

  if (GROUP_CONVERSATION.test(value) || EXPORT_FILENAME.test(value)) {
    return 'export_filename';
  }

  return null;
}

/**
 * `true` when `raw` must not become a Person, a display name or a `name`
 * identifier. Logs the refusal (rate-limited, see {@link seen}) so a new parser
 * leak is visible instead of silent.
 *
 * @param context where the refusal happened, e.g. 'classifyParticipant'.
 */
export function isNonNameParticipant(raw: string | null | undefined, context: string): boolean {
  const reason = nonNameParticipantReason(raw);
  if (reason == null) {
    return false;
  }

  const count = (seen.get(reason) ?? 0) + 1;
  seen.set(reason, count);

  if (count === 1 || count % 1000 === 0) {
    logger.warn(
      `Refused a participant string that is structurally not a name (${reason}) in ${context}: ` +
        `${JSON.stringify(sample(raw ?? ''))} — occurrences so far: ${count}`,
    );
  }

  return true;
}

/**
 * The contact name inside a call-log heading, or `''` when the export named
 * nobody. Trimmed, and the heading's trailing newline goes with it.
 *
 * Returns the input unchanged (trimmed) when there is no heading, so callers
 * can apply it unconditionally.
 */
export function stripCallLogHeading(raw: string): string {
  return raw.replace(CALL_LOG_HEADING, '').trim();
}

/** Test seam: forget the rate-limiter's state. */
export function resetNonNameParticipantLog(): void {
  seen.clear();
}

/** A refused value is untrusted input; never log it unbounded. */
function sample(value: string): string {
  return value.length > 80 ? `${value.slice(0, 80)}…` : value;
}
