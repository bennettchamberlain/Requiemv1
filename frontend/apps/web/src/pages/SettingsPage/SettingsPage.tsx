import { useState, useEffect } from 'react';

import { gql, useQuery, useMutation } from '@apollo/client';
import { Portal, usePageTitle } from '@ci/common';
import { Breadcrumb, Button, Card, Input, Label, Select, Switch, Alert, Dialog } from '@ci/shadcn';
import { Database, Key, Brain, RefreshCw, Settings, Save, Eye, EyeOff, Info, Trash } from '@ci/shadcn/icons';
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
        }
      }
    }
  }
`);

const GET_PROVIDER_KEYS = gql(`
  query GetProviderKeys {
    providerKeys {
      edges {
        node {
          id
          providerId
          clientId
          clientSecret
          userId
          createdAt
          updatedAt
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
  // Data Storage
  dataRetentionDays: string;
  backupFrequency: string;
  cacheSize: string;

  oauth: Record<
    string,
    {
      providerKeyId?: string;
      clientId: string;
      clientSecret: string;
    }
  >;

  // LLM Behavior
  modelSelection: string;
  temperature: string;
  enableTools: boolean;
  contextWindow: string;
  streamingEnabled: boolean;

  // Update Frequencies
  notificationFrequency: string;
  autoRefresh: boolean;
  backgroundTaskFreq: string;

  // System Preferences
  theme: string;
  language: string;
  timezone: string;
}

export function SettingsPage() {
  usePageTitle('Settings - Companion Intelligence');

  const [settings, setSettings] = useState<SettingsState>({
    // Data Storage defaults
    dataRetentionDays: '365',
    backupFrequency: 'daily',
    cacheSize: '2048',

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

    // LLM Behavior defaults
    modelSelection: 'qwen3:8b',
    temperature: '0.7',
    enableTools: true,
    contextWindow: '8192',
    streamingEnabled: true,

    // Update Frequencies defaults
    notificationFrequency: 'hourly',
    autoRefresh: true,
    backgroundTaskFreq: '30',

    // System Preferences defaults
    theme: 'dark',
    language: 'english',
    timezone: 'America/New_York',
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

  const [unsavedChanges, setUnsavedChanges] = useState(false);

  const { data: providersData } = useQuery(GET_PROVIDERS);
  const { data: providerKeysData } = useQuery(GET_PROVIDER_KEYS);
  const [createProviderKey] = useMutation(CREATE_PROVIDER_KEY);
  const [updateProviderKey] = useMutation(UPDATE_PROVIDER_KEY);
  const [deleteProviderKey] = useMutation(DELETE_PROVIDER_KEY);

  // Load provider keys when data is available
  useEffect(() => {
    if (!providersData || !providerKeysData) {
      return;
    }

    const providers: Provider[] = providersData.providers.edges.map((edge: { node: Provider }) => edge.node);
    const providerKeys: ProviderKey[] = providerKeysData.providerKeys.edges.map(
      (edge: { node: ProviderKey }) => edge.node,
    );

    // Map provider names to lowercase for matching
    const providerMap = new Map(providers.map((p) => [p.id, p.name?.toLowerCase()]));

    const newOriginalValues: Record<string, { clientId: string; clientSecret: string }> = {
      google: { clientId: '', clientSecret: '' },
      microsoft: { clientId: '', clientSecret: '' },
      facebook: { clientId: '', clientSecret: '' },
    };

    setSettings((prev) => {
      const newSettings = { ...prev };

      providerKeys.forEach((key) => {
        const providerName = providerMap.get(key.providerId) as string;
        if (providerName && newSettings.oauth[providerName as keyof typeof newSettings.oauth]) {
          newSettings.oauth[providerName as keyof typeof newSettings.oauth] = {
            providerKeyId: key.id,
            clientId: key.clientId,
            clientSecret: key.clientSecret,
          };
          // Store original values
          newOriginalValues[providerName] = {
            clientId: key.clientId,
            clientSecret: key.clientSecret,
          };
        }
      });

      return newSettings;
    });

    setOriginalValues(newOriginalValues);
  }, [providersData, providerKeysData]);

  const updateSetting = (key: string, value: string | boolean) => {
    console.log('updateSetting', key, value);

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

    setUnsavedChanges(true);

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

  const handleSave = () => {
    // Demo: simulate saving
    console.log('Saving settings:', settings);
    setUnsavedChanges(false);
    // In real implementation, this would make API call
  };

  const handleReset = () => {
    // Demo: simulate reset to defaults
    console.log('Resetting to defaults');
    setUnsavedChanges(false);
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
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground">
              Configure your personal assistant preferences and system settings
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleReset} disabled={!unsavedChanges}>
              Reset
            </Button>
            <Button onClick={handleSave} disabled={!unsavedChanges} className="min-w-[100px]">
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
          </div>
        </div>

        {/* Unsaved Changes Alert */}
        {unsavedChanges && (
          <Alert>
            <Info className="h-4 w-4" />
            <Alert.Title>Unsaved Changes</Alert.Title>
            <Alert.Description>
              You have unsaved changes. Remember to save your settings before leaving this page.
            </Alert.Description>
          </Alert>
        )}

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

              <div className="grid gap-2">
                <Label htmlFor="temperature">Temperature (Creativity): {settings.temperature}</Label>
                <input
                  id="temperature"
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={settings.temperature}
                  onChange={(e) => updateSetting('temperature', e.target.value)}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Conservative</span>
                  <span>Balanced</span>
                  <span>Creative</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Function Calling</Label>
                  <div className="text-sm text-muted-foreground">
                    Allow AI to use tools and external functions
                  </div>
                </div>
                <Switch
                  checked={settings.enableTools}
                  onCheckedChange={(checked) => updateSetting('enableTools', checked)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="context">Context Window (tokens)</Label>
                <Select
                  value={settings.contextWindow}
                  onValueChange={(value) => updateSetting('contextWindow', value)}
                >
                  <Select.Trigger id="context">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="4096">4K tokens</Select.Item>
                    <Select.Item value="8192">8K tokens</Select.Item>
                    <Select.Item value="16384">16K tokens</Select.Item>
                    <Select.Item value="32768">32K tokens</Select.Item>
                  </Select.Content>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Streaming Responses</Label>
                  <div className="text-sm text-muted-foreground">Show responses as they're generated</div>
                </div>
                <Switch
                  checked={settings.streamingEnabled}
                  onCheckedChange={(checked) => updateSetting('streamingEnabled', checked)}
                />
              </div>
            </Card.Content>
          </Card>

          {/* Update Frequencies */}
          <Card>
            <Card.Header>
              <Card.Title className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Update Frequencies
              </Card.Title>
              <Card.Description>Control how often different systems sync and update</Card.Description>
            </Card.Header>
            <Card.Content className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="notifications">Notification Frequency</Label>
                <Select
                  value={settings.notificationFrequency}
                  onValueChange={(value) => updateSetting('notificationFrequency', value)}
                >
                  <Select.Trigger id="notifications">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="realtime">Real-time</Select.Item>
                    <Select.Item value="hourly">Hourly</Select.Item>
                    <Select.Item value="daily">Daily</Select.Item>
                    <Select.Item value="weekly">Weekly</Select.Item>
                  </Select.Content>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Auto-refresh Data</Label>
                  <div className="text-sm text-muted-foreground">
                    Automatically refresh data in background
                  </div>
                </div>
                <Switch
                  checked={settings.autoRefresh}
                  onCheckedChange={(checked) => updateSetting('autoRefresh', checked)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="background">Background Tasks (minutes)</Label>
                <Input
                  id="background"
                  type="number"
                  value={settings.backgroundTaskFreq}
                  onChange={(e) => updateSetting('backgroundTaskFreq', e.target.value)}
                  placeholder="30"
                />
              </div>
            </Card.Content>
          </Card>
          {/* Data Storage Settings */}
          <Card>
            <Card.Header>
              <Card.Title className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Data Storage Settings
              </Card.Title>
              <Card.Description>Configure how your data is stored, backed up, and managed</Card.Description>
            </Card.Header>
            <Card.Content className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="retention">Data Retention (days)</Label>
                <Select
                  value={settings.dataRetentionDays}
                  onValueChange={(value) => updateSetting('dataRetentionDays', value)}
                >
                  <Select.Trigger id="retention">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="30">30 days</Select.Item>
                    <Select.Item value="90">90 days</Select.Item>
                    <Select.Item value="365">1 year</Select.Item>
                    <Select.Item value="unlimited">Unlimited</Select.Item>
                  </Select.Content>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="backup">Backup Frequency</Label>
                <Select
                  value={settings.backupFrequency}
                  onValueChange={(value) => updateSetting('backupFrequency', value)}
                >
                  <Select.Trigger id="backup">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="hourly">Hourly</Select.Item>
                    <Select.Item value="daily">Daily</Select.Item>
                    <Select.Item value="weekly">Weekly</Select.Item>
                    <Select.Item value="monthly">Monthly</Select.Item>
                  </Select.Content>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="cache">Cache Size (MB)</Label>
                <Input
                  id="cache"
                  type="number"
                  value={settings.cacheSize}
                  onChange={(e) => updateSetting('cacheSize', e.target.value)}
                  placeholder="2048"
                />
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
          <Card.Content className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="shadow-none border-border/60">
                <Card.Header>
                  <Card.Title className="text-base">Theme & Texture</Card.Title>
                  <Card.Description>Customize your interface appearance</Card.Description>
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

              <Card className="shadow-none border-border/60">
                <Card.Header>
                  <Card.Title className="text-base">Locale Settings</Card.Title>
                  <Card.Description>Language and timezone preferences</Card.Description>
                </Card.Header>
                <Card.Content className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="language">Language</Label>
                    <Select
                      value={settings.language}
                      onValueChange={(value) => updateSetting('language', value)}
                    >
                      <Select.Trigger id="language">
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="english">English</Select.Item>
                        <Select.Item value="spanish">Spanish</Select.Item>
                        <Select.Item value="french">French</Select.Item>
                        <Select.Item value="german">German</Select.Item>
                      </Select.Content>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="timezone">Timezone</Label>
                    <Select
                      value={settings.timezone}
                      onValueChange={(value) => updateSetting('timezone', value)}
                    >
                      <Select.Trigger id="timezone">
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="America/New_York">Eastern Time</Select.Item>
                        <Select.Item value="America/Chicago">Central Time</Select.Item>
                        <Select.Item value="America/Denver">Mountain Time</Select.Item>
                        <Select.Item value="America/Los_Angeles">Pacific Time</Select.Item>
                        <Select.Item value="UTC">UTC</Select.Item>
                      </Select.Content>
                    </Select>
                  </div>
                </Card.Content>
              </Card>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <Button variant="outline" className="flex-1">
                Export Settings
              </Button>
              <Button variant="outline" className="flex-1">
                Import Settings
              </Button>
              <Button variant="destructive" className="flex-1">
                Reset All Settings
              </Button>
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
