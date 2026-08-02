import { useMemo, useState } from 'react';

import { useQuery, gql } from '@apollo/client';
import { GlobalUID } from '@ci/common';
import { cn, Dialog, Button } from '@ci/shadcn';
import { useNavigate } from 'react-router-dom';

import { Card } from '@/pages/ConnectPage/Card';
import { GET_PROVIDERS, GET_OAUTH_CALLBACK_URL } from '@/queries';

const GET_CONNECTIONS = gql`
  query GetConnectionsForOnboarding {
    connections {
      edges {
        node {
          id
          name
          active
          needsReauth
          providerId
        }
      }
    }
  }
`;

export interface ServiceProviderConfig {
  rawId: string;
  logo: string;
  background: string;
  border: string;
  text: string;
  disabled?: boolean;
}

/** Connection GraphQL historically returned raw UUIDs; accept encoded or raw provider ids. */
function toRawProviderId(providerId: string): string {
  try {
    return GlobalUID.parse('provider', providerId);
  } catch {
    return providerId;
  }
}

export const SERVICE_PROVIDERS: ServiceProviderConfig[] = [
  {
    rawId: '0198779b-3c33-73da-84e5-82e0df145260',
    logo: '/branding/microsoft/logo.svg',
    background: 'bg-sky-400',
    border: 'border-sky-300',
    text: 'Bring your Microsoft account into the mix for email and scheduling.',
  },
  {
    rawId: '0198779b-182c-716e-9275-b81d99a47fdb',
    logo: '/branding/google/logo.svg',
    background: 'bg-violet-400',
    border: 'border-violet-300',
    text: 'Link your Google account for Gmail, Calendar, Drive, Photos, and YouTube.',
  },
  {
    rawId: 'dbb8002f-12da-4cd9-b02b-37db7791a900',
    logo: '/branding/meta/logo.svg',
    background: 'bg-blue-500',
    border: 'border-blue-400',
    text: 'Connect Meta to sync Facebook posts, photos, videos, and friends.',
  },
  {
    rawId: '019cbaf2-d789-7723-aada-7e3d709663f5',
    logo: '/branding/spotify/logo.svg',
    background: 'bg-green-500',
    border: 'border-green-400',
    text: 'Connect Spotify to track your listening habits and playlists.',
  },
  {
    rawId: '019d6470-f9e1-720f-a3ce-299842abaece',
    logo: '/branding/steam/logo.svg',
    background: 'bg-slate-700',
    border: 'border-slate-600',
    text: 'Connect Steam to track your game library and achievements.',
  },
  {
    rawId: '019d7a32-e4b0-7f01-b5c2-8a1d3e6f9c04',
    logo: '/branding/github/logo.svg',
    background: 'bg-gray-800',
    border: 'border-gray-700',
    text: 'Link GitHub to track repositories, commits, and development activity.',
  },
  {
    rawId: '019e3d77-c6e3-8f14-da06-2b5f7c0e1d19',
    logo: '/branding/signal/logo.svg',
    background: 'bg-blue-600',
    border: 'border-blue-500',
    text: 'Link Signal for secure messaging and communication tracking.',
  },
  {
    rawId: 'discord',
    logo: '/branding/discord/logo.svg',
    background: 'bg-indigo-500',
    border: 'border-indigo-400',
    text: 'Connect Discord to sync your server activity, messages, and community interactions. Coming soon.',
    disabled: true,
  },
  {
    rawId: 'instagram',
    logo: '/branding/instagram/logo.svg',
    background: 'bg-pink-500',
    border: 'border-pink-400',
    text: 'Sync Instagram to capture your visual memories, stories, and social interactions. Coming soon.',
    disabled: true,
  },
  {
    rawId: 'shopify',
    logo: '/branding/shopify/logo.svg',
    background: 'bg-green-600',
    border: 'border-green-500',
    text: 'Connect Shopify to track your e-commerce activity, orders, and business insights. Coming soon.',
    disabled: true,
  },
  {
    rawId: 'slack',
    logo: '/branding/slack/logo.svg',
    background: 'bg-purple-600',
    border: 'border-purple-500',
    text: 'Sync Slack to capture your team communications, channels, and workspace activity. Coming soon.',
    disabled: true,
  },
  {
    rawId: 'x',
    logo: '/branding/x/logo.svg',
    background: 'bg-black',
    border: 'border-gray-600',
    text: 'Connect X to track your social interactions, posts, and real-time engagement streams. Coming soon.',
    disabled: true,
  },
  {
    rawId: 'linkedin',
    logo: '/branding/linkedin/logo.svg',
    background: 'bg-blue-600',
    border: 'border-blue-500',
    text: 'Link LinkedIn to track your professional network, career updates, and industry connections. Coming soon.',
    disabled: true,
  },
  {
    rawId: 'notion',
    logo: '/branding/notion/logo.svg',
    background: 'bg-gray-100',
    border: 'border-gray-300',
    text: 'Connect Notion to sync your notes, databases, and productivity workflows. Coming soon.',
    disabled: true,
  },
  {
    rawId: 'twitch',
    logo: '/branding/twitch/logo.svg',
    background: 'bg-purple-500',
    border: 'border-purple-400',
    text: 'Link Twitch to track your streaming activity, follows, and gaming community engagement. Coming soon.',
    disabled: true,
  },
  {
    rawId: 'reddit',
    logo: '/branding/reddit/logo.svg',
    background: 'bg-orange-500',
    border: 'border-orange-400',
    text: 'Connect Reddit to track your community discussions, posts, and subreddit interactions. Coming soon.',
    disabled: true,
  },
  {
    rawId: 'dropbox',
    logo: '/branding/dropbox/logo.svg',
    background: 'bg-blue-500',
    border: 'border-blue-400',
    text: 'Link Dropbox to sync your files, documents, and cloud storage activity. Coming soon.',
    disabled: true,
  },
];

