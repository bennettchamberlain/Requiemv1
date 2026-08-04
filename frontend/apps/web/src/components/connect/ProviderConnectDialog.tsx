import { useCallback, useEffect } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage } from '@ci/common';
import {
  Dialog,
  Form,
  formDataResolver,
  Input,
  Label,
  Popover,
  useForm,
  useToast,
  formDataSchema as s,
} from '@ci/shadcn';
import { Info } from '@ci/shadcn/icons';

import { BrandPrimaryButton } from '@/components/BrandPrimaryButton/BrandPrimaryButton';
import { ONBOARDING_OAUTH_RESUME_KEY } from '@/pages/OnboardingPage/constants';
import { Endpoints } from '@/pages/ProviderPage/Endpoints';
import { GET_PROVIDER } from '@/pages/ProviderPage/ProviderPage';
import { useConnectService } from '@/pages/ProviderPage/useConnectService';

const ConnectFormSchema = s.object({
  endpoints: s.array(s.string()).nullable().default(null),
});

type ConnectFormData = s.input<typeof ConnectFormSchema>;

interface ProviderConnectDialogProps {
  rawProviderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: () => void;
  resumeOnboarding?: boolean;
}

export function ProviderConnectDialog({
  rawProviderId,
  open,
  onOpenChange,
  onConnected,
  resumeOnboarding = false,
}: ProviderConnectDialogProps) {
  const { toast } = useToast();
  const form = useForm<ConnectFormData>({
    resolver: formDataResolver(ConnectFormSchema),
    shouldUnregister: false,
  });

  const { data, loading } = useQuery(GET_PROVIDER, {
    variables: { id: GlobalUID.encode('provider', rawProviderId ?? '') },
    skip: !rawProviderId || !open,
  });

  const provider = data?.provider;
  const [{ authorizationUrl, loading: connectLoading, error, apiKey, setApiKey }, { connect }] =
    useConnectService();

  const isOpenId = provider?.authType === 'openid';
  const isApiKey = provider?.authType === 'api_key';
  const requiresApiKey = isOpenId || isApiKey;
  const isConnectDisabled = requiresApiKey && (apiKey == null || apiKey.length === 0);

  const handleConnect = useCallback(() => {
    if (!provider || !rawProviderId) {
      return;
    }

    if (resumeOnboarding) {
      localStorage.setItem(ONBOARDING_OAUTH_RESUME_KEY, '1');
    }

    connect(rawProviderId, form.getValues('endpoints') || []);
  }, [connect, provider, rawProviderId, form, resumeOnboarding]);

  useEffect(() => {
    if (authorizationUrl === null) {
      return;
    }

    if (authorizationUrl === '') {
      toast.success(`Connected to ${provider?.name ?? 'provider'}`);
      onConnected?.();
      onOpenChange(false);

      return;
    }

    window.location.href = authorizationUrl;
  }, [authorizationUrl, onConnected, onOpenChange, provider?.name, toast]);

  useEffect(() => {
    if (!error) {
      return;
    }

    toast.error('Error connecting to API');
    if (resumeOnboarding) {
      localStorage.removeItem(ONBOARDING_OAUTH_RESUME_KEY);
    }
  }, [error, resumeOnboarding, toast]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <Dialog.Header>
          <Dialog.Title>{provider ? `Connect ${provider.name}` : 'Connect'}</Dialog.Title>
          <Dialog.Description>Select what to sync, then connect your account.</Dialog.Description>
        </Dialog.Header>

        {loading || !provider ? (
          <LoadingPage />
        ) : (
          <Form {...form}>
            <form className="space-y-4 py-2">
              <Endpoints provider={provider} />

              {(isOpenId || isApiKey) && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="provider-api-key">API key</Label>
                    {provider.openidKeyLink && (
                      <Popover>
                        <Popover.Trigger asChild>
                          <button type="button" className="text-muted-foreground hover:text-foreground">
                            <Info className="h-4 w-4" />
                          </button>
                        </Popover.Trigger>
                        <Popover.Content className="text-sm w-fit">
                          <a
                            href={provider.openidKeyLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            Get your API key
                          </a>
                        </Popover.Content>
                      </Popover>
                    )}
                  </div>
                  <Input
                    id="provider-api-key"
                    type="password"
                    autoComplete="off"
                    placeholder="API key"
                    value={apiKey ?? ''}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
              )}

              <BrandPrimaryButton
                type="button"
                className="w-full"
                disabled={isConnectDisabled || connectLoading}
                onClick={handleConnect}
              >
                {connectLoading ? 'Connecting…' : 'Connect'}
              </BrandPrimaryButton>
            </form>
          </Form>
        )}
      </Dialog.Content>
    </Dialog>
  );
}
