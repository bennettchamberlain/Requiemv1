import { useState, useEffect } from 'react';

import { gql, useQuery, useMutation } from '@apollo/client';
import { Portal, usePageTitle } from '@ci/common';
import { Breadcrumb, Button, Card, Input, Label, Dialog } from '@ci/shadcn';
import { Key, Brain, Settings, Save, Eye, EyeOff, Trash } from '@ci/shadcn/icons';
import { Link } from 'react-router-dom';

import { PageContent } from '@/components/layout';
import { ModelSelector } from '@/components/ModelSelector';
import { ColorPicker, TexturePicker } from '@/components/ThemePicker';
import type { Provider } from '@/pages/ConnectionsPage/ConnectionsPage.tsx';

export interface ProviderKey {
  readonly id: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly providerId: string;
  readonly userId: string;
}

const GET_PROVIDERS = gql(`
  query GetProviders {
    providers {
      edges {
        cursor
        node {
          id
          name
          description
          logoUrl
          providerKeys {
            id
            clientId
            clientSecret
          }
        }
      }
    }
  }
`);

const CREATE_PROVIDER_KEY = gql(`
  mutation CreateProviderKey($input: CreateProviderKeyInput!) {
    createProviderKey(input: $input) {
      id
      providerId
      clientId
      clientSecret
      userId
    }
  }
`);

const UPDATE_PROVIDER_KEY = gql(`
  mutation UpdateProviderKey($id: ID!, $input: UpdateProviderKeyInput!) {
    updateProviderKey(id: $id, input: $input) {
      id
      clientId
      clientSecret
    }
  }
`);

const DELETE_PROVIDER_KEY = gql(`
  mutation DeleteProviderKey($id: ID!) {
    deleteProviderKey(id: $id)
  }
`);

interface SettingsState {
  oauth: Record<
    string,
    {
      providerKeyId?: string;
      clientId: string;
      clientSecret: string;
    }
  >;
}

