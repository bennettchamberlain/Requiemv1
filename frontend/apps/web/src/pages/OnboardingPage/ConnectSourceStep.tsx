import { useState } from 'react';

import { useQuery } from '@apollo/client';
import { ExternalLink } from '@ci/shadcn/icons';

import { BrandPrimaryButton } from '@/components/BrandPrimaryButton/BrandPrimaryButton';
import { ProviderConnectDialog } from '@/components/connect/ProviderConnectDialog';
import {
  GET_CONNECTIONS_LIGHT,
  ServiceIntegrationsSection,
} from '@/components/connect/ServiceIntegrationsSection';
import { Card } from '@/pages/ConnectPage/Card';

import { CHROME_EXTENSION_URL, CI_DOWNLOAD_URL, IMPORT_TOOLS_URL } from './constants';

export function ConnectSourceStep() {
  const [dialogProviderId, setDialogProviderId] = useState<string | null>(null);
  const { data, refetch } = useQuery(GET_CONNECTIONS_LIGHT, { fetchPolicy: 'cache-and-network' });

  const connections =
    data?.connections?.edges?.map(
      (edge: { node: { id: string; name: string | null; active: boolean; needsReauth: boolean } }) => edge.node,
    ) ?? [];

  const openDownload = () => window.open(CI_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');

  return (
    <div className="space-y-6 py-6 w-full mx-auto">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Connect a source</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Pull your email and calendar in automatically.
        </p>
      </div>

      {connections.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3 max-w-2xl mx-auto w-full">
          <p className="text-xs font-semibold text-foreground">Connected sources</p>
          {connections.map((c: { id: string; name: string | null; active: boolean; needsReauth: boolean }) => (
            <div
              key={c.id}
              className="flex items-center justify-between text-xs rounded-md border border-border px-2 py-1.5"
            >
              <span className="text-foreground truncate">{c.name ?? 'Connection'}</span>
              <span className="text-muted-foreground">
                {c.needsReauth ? 'Needs reauth' : c.active ? 'Connected' : 'Inactive'}
              </span>
            </div>
          ))}
        </div>
      )}

      <ServiceIntegrationsSection
        variant="onboarding"
        disabledWhenConnected
        onProviderSelect={(rawId) => setDialogProviderId(rawId)}
      />

      <div className="space-y-4 max-w-5xl mx-auto w-full">
        <p className="text-base md:text-lg leading-7 text-muted-foreground text-center px-2">
          Want your memory to include desktop or mobile browser history? Get the browser extension.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
          <Card
            logo="/branding/chrome/logo.svg"
            background="bg-blue-500"
            border="border-blue-400"
            text="Install the Chrome extension to automatically track your browsing history, bookmarks, and web activity."
            onClick={() => window.open(CHROME_EXTENSION_URL, '_blank', 'noopener,noreferrer')}
          />
          <Card
            logo="/branding/firefox/logo.svg"
            background="bg-orange-500"
            border="border-orange-400"
            text="Get the Firefox extension to capture your web browsing patterns and site interactions."
            disabled
          />
          <Card
            logo="/branding/ios/logo.svg"
            background="bg-blue-500"
            border="border-blue-400"
            text="Download the iOS app to track your mobile usage, screen time, and app interactions on iPhone and iPad."
            onClick={openDownload}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border/70 bg-background/70 p-5 space-y-3 max-w-2xl mx-auto w-full">
        <p className="text-base md:text-lg leading-7 text-muted-foreground">
          Have local exports? Import tools can seed your memory faster.
        </p>
        <BrandPrimaryButton className="w-full sm:w-auto text-base px-5" asChild>
          <a href={IMPORT_TOOLS_URL} target="_blank" rel="noopener noreferrer">
            Get import tools
            <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </BrandPrimaryButton>
      </div>

      <ProviderConnectDialog
        rawProviderId={dialogProviderId}
        open={dialogProviderId != null}
        resumeOnboarding
        onOpenChange={(open) => {
          if (!open) {
            setDialogProviderId(null);
            void refetch();
          }
        }}
        onConnected={() => {
          setDialogProviderId(null);
          void refetch();
        }}
      />
    </div>
  );
}
