import { ContextService, SYSTEM_USER } from '@ci/common/context';

import { JwtStrategy } from '../services/JwtStrategy';

/**
 * JwtStrategy.validate is the primary Bearer-JWT authentication path for
 * every JWT-guarded route in the API (JwtOrPortalAuthGuard and friends sit on
 * top of it). Three things matter here and nowhere else:
 *
 *  - a payload that fails the `{ sub: string }` shape check must not
 *    authenticate, even if it otherwise looks plausible;
 *  - a `sub` for a user that no longer exists (e.g. a deleted account whose
 *    access token has not yet expired) must not authenticate — passport-jwt
 *    treats a `null` return as "unauthenticated", not an error;
 *  - a successful validation must publish the resolved user id onto
 *    ContextService, since downstream services (tenancy scoping, audit
 *    logging) read it from there rather than from the request.
 */
describe('JwtStrategy', () => {
  const USER = { id: 'user-1', name: 'Test User' };

  let userService: { findById: jest.Mock };
  let strategy: JwtStrategy;
  let setSpy: jest.SpyInstance;

  const req = {} as never;

  beforeEach(() => {
    setSpy = jest.spyOn(ContextService, 'set').mockImplementation(() => undefined as never);
    userService = { findById: jest.fn() };
    userService.findById.mockResolvedValue(USER);
    strategy = new JwtStrategy(userService as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('authenticates a payload with a valid sub for an existing user', async () => {
    const user = await strategy.validate(req, { sub: USER.id });

    // Looked up as the trusted system caller (this IS the authentication
    // boundary — there is no authenticated user yet to scope the lookup by).
    expect(userService.findById).toHaveBeenCalledWith({ userId: SYSTEM_USER }, USER.id);
    expect(user).toEqual(USER);
  });

  it('publishes the resolved user id onto ContextService on success', async () => {
    await strategy.validate(req, { sub: USER.id });

    expect(setSpy).toHaveBeenCalledWith({ userId: USER.id });
  });

  it('rejects a payload missing `sub` without ever looking up a user', async () => {
    const user = await strategy.validate(req, {} as never);

    expect(user).toBeNull();
    expect(userService.findById).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('rejects a payload whose `sub` is not a string', async () => {
    const user = await strategy.validate(req, { sub: 12345 } as never);

    expect(user).toBeNull();
    expect(userService.findById).not.toHaveBeenCalled();
  });

  it('returns null (not a throw) when the user in the token no longer exists', async () => {
    // A deleted account with a still-unexpired access token must not
    // authenticate as some other/no user — it must cleanly fail closed.
    userService.findById.mockResolvedValue(null);

    const user = await strategy.validate(req, { sub: 'deleted-user' });

    expect(user).toBeNull();
    expect(setSpy).not.toHaveBeenCalled();
  });
});
