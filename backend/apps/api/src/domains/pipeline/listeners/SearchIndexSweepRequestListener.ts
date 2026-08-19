import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import { OnEvent } from '@ci/domains/events';
// The events leaf, NOT the maintenance barrel — the barrel would re-enter this
// domain through maintenance → llm → tools → import.
import {
  SEARCH_INDEX_BACKFILL_QUEUE,
  SearchIndexBackfillRequestEvent,
  type SearchIndexBackfillRequestPayload,
} from '@ci/domains/maintenance/events';

import { STAGE_IDS, type StageId } from '../constants';
import { PipelineDispatchService } from '../services/PipelineDispatchService';

/**
 * Entity type → the `(embed, vector)` stage pair that indexes it. The keys are
 * the wire vocabulary emitters use (the old backfill's entity-type names, which
 * are also `ci_search.*.entity_type` values).
 */
export const INDEX_STAGES_BY_ENTITY_TYPE: Readonly<Record<string, readonly [StageId, StageId]>> = {
  content: [STAGE_IDS.INDEX_EMBED, STAGE_IDS.INDEX_VECTOR],
  communication: [STAGE_IDS.INDEX_EMBED_COMMUNICATION, STAGE_IDS.INDEX_VECTOR_COMMUNICATION],
  event: [STAGE_IDS.INDEX_EMBED_EVENT, STAGE_IDS.INDEX_VECTOR_EVENT],
  item: [STAGE_IDS.INDEX_EMBED_ITEM, STAGE_IDS.INDEX_VECTOR_ITEM],
  person: [STAGE_IDS.INDEX_EMBED_PERSON, STAGE_IDS.INDEX_VECTOR_PERSON],
  file: [STAGE_IDS.INDEX_EMBED_FILE, STAGE_IDS.INDEX_VECTOR_FILE],
  'browser-activity': [STAGE_IDS.INDEX_EMBED_BROWSER_ACTIVITY, STAGE_IDS.INDEX_VECTOR_BROWSER_ACTIVITY],
};

/**
 * Consumes {@link SearchIndexBackfillRequestEvent}: starts a pipeline sweep of
 * the requested types' embed + vector stages for the requesting user.
 *
 * This listener REPLACED the maintenance domain's `SearchIndexBackfillListener`
 * when the per-entity-type index stages landed — the request now flows into the
 * ledger path (recorded outcomes, model-derived versions, per-row failure
 * reasons) instead of the old embedding-exists backfill. The event and queue
 * are unchanged; only the consumer moved, because starting sweeps needs
 * {@link PipelineDispatchService} and the maintenance domain cannot import this
 * one without closing a module cycle.
 *
 * Starting a sweep that overlaps a running one is safe by construction: hops
 * select through the ledger's claim, so the loser of a race gets a shorter list
 * and does correspondingly less work. There is deliberately no dedupe here —
 * an empty hop costs one query.
 *
 * A request whose scope names ONLY unknown types is refused, not widened: the
 * fallback to "all types" would turn a typo into a full-corpus pass — the
 * opposite of what a scoped emitter asked for. A request without a `userId` is
 * likewise refused: sweeps are user-scoped by design, and guessing an owner
 * would index one user's rows under another's name.
 */
@Injectable()
export class SearchIndexSweepRequestListener {
  constructor(
    private readonly dispatchService: PipelineDispatchService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(SearchIndexSweepRequestListener.name);
  }

  @OnEvent(SearchIndexBackfillRequestEvent, { queue: SEARCH_INDEX_BACKFILL_QUEUE })
  async handleRequest(payload: SearchIndexBackfillRequestPayload): Promise<void> {
    const { userId, requestedBy } = payload;

    if (userId == null || userId.length === 0) {
      this.logger.warn('Search-index sweep request carries no userId; ignoring', { requestedBy });

      return;
    }

    const requested = payload.entityTypes;
    const known = requested?.filter((type) => INDEX_STAGES_BY_ENTITY_TYPE[type] != null);

    if (requested != null && (known == null || known.length === 0)) {
      this.logger.warn('Search-index sweep request named no known entity types; ignoring', {
        requested,
        requestedBy,
      });

      return;
    }

    if (known != null && known.length < (requested?.length ?? 0)) {
      this.logger.warn('Search-index sweep request named unknown entity types; sweeping the rest', {
        requested,
        known,
        requestedBy,
      });
    }

    const entityTypes = known ?? Object.keys(INDEX_STAGES_BY_ENTITY_TYPE);
    const stages = entityTypes.flatMap((type) => INDEX_STAGES_BY_ENTITY_TYPE[type]);

    for (const stage of stages) {
      await this.dispatchService.startSweep({ stage, userId });
    }

    this.logger.log('Search-index sweeps started', {
      requestedBy,
      userId,
      entityTypes,
      stages,
    });
  }
}
