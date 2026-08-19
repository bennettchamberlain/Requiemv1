import { renderSignupConfirmPage, type SignupConfirmParams } from '../utils/signupConfirmPage';

/**
 * `renderSignupConfirmPage` had NO test coverage at all before this file. Like
 * the app-connect consent page, it runs under a strict, nonce-only CSP
 * specifically because it interpolates values that are not hard-coded:
 * `email` and `name` come from the OIDC provider's userinfo response
 * (OidcController.callback), and `csrfToken`/`cancelUrl` are request-derived.
 * These tests pin both what the page shows and — the thing that actually
 * matters on a CSP-hardened page — that every interpolated field is
 * HTML-escaped, so a provider-supplied email containing markup cannot inject
 * into the page.
 */
function render(overrides: Partial<SignupConfirmParams> = {}): string {
  const params: SignupConfirmParams = {
    email: 'new@example.com',
    csrfToken: 'csrf-token',
    cancelUrl: '/login',
    nonce: 'test-nonce',
    ...overrides,
  };

  return renderSignupConfirmPage(params);
}

describe('renderSignupConfirmPage', () => {
  it('shows the signed-in email and the create-account form', () => {
    const html = render({ email: 'jsmith@example.com' });

    expect(html).toContain('<!--email_off-->jsmith@example.com<!--/email_off-->');
    expect(html).toContain('<form method="POST" action="/api/authenticate/oidc/confirm-account">');
    expect(html).toContain('<button class="btn primary" type="submit">Create account</button>');
  });

  it('points "Cancel" at the given cancelUrl', () => {
    const html = render({ cancelUrl: '/login?error=signup_expired' });

    expect(html).toContain('<a class="btn secondary" href="/login?error=signup_expired">Cancel</a>');
  });

  it('embeds the csrf token as a hidden field, and omits csrf_retry by default', () => {
    const html = render({ csrfToken: 'the-csrf-token' });

    expect(html).toContain('<input type="hidden" name="csrf" value="the-csrf-token" />');
    expect(html).not.toContain('name="csrf_retry"');
  });

  it('adds the csrf_retry hidden field on the one-shot self-heal retry', () => {
    const html = render({ csrfRetry: true });

    expect(html).toContain('<input type="hidden" name="csrf_retry" value="1" />');
  });

  it('stamps the CSP nonce onto the inline <style>', () => {
    const html = render({ nonce: 'abc123nonce' });

    expect(html).toContain('<style nonce="abc123nonce">');
  });
});

/**
 * This page runs under a strict, nonce-only CSP precisely because it renders
 * values that are not hard-coded — the OIDC-verified email in particular
 * comes straight from the provider's userinfo response. A regression that
 * stopped escaping any of these fields would enable HTML/attribute injection.
 */
describe('renderSignupConfirmPage HTML escaping', () => {
  // Covers all five characters escapeHtml() rewrites: & < > " '
  const RAW = `<script>alert('pwned')</script>&"quote`;
  const ESCAPED = '&lt;script&gt;alert(&#39;pwned&#39;)&lt;/script&gt;&amp;&quot;quote';

  it('escapes the email in the "signed in as" line', () => {
    const html = render({ email: RAW });

    expect(html).not.toContain(RAW);
    expect(html).toContain(`<!--email_off-->${ESCAPED}<!--/email_off-->`);
  });

  it('escapes the csrf token in the hidden csrf field', () => {
    const html = render({ csrfToken: RAW });

    expect(html).not.toContain(RAW);
    expect(html).toContain(`<input type="hidden" name="csrf" value="${ESCAPED}" />`);
  });

  it('escapes cancelUrl in the "Cancel" link href', () => {
    const html = render({ cancelUrl: `/login?next=${RAW}` });

    expect(html).not.toContain(RAW);
    expect(html).toContain(`<a class="btn secondary" href="/login?next=${ESCAPED}">Cancel</a>`);
  });
});
