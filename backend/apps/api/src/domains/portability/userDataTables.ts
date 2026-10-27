import type { UserColumn, UserScopedTable } from './types';

/**
 * Tables that must never leave the server or be restored from an archive.
 *
 * Discovery is catalog-driven (every table with a `user_id` or `owner_user_id`),
 * so a new table of memory data is carried by export and import the day it is
 * created. The price is that a new table of AUTHORITY is carried too, and an
 * import writes every column but the owner straight from the archive. Each
 * entry here is a row that grants access, trusts someone, or makes the server
 * act, which only its own screen (and that screen's checks) may create:
 *
 * - credentials: sessions, api keys, connect and signup codes, the account row;
 * - `ci.federated_identities`: an (issuer, subject) bound here signs that
 *   identity into this account on its next CI-Portal or OIDC sign-in;
 * - `ci.mcp_server_configs`: a stdio config is a command the server runs, which
 *   Settings > MCP servers reserves for an administrator;
 * - `ci.peer_links`, `ci.ask_grants`, `ci.household_tiers`: who may ask this
 *   account what, and at which tier;
 * - `ci.push_subscriptions`: an outside URL the server posts notifications to,
 *   bound to one browser and this appliance's push keys;
 * - `ci.pending_actions`: queued tool calls that run as the owner on approval;
 * - `ci.pipeline_dead_letters`: a replay puts the stored event name and payload
 *   back on the job bus verbatim, and the listeners act for whichever account
 *   or record the payload names, so an archive could queue work against
 *   another account's data;
 * - `ci.account_purges`: the record of an account the purge already destroyed.
 */
export const EXCLUDED_TABLES = new Set([
  'ci.sessions',
  'ci.api_keys',
  'ci.connect_codes',
  'ci.signup_codes',
  'ci.users',
  'ci.federated_identities',
  'ci.mcp_server_configs',
  'ci.peer_links',
  'ci.ask_grants',
  'ci.household_tiers',
  'ci.push_subscriptions',
  'ci.pending_actions',
  'ci.pipeline_dead_letters',
  'ci.account_purges',
]);

export const USER_DATA_SCHEMAS = ['ci', 'ci_search', 'hbpe'] as const;

/**
 * One row per (table, user-scoping column) — a table carrying BOTH `user_id`
 * and `owner_user_id` yields two rows, which {@link groupUserTables} folds into
 * one table. Each row also carries the table's full column list (`columns`, in
 * ordinal order): the import path checks every archive row's keys against it
 * before they are interpolated into an INSERT as identifiers. Without that
 * check the column list was built from whatever keys the archive named, which
 * turned the import into an arbitrary-SQL primitive for any signed-in user.
 */
export const DISCOVER_USER_TABLES_SQL = `
  SELECT c.table_schema AS schema,
         c.table_name AS table,
         c.column_name AS user_column,
         (
           SELECT array_agg(cc.column_name::text ORDER BY cc.ordinal_position)
             FROM information_schema.columns cc
            WHERE cc.table_schema = c.table_schema
              AND cc.table_name = c.table_name
         ) AS columns,
         (
           SELECT array_agg(cc.column_name::text ORDER BY cc.ordinal_position)
             FROM information_schema.columns cc
            WHERE cc.table_schema = c.table_schema
              AND cc.table_name = c.table_name
              AND cc.is_generated = 'ALWAYS'
         ) AS generated,
         (
           SELECT array_agg(DISTINCT pn.nspname || '.' || p.relname)
             FROM pg_constraint k
             JOIN pg_class p ON p.oid = k.confrelid
             JOIN pg_namespace pn ON pn.oid = p.relnamespace
            WHERE k.contype = 'f'
              AND k.conrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
              AND k.confrelid <> k.conrelid
              AND NOT k.condeferred
         ) AS parents,
         (
           SELECT json_agg(json_build_object('column', ca.attname, 'key', pa.attname))
             FROM pg_constraint k
             JOIN pg_attribute ca ON ca.attrelid = k.conrelid AND ca.attnum = k.conkey[1]
             JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1]
            WHERE k.contype = 'f'
              AND k.conrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
              AND k.confrelid = k.conrelid
              AND cardinality(k.conkey) = 1
              AND NOT k.condeferred
              AND NOT ca.attnotnull
         ) AS self_references,
         (
           SELECT json_agg(json_build_object('column', ca.attname, 'parent', pn.nspname || '.' || p.relname, 'key', pa.attname))
             FROM pg_constraint k
             JOIN pg_class p ON p.oid = k.confrelid
             JOIN pg_namespace pn ON pn.oid = p.relnamespace
             JOIN pg_attribute ca ON ca.attrelid = k.conrelid AND ca.attnum = k.conkey[1]
             JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1]
            WHERE k.contype = 'f'
              AND k.conrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
              AND k.confrelid <> k.conrelid
              AND cardinality(k.conkey) = 1
              AND NOT k.condeferred
              AND NOT ca.attnotnull
         ) AS nullable_references,
         (
           SELECT a.attname::text
             FROM pg_index i
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
            WHERE i.indrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
              AND i.indisprimary
              AND i.indnkeyatts = 1
         ) AS primary_key
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name
  WHERE c.column_name IN ('user_id', 'owner_user_id')
    AND t.table_type = 'BASE TABLE'
    AND c.table_schema = ANY($1)
  ORDER BY c.table_schema, c.table_name
`;

