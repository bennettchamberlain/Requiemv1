import { z } from 'zod';

/**
 * The peer-ask wire protocol — the contract two Companion Memory boxes speak.
 *
 * Shape and vocabulary follow OID4VP/DCQL's "request specific claims, get a
 * selectively-disclosed response" model rather than a datastore query: the asker
 * names the ARCHETYPE and its constraints; the responder's box decides what (if
 * anything) that maps to in its own memory. The asker never expresses a query
 * over the responder's schema, so a peer can never probe storage layout.
 *
 * Transport is HTTP POST to the peer's `/agent/v1/ask`, authenticated with a
 * CI-Portal-issued OIDC token whose audience is the target peer. Discovery of
 * that endpoint (handle → memory endpoint + issuer) is CI-Portal's job; the
 * relationship itself is held only by the two boxes.
 */

/**
 * The three interpersonal archetypes this protocol carries. Each is a distinct
 * disclosure surface, so each is a distinct wire shape — a peer cannot smuggle a
 * retrieval through an availability request.
 *
 * - `relationship` — "do you know X?" → boolean (+ optional how, if permitted)
 * - `content`      — "have you seen / do you have X?" → existence or references
 * - `availability` — "free for lunch Friday at X?" → free/busy slots ONLY
 */
export const PEER_ASK_ARCHETYPES = ['relationship', 'content', 'availability'] as const;
export type PeerAskArchetype = (typeof PEER_ASK_ARCHETYPES)[number];

/** "Do you know X?" — X named as free text plus optional identifiers. */
export const relationshipAskSchema = z.object({
  archetype: z.literal('relationship'),
  /** The person being asked about, as the asker knows them. */
  subject: z.string().min(1).max(200),
  /** Optional normalized identifiers to disambiguate (email/phone). */
  identifiers: z.array(z.string().max(200)).max(5).optional(),
});

/** "Have you seen / do you have X content?" */
export const contentAskSchema = z.object({
  archetype: z.literal('content'),
  /** What the asker is looking for. */
  subject: z.string().min(1).max(500),
  /** Coarse class hint — 'photos' | 'documents' | 'messages' | 'events'. */
  dataClass: z.string().max(60).optional(),
  /** Optional ISO date window to bound the search. */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/**
 * "Free for lunch Friday?" — a free/busy question over a bounded window.
 * The response carries ONLY busy/free intervals; titles, attendees, and
 * locations of the responder's events are never disclosed by this archetype.
 */
export const availabilityAskSchema = z.object({
  archetype: z.literal('availability'),
  /** Window start (ISO 8601). */
  from: z.string().datetime(),
  /** Window end (ISO 8601). */
  to: z.string().datetime(),
  /** Optional minimum contiguous free minutes the asker needs (e.g. 60). */
  minMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .optional(),
  /** Optional human context shown to the responder ("lunch at Zuni"). */
  purpose: z.string().max(200).optional(),
});

export const peerAskBodySchema = z.object({
  /** Correlation id minted by the asker; the answer echoes it (idempotency key). */
  askId: z.string().min(8).max(64),
  /** The asker's Portal handle, for display and peer-link matching. */
  askerHandle: z.string().min(1).max(120),
  /** Natural-language question, shown to the responder in their review inbox. */
  prompt: z.string().min(1).max(500),
  /** The structured request. */
  request: z.discriminatedUnion('archetype', [
    relationshipAskSchema,
    contentAskSchema,
    availabilityAskSchema,
  ]),
});

export type PeerAskBody = z.infer<typeof peerAskBodySchema>;
export type RelationshipAsk = z.infer<typeof relationshipAskSchema>;
export type ContentAsk = z.infer<typeof contentAskSchema>;
export type AvailabilityAsk = z.infer<typeof availabilityAskSchema>;

/** A free/busy interval — the ONLY calendar shape that crosses a peer boundary. */
export interface BusyInterval {
  /** ISO 8601. */
  start: string;
  /** ISO 8601. */
  end: string;
}

/**
 * The peer's response. `status` distinguishes an answer from a deliberate
 * non-answer, and a declined/pending ask is INDISTINGUISHABLE in content from
 * "nothing found" — a peer must not be able to probe existence by inference.
 */
export interface PeerAskResponse {
  askId: string;
  status: 'answered' | 'pending_review' | 'declined';
  /** Present only when status === 'answered'. */
  answer?: {
    /** Mirrors the disclosure form used locally. */
    form: 'boolean' | 'existence' | 'attribute' | 'retrieval' | 'identity' | 'availability';
    /** Templated, non-leaking summary for display. */
    summary: string;
    /** Item references (id + type) — retrieval form only, never raw content. */
    items?: { id: string; type: string }[];
    /** Count disclosed after the responder's redaction. */
    disclosedCount?: number;
    /** Count the responder withheld (never itemized). */
    withheldCount?: number;
    /** Free/busy intervals — availability form only. */
    busy?: BusyInterval[];
    free?: BusyInterval[];
  };
  /** Human-readable reason for a non-answer. Deliberately vague by design. */
  reason?: string;
}

/** A peer as returned by CI-Portal discovery. */
export interface PeerDescriptor {
  handle: string;
  displayName?: string;
  /** Base URL of the peer's Companion (their `/agent/v1`). */
  memoryEndpoint: string;
  /** OIDC issuer that will sign this peer's outbound asks. */
  issuer?: string;
  /** OIDC subject of the peer's owning user. */
  subject?: string;
}
