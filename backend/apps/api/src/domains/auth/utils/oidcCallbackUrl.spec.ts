import { resolveOidcCallbackUrl } from './oidcCallbackUrl';

const CALLBACK_PATH = '/api/authenticate/oidc/callback';

describe('resolveOidcCallbackUrl', () => {
  const localhostRequest = {
    host: 'ci-memory-core-2-hanz-corp.localhost',
    secure: false,
  };

  it('prefers the public base URL over the inbound request host', () => {
    expect(
      resolveOidcCallbackUrl(
        localhostRequest,
        'https://ci-memory-core-2-hanz-corp.companionintelligence.com',
      ),
    ).toBe(`https://ci-memory-core-2-hanz-corp.companionintelligence.com${CALLBACK_PATH}`);
  });

  it('strips trailing slashes and whitespace from the public base URL', () => {
    expect(resolveOidcCallbackUrl(localhostRequest, '  https://app.example.com//  ')).toBe(
      `https://app.example.com${CALLBACK_PATH}`,
    );
  });

  it('falls back to the request origin when no public base URL is configured', () => {
    expect(resolveOidcCallbackUrl(localhostRequest, '')).toBe(
      `http://ci-memory-core-2-hanz-corp.localhost${CALLBACK_PATH}`,
    );
    expect(resolveOidcCallbackUrl(localhostRequest, undefined)).toBe(
      `http://ci-memory-core-2-hanz-corp.localhost${CALLBACK_PATH}`,
    );
    expect(resolveOidcCallbackUrl(localhostRequest, '   ')).toBe(
      `http://ci-memory-core-2-hanz-corp.localhost${CALLBACK_PATH}`,
    );
  });

  it('honours forwarded proto/host from the reverse proxy in the fallback path', () => {
    expect(
      resolveOidcCallbackUrl({
        forwardedProto: 'https',
        forwardedHost: 'app.example.com',
        host: 'internal:3000',
        secure: false,
      }),
    ).toBe(`https://app.example.com${CALLBACK_PATH}`);
  });

  it('takes the first hop from comma-separated forwarded headers', () => {
    expect(
      resolveOidcCallbackUrl({
        forwardedProto: 'https, http',
        forwardedHost: 'app.example.com, internal:3000',
        secure: false,
      }),
    ).toBe(`https://app.example.com${CALLBACK_PATH}`);
  });

  it('takes the first entry from array-valued forwarded headers', () => {
    expect(
      resolveOidcCallbackUrl({
        forwardedProto: ['https', 'http'],
        forwardedHost: ['app.example.com', 'internal:3000'],
        secure: false,
      }),
    ).toBe(`https://app.example.com${CALLBACK_PATH}`);
  });

  it('uses https in the fallback path when the connection is secure', () => {
    expect(resolveOidcCallbackUrl({ host: 'app.example.com', secure: true })).toBe(
      `https://app.example.com${CALLBACK_PATH}`,
    );
  });

  it('defaults the host to localhost when none is available', () => {
    expect(resolveOidcCallbackUrl({ secure: false })).toBe(`http://localhost${CALLBACK_PATH}`);
  });
});
