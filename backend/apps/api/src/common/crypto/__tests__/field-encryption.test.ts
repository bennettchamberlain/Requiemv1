/**
 * AES-256-GCM field-level encryption backing `ConnectionEntity`/`ProviderKeyEntity`
 * (stored third-party OAuth connection secrets and provider API keys). Before this
 * file, NOTHING exercised `encrypt`/`decrypt`/`isEncrypted`/`encryptedColumnTransformer`
 * — a regression here could silently persist plaintext secrets, or make every
 * stored connection/provider key permanently undecryptable, with no test failure
 * to catch it.
 *
 * `@ci/configuration` is mocked wholesale (not `requireActual` + override) —
 * `field-encryption.ts` touches exactly one field of it
 * (`config.auth.encryption.fieldKey`), so there is nothing to gain from loading
 * the real, env-dependent config module and something to lose (it would drag in
 * zod validation of the whole app config for an unrelated unit test).
 */
// `jest.mock(...)` factories run before any module-scope `const` in this file
// is initialized, so the fieldKey is a literal here rather than a reference to
// the `VALID_KEY` constant below — they are kept equal by hand (both 64 hex
// chars: 'a1' repeated 32 times).
jest.mock('@ci/configuration', () => ({
  __esModule: true,
  default: {
    auth: {
      encryption: {
        fieldKey: 'a1'.repeat(32),
      },
    },
  },
}));

const VALID_KEY = 'a1'.repeat(32); // 64 hex chars = 256 bits — must match the mock above

import { decrypt, encrypt, encryptedColumnTransformer, isEncrypted } from '../field-encryption';

describe('encrypt / decrypt round trip', () => {
  it('decrypts back to the original plaintext', () => {
    const ciphertext = encrypt('a stored OAuth refresh token', VALID_KEY);

    expect(decrypt(ciphertext, VALID_KEY)).toBe('a stored OAuth refresh token');
  });

  it('round-trips an empty string', () => {
    const ciphertext = encrypt('', VALID_KEY);

    expect(decrypt(ciphertext, VALID_KEY)).toBe('');
  });

  it('round-trips non-ASCII content (utf8 boundaries)', () => {
    const plaintext = '🔑 clé secrète — 日本語';
    const ciphertext = encrypt(plaintext, VALID_KEY);

    expect(decrypt(ciphertext, VALID_KEY)).toBe(plaintext);
  });

  it('produces the documented `enc:v1:<iv>:<authTag>:<data>` hex format', () => {
    const ciphertext = encrypt('secret', VALID_KEY);

    expect(ciphertext.startsWith('enc:v1:')).toBe(true);

    const [ivHex, authTagHex, dataHex] = ciphertext.slice('enc:v1:'.length).split(':');
    expect(ivHex).toMatch(/^[0-9a-f]{24}$/); // 12-byte IV
    expect(authTagHex).toMatch(/^[0-9a-f]{32}$/); // 16-byte auth tag
    expect(dataHex).toMatch(/^[0-9a-f]*$/);
  });

  it('uses a fresh random IV per call, so the same plaintext never encrypts the same way twice', () => {
    const first = encrypt('same plaintext', VALID_KEY);
    const second = encrypt('same plaintext', VALID_KEY);

    expect(first).not.toBe(second);
    // ...but both still decrypt to the same value.
    expect(decrypt(first, VALID_KEY)).toBe('same plaintext');
    expect(decrypt(second, VALID_KEY)).toBe('same plaintext');
  });
});

describe('isEncrypted', () => {
  it('is true for a real ciphertext', () => {
    expect(isEncrypted(encrypt('x', VALID_KEY))).toBe(true);
  });

  it('is false for plaintext (the legacy pre-migration case)', () => {
    expect(isEncrypted('a plain OAuth token stored before the migration')).toBe(false);
  });

  it('is false for an empty string', () => {
    expect(isEncrypted('')).toBe(false);
  });
});

describe('decrypt — malformed ciphertext', () => {
  it('rejects a value missing the version prefix', () => {
    expect(() => decrypt('not-encrypted-at-all', VALID_KEY)).toThrow(/missing version prefix/i);
  });

  it('rejects a prefixed value with the wrong number of segments', () => {
    expect(() => decrypt('enc:v1:only-one-part', VALID_KEY)).toThrow(/expected iv:authTag:data/i);
    expect(() => decrypt('enc:v1:a:b:c:d', VALID_KEY)).toThrow(/expected iv:authTag:data/i);
  });
});

