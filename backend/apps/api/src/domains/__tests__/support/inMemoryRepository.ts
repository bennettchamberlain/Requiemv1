/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE REPOSITORY CALLS AN UPSERT MAKES, OVER A MAP.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `findOne({ where })`, `create()`, `save()` and a plain query-builder INSERT
 * (createOrUpdateNode inserts that way, so an id taken since its read fails
 * rather than being overwritten) — enough for a spec to run a
 * REAL read-modify-write service method (`GraphUtilityService.createOrUpdateNode`,
 * `createOrUpdateRelationship`) and then assert on the row it left behind,
 * instead of on the arguments a mock was called with. A mock that records
 * arguments agrees with whatever the caller sends; this one shows what a write
 * actually did to a row that already held something.
 *
 * Rows are deep-copied in and out, the way a database hands back a fresh object
 * per read: a service cannot "save" by mutating a row it read earlier, and a
 * spec cannot pass by holding a reference the service still mutates.
 *
 * `where` matches by strict equality per column. A TypeORM `FindOperator`
 * (`In(...)`, `IsNull()`) is rejected rather than silently matching nothing —
 * a service that starts using one needs a real database, not a wider fake.
 */
export class InMemoryRepository<T extends object> {
  private readonly rows = new Map<string, T>();

  constructor(private readonly primaryKey: keyof T & string) {}

  /** Insert or overwrite rows directly — fixtures, or "another writer landed here". */
  seed(...rows: T[]): void {
    for (const row of rows) {
      this.rows.set(String(row[this.primaryKey]), structuredClone(row));
    }
  }

  /** A copy of the stored row, or `undefined`. */
  get(id: string): T | undefined {
    const row = this.rows.get(id);

    return row === undefined ? undefined : structuredClone(row);
  }

  all(): T[] {
    return [...this.rows.values()].map((row) => structuredClone(row));
  }

  async findOne(options: { where: Partial<Record<keyof T, unknown>> }): Promise<T | null> {
    const conditions = Object.entries(options.where);

    for (const [column, value] of conditions) {
      if (value !== null && typeof value === 'object') {
        throw new Error(
          `InMemoryRepository.findOne: unsupported condition on ${column} — use a real database`,
        );
      }
    }

    for (const row of this.rows.values()) {
      if (conditions.every(([column, value]) => (row as Record<string, unknown>)[column] === value)) {
        return structuredClone(row);
      }
    }

    return null;
  }

  create(fields: Partial<T>): T {
    return { ...fields } as T;
  }

  async save(row: T): Promise<T> {
    this.seed(row);

    return structuredClone(row);
  }

  /** What `.into(repo.metadata.target)` reads; the fake has one table, so any value names it. */
  readonly metadata = { target: 'InMemoryRepository' };

  /**
   * The plain INSERT `createQueryBuilder().insert().into(…).values(…).execute()`,
   * and nothing else: an id already stored fails, as the primary key does,
   * instead of being overwritten the way save() would. `onConflict`,
   * `returning` and every other builder call are absent on purpose — a write
   * that needs one needs a real database.
   */
  createQueryBuilder() {
    const execute = async (values: T | T[]) => {
      const rows = Array.isArray(values) ? values : [values];

      for (const row of rows) {
        if (this.rows.has(String(row[this.primaryKey]))) {
          throw new Error(
            `InMemoryRepository: duplicate key value violates unique constraint on ${this.primaryKey}`,
          );
        }
      }

      this.seed(...rows);

      return { identifiers: [], generatedMaps: [], raw: [] };
    };

    return {
      insert: () => ({ into: () => ({ values: (values: T | T[]) => ({ execute: () => execute(values) }) }) }),
    };
  }
}
