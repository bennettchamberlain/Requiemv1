import config from '@ci/configuration';

/**
 * The dense-embedding version machinery, shared by every `index.embed*` stage.
 *
 * Moved out of `EmbedStage.ts` when the per-entity-type embed stages joined it
 * (they all embed with the same model into the same `vector(768)` column, so
 * they all carry the same derived version). `EmbedStage.ts` re-exports
 * everything here, so existing importers — `versions.ts`, the specs — keep
 * their path.
 */

/**
 * Dimensionality of `ci_search.embeddings.embedding`, which is `vector(768)`.
 *
 * Hardcoded because it is a SCHEMA fact, not a tunable: pgvector fixes the
 * column width at DDL time, so changing it is a migration, and a migration that
 * changes it MUST change this line in the same commit. That coupling is the
 * point — see {@link embedStageVersion}, which folds this number into the stage
 * version, so a re-dimension automatically re-embeds the corpus that no longer
 * fits.
 */
export const EMBEDDING_DIMENSION = 768;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE HEADLINE CAPABILITY: CHANGING THE EMBEDDING MODEL RE-EMBEDS EVERYTHING.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `(model, dimension)` → the stage version rows embedded by that model carry.
 *
 * ── The defect this deletes ────────────────────────────────────────────────
 *
 * `SearchIndexBackfillService.missingIds` selects work with
 * `LEFT JOIN ci_search.embeddings e ... WHERE e.entity_id IS NULL`. A row that
 * HAS an embedding is, by that predicate, permanently finished — regardless of
 * which model produced the vector. So switching `CI_EMBED_MODEL` today produces
 * an index in which old rows hold `nomic-embed-text` vectors and new rows hold
 * the new model's, in the same 768-dimensional column, silently, forever.
 * Cosine distance between two different models' vectors is meaningless, so
 * search quality degrades in a way that shows up as "results feel worse" and
 * cannot be traced back to the switch. Repairing it requires
 * `TRUNCATE ci_search.embeddings` and a full re-index, which is exactly the
 * "delete everything and start over" migration the ledger exists to remove.
 *
 * With the version derived from the model, the switch IS the re-embed: every
 * row recorded at the old model's generation fails `stage_version < $current`
 * on the very next sweep and comes back. No backfill script, no truncate.
 *
 * ── Why a declared map and not a hash ──────────────────────────────────────
 *
 * The obvious implementation — `version = hash(model + dimension)` — is
 * genuinely dangerous here. `versions.ts` documents the invariant: **versions
 * only ever go UP.** A row is re-selected by `stage_version < $current`, so a
 * version that DECREASES leaves every already-processed row looking
 * stale-forward — its recorded version exceeds the current one, the comparison
 * is false, and the row is never re-selected again, including by the next bump
 * until it climbs past the abandoned high-water mark. A hash is uniformly
 * distributed, so switching models has a ~50 % chance of moving the version
 * DOWN, which would silently pin the entire corpus to the previous model's
 * vectors — the exact bug this derivation exists to fix, reintroduced by the
 * fix.
 *
 * So generations are DECLARED and APPEND-ONLY. Adopting a new model is one line
 * here, and the boot guard below plus {@link embedStageVersion}'s throw make it
 * impossible to run against a model whose generation nobody chose.
 *
 * ── Adding a model ─────────────────────────────────────────────────────────
 *
 * Append `'<model>@<dimension>': <max generation + 1>`. Never edit or reuse an
 * existing entry: the generation is what already-written ledger rows are
 * compared against, and reusing a number tells the sweep that rows embedded by a
 * DIFFERENT model are current.
 *
 * Dry-run before you deploy it. On a single appliance sharing one Ollama host
 * process with interactive chat, HBPE and the summary sidecar, re-embedding the
 * full corpus is hours of contended GPU time. Get the candidate count before you
 * get the bill.
 */
export const EMBED_MODEL_GENERATIONS: Readonly<Record<string, number>> = {
  /** v1 — the shipped default. `CI_EMBED_MODEL` unset resolves to this. */
  'nomic-embed-text@768': 1,
};

/** The key a `(model, dimension)` pair is declared under. */
function modelKey(model: string, dimension: number): string {
  return `${model}@${dimension}`;
}

