import 'package:postgres/postgres.dart';

/// pg-boss 10 schema version this package emits. Matches `pgboss.version`
/// written by pg-boss 10.3.x so the Node library can also attach.
const int pgBossSchemaVersion = 24;

/// Installs the pg-boss 10 schema into [schema] if it is not there.
///
/// DDL mirrors `plans.js#create` from pg-boss 10.3.2 (job table partitioned
/// by list on `name`, `create_queue`/`delete_queue` functions, archive).
class PgBossSchema {
  const PgBossSchema({this.schema = 'pgboss'});

  final String schema;

  Future<bool> isInstalled(Session s) async {
    final r = await s.execute(
      Sql.named(
        'select 1 from information_schema.tables '
        'where table_schema = @s and table_name = @t',
      ),
      parameters: {'s': schema, 't': 'version'},
    );
    return r.isNotEmpty;
  }

  Future<void> install(Session s) async {
    if (await isInstalled(s)) return;
    await s.execute('select pg_advisory_xact_lock(hashtext(\'$schema\'))');
    for (final stmt in _ddl) {
      await s.execute(stmt);
    }
    await s.execute(
      'insert into $schema.version (version) values ($pgBossSchemaVersion)',
    );
  }

  List<String> get _ddl => [
    'create schema if not exists $schema',
    '''
        create type $schema.job_state as enum (
          'created','retry','active','completed','cancelled','failed'
        )''',
    '''
        create table $schema.version (
          version int primary key,
          maintained_on timestamptz,
          cron_on timestamptz,
          monitored_on timestamptz
        )''',
    '''
        create table $schema.queue (
          name text,
          policy text,
          retry_limit int,
          retry_delay int,
          retry_backoff bool,
          expire_seconds int,
          retention_minutes int,
          dead_letter text references $schema.queue (name),
          partition_name text,
          created_on timestamptz not null default now(),
          updated_on timestamptz not null default now(),
          primary key (name)
        )''',
    '''
        create table $schema.schedule (
          name text references $schema.queue on delete cascade,
          cron text not null,
          timezone text,
          data jsonb,
          options jsonb,
          created_on timestamptz not null default now(),
          updated_on timestamptz not null default now(),
          primary key (name)
        )''',
    '''
        create table $schema.subscription (
          event text not null,
          name text not null references $schema.queue on delete cascade,
          created_on timestamptz not null default now(),
          updated_on timestamptz not null default now(),
          primary key (event, name)
        )''',
    '''
        create table $schema.job (
          id uuid not null default gen_random_uuid(),
          name text not null,
          priority integer not null default(0),
          data jsonb,
          state $schema.job_state not null default('created'),
          retry_limit integer not null default(2),
          retry_count integer not null default(0),
          retry_delay integer not null default(0),
          retry_backoff boolean not null default false,
          start_after timestamptz not null default now(),
          started_on timestamptz,
          singleton_key text,
          singleton_on timestamp without time zone,
          expire_in interval not null default interval '15 minutes',
          created_on timestamptz not null default now(),
          completed_on timestamptz,
          keep_until timestamptz not null default now() + interval '14 days',
          output jsonb,
          dead_letter text,
          policy text
        ) partition by list (name)''',
    'alter table $schema.job add primary key (name, id)',
    'create table $schema.archive (like $schema.job)',
    'alter table $schema.archive add primary key (name, id)',
    'alter table $schema.archive add archived_on timestamptz not null default now()',
    'create index archive_i1 on $schema.archive (archived_on)',
    _createQueueFunction,
    _deleteQueueFunction,
  ];

  String get _createQueueFunction =>
      """
    create function $schema.create_queue(queue_name text, options json)
    returns void as \$\$
    declare
      table_name varchar := 'j' || encode(sha224(queue_name::bytea), 'hex');
      queue_created_on timestamptz;
    begin
      with q as (
        insert into $schema.queue (
          name, policy, retry_limit, retry_delay, retry_backoff,
          expire_seconds, retention_minutes, dead_letter, partition_name
        ) values (
          queue_name,
          options->>'policy',
          (options->>'retryLimit')::int,
          (options->>'retryDelay')::int,
          (options->>'retryBackoff')::bool,
          (options->>'expireInSeconds')::int,
          (options->>'retentionMinutes')::int,
          options->>'deadLetter',
          table_name
        )
        on conflict do nothing
        returning created_on
      )
      select created_on into queue_created_on from q;

      if queue_created_on is null then
        return;
      end if;

      execute format('create table $schema.%I (like $schema.job including defaults)', table_name);
      execute format('alter table $schema.%I add primary key (name, id)', table_name);
      execute format('alter table $schema.%I add constraint q_fkey foreign key (name) references $schema.queue (name) on delete restrict deferrable initially deferred', table_name);
      execute format('alter table $schema.%I add constraint dlq_fkey foreign key (dead_letter) references $schema.queue (name) on delete restrict deferrable initially deferred', table_name);
      execute format('create unique index %1\$s_i1 on $schema.%1\$I (name, coalesce(singleton_key, '''')) where state = ''created'' and policy = ''short''', table_name);
      execute format('create unique index %1\$s_i2 on $schema.%1\$I (name, coalesce(singleton_key, '''')) where state = ''active'' and policy = ''singleton''', table_name);
      execute format('create unique index %1\$s_i3 on $schema.%1\$I (name, state, coalesce(singleton_key, '''')) where state <= ''active'' and policy = ''stately''', table_name);
      execute format('create unique index %1\$s_i4 on $schema.%1\$I (name, singleton_on, coalesce(singleton_key, '''')) where state <> ''cancelled'' and singleton_on is not null', table_name);
      execute format('create index %1\$s_i5 on $schema.%1\$I (name, start_after) include (priority, created_on, id) where state < ''active''', table_name);
      execute format('alter table $schema.%I add constraint cjc check (name=%L)', table_name, queue_name);
      execute format('alter table $schema.job attach partition $schema.%I for values in (%L)', table_name, queue_name);
    end;
    \$\$ language plpgsql""";

  String get _deleteQueueFunction =>
      """
    create function $schema.delete_queue(queue_name text)
    returns void as \$\$
    declare
      table_name varchar;
    begin
      with deleted as (
        delete from $schema.queue where name = queue_name returning partition_name
      )
      select partition_name from deleted into table_name;
      execute format('drop table if exists $schema.%I', table_name);
    end;
    \$\$ language plpgsql""";
}
