/**
 * Pull the credential out of an `Authorization: Bearer <token>` header value.
 *
 * Shared by every surface that reads a bearer credential — `JwtOrApiKeyAuthGuard`
 * (Portal OIDC tokens) and `ApiKeyStrategy` (api keys) — so the three readers of that
 * one header cannot drift apart. They did: each grew its own `startsWith('Bearer ')`,
 * while the fourth reader, passport-jwt, lowercases the scheme before comparing
 * (`extract_jwt.js:54,60`). That left `authorization: bearer <jwt>` authenticating and
 * `authorization: bearer <key>` 401ing on the same request line.
 *
 * RFC 7235 §2.1 makes the scheme case-insensitive, so match it that way. The token
 * itself is compared verbatim by callers — only surrounding whitespace is stripped.
 */
const BEARER_SCHEME = 'bearer';

export function extractBearerToken(header: unknown): string | null {
  if (typeof header !== 'string') {
    return null;
  }

  const separator = header.indexOf(' ');

  if (separator === -1 || header.slice(0, separator).toLowerCase() !== BEARER_SCHEME) {
    return null;
  }

  return header.slice(separator + 1).trim() || null;
}
