import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { EmbeddingGenerationService } from '@ci/common/embeddings';
import { LoggerService } from '@ci/common/logging';
import { contentSearchDocument, type ContentSearchFields } from '@ci/domains/search-ingress';

import { STAGE_IDS } from '../../constants';
import type { StageSource } from '../../types';

import { DenseEmbedStageBase, type EmbedDocumentRow } from './DenseEmbedStageBase';
import { loadContentRows } from './entityRows';

/**
 * The version machinery moved to `embedVersion.ts` when the per-entity-type
 * embed stages joined this one (they all share the derived version); re-exported
 * so `versions.ts` and the specs keep their import path.
 */
export {
  EMBEDDING_DIMENSION,
  EMBED_MODEL_GENERATIONS,
  assertEmbedModelGenerations,
  embedStageVersion,
} from './embedVersion';

/**
 * Alias for {@link STAGE_IDS.INDEX_EMBED}, which is now the sole declaration.
 *
 * This used to be a local string literal, landed ahead of the `constants.ts`
 * entry. It survives only as an alias because `__tests__/EmbedStage.spec.ts`
 * imports the name; new code reads `STAGE_IDS.INDEX_EMBED`, and the alias goes
 * away with the change that owns that spec.
 *
 * IDS ARE PERMANENT — the id is the third component of `ci.pipeline_state`'s
 * primary key, so renaming it abandons every ledger row written under the old
 * name.
 */
export const INDEX_EMBED_STAGE_ID = STAGE_IDS.INDEX_EMBED;

/**
 * Candidate rows for this stage.
 *
 * Note what is ABSENT: there is no `LEFT JOIN ci_search.embeddings e ... WHERE
 * e.entity_id IS NULL`, and no `LEFT JOIN ci_search.index_skips`. Those two
 * anti-joins are how `SearchIndexBackfillService` decides what still needs
 * embedding, and together they are the same one-way ratchet as `width IS NULL`
 * wearing a different hat: the presence of the OUTPUT is the definition of done,
 * so the model that produced it is irrelevant and improving it repairs nothing.
 * `StageRegistry` rejects a predicate that reaches into the ledger for the
 * mirror-image reason.
 *
 * What is left is pure applicability: a content row belonging to a user. Whether
 * it has been embedded, by which model, and what happened if it was not, all
 * live in `ci.pipeline_state`.
 *
 * `user_id IS NOT NULL` is not needed — the sweep binds `s.user_id = $3` — but
 * `ci.content.user_id` is nullable and rows with a NULL owner are unreachable by
 * any user-scoped sweep, which is worth knowing when coverage looks short.
 */
export const INDEX_EMBED_SOURCE: StageSource = {
  schema: 'ci',
  table: 'content',
  idColumn: 'id',
  userColumn: 'user_id',
};

/**
 * The text that gets embedded — now literally the same function the live
 * `ContentSearchIndexListener` calls (`searchTexts.contentSearchDocument`), so
 * the two paths produce byte-identical documents by construction rather than by
 * a comment promising they stay in sync. Kept as a named export because the
 * spec exercises it directly.
 */
export function buildSearchDocument(row: ContentSearchFields): string | null {
  return contentSearchDocument(row);
}

/**
 * Dense-embeds `ci.content` rows into `ci_search.embeddings`.
 *
 * The stage that proved the ledger is worth having: its version is not a
 * hand-chosen integer but a function of the embedding model itself (see
 * `embedVersion.ts`), so swapping `CI_EMBED_MODEL` re-embeds the corpus with no
 * script, no truncate and no operator remembering to. The slice mechanics —
 * batched Ollama call, dimension screen, one bulk upsert, per-row ledger
 * outcomes — live in {@link DenseEmbedStageBase}, shared with the other
 * `index.embed*` stages.
 *
 * ── Skips are recorded, not silent ─────────────────────────────────────────
 *
 * `embedSkipReason` already knows that empty / too-short / trivial-reaction /
 * bare-URL text is not worth a vector, and the listeners have always honoured
 * it. What they could not do is REMEMBER it: a skipped row simply had no
 * `ci_search.embeddings` entry, indistinguishable from a row that failed, or
 * one Ollama never got to. Here the ledger row IS the skip marker:
 * `skipped: 'too-short'`, one row, countable and greppable, and re-openable by
 * a version bump. This stage therefore does NOT write `ci_search.index_skips` —
 * `SearchIndexBackfillService` still needs that table while it exists, and it
 * is that service's to write.
 *
 * ── A dead Ollama is a rising failure count ────────────────────────────────
 *
 * On the old search-index queue an Ollama outage meant jobs failing into the
 * archive, visible only as an embedded count that stopped climbing —
 * indistinguishable from a drain that finished. Here every id in the slice is
 * recorded `failed: ollama_unreachable`, with a retry gate, so the outage reads
 * as a number going UP on `GET /api/pipeline/state`.
 */
@Injectable()
export class EmbedStage extends DenseEmbedStageBase {
  readonly id = STAGE_IDS.INDEX_EMBED;

  readonly entityTypes = ['content'] as const;

  readonly source = INDEX_EMBED_SOURCE;

  protected readonly skipHeuristics = true;

  /**
   * False, matching `ContentSearchIndexListener`, which — unlike the
   * communication/event/browser-activity listeners — never consulted
   * `shouldEmbedType`.
   */
  protected readonly honorsEmbedAllowlist = false;

  constructor(
    @InjectDataSource() dataSource: DataSource,
    embeddingGenerationService: EmbeddingGenerationService,
    logger: LoggerService,
  ) {
    super(dataSource, embeddingGenerationService, logger);
    this.logger.setContext(EmbedStage.name);
  }

  protected async loadDocuments(userId: string, ids: string[]): Promise<EmbedDocumentRow[]> {
    const rows = await loadContentRows(this.dataSource, userId, ids);

    return rows.map((row) => ({ id: row.id, document: buildSearchDocument(row) }));
  }
}