/**
 * Quote a SQL identifier the way Postgres requires: wrapped in double quotes
 * with any embedded double quote doubled. Every identifier this domain
 * interpolates comes from the catalog (schema, table, column names discovered
 * above), so a stray quote should be impossible — this is the belt to the
 * column allowlist's braces, so a catalog name that ever did carry one could
 * not break out of the identifier position.
 */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function qualifiedName(table: Pick<UserScopedTable, 'schema' | 'table'>): string {
  return `${table.schema}.${table.table}`;
}

/** {@link qualifiedName} with each part through {@link quoteIdentifier}, for SQL. */
export function quotedTableName(table: Pick<UserScopedTable, 'schema' | 'table'>): string {
  return `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.table)}`;
}

export function isExcluded(table: Pick<UserScopedTable, 'schema' | 'table'>): boolean {
  return EXCLUDED_TABLES.has(qualifiedName(table));
}

/** One row of {@link DISCOVER_USER_TABLES_SQL}. */
export interface DiscoveredUserColumn {
  schema: string;
  table: string;
  user_column: string;
  columns?: string[] | null;
  /** Columns the database computes; see {@link UserScopedTable.generatedColumns}. */
  generated?: string[] | null;
  /** Tables this one references through a foreign key that is checked at once (not deferred). */
  parents?: string[] | null;
  /** This table's own nullable columns that reference another of its rows; see {@link UserScopedTable.selfReferences}. */
  self_references?: Array<{ column: string; key: string }> | null;
  /** Nullable, single-column, checked-at-once foreign keys into other tables; input to {@link UserScopedTable.laterReferences}. */
  nullable_references?: Array<{ column: string; parent: string; key: string }> | null;
  /** The table's primary key when it is one column. */
  primary_key?: string | null;
}

/**
 * Fold discovery's one-row-per-(table, user column) output into one entry per
 * table, minus {@link EXCLUDED_TABLES}, with every table after the tables it
 * references (see {@link orderParentsFirst}) and otherwise in discovery order.
 *
 * Five tables carry both columns (`ci.objects`, `ci.receipts`,
 * `ci.receipt_line_items`, `ci.object_observations`, `ci.product_models`).
 * Treated as two tables, export and the pre-import delete each ran once per
 * column, so they also reached rows whose `user_id` is another account's, and
 * the import set only ONE of the two columns to the importer: the stream path
 * kept whichever entry a `Map` saw last, and the JSON path inserted each row
 * twice. The other column came from the archive, so an import could put rows
 * into someone else's account.
 *
 * Grouped, each table has one owning column ({@link UserScopedTable.userColumn}:
 * `user_id` where the table has it, since `owner_user_id` there is an
 * attribution that the schema nulls on delete) and the full list of user
 * columns, every one of which the import sets to the importer.
 */