describe('decrypt — GCM authenticated-tamper detection', () => {
  // Splits a real ciphertext back into its hex segments so a test can corrupt
  // exactly one and re-assemble.
  function segments(ciphertext: string): { iv: string; authTag: string; data: string } {
    const [iv, authTag, data] = ciphertext.slice('enc:v1:'.length).split(':');

    return { iv, authTag, data };
  }

  function flipLastHexChar(hex: string): string {
    const last = hex.at(-1)!;
    const flipped = last === '0' ? '1' : '0';

    return hex.slice(0, -1) + flipped;
  }

  it('throws rather than silently returning garbage when the ciphertext data is corrupted', () => {
    const { iv, authTag, data } = segments(encrypt('a provider api key', VALID_KEY));
    const tampered = `enc:v1:${iv}:${authTag}:${flipLastHexChar(data)}`;

    expect(() => decrypt(tampered, VALID_KEY)).toThrow();
  });

  it('throws when the auth tag itself is corrupted', () => {
    const { iv, authTag, data } = segments(encrypt('a provider api key', VALID_KEY));
    const tampered = `enc:v1:${iv}:${flipLastHexChar(authTag)}:${data}`;

    expect(() => decrypt(tampered, VALID_KEY)).toThrow();
  });

  it('throws when the IV is corrupted (tag no longer matches the substituted IV)', () => {
    const { iv, authTag, data } = segments(encrypt('a provider api key', VALID_KEY));
    const tampered = `enc:v1:${flipLastHexChar(iv)}:${authTag}:${data}`;

    expect(() => decrypt(tampered, VALID_KEY)).toThrow();
  });
});

describe('getKeyBuffer hex-key-format validation', () => {
  // A fresh, isolated module instance per test: `field-encryption.ts` caches
  // the first successfully-parsed key in a module-level `_keyBuffer` and never
  // re-validates after that, so a shared module instance would let an earlier
  // passing test's valid key mask this validation on a later call. Isolating
  // the module guarantees `_keyBuffer` starts null for each assertion here —
  // an invalid key throws before that cache is ever populated, so several
  // invalid keys can safely share one isolated instance.
  it('rejects a key that is not a 64-character hex string', async () => {
    await jest.isolateModulesAsync(async () => {
      const { encrypt: freshEncrypt } = await import('../field-encryption');

      // Too short.
      expect(() => freshEncrypt('x', 'a1'.repeat(31))).toThrow(/must be a 64-character hex string/);
      // Too long.
      expect(() => freshEncrypt('x', `${'a1'.repeat(32)}ff`)).toThrow(/must be a 64-character hex string/);
      // Right length, non-hex characters.
      expect(() => freshEncrypt('x', 'z'.repeat(64))).toThrow(/must be a 64-character hex string/);
      // Empty.
      expect(() => freshEncrypt('x', '')).toThrow(/must be a 64-character hex string/);
    });
  });

  it('accepts a well-formed key once, in a fresh module instance', async () => {
    await jest.isolateModulesAsync(async () => {
      const { encrypt: freshEncrypt, decrypt: freshDecrypt } = await import('../field-encryption');

      const ciphertext = freshEncrypt('ok', VALID_KEY);
      expect(freshDecrypt(ciphertext, VALID_KEY)).toBe('ok');
    });
  });
});

describe('encryptedColumnTransformer', () => {
  it('passes null through unchanged in both directions', () => {
    expect(encryptedColumnTransformer.to(null)).toBeNull();
    expect(encryptedColumnTransformer.from(null)).toBeNull();
  });

  it('encrypts on write (to) and decrypts on read (from), round-tripping the original value', () => {
    const stored = encryptedColumnTransformer.to('a-provider-oauth-secret');

    expect(stored).not.toBeNull();
    expect(isEncrypted(stored as string)).toBe(true);
    expect(stored).not.toBe('a-provider-oauth-secret');

    expect(encryptedColumnTransformer.from(stored)).toBe('a-provider-oauth-secret');
  });

  it('gracefully passes through a legacy plaintext value on read (pre-migration rows)', () => {
    // A row written before the encryption migration: `from` must return it
    // verbatim rather than attempting (and failing) to decrypt it.
    expect(encryptedColumnTransformer.from('legacy-plaintext-secret')).toBe('legacy-plaintext-secret');
  });
});
