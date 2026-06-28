import { apiKeyHeaders, getApiKey, setApiKey } from '@ci/common/src/utils/apiAuth';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  setApiKey(null);
});

describe('apiAuth — native API key header', () => {
  it('defaults to no key and emits no header', () => {
    expect(getApiKey()).toBeNull();
    expect(apiKeyHeaders()).toEqual({});
  });

  it('emits the x-api-key header once a key is set', () => {
    setApiKey('key-123');

    expect(getApiKey()).toBe('key-123');
    expect(apiKeyHeaders()).toEqual({ 'x-api-key': 'key-123' });
  });

  it('treats an empty string as no key', () => {
    setApiKey('');

    expect(getApiKey()).toBeNull();
    expect(apiKeyHeaders()).toEqual({});
  });

  it('clears the key with null', () => {
    setApiKey('key-123');
    setApiKey(null);

    expect(getApiKey()).toBeNull();
    expect(apiKeyHeaders()).toEqual({});
  });
});