export function groupUserTables(rows: readonly DiscoveredUserColumn[]): UserScopedTable[] {
  const byName = new Map<string, UserScopedTable>();
  const parents = new Map<string, string[]>();
  const nullableReferences = new Map<string, Array<{ column: string; parent: string; key: string }>>();

  for (const row of rows) {
    if (isExcluded(row)) {
      continue;
    }

    if (Array.isArray(row.parents)) {
      parents.set(qualifiedName(row), row.parents);
    }

    if (Array.isArray(row.nullable_references)) {
      nullableReferences.set(qualifiedName(row), row.nullable_references);
    }

    const column = row.user_column as UserColumn;
    const existing = byName.get(qualifiedName(row));

    if (existing) {
      if (!existing.userColumns.includes(column)) {
        existing.userColumns = [...existing.userColumns, column];
      }

      if (column === 'user_id') {
        existing.userColumn = 'user_id';
      }

      continue;
    }

    byName.set(qualifiedName(row), {
      schema: row.schema,
      table: row.table,
      userColumn: column,
      userColumns: [column],
      // Fail closed: a row without a column list can accept no imported rows.
      columns: Array.isArray(row.columns) ? row.columns : [],
      generatedColumns: Array.isArray(row.generated) ? row.generated : [],
      selfReferences: Array.isArray(row.self_references) ? row.self_references : [],
      laterReferences: [],
      primaryKey: row.primary_key ?? null,
    });
  }

  const ordered = orderParentsFirst([...byName.values()], parents);
  const position = new Map(ordered.map((table, index) => [qualifiedName(table), index]));

  // Only a cycle leaves a table ahead of one it references (see
  // orderParentsFirst); those references are the ones the import sets late.
  ordered.forEach((table, index) => {
    table.laterReferences = (nullableReferences.get(qualifiedName(table)) ?? []).flatMap(
      ({ column, parent, key }) => {
        const at = position.get(parent);

        if (at === undefined || at <= index) {
          return [];
        }

        const { schema, table: name, userColumn } = ordered[at];

        return [{ column, parent: { schema, table: name, key, userColumn } }];
      },
    );
  });

  return ordered;
}

/**
 * Put every table after the tables it references, keeping discovery order
 * wherever the foreign keys leave a choice.
 *
 * Export writes tables in this order and import inserts rows in the order the
 * archive gives them (and deletes in the reverse). Import can only switch
 * foreign-key checks off with `session_replication_role`, which the app's role
 * may not set, so a child written before its parent failed the whole import:
 * alphabetically `ci.messages` comes before `ci.threads`, and
 * `ci_search.mobile_search_documents` before `ci_search.vectors`. Deferred
 * constraints are checked at commit and do not count.
 *
 * A cycle falls back to discovery order for the tables in it, and only for
 * them: `ci.objects` and `ci.receipt_line_items` point at each other, and
 * `ci.object_observations`, which sorts first, points at `ci.objects` without
 * being part of the cycle, so it still waits for `ci.objects`. The reference
 * that then points forward (`ci.objects.acquisition_line_item_id`) is set
 * once every row is in; see {@link UserScopedTable.laterReferences}.
 */
export function orderParentsFirst(
  tables: readonly UserScopedTable[],
  parents: ReadonlyMap<string, readonly string[]>,
): UserScopedTable[] {
  const names = new Set(tables.map(qualifiedName));
  const placed = new Set<string>();
  const ordered: UserScopedTable[] = [];
  const pending = [...tables];
  const waitsOn = (name: string) =>
    (parents.get(name) ?? []).filter((parent) => names.has(parent) && !placed.has(parent));

  while (pending.length > 0) {
    let ready = pending.findIndex((table) => waitsOn(qualifiedName(table)).length === 0);

    if (ready === -1) {
      // Every table left waits on another table left. Follow the waits from the
      // first one until a table repeats: that table is on a cycle.
      const walked: string[] = [];
      let current = qualifiedName(pending[0]);

      while (!walked.includes(current)) {
        walked.push(current);
        current = waitsOn(current)[0];
      }

      const cycle = new Set(walked.slice(walked.indexOf(current)));
      ready = pending.findIndex((table) => cycle.has(qualifiedName(table)));
    }

    const [next] = pending.splice(ready, 1);

    ordered.push(next);
    placed.add(qualifiedName(next));
  }

  return ordered;
}