interface SetupProviderState {
  name: string;
  appSetupUrl: string | null;
  scopes: string[] | null;
}

interface ServiceIntegrationsSectionProps {
  variant?: 'page' | 'onboarding';
  disabledWhenConnected?: boolean;
  onProviderSelect?: (rawProviderId: string) => void;
}

export function ServiceIntegrationsSection({
  variant = 'page',
  disabledWhenConnected = false,
  onProviderSelect,
}: ServiceIntegrationsSectionProps) {
  const navigate = useNavigate();
  const { data: providersData } = useQuery(GET_PROVIDERS, {
    fetchPolicy: 'cache-and-network',
  });
  const { data: connectionsData } = useQuery(GET_CONNECTIONS, {
    fetchPolicy: 'cache-and-network',
  });
  const { data: oauthData } = useQuery(GET_OAUTH_CALLBACK_URL);

  const callbackUrl = oauthData?.oAuthCallbackUrl ?? `${window.location.origin}/oauth/callback`;

  const [setupProvider, setSetupProvider] = useState<SetupProviderState | null>(null);

  const connections =
    connectionsData?.connections?.edges?.map(
      (edge: { node: { providerId: string; active: boolean } }) => edge.node,
    ) ?? [];

  const connectionsCount: Record<string, number> = {};
  connections.forEach((c: { providerId: string; active: boolean }) => {
    if (!c.active) {
      return;
    }

    const rawId = toRawProviderId(c.providerId);
    connectionsCount[rawId] = (connectionsCount[rawId] ?? 0) + 1;
  });

  const providers =
    providersData?.providers.edges.map(
      (edge: {
        node: {
          id: string;
          name: string;
          localOnly: boolean;
          providerKeys: unknown;
          appSetupUrl: string | null;
          scopes: string[] | null;
        };
      }) => edge.node,
    ) || [];

  const providerMap = useMemo(() => {
    const map: Record<string, (typeof providers)[number]> = {};
    providers.forEach((p: (typeof providers)[number]) => {
      map[GlobalUID.parse('provider', p.id)] = p;
    });

    return map;
  }, [providers]);

  function handleProviderClick(rawId: string) {
    const provider = providerMap[rawId];
    const connectedCount = connectionsCount[rawId] ?? 0;

    if (disabledWhenConnected && connectedCount > 0) {
      return;
    }

    const isLocalOnlyWithoutKeys = provider?.localOnly && !provider?.providerKeys;

    if (isLocalOnlyWithoutKeys) {
      setSetupProvider({
        name: provider.name ?? 'Provider',
        appSetupUrl: provider.appSetupUrl ?? null,
        scopes: provider.scopes ?? null,
      });

      return;
    }

    if (onProviderSelect) {
      onProviderSelect(rawId);

      return;
    }

    navigate(`/providers/${rawId}`);
  }

  return (
    <>
      <div
        className={cn(
          'grid grid-cols-1 gap-2 md:gap-4',
          variant === 'onboarding' ? 'sm:grid-cols-2 lg:grid-cols-3' : 'md:grid-cols-2 lg:grid-cols-3',
        )}
      >
        {SERVICE_PROVIDERS.map((config) => {
          const count = connectionsCount[config.rawId] ?? 0;
          const isConnected = count > 0;
          const cardDisabled = config.disabled || (disabledWhenConnected && isConnected);

          return (
            <Card
              key={config.rawId}
              {...config}
              disabled={cardDisabled}
              onClick={() => handleProviderClick(config.rawId)}
              subtext={isConnected ? (count === 1 ? '1 Connection' : `${count} Connections`) : undefined}
              className={
                isConnected
                  ? 'ring-2 ring-green-800/35 bg-green-900/[0.08] dark:bg-green-950/45 dark:ring-green-700/45 [&>div:last-child]:text-green-800 dark:[&>div:last-child]:text-green-300'
                  : undefined
              }
            />
          );
        })}
      </div>

      <Dialog open={setupProvider != null} onOpenChange={() => setSetupProvider(null)}>
        <Dialog.Content className="sm:max-w-[500px] [&>button]:cursor-pointer">
          <Dialog.Header>
            <Dialog.Title>{setupProvider?.name} — OAuth Setup</Dialog.Title>
            <Dialog.Description>
              We cannot provide cloud OAuth for this provider at this time, but you can create and connect
              your own OAuth app for this provider. See{' '}
              <a
                href={setupProvider?.appSetupUrl ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-blue-600"
              >
                this link
              </a>{' '}
              for more information on creating an app.
            </Dialog.Description>
          </Dialog.Header>
          <ul className="px-6 pb-4 space-y-3 text-sm text-gray-700 dark:text-gray-300 list-disc list-outside">
            <li>If the setup asks for an app type, it should be &apos;Web&apos;.</li>
            <li>
              The callback URL you need to register with the app is{' '}
              <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-xs break-all">
                {callbackUrl}
              </code>
              .
            </li>
            {setupProvider?.scopes && setupProvider.scopes.length > 0 && (
              <li>
                You may need to explicitly enable the following scopes on the OAuth app:
                <ul className="mt-2 space-y-1 list-disc list-outside ml-6">
                  {setupProvider.scopes.map((scope) => (
                    <li key={scope}>
                      <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-xs break-all">
                        {scope}
                      </code>
                    </li>
                  ))}
                </ul>
              </li>
            )}
            <li>Once you have made the OAuth app, you will need to generate a secret in the OAuth app.</li>
            <li>
              With the OAuth app&apos;s ID/Client ID and Secret in hand, go to{' '}
              <a href="/settings/oauth" className="underline text-blue-600 hover:text-blue-800">
                Settings → OAuth Credentials
              </a>{' '}
              in this app, and copy the app&apos;s ID/Client ID to the &apos;Client ID&apos; field for that
              provider, and the app&apos;s secret to &apos;Client Secret&apos; field. Make sure to save. Then
              come back to this page.
            </li>
          </ul>
          <Dialog.Footer>
            <Button variant="outline" onClick={() => setSetupProvider(null)}>
              Close
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </>
  );
}

export { GET_CONNECTIONS as GET_CONNECTIONS_LIGHT };
