/*
 * `ci_import.staged_entities` in memory, for parser tests that have to go
 * through the REAL `StagedWriter` rather than assume what it keeps.
 *
 * The writer persists an entity's resolved type, its name, its `metadata` and
 * ONE identity handle. `attributes` never reach the row. So a test that hands a
 * parser's entity straight to `toGraphEntity` proves nothing about what
 * survives staging, and staging is exactly where a contact's other emails and
 * phones used to vanish. Pushing through the writer into this store does prove
 * it, including what a second sighting of the same key grows (`accumulate`).
 *
 * Models ONE run, and the two partial unique indexes the writer's ON CONFLICT
 * clauses name: `(run_id, identity_key)` and `(run_id, dedupe_key)`. Columns are
 * read by NAME from each INSERT's own column list, so a column added to the
 * statement lands on the row instead of shifting every value into the wrong
 * field. Any statement it does not model throws — items and relationships
 * included, so this is for parsers that emit bare entities.
 */
import type { StagedEntity } from '../../../entities/StagedEntityEntity';
import { StagedWriter } from '../../../staging/StagedWriter';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const INSERT = /INSERT INTO ci_import\.staged_entities\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/;
const PLACEHOLDER = /^\$(\d+)(::(\w+))?/;

type Row = Record<string, unknown> & { id: string; metadata: Record<string, unknown> };

/** `identity_key` → `identityKey`: the column's name on {@link StagedEntity}. */
function camelCase(column: string): string {
  return column.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/** The bound value one VALUES entry stands for: `$5::jsonb` parsed, `NULL` null. */
function boundValue(expression: string, params: unknown[]): unknown {
  const placeholder = PLACEHOLDER.exec(expression);

  if (placeholder == null) {
    if (/^null$/i.test(expression)) {
      return null;
    }

    throw new Error(`stagedEntityStore cannot read VALUES entry ${expression}`);
  }

  const value = params[Number(placeholder[1]) - 1];

  return placeholder[3] === 'jsonb' && typeof value === 'string' ? JSON.parse(value) : value;
}

export interface StagedEntityStore {
  /** The pipeline to hand a parser as `params.pipeline`. Await `settled()` before reading. */
  writer: StagedWriter;
  /** Every staged row, as the push stage would read it back. */
  staged: () => StagedEntity[];
}

export function stagedEntityStore(dataSource: string): StagedEntityStore {
  const rows: Row[] = [];

  const query = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    const insert = INSERT.exec(sql);

    if (insert) {
      const columns = insert[1].split(',').map((column) => column.trim());
      const values = insert[2].split(',').map((value) => value.trim());
      const row: Row = { id: `staged-entity-${rows.length + 1}`, metadata: {} };

      columns.forEach((column, index) => {
        row[camelCase(column)] = boundValue(values[index], params);
      });

      const clash = rows.find(
        (other) =>
          (row.identityKey != null && other.identityKey === row.identityKey) ||
          (row.dedupeKey != null && other.dedupeKey === row.dedupeKey),
      );

      if (clash) {
        return []; // ON CONFLICT ... DO NOTHING
      }

      rows.push({ ...row, graphDirty: false });

      return [{ id: row.id, metadata: row.metadata }];
    }

    const keyed = /WHERE run_id = \$1::uuid AND (identity_key|dedupe_key) = \$2/.exec(sql);

    if (sql.includes('SELECT id, metadata FROM ci_import.staged_entities') && keyed) {
      const column = camelCase(keyed[1]);

      return rows.filter((row) => row[column] === params[1]).map(({ id, metadata }) => ({ id, metadata }));
    }

    if (sql.includes('SELECT metadata FROM ci_import.staged_entities WHERE id = $1::uuid')) {
      return rows.filter((row) => row.id === params[0]).map(({ metadata }) => ({ metadata }));
    }

    if (sql.includes('UPDATE ci_import.staged_entities') && sql.includes('SET metadata = $2::jsonb')) {
      const row = rows.find((candidate) => candidate.id === params[0]);

      if (row) {
        row.metadata = JSON.parse(params[1] as string);
        row.graphDirty = true;
      }

      return [];
    }

    throw new Error(`stagedEntityStore does not model: ${sql.trim().slice(0, 80)}`);
  };

  const manager = {
    query,
    transaction: async <T>(work: (tx: { query: typeof query }) => Promise<T>): Promise<T> => work({ query }),
  };

  return {
    writer: new StagedWriter(manager as never, { userId: USER_ID, runId: RUN_ID, dataSource }),
    staged: () =>
      rows.map(
        (row) =>
          ({
            dedupeKey: null,
            pushStatus: 'pending',
            pushError: null,
            pushedAt: null,
            createdAt: new Date(0),
            ...row,
          }) as unknown as StagedEntity,
      ),
  };
}
