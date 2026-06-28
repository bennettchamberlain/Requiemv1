import type { ComponentProps, MouseEvent } from 'react';

import { buildApiUrl, isNativePlatform, OIDC_NATIVE_CLIENT_FLAG, openExternalUrl } from '@ci/common';
import { Button } from '@ci/shadcn';

const OIDC_URL_PATH = '/api/authenticate/oidc';

type ButtonVariant = ComponentProps<typeof Button>['variant'];

/**
 * "Sign in with CI Portal" button. On web it's a plain anchor: the browser navigates
 * to the API, which 302s to the identity provider. On native, OAuth/OIDC must run in
 * the SYSTEM browser (not the app webview), so the click opens it externally and adds
 * `?client=native` so the backend callback returns the result via the custom URL
 * scheme (`companion://oidc/callback`) — handled by the deep-link listener in useAuth —
 * instead of setting a browser session cookie.
 */
export function OidcButton({ label, variant }: { label: string; variant?: ButtonVariant }) {
  // Web: same-origin path, anchor navigates normally (unchanged behavior).
  const webHref = buildApiUrl(OIDC_URL_PATH);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (isNativePlatform()) {
      event.preventDefault();
      const nativeHref = buildApiUrl(`${OIDC_URL_PATH}?client=${OIDC_NATIVE_CLIENT_FLAG}`);
      void openExternalUrl(nativeHref);
    }
    // Web: let the anchor navigate normally.
  };

  return (
    <Button variant={variant} className="w-full" asChild>
      <a href={webHref} onClick={handleClick}>
        {label}
      </a>
    </Button>
  );
}