/**
 * Boot-time guard on {@link EMBED_MODEL_GENERATIONS}.
 *
 * Two mistakes, both invisible until a sweep silently returns the wrong set:
 *
 *  - **a non-integer or non-positive generation** — `stage_version` is `INTEGER`
 *    in Postgres, so `1.5` truncates to 1 and the "bump" is a no-op; and
 *    `versions.ts` rejects 0 because a stage at version 0 makes rows stranded in
 *    `status='running'` unreclaimable by the staleness sweep.
 *  - **two models sharing a generation** — the whole mechanism is "a different
 *    model means a different version". Two models at the same number means
 *    switching between them re-embeds nothing, which is the original bug.
 *
 * Runs at module load: an incomplete declaration is a programming error, and the
 * earliest failure is the cheapest one.
 */
export function assertEmbedModelGenerations(
  generations: Record<string, number> = EMBED_MODEL_GENERATIONS,
): void {
  const seen = new Map<number, string>();

  for (const [key, generation] of Object.entries(generations)) {
    if (!Number.isInteger(generation) || generation < 1) {
      throw new Error(
        `EMBED_MODEL_GENERATIONS["${key}"] must be an integer >= 1, got ${String(generation)}. ` +
          `A fractional generation truncates to an integer in Postgres so the bump would be a no-op, and ` +
          `generation 0 makes rows stranded in status='running' unreclaimable by the staleness sweep.`,
      );
    }

    const clash = seen.get(generation);

    if (clash != null) {
      throw new Error(
        `EMBED_MODEL_GENERATIONS declares generation ${generation} for both "${clash}" and "${key}". ` +
          `Two models sharing a generation means switching between them re-embeds nothing — the exact ` +
          `defect deriving the version from the model exists to fix. Generations are append-only and unique.`,
      );
    }

    seen.set(generation, key);
  }
}

assertEmbedModelGenerations();

/**
 * The stage version for a `(model, dimension)` pair.
 *
 * Defaults to the live configuration, so in production this is literally "the
 * version of the model this appliance is embedding with". Both arguments are
 * overridable so a test can prove the property that matters — that changing the
 * model changes the version, and therefore re-selects every row — without
 * mutating global config.
 *
 * Throws for an undeclared pair rather than inventing a number. See
 * {@link EMBED_MODEL_GENERATIONS} for why: an invented version can go DOWN, and
 * a version that goes down permanently hides the corpus from every future sweep.
 */
export function embedStageVersion(
  model: string = config.embedding.model,
  dimension: number = EMBEDDING_DIMENSION,
  generations: Record<string, number> = EMBED_MODEL_GENERATIONS,
): number {
  const key = modelKey(model, dimension);
  const generation = generations[key];

  if (generation == null) {
    const next = Math.max(0, ...Object.values(generations)) + 1;

    throw new Error(
      `No embedding generation declared for "${key}". Refusing to embed: an undeclared model would have ` +
        `to be given an invented stage version, and a version that lands BELOW an existing one hides ` +
        `every already-embedded row from the staleness sweep forever, leaving the index a silent mix of ` +
        `two models' vectors. Add '${key}': ${next} to EMBED_MODEL_GENERATIONS in ` +
        `domains/pipeline/stages/index/embedVersion.ts (append only — never reuse or edit an existing ` +
        `generation), and expect the next sweep to re-embed the whole corpus.`,
    );
  }

  return generation;
}

/**
 * Error text that means "Ollama is not answering", as opposed to "Ollama
 * answered and refused".
 *
 * Matched on the message because the `ollama` client surfaces undici/node
 * connection failures as ordinary `Error`s with these codes embedded, and the
 * distinction is worth keeping: an unreachable host is an appliance-level
 * incident affecting every row, while a model-level rejection is about the
 * request. Both are `failed` — only the recorded reason differs, and the reason
 * is what an operator groups by.
 */
const UNREACHABLE_PATTERNS = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'fetch failed',
  'Failed to fetch',
];

export function isUnreachable(message: string): boolean {
  return UNREACHABLE_PATTERNS.some((pattern) => message.includes(pattern));
}
