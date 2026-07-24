/**
 * Vocabulary IRIs used by the Solid facade. Kept in one place so the serializers
 * can emit `@prefix` / `@context` blocks and so predicate construction reads as
 * `FOAF('name')` rather than a raw string literal scattered across services.
 *
 * These are the canonical namespaces the Solid ecosystem expects; do not
 * "tidy" the URLs (e.g. https vs http) — they are opaque identifiers and other
 * agents match them byte-for-byte.
 */

/** Prefix -> namespace IRI. The serializers iterate this to declare prefixes. */
export const PREFIXES = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  foaf: 'http://xmlns.com/foaf/0.1/',
  solid: 'http://www.w3.org/ns/solid/terms#',
  pim: 'http://www.w3.org/ns/pim/space#',
  ldp: 'http://www.w3.org/ns/ldp#',
  acl: 'http://www.w3.org/ns/auth/acl#',
  schema: 'http://schema.org/',
} as const;

export type Prefix = keyof typeof PREFIXES;

/** Builds a term IRI in the given vocabulary, e.g. `term('foaf', 'name')`. */
export const term = (prefix: Prefix, local: string): string => `${PREFIXES[prefix]}${local}`;

export const RDF = (local: string): string => term('rdf', local);
export const FOAF = (local: string): string => term('foaf', local);
export const SOLID = (local: string): string => term('solid', local);
export const PIM = (local: string): string => term('pim', local);
export const SCHEMA = (local: string): string => term('schema', local);

/** `rdf:type`, the one predicate both serializers special-case. */
export const RDF_TYPE = RDF('type');