/**
 * Every single-column foreign key out of a table in {@link USER_DATA_SCHEMAS}.
 * Input to {@link findLinkTables}.
 */
export const DISCOVER_LINK_REFERENCES_SQL = `
  SELECT cn.nspname AS schema,
         c.relname AS table,
         ca.attname AS column,
         pn.nspname AS parent_schema,
         p.relname AS parent_table,
         pa.attname AS parent_column,
         k.confdeltype AS delete_action
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace cn ON cn.oid = c.relnamespace
    JOIN pg_class p ON p.oid = k.confrelid
    JOIN pg_namespace pn ON pn.oid = p.relnamespace
    JOIN pg_attribute ca ON ca.attrelid = k.conrelid AND ca.attnum = k.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1]
   WHERE k.contype = 'f'
     AND cardinality(k.conkey) = 1
     AND cn.nspname = ANY($1)
   ORDER BY 1, 2, 3
`;

/**
 * The columns an INSERT may name on one table: everything but
 * `GENERATED ALWAYS` and `IDENTITY ALWAYS` columns, which the database fills.
 */
export const DISCOVER_INSERTABLE_COLUMNS_SQL = `
  SELECT a.attname AS column
    FROM pg_attribute a
   WHERE a.attrelid = format('%I.%I', $1::text, $2::text)::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND a.attgenerated = ''
     AND a.attidentity <> 'a'
   ORDER BY a.attnum
`;

export interface DiscoveredLinkReference {
  schema: string;
  table: string;
  column: string;
  parent_schema: string;
  parent_table: string;
  parent_column: string;
  delete_action: string;
}

/**
 * A table with no user column whose rows hang off the account's rows. Some
 * refuse the import's delete (NO ACTION): `ci_search.entity_tag` (a tag on an
 * entity), `hbpe.l1_event_cluster` and `hbpe.l2_content_cluster` (HBPE's
 * cluster of an event or a piece of content). Others go with it by cascade:
 * `ci.message_files` (a chat message's attachments), `ci.task_dependencies`,
 * the search tags' categories and directions. An archive carries none of
 * them, so the import sets them aside first and puts back the ones whose rows
 * came back.
 */
export interface LinkTable {
  schema: string;
  table: string;
  /** Every foreign key out of the table. `userColumn` is set when the parent is one of the account's tables. */
  references: ReadonlyArray<{
    column: string;
    parent: { schema: string; table: string; column: string; userColumn: string | null };
  }>;
}

/**
 * The {@link LinkTable}s among the foreign keys discovery found: tables that
 * are not the account's own (no user column), not `ci.users`, and that hold a
 * NO ACTION, RESTRICT or CASCADE key into one of `userTables`. A SET NULL key
 * only mentions the account's row, and that row survives the delete.
 */
export function findLinkTables(
  references: readonly DiscoveredLinkReference[],
  userTables: readonly UserScopedTable[],
): LinkTable[] {
  const userColumnOf = new Map(userTables.map((table) => [qualifiedName(table), table.userColumn]));
  const byTable = new Map<string, LinkTable & { hangsOff: boolean }>();

  for (const reference of references) {
    const name = qualifiedName(reference);

    if (userColumnOf.has(name) || name === 'ci.users' || isExcluded(reference)) {
      continue;
    }

    const parentName = `${reference.parent_schema}.${reference.parent_table}`;
    const userColumn = userColumnOf.get(parentName) ?? null;
    const entry =
      byTable.get(name) ??
      ({ schema: reference.schema, table: reference.table, references: [], hangsOff: false } as LinkTable & {
        hangsOff: boolean;
      });

    (entry.references as LinkTable['references'][number][]).push({
      column: reference.column,
      parent: {
        schema: reference.parent_schema,
        table: reference.parent_table,
        column: reference.parent_column,
        userColumn,
      },
    });
    entry.hangsOff ||= userColumn !== null && ['a', 'r', 'c'].includes(reference.delete_action);
    byTable.set(name, entry);
  }

  return [...byTable.values()]
    .filter((entry) => entry.hangsOff)
    .map(({ hangsOff: _hangsOff, ...table }) => table);
}
