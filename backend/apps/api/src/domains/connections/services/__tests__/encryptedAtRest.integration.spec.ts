import { randomUUID } from 'node:crypto';

import { DataSource } from 'typeorm';

import type { UserServiceContext } from '@ci/common/context';
import { UserEntity } from '@ci/domains/user';

import { databaseAvailability, resolveConnection } from '../../../__tests__/support/databaseConnection';
import { ConnectionEntity } from '../../entities/ConnectionEntity';
import { ProviderEntity } from '../../entities/ProviderEntity';
import { ProviderKeyEntity } from '../../entities/ProviderKeyEntity';
import { ConnectionService } from '../ConnectionService';
import { ProviderKeyService } from '../ProviderKeyService';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * IS THE SECRET ACTUALLY ENCRYPTED ON DISK, OR JUST TRUSTED TO BE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ProviderKeyEntity.clientSecret and ConnectionEntity.accessToken/refreshToken
 * all declare `transformer: encryptedColumnTransformer` — this is the ONLY
 * thing standing between a stolen Postgres dump and every third-party
 * credential this appliance holds. A mocked repository test cannot catch a
 * dropped `transformer:` on a column (TypeORM would happily persist the
 * plaintext, and a mock's `save()` never runs a transformer at all) — the
 * audit calls this "the domain holding third-party credentials for the whole
 * platform" and flags exactly this as untested. This reads the RAW column
 * value back with a plain SQL query (bypassing the entity layer entirely) and
 * asserts it does NOT equal the plaintext the service was given, then proves
 * the service's own read path still recovers the original value.
 */

const CONNECTIONS_DATABASE_ENV = {
  urlEnvVar: 'CONNECTIONS_TEST_DATABASE_URL',
  probeTimeoutEnvVar: 'CONNECTIONS_TEST_PROBE_TIMEOUT_MS',
};

const availability = databaseAvailability(CONNECTIONS_DATABASE_ENV);
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[connections/encryptedAtRest.integration] SKIPPED — ${availability.reason}`);
}

jest.setTimeout(60_000);

describeWithDatabase(`connections domain — encrypted at rest, against a live Postgres (${availability.target})`, () => {
  let dataSource: DataSource;
  let providerKeyService: ProviderKeyService;
  let connectionService: ConnectionService;

  const userId = randomUUID();
  const providerId = randomUUID();
  const context = { userId } as UserServiceContext;

  beforeAll(async () => {
    const connection = resolveConnection(CONNECTIONS_DATABASE_ENV);

    if (connection == null) {
      throw new Error('databaseAvailability passed but no connection resolved');
    }

    dataSource = new DataSource({
      type: 'postgres',
      ...(connection.url != null
        ? { url: connection.url }
        : {
            host: connection.host,
            port: connection.port,
            username: connection.username,
            password: connection.password,
            database: connection.database,
          }),
      entities: [ProviderKeyEntity, ConnectionEntity, ProviderEntity, UserEntity],
      synchronize: false,
    });
    await dataSource.initialize();

    providerKeyService = new ProviderKeyService(dataSource.getRepository(ProviderKeyEntity));
    connectionService = new ConnectionService(dataSource.getRepository(ConnectionEntity));

    await dataSource.query('INSERT INTO ci.users (id) VALUES ($1::uuid)', [userId]);
    await dataSource.query('INSERT INTO ci.providers (id, name) VALUES ($1::uuid, $2)', [providerId, 'Test Provider']);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM ci.connections WHERE user_id = $1::uuid', [userId]);
      await dataSource.query('DELETE FROM ci.provider_keys WHERE user_id = $1::uuid', [userId]);
      await dataSource.query('DELETE FROM ci.providers WHERE id = $1::uuid', [providerId]);
      await dataSource.query('DELETE FROM ci.users WHERE id = $1::uuid', [userId]);
      await dataSource.destroy();
    }
  });

  it('ProviderKeyService.create encrypts client_secret at rest and decrypts it back on read', async () => {
    const plaintext = 'oauth-client-secret-do-not-leak';

    const created = await providerKeyService.create(context, {
      providerId,
      clientId: 'client-id-123',
      clientSecret: plaintext,
    });

    const [raw] = await dataSource.query('SELECT client_secret FROM ci.provider_keys WHERE id = $1::uuid', [
      created.id,
    ]);

    expect(raw.client_secret).not.toBe(plaintext);
    expect(raw.client_secret).toMatch(/^enc:v1:/);

    const fetched = await providerKeyService.findById(context, created.id);
    expect(fetched?.clientSecret).toBe(plaintext);
  });

  it('ConnectionService encrypts access_token and refresh_token at rest and decrypts them back on read', async () => {
    const accessPlaintext = 'access-token-do-not-leak';
    const refreshPlaintext = 'refresh-token-do-not-leak';

    const created = await connectionService.create(context, {
      providerId,
      accessToken: accessPlaintext,
    });

    const updated = await connectionService.update(context, created.id, {
      refreshToken: refreshPlaintext,
    });
    expect(updated).not.toBeNull();

    const [raw] = await dataSource.query(
      'SELECT access_token, refresh_token FROM ci.connections WHERE id = $1::uuid',
      [created.id],
    );

    expect(raw.access_token).not.toBe(accessPlaintext);
    expect(raw.access_token).toMatch(/^enc:v1:/);
    expect(raw.refresh_token).not.toBe(refreshPlaintext);
    expect(raw.refresh_token).toMatch(/^enc:v1:/);

    const fetched = await connectionService.findById(context, created.id);
    expect(fetched?.accessToken).toBe(accessPlaintext);
    expect(fetched?.refreshToken).toBe(refreshPlaintext);
  });
});
