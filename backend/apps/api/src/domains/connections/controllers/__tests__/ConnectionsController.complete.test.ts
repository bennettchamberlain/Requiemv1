import { BadGatewayException, BadRequestException, ConflictException } from '@nestjs/common';

import type { RequestContext } from '@ci/common/context';

import type { CompleteConnectionDto } from '../../types';
import { completeConnectionSchema, ConnectionsController } from '../ConnectionsController';

/*
 * CI-Server#2676: a connection proxied through CI Portal used to be stored with the
 * provider access token the BROWSER carried back in the URL fragment. With a proxy
 * refresh token the server now fetches the access token from CI Portal over the
 * device-authenticated channel, and stores the refresh token CI Portal rotated.
 */

// `accountLabel` is set so completion does not go on to call a provider client —
// the label lookup is not what these cases are about.
const CONNECTION = {
  id: 'conn-1',
  providerId: 'prov-google',
  provider: { id: 'prov-google' },
  accountLabel: 'someone@example.com',
};

const ctx = { userId: 'user-1' } as RequestContext;

function makeController() {
  const clientFactory = { getClientByProviderId: jest.fn() };
  const cloudOAuthProxyService = { refreshAccessToken: jest.fn() };
  const connectionService = {
    findById: jest.fn().mockResolvedValue(CONNECTION),
    search: jest.fn().mockResolvedValue([]),
    remove: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(CONNECTION),
  };
  const eventService = {};
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const controller = new ConnectionsController(
    clientFactory as never,
    cloudOAuthProxyService as never,
    connectionService as never,
    eventService as never,
    logger as never,
  );

  return { controller, cloudOAuthProxyService, connectionService };
}

const proxyBody = (
  overrides: Partial<Extract<CompleteConnectionDto, { flow: 'proxy' }>> = {},
): CompleteConnectionDto => ({
  flow: 'proxy',
  state: 'conn-1',
  userProviderId: 'up-1',
  ...overrides,
});

/** The token fields the connection was stored with, from the one update that carries them. */
function storedTokens(connectionService: ReturnType<typeof makeController>['connectionService']) {
  const call = connectionService.update.mock.calls.find(([, , input]) => input && 'accessToken' in input);

  expect(call).toBeDefined();

  return call![2] as {
    accessToken: string;
    refreshToken: string | null;
    tokenExpiry: Date | null;
    active: boolean;
  };
}

describe('ConnectionsController.completeCallback — CI Portal proxy flow', () => {
  it('stores the access token CI Portal returns, not the one the browser carried', async () => {
    const { controller, cloudOAuthProxyService, connectionService } = makeController();
    cloudOAuthProxyService.refreshAccessToken.mockResolvedValue({
      access_token: 'portal-access-token',
      refresh_token: 'rotated-refresh-token',
      expires_in: 1800,
      token_type: 'Bearer',
    });
    const before = Date.now();

    await controller.completeCallback(
      ctx,
      proxyBody({
        accessToken: 'browser-access-token',
        refreshToken: 'fragment-refresh-token',
        expiresIn: 3600,
      }),
    );

    expect(cloudOAuthProxyService.refreshAccessToken).toHaveBeenCalledWith('fragment-refresh-token');

    const stored = storedTokens(connectionService);

    expect(stored.accessToken).toBe('portal-access-token');
    // CI Portal rotates the proxy refresh token on use: the one in the request is spent.
    expect(stored.refreshToken).toBe('rotated-refresh-token');
    expect(stored.active).toBe(true);
    // The expiry is CI Portal's, not the browser's `expiresIn`.
    expect(stored.tokenExpiry!.getTime()).toBeGreaterThanOrEqual(before + 1800 * 1000);
    expect(stored.tokenExpiry!.getTime()).toBeLessThan(before + 3600 * 1000);
  });

  it('completes with no access token from the browser at all', async () => {
    const { controller, cloudOAuthProxyService, connectionService } = makeController();
    cloudOAuthProxyService.refreshAccessToken.mockResolvedValue({
      access_token: 'portal-access-token',
      refresh_token: 'rotated-refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    await controller.completeCallback(ctx, proxyBody({ refreshToken: 'fragment-refresh-token' }));

    expect(storedTokens(connectionService)).toMatchObject({
      accessToken: 'portal-access-token',
      refreshToken: 'rotated-refresh-token',
      active: true,
    });
  });

  it('uses the browser access token only when there is no refresh token (Facebook, Instagram)', async () => {
    const { controller, cloudOAuthProxyService, connectionService } = makeController();

    await controller.completeCallback(
      ctx,
      proxyBody({ accessToken: 'browser-access-token', expiresIn: 3600 }),
    );

    expect(cloudOAuthProxyService.refreshAccessToken).not.toHaveBeenCalled();
    expect(storedTokens(connectionService)).toMatchObject({
      accessToken: 'browser-access-token',
      refreshToken: null,
      active: true,
    });
  });

  it('refuses a proxy completion that carries neither token', async () => {
    const { controller, cloudOAuthProxyService, connectionService } = makeController();

    await expect(controller.completeCallback(ctx, proxyBody())).rejects.toBeInstanceOf(BadRequestException);
    expect(cloudOAuthProxyService.refreshAccessToken).not.toHaveBeenCalled();
    expect(connectionService.update).not.toHaveBeenCalled();
  });

  it('refuses a duplicate account before spending the refresh token', async () => {
    const { controller, cloudOAuthProxyService, connectionService } = makeController();
    connectionService.search.mockResolvedValue([{ id: 'conn-already-there' }]);

    await expect(
      controller.completeCallback(ctx, proxyBody({ refreshToken: 'fragment-refresh-token' })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(cloudOAuthProxyService.refreshAccessToken).not.toHaveBeenCalled();
    expect(connectionService.remove).toHaveBeenCalled();
  });

  it.each([
    [
      'CI Portal refuses the refresh',
      (refresh: jest.Mock) => refresh.mockRejectedValue(new Error('No stored tokens')),
    ],
    [
      'CI Portal answers with no access token',
      (refresh: jest.Mock) => refresh.mockResolvedValue({ expires_in: 3600 }),
    ],
  ])('does not activate the connection when %s', async (_label, arrange) => {
    const { controller, cloudOAuthProxyService, connectionService } = makeController();
    arrange(cloudOAuthProxyService.refreshAccessToken);

    await expect(
      controller.completeCallback(
        ctx,
        proxyBody({ accessToken: 'browser-access-token', refreshToken: 'rt' }),
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(connectionService.update).not.toHaveBeenCalled();
  });

  it('stores no refresh token rather than the spent one when CI Portal returns none', async () => {
    const { controller, cloudOAuthProxyService, connectionService } = makeController();
    cloudOAuthProxyService.refreshAccessToken.mockResolvedValue({
      access_token: 'portal-access-token',
      expires_in: 3600,
    });

    await controller.completeCallback(ctx, proxyBody({ refreshToken: 'fragment-refresh-token' }));

    expect(storedTokens(connectionService).refreshToken).toBeNull();
  });
});

describe('completeConnectionSchema', () => {
  it('accepts a proxy completion with a refresh token and no access token', () => {
    expect(
      completeConnectionSchema.safeParse({
        flow: 'proxy',
        state: 'conn-1',
        refreshToken: 'rt',
        userProviderId: 'up-1',
      }).success,
    ).toBe(true);
  });

  it('still requires the direct flow to carry a code', () => {
    expect(completeConnectionSchema.safeParse({ flow: 'direct', state: 'conn-1' }).success).toBe(false);
  });
});
