import { Injectable } from '@nestjs/common';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import {
  INDEXABLE_ENTITIES,
  type EntityIdentifier,
  type IndexableEntity,
  SearchService,
} from '@ci/domains/search-next';

import { type Ask } from '../entities/AskEntity';
import { canonicalDataClass } from '../grantMatch';
import type { AskQuery } from '../types';

/** Coarse data-class → candidate entity-type hints (validated against the taxonomy). */
const CLASS_TYPE_HINTS: Readonly<Record<string, readonly string[]>> = {
  photos: ['file'],
  media: ['file'],
  files: ['file'],
  documents: ['content', 'file'],
  events: ['event'],
  calendar: ['event'],
  messages: ['communication'],
  communications: ['communication'],
};

/**
 * Runs a bounded ask query inside the RESPONDER's memory scope and returns the
 * matching entity identifiers.
 *
 * This is the run-as-owner executor: the query executes as
 * `{ userId: responderUserId }`, mirroring how `SearchResolver.runSharedSearch`
 * runs a shared search as its owner. The ask query is asker-supplied (hostile),
 * so ONLY its text (keyword mode — no embedding side effects) and an optional
 * known data-class → entity-type filter are honored; nothing else from the asker
 * reaches search.
 *
 * Phase 0 returns the raw scoped identifiers for the owner's preview / dogfood.
 * The disclosure filter that turns these into a synthesized, redactable answer
 * for the asker — and the actual cross-person delivery — is Phase 1+.
 */
@Injectable()
export class AskExecutorService {
  constructor(
    private readonly searchService: SearchService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AskExecutorService.name);
  }

  async execute(
    ask: Ask,
    options: { maxResults?: number } = {},
  ): Promise<EntityIdentifier<IndexableEntity>[]> {
    const responderContext: UserServiceContext = { userId: ask.responderUserId };
    const includeTypes = toIncludeTypes(ask.query);
    const base = {
      query: ask.query.prompt,
      mode: 'keyword' as const, // keyword only: deterministic, no embedding side effects
      maxResults: options.maxResults ?? 50,
    };

    return includeTypes
      ? this.searchService.search(responderContext, { ...base, includeTypes })
      : this.searchService.search(responderContext, base);
  }
}

function toIncludeTypes(query: AskQuery): IndexableEntity[] | undefined {
  if (query.dataClass == null) {
    return undefined;
  }

  // Same canonical form the grant evaluator matched on — if these diverged, a
  // peer could satisfy one and evade the other.
  const canonical = canonicalDataClass(query.dataClass);
  if (canonical == null) {
    return undefined;
  }

  const hints = CLASS_TYPE_HINTS[canonical];
  if (hints == null) {
    return undefined; // unknown class → unfiltered (still responder-scoped)
  }

  const valid = hints.filter((type): type is IndexableEntity =>
    (INDEXABLE_ENTITIES as readonly string[]).includes(type),
  );

  return valid.length > 0 ? valid : undefined;
}
