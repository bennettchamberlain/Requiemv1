import type { UserScopedTable } from './types';

/** Tables that must never leave the server or be restored from an archive. */
export const EXCLUDED_TABLES = new Set([
  'ci.sessions',
  'ci.api_keys',
  'ci.connect_codes',
  'ci.signup_codes',
  'ci.users',
]);

export const USER_DATA_SCHEMAS = ['ci', 'ci_search', 'hbpe'] as const;

export const DISCOVER_USER_TABLES_SQL = `
  SELECT c.table_schema AS schema, c.table_name AS table, c.column_name AS user_column
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name
  WHERE c.column_name IN ('user_id', 'owner_user_id')
    AND t.table_type = 'BASE TABLE'
    AND c.table_schema = ANY($1)
  ORDER BY c.table_schema, c.table_name
`;

export function qualifiedName(table: Pick<UserScopedTable, 'schema' | 'table'>): string {
  return `${table.schema}.${table.table}`;
}

export function isExcluded(table: Pick<UserScopedTable, 'schema' | 'table'>): boolean {
  return EXCLUDED_TABLES.has(qualifiedName(table));
}
