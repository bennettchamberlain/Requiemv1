import type { CreatePersonDto } from '@ci/domains/memory';

import type { StagedEntity } from '../entities/StagedEntityEntity';

/**
 * The `linked_table` namespace every entity this importer resolves is filed
 * under.
 *
 * `PersonService.create` is resolve-or-create on
 * `(owner_user_id, entity_type, linked_table, linked_id)`, so this constant plus
 * the staged entity's identity key IS the cross-run dedup: the same person
 * arriving from a Gmail export today and an iMessage export next month resolves
 * to one row, because both normalise to the same handle.
 *
 * It is deliberately not the data source. Namespacing per source would give one
 * person a row per export they appear in, which is the duplication the identity
 * key exists to prevent.
 */
export const IMPORT_LINKED_TABLE = 'ci_import';

/**
 * Turn a staged entity into the person to resolve-or-create.
 *
 * Returns null for an entity with no identity key. That is not an oversight —
 * a handle-less staged entity (an album, a mail thread, a place name) has no
 * stable key, so `linked_id` would be null and every run would create another
 * row for the same album. Those types belong to their own services
 * (`PlaceService`, `ThreadService`) with their own identity rules, and pushing
 * them through the person lane would file a photo album as a contact.
 */
export function toPersonInput(staged: StagedEntity): CreatePersonDto | null {
  if (staged.identityKey == null) {
    return null;
  }

  const properties: Record<string, unknown> = { ...(staged.metadata ?? {}) };

  // The handle is the identity, so it is worth having as a first-class property
  // and not only as the linked id.
  if (staged.identityKey.includes('@')) {
    properties.email = staged.identityKey;
  } else {
    properties.phone = staged.identityKey;
  }

  properties.sources = [IMPORT_LINKED_TABLE];

  return {
    // A display name that drifts between sources must not become the identity —
    // it is only what this sighting called them.
    name: staged.name ?? staged.identityKey,
    linkedTable: IMPORT_LINKED_TABLE,
    linkedId: staged.identityKey,
    properties,
  };
}
