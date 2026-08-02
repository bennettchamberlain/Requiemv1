import { useState } from 'react';

import { useQuery } from '@apollo/client';
import { Button } from '@ci/shadcn';
import { ExternalLink } from '@ci/shadcn/icons';

import { ProviderConnectDialog } from '@/components/connect/ProviderConnectDialog';
import {
  GET_CONNECTIONS_LIGHT,
  ServiceIntegrationsSection,
} from '@/components/connect/ServiceIntegrationsSection';

import { CHROME_EXTENSION_URL, IMPORT_TOOLS_URL } from './constants';

export function ConnectSourceStep() {
  const [dialogProviderId, setDialogProviderId] = useState<string | null>(null);
  const { data, refetch } = useQuery(GET_CONNECTIONS_LIGHT, { fetchPolicy: 'cache-and-network' });

  const connections =
    data?.connections.edges.map(
      (edge: { node: { id: string; name: string | null; active: boolean; needsReauth: boolean } }) => edge.node,
    ) ?? [];

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

      <div className="rounded-lg border border-border/70 bg-muted/20 p-4 space-y-2 max-w-2xl mx-auto w-full">
        <p className="text-sm text-muted-foreground">
          Want your memory to include desktop or mobile browser history? Get the browser extension.
        </p>
        <Button variant="outline" size="sm" asChild>
          <a href={CHROME_EXTENSION_URL} target="_blank" rel="noopener noreferrer">
            Get the browser extension
            <ExternalLink className="ml-2 h-3.5 w-3.5" />
          </a>
        </Button>
      </div>

      <div className="rounded-lg border border-border/70 bg-background/70 p-4 space-y-2 max-w-2xl mx-auto w-full">
        <p className="text-sm text-muted-foreground">Have local exports? Import tools can seed your memory faster.</p>
        <Button variant="outline" size="sm" asChild>
          <a href={IMPORT_TOOLS_URL} target="_blank" rel="noopener noreferrer">
            Get import tools
            <ExternalLink className="ml-2 h-3.5 w-3.5" />
          </a>
        </Button>
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
