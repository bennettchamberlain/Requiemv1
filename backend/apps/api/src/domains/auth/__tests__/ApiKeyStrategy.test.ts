import { ContextService } from '@ci/common/context';

import { ApiKeyStrategy } from '../services/ApiKeyStrategy';

/**
 * The strategy accepts a key from `x-api-key` or `Authorization: Bearer <key>`.
 *
 * The bearer form exists because most MCP clients expose only a bearer-token field and cannot send
 * a custom header, which made `/api/mcp` unreachable for them. These tests pin both forms, the
 * precedence between them, and that a malformed Authorization header is not mistaken for a key.
 */
describe('ApiKeyStrategy', () => {
  const VALID_KEY = 'a'.repeat(64);
  const USER = { id: 'user-1' };

  let apiKeyService: { validateKey: jest.Mock };
  let userService: { findById: jest.Mock };
  let strategy: ApiKeyStrategy;

  /** Minimal express-like request: `req.get()` is case-insensitive, as express is. */
  const requestWith = (headers: Record<string, string>) => {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));

    return { get: (name: string) => lower[name.toLowerCase()], headers: lower } as never;
  };

  beforeEach(() => {
    jest.spyOn(ContextService, 'set').mockImplementation(() => undefined as never);
    apiKeyService = { validateKey: jest.fn() };
    userService = { findById: jest.fn() };
    apiKeyService.validateKey.mockResolvedValue({ userId: USER.id, scopes: ['mcp'], keyId: 'key-1' });
    userService.findById.mockResolvedValue(USER);
    strategy = new ApiKeyStrategy(apiKeyService as never, userService as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('authenticates a key sent as x-api-key', async () => {
    const user = await strategy.validate(requestWith({ 'x-api-key': VALID_KEY }));

    expect(apiKeyService.validateKey).toHaveBeenCalledWith(VALID_KEY);
    expect(user).toEqual(USER);
  });

  it('authenticates a key sent as Authorization: Bearer', async () => {
    const user = await strategy.validate(requestWith({ authorization: `Bearer ${VALID_KEY}` }));

    expect(apiKeyService.validateKey).toHaveBeenCalledWith(VALID_KEY);
    expect(user).toEqual(USER);
  });

  it('prefers x-api-key when both headers are present', async () => {
    await strategy.validate(requestWith({ 'x-api-key': VALID_KEY, authorization: 'Bearer other-key' }));

    expect(apiKeyService.validateKey).toHaveBeenCalledWith(VALID_KEY);
  });

  it('exposes the key scopes and id so route scope enforcement can run', async () => {
    const req = requestWith({ authorization: `Bearer ${VALID_KEY}` });

    await strategy.validate(req);

    expect((req as unknown as { apiKeyScopes: string[] }).apiKeyScopes).toEqual(['mcp']);
    expect((req as unknown as { apiKeyId: string }).apiKeyId).toBe('key-1');
  });

  it('ignores a non-Bearer Authorization scheme', async () => {
    const user = await strategy.validate(requestWith({ authorization: `Basic ${VALID_KEY}` }));

    expect(apiKeyService.validateKey).not.toHaveBeenCalled();
    expect(user).toBeNull();
  });

  it('ignores a Bearer header with an empty token', async () => {
    const user = await strategy.validate(requestWith({ authorization: 'Bearer    ' }));

    expect(apiKeyService.validateKey).not.toHaveBeenCalled();
    expect(user).toBeNull();
  });

  it('returns null when no credential header is present', async () => {
    const user = await strategy.validate(requestWith({}));

    expect(apiKeyService.validateKey).not.toHaveBeenCalled();
    expect(user).toBeNull();
  });

  it('returns null when the key does not resolve', async () => {
    apiKeyService.validateKey.mockResolvedValue(null);

    const user = await strategy.validate(requestWith({ authorization: `Bearer ${VALID_KEY}` }));

    expect(user).toBeNull();
  });
});
