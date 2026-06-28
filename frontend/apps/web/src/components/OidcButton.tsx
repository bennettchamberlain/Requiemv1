import type { ComponentProps, MouseEvent } from 'react';

import { buildApiUrl, isNativePlatform, openExternalUrl } from '@ci/common';
import { Button } from '@ci/shadcn';

const OIDC_URL_PATH = '/api/authenticate/oidc';

type ButtonVariant = ComponentProps<typeof Button>['variant'];

/**
 * "Sign in with CI Portal" button. On web it's a plain anchor: the browser navigates
 * to the API, which 302s to the identity provider. On native, OAuth/OIDC must run in
 * the SYSTEM browser (not the app webview), so the click opens it externally.
 *
 * NOTE: completing the loop on native still needs the IdP to redirect back into the
 * app via a deep link (custom URL scheme) handled by @capacitor/app — that wiring is
 * a follow-up. Email/password sign-in is the supported native path today.
 */
export function OidcButton({ label, variant }: { label: string; variant?: ButtonVariant }) {
  const href = buildApiUrl(OIDC_URL_PATH);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (isNativePlatform()) {
      event.preventDefault();
      void openExternalUrl(href);
    }
    // Web: let the anchor navigate normally.
  };

  return (
    <Button variant={variant} className="w-full" asChild>
      <a href={href} onClick={handleClick}>
        {label}
      </a>
    </Button>
  );
}