export function SettingsPage() {
  usePageTitle('Settings - Companion Intelligence');

  const [settings, setSettings] = useState<SettingsState>({
    oauth: {
      google: {
        clientId: '',
        clientSecret: '',
      },
      microsoft: {
        clientId: '',
        clientSecret: '',
      },
      facebook: {
        clientId: '',
        clientSecret: '',
      },
    },
  });

  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({
    googleClientId: false,
    googleClientSecret: false,
    microsoftClientId: false,
    microsoftClientSecret: false,
    facebookClientId: false,
    facebookClientSecret: false,
  });

  const [originalValues, setOriginalValues] = useState<
    Record<string, { clientId: string; clientSecret: string }>
  >({
    google: { clientId: '', clientSecret: '' },
    microsoft: { clientId: '', clientSecret: '' },
    facebook: { clientId: '', clientSecret: '' },
  });

  const [validationErrors, setValidationErrors] = useState<
    Record<string, { clientId?: string; clientSecret?: string }>
  >({
    google: {},
    microsoft: {},
    facebook: {},
  });

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [providerToDelete, setProviderToDelete] = useState<'google' | 'microsoft' | 'facebook' | null>(null);

  const { data: providersData } = useQuery(GET_PROVIDERS);
  const [createProviderKey] = useMutation(CREATE_PROVIDER_KEY);
  const [updateProviderKey] = useMutation(UPDATE_PROVIDER_KEY);
  const [deleteProviderKey] = useMutation(DELETE_PROVIDER_KEY);

  // Load provider keys when data is available
  useEffect(() => {
    if (!providersData) {
      return;
    }

    const providers: Provider[] = providersData.providers.edges.map((edge: { node: Provider }) => edge.node);

    const newOriginalValues: Record<string, { clientId: string; clientSecret: string }> = {
      google: { clientId: '', clientSecret: '' },
      microsoft: { clientId: '', clientSecret: '' },
      facebook: { clientId: '', clientSecret: '' },
    };

    setSettings((prev) => {
      const newSettings = { ...prev };

      providers.forEach((provider) => {
        const providerName = provider.name?.toLowerCase();
        if (
          providerName &&
          provider.providerKeys &&
          newSettings.oauth[providerName as keyof typeof newSettings.oauth]
        ) {
          newSettings.oauth[providerName as keyof typeof newSettings.oauth] = {
            providerKeyId: provider.providerKeys.id,
            clientId: provider.providerKeys.clientId,
            clientSecret: provider.providerKeys.clientSecret,
          };
          // Store original values
          newOriginalValues[providerName] = {
            clientId: provider.providerKeys.clientId,
            clientSecret: provider.providerKeys.clientSecret,
          };
        }
      });

      return newSettings;
    });

    setOriginalValues(newOriginalValues);
  }, [providersData]);

  const updateSetting = (key: string, value: string | boolean) => {
    let updatedSettings: SettingsState = settings;

    setSettings((prev) => {
      const keys = key.split('.');
      if (keys.length === 1) {
        updatedSettings = { ...prev, [key]: value };

        return updatedSettings;
      }

      // Deep clone and update nested value
      const updated = { ...prev };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let current: any = updated;

      for (let i = 0; i < keys.length - 1; i++) {
        current[keys[i]] = { ...current[keys[i]] };
        current = current[keys[i]];
      }

      current[keys[keys.length - 1]] = value;
      updatedSettings = updated;

      return updated;
    });

    // For OAuth fields, validate with the updated values
    if (key.startsWith('oauth.')) {
      const parts = key.split('.');
      if (parts.length === 3) {
        const provider = parts[1] as 'google' | 'microsoft' | 'facebook';
        const { clientId, clientSecret, providerKeyId } = updatedSettings.oauth[provider];
        const errors: { clientId?: string; clientSecret?: string } = {};

        const hasClientId = clientId && clientId.trim().length > 0;
        const hasClientSecret = clientSecret && clientSecret.trim().length > 0;

        // Show validation errors if providerKeyId exists or one field is filled
        if (providerKeyId || hasClientId || hasClientSecret) {
          if (!hasClientId) {
            errors.clientId = 'Client ID is required';
          }

          if (!hasClientSecret) {
            errors.clientSecret = 'Client Secret is required';
          }
        }

        setValidationErrors((prev) => ({ ...prev, [provider]: errors }));
      }
    }
  };

  const toggleKeyVisibility = (keyName: string) => {
    setShowKeys((prev) => ({ ...prev, [keyName]: !prev[keyName] }));
  };

  const hasProviderChanges = (provider: 'google' | 'microsoft' | 'facebook'): boolean => {
    const current = settings.oauth[provider];
    const original = originalValues[provider];
    const { providerKeyId } = current;

    // If no provider key exists, show save button if both fields have values
    if (!providerKeyId) {
      return current.clientId?.trim().length > 0 && current.clientSecret?.trim().length > 0;
    }

    // If provider key exists, show save button if either field differs from original
    return current.clientId !== original.clientId || current.clientSecret !== original.clientSecret;
  };

  const validateOAuthFields = (provider: string): boolean => {
    if (!settings.oauth[provider]) {
      return true;
    }

    const { clientId, clientSecret, providerKeyId } = settings.oauth[provider];
    const errors: { clientId?: string; clientSecret?: string } = {};
    let isValid = true;

    const hasClientId = clientId && clientId.trim().length > 0;
    const hasClientSecret = clientSecret && clientSecret.trim().length > 0;

    // Show validation errors if:
    // 1. Provider key exists (updating mode), OR
    // 2. One field is filled but the other isn't (partial entry)
    if (providerKeyId || hasClientId || hasClientSecret) {
      if (!hasClientId) {
        errors.clientId = 'Client ID is required';
        isValid = false;
      }

      if (!hasClientSecret) {
        errors.clientSecret = 'Client Secret is required';
        isValid = false;
      }
    }

    setValidationErrors((prev) => ({ ...prev, [provider]: errors }));

    return isValid;
  };

  const handleSaveOAuthField = async (provider: 'google' | 'microsoft' | 'facebook') => {
    // Validate fields
    if (!validateOAuthFields(provider)) {
      return;
    }

    const { providerKeyId, clientId, clientSecret } = settings.oauth[provider];

    try {
      if (!providerKeyId) {
        // Create new provider key
        if (!providersData) {
          return;
        }

        const providers: Provider[] = providersData.providers.edges.map(
          (edge: { node: Provider }) => edge.node,
        );
        const providerEntity = providers.find((p) => p.name?.toLowerCase() === provider);

        if (!providerEntity) {
          console.error('Provider not found:', provider);

          return;
        }

        const result = await createProviderKey({
          variables: {
            input: {
              providerId: providerEntity.id,
              clientId,
              clientSecret,
            },
          },
        });

        // Update settings with new provider key ID
        setSettings((prev) => ({
          ...prev,
          oauth: {
            ...prev.oauth,
            [provider]: {
              ...prev.oauth[provider],
              providerKeyId: result.data?.createProviderKey.id,
            },
          },
        }));

        // Update original values to match current
        setOriginalValues((prev) => ({
          ...prev,
          [provider]: { clientId, clientSecret },
        }));
      } else {
        // Update existing provider key
        await updateProviderKey({
          variables: {
            id: providerKeyId,
            input: {
              clientId,
              clientSecret,
            },
          },
        });

        // Update original values to match current
        setOriginalValues((prev) => ({
          ...prev,
          [provider]: { clientId, clientSecret },
        }));
      }

      // Clear validation errors
      setValidationErrors((prev) => ({ ...prev, [provider]: {} }));
    } catch (error) {
      console.error('Failed to save provider key:', error);
    }
  };

  const handleDeleteOAuthKey = async (provider: 'google' | 'microsoft' | 'facebook') => {
    const { providerKeyId } = settings.oauth[provider];

    if (!providerKeyId) {
      return;
    }

    try {
      await deleteProviderKey({
        variables: {
          id: providerKeyId,
        },
      });

      // Clear from settings
      setSettings((prev) => ({
        ...prev,
        oauth: {
          ...prev.oauth,
          [provider]: {
            providerKeyId: undefined,
            clientId: '',
            clientSecret: '',
          },
        },
      }));

      // Reset original values
      setOriginalValues((prev) => ({
        ...prev,
        [provider]: { clientId: '', clientSecret: '' },
      }));

      // Clear validation errors
      setValidationErrors((prev) => ({ ...prev, [provider]: {} }));

      setDeleteModalOpen(false);
      setProviderToDelete(null);
    } catch (error) {
      console.error('Failed to delete provider key:', error);
    }
  };

  const openDeleteModal = (provider: 'google' | 'microsoft' | 'facebook') => {
    setProviderToDelete(provider);
    setDeleteModalOpen(true);
  };

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link asChild>
                <Link to="/feed">Companion</Link>
              </Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator className="hidden md:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Page>Settings</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Configure your personal assistant preferences and system settings
          </p>
        </div>

        {/* Settings Grid */}
        <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
          {/* LLM Behavior Configuration */}
          <Card>
            <Card.Header>
              <Card.Title className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                LLM Behavior Configuration
              </Card.Title>
              <Card.Description>Configure how your AI assistant behaves and responds</Card.Description>
            </Card.Header>
            <Card.Content className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="model">Model Selection</Label>
                <ModelSelector />
              </div>
            </Card.Content>
          </Card>

          {/* API Keys & Tokens */}
          <Card>
            <Card.Header>
              <Card.Title className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                OAuth Provider Credentials
              </Card.Title>
              <Card.Description>
                Use your own OAuth app's credentials for connecting to Google, Facebook, Microsoft, etc.
              </Card.Description>
            </Card.Header>
            <Card.Content className="space-y-4">
              {/* Google OAuth */}
              <div className="space-y-3 p-4 border-b mb-0">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Google</Label>
                  <div className="flex gap-2">
                    {settings.oauth.google.providerKeyId && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => openDeleteModal('google')}
                        className="h-8 w-8 text-red-600 hover:text-red-700"
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    )}
                    {hasProviderChanges('google') && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handleSaveOAuthField('google')}
                        className="h-8 w-8 text-green-600 hover:text-green-700"
                        disabled={
                          settings.oauth.google.providerKeyId != null &&
                          (!settings.oauth.google.clientId?.trim() ||
                            !settings.oauth.google.clientSecret?.trim())
                        }
                      >
                        <Save className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="googleClientId">Client ID</Label>
                  <div className="flex gap-2">
                    <Input
                      id="googleClientId"
                      type={showKeys.googleClientId ? 'text' : 'password'}
                      value={settings.oauth.google.clientId}
                      onChange={(e) => updateSetting('oauth.google.clientId', e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => toggleKeyVisibility('googleClientId')}
                    >
                      {showKeys.googleClientId ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  {validationErrors.google.clientId &&
                    (settings.oauth.google.providerKeyId ||
                      settings.oauth.google.clientSecret?.trim().length > 0) && (
                      <p className="text-sm text-red-600">{validationErrors.google.clientId}</p>
                    )}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="googleClientSecret">Client Secret</Label>
                  <div className="flex gap-2">
                    <Input
                      id="googleClientSecret"
                      type={showKeys.googleClientSecret ? 'text' : 'password'}
                      value={settings.oauth.google.clientSecret}
                      onChange={(e) => updateSetting('oauth.google.clientSecret', e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => toggleKeyVisibility('googleClientSecret')}
                    >
                      {showKeys.googleClientSecret ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {validationErrors.google.clientSecret &&
                    (settings.oauth.google.providerKeyId ||
                      settings.oauth.google.clientId?.trim().length > 0) && (
                      <p className="text-sm text-red-600">{validationErrors.google.clientSecret}</p>
                    )}
                </div>
              </div>
              {/* Microsoft OAuth */}
              <div className="space-y-3 p-4 border-b mb-0">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Microsoft</Label>
                  <div className="flex gap-2">
                    {settings.oauth.microsoft.providerKeyId && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => openDeleteModal('microsoft')}
                        className="h-8 w-8 text-red-600 hover:text-red-700"
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    )}
                    {hasProviderChanges('microsoft') && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handleSaveOAuthField('microsoft')}
                        className="h-8 w-8 text-green-600 hover:text-green-700"
                        disabled={
                          settings.oauth.microsoft.providerKeyId != null &&
                          (!settings.oauth.microsoft.clientId?.trim() ||
                            !settings.oauth.microsoft.clientSecret?.trim())
                        }
                      >
                        <Save className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="microsoftClientId">Client ID</Label>
                  <div className="flex gap-2">
                    <Input
                      id="microsoftClientId"
                      type={showKeys.microsoftClientId ? 'text' : 'password'}
                      value={settings.oauth.microsoft.clientId}
                      onChange={(e) => updateSetting('oauth.microsoft.clientId', e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => toggleKeyVisibility('microsoftClientId')}
                    >
                      {showKeys.microsoftClientId ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {validationErrors.microsoft.clientId &&
                    (settings.oauth.microsoft.providerKeyId ||
                      settings.oauth.microsoft.clientSecret?.trim().length > 0) && (
                      <p className="text-sm text-red-600">{validationErrors.microsoft.clientId}</p>
                    )}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="microsoftClientSecret">Client Secret</Label>
                  <div className="flex gap-2">
                    <Input
                      id="microsoftClientSecret"
                      type={showKeys.microsoftClientSecret ? 'text' : 'password'}
                      value={settings.oauth.microsoft.clientSecret}
                      onChange={(e) => updateSetting('oauth.microsoft.clientSecret', e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => toggleKeyVisibility('microsoftClientSecret')}
                    >
                      {showKeys.microsoftClientSecret ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {validationErrors.microsoft.clientSecret &&
                    (settings.oauth.microsoft.providerKeyId ||
                      settings.oauth.microsoft.clientId?.trim().length > 0) && (
                      <p className="text-sm text-red-600">{validationErrors.microsoft.clientSecret}</p>
                    )}
                </div>
              </div>
              {/* Facebook OAuth */}
              <div className="space-y-3 p-4 mb-0">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Facebook</Label>
                  <div className="flex gap-2">
                    {settings.oauth.facebook.providerKeyId && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => openDeleteModal('facebook')}
                        className="h-8 w-8 text-red-600 hover:text-red-700"
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    )}
                    {hasProviderChanges('facebook') && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handleSaveOAuthField('facebook')}
                        className="h-8 w-8 text-green-600 hover:text-green-700"
                        disabled={
                          settings.oauth.facebook.providerKeyId != null &&
                          (!settings.oauth.facebook.clientId?.trim() ||
                            !settings.oauth.facebook.clientSecret?.trim())
                        }
                      >
                        <Save className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="facebookClientId">Client ID</Label>
                  <div className="flex gap-2">
                    <Input
                      id="facebookClientId"
                      type={showKeys.facebookClientId ? 'text' : 'password'}
                      value={settings.oauth.facebook.clientId}
                      onChange={(e) => updateSetting('oauth.facebook.clientId', e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => toggleKeyVisibility('facebookClientId')}
                    >
                      {showKeys.facebookClientId ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {validationErrors.facebook.clientId &&
                    (settings.oauth.facebook.providerKeyId ||
                      settings.oauth.facebook.clientSecret?.trim().length > 0) && (
                      <p className="text-sm text-red-600">{validationErrors.facebook.clientId}</p>
                    )}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="facebookClientSecret">Client Secret</Label>
                  <div className="flex gap-2">
                    <Input
                      id="facebookClientSecret"
                      type={showKeys.facebookClientSecret ? 'text' : 'password'}
                      value={settings.oauth.facebook.clientSecret}
                      onChange={(e) => updateSetting('oauth.facebook.clientSecret', e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => toggleKeyVisibility('facebookClientSecret')}
                    >
                      {showKeys.facebookClientSecret ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {validationErrors.facebook.clientSecret &&
                    (settings.oauth.facebook.providerKeyId ||
                      settings.oauth.facebook.clientId?.trim().length > 0) && (
                      <p className="text-sm text-red-600">{validationErrors.facebook.clientSecret}</p>
                    )}
                </div>
              </div>
            </Card.Content>
          </Card>
        </div>

        {/* System Preferences - Full Width */}
        <Card>
          <Card.Header>
            <Card.Title className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Appearance & System Preferences
            </Card.Title>
            <Card.Description>Configure general system behavior and appearance</Card.Description>
          </Card.Header>
          <Card.Content>
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <ColorPicker />
              </div>

              <div className="border-t border-border pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
                <TexturePicker />
              </div>
            </div>
          </Card.Content>
        </Card>
      </PageContent>

      {/* Delete Confirmation Modal */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Delete OAuth Keys</Dialog.Title>
            <Dialog.Description>
              Are you sure you want to delete the OAuth keys for {providerToDelete}? This action cannot be
              undone.
            </Dialog.Description>
          </Dialog.Header>
          <Dialog.Footer>
            <Button variant="outline" onClick={() => setDeleteModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => providerToDelete && handleDeleteOAuthKey(providerToDelete)}
            >
              Delete
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </>
  );
}
