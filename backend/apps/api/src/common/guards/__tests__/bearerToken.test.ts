import { extractBearerToken } from '../bearerToken';

/**
 * Both inbound bearer readers — `JwtOrApiKeyAuthGuard` (Portal OIDC) and `ApiKeyStrategy` (api
 * keys) — parse the header through this one function, and neither guard has a unit test of its own.
 * Pin the parse here so a change to it cannot silently alter what either credential path accepts.
 */
describe('extractBearerToken', () => {
  const TOKEN = 'a'.repeat(64);

  it.each([
    ['canonical scheme', `Bearer ${TOKEN}`],
    ['lowercase scheme (RFC 7235 §2.1)', `bearer ${TOKEN}`],
    ['upper-case scheme', `BEARER ${TOKEN}`],
    ['mixed-case scheme', `BeArEr ${TOKEN}`],
    ['padded token', `Bearer   ${TOKEN}  `],
  ])('extracts the token from a %s', (_label, header) => {
    expect(extractBearerToken(header)).toBe(TOKEN);
  });

  it.each([
    ['a different scheme', `Basic ${TOKEN}`],
    ['a scheme that merely starts with bearer', `Bearerish ${TOKEN}`],
    ['the scheme alone', 'Bearer'],
    ['an empty token', 'Bearer    '],
    ['an empty string', ''],
    ['a leading space', ` Bearer ${TOKEN}`],
  ])('returns null for %s', (_label, header) => {
    expect(extractBearerToken(header)).toBeNull();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    // JwtOrApiKeyAuthGuard reads `request?.headers?.authorization` off an `unknown`-typed bag (the
    // request may come from the GraphQL context, not an express one), so the string check — not the
    // type system — is what keeps a non-string from reaching a verifier.
    ['an array', [`Bearer ${TOKEN}`]],
    ['a number', 42],
  ])('returns null for a non-string header (%s)', (_label, header) => {
    expect(extractBearerToken(header)).toBeNull();
  });

  it('does not alter the token itself', () => {
    // Only surrounding whitespace is stripped — case and inner punctuation reach the verifier
    // verbatim, so a JWT's dots and a key's hex both survive.
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl';

    expect(extractBearerToken(`Bearer ${jwt}`)).toBe(jwt);
  });
});
