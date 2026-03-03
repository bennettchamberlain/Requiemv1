import { useState } from 'react';

import { Portal, usePageTitle } from '@ci/common';
import { Breadcrumb, Button, Card, Input, Label, Select, Switch, Badge, Alert } from '@ci/shadcn';
import {
  Database,
  Key,
  Brain,
  RefreshCw,
  Settings,
  Save,
  Eye,
  EyeOff,
  Info,
} from '@ci/shadcn/icons';
import { Link } from 'react-router-dom';

import { PageContent } from '@/components/layout';
import { ModelSelector } from '@/components/ModelSelector';
import { ColorPicker, TexturePicker } from '@/components/ThemePicker';
import { gql } from '@/graphql';

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
`);

interface SettingsState {
  // Data Storage
  dataRetentionDays: string;
  backupFrequency: string;
  cacheSize: string;

  oauth: {
    google: {
      clientId: string;
      secretKey: string;
    };
    microsoft: {
      clientId: string;
      secretKey: string;
    };
    facebook: {
      clientId: string;
      secretKey: string;
    };
  }

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
        secretKey: '',
      },
      microsoft: {
        clientId: '',
        secretKey: '',
      },
      facebook: {
        clientId: '',
        secretKey: '',
      }
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
    googleSecretKey: false,
    microsoftClientId: false,
    microsoftSecretKey: false,
    facebookClientId: false,
    facebookSecretKey: false,
  });

  const [unsavedChanges, setUnsavedChanges] = useState(false);

  const { data, loading: queryLoading } = useQuery(GET_PROVIDERS, {
    skip: !id,
  });

  const updateSetting = (key: string, value: string | boolean) => {
    console.log('updateSetting', key, value);
    setSettings((prev) => {
      const keys = key.split('.');
      if (keys.length === 1) {
        return { ...prev, [key]: value };
      }

      // Deep clone and update nested value
      const updated = { ...prev };
      let current: any = updated;

      for (let i = 0; i < keys.length - 1; i++) {
        current[keys[i]] = { ...current[keys[i]] };
        current = current[keys[i]];
      }

      current[keys[keys.length - 1]] = value;
      return updated;
    });
    console.log('new settings', settings)
    setUnsavedChanges(true);
  };

  const toggleKeyVisibility = (keyName: string) => {
    setShowKeys((prev) => ({ ...prev, [keyName]: !prev[keyName] }));
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
                OAuth Provider Tokens
              </Card.Title>
              <Card.Description>Use your own OAuth app's credentials for connecting to Google, Facebook, Microsoft, etc.</Card.Description>
            </Card.Header>
            <Card.Content className="space-y-4">
              <div className="grid gap-2">
                <div className="grid gap-2">
                  <Label htmlFor="googleClientId">Google Client ID</Label>
                  <div className="flex gap-2">
                    <Input
                      id="meta"
                      type={showKeys.googleClientId ? 'text' : 'password'}
                      value={settings.oauth.google.clientId}
                      onChange={(e) => updateSetting('oauth.google.clientId', e.target.value)}
                      className="flex-1"
                    />
                    <Button variant="outline" size="icon" onClick={() => toggleKeyVisibility('googleClientId')}>
                      {showKeys.googleClientId ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="grid gap-2">
                <div className="grid gap-2">
                  <Label htmlFor="googleClientId">Google Secret Key</Label>
                  <div className="flex gap-2">
                    <Input
                      id="meta"
                      type={showKeys.googleSecretKey ? 'text' : 'password'}
                      value={settings.oauth.google.secretKey}
                      onChange={(e) => updateSetting('oauth.google.secretKey', e.target.value)}
                      className="flex-1"
                    />
                    <Button variant="outline" size="icon" onClick={() => toggleKeyVisibility('googleSecretKey')}>
                      {showKeys.googleSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="grid gap-2">
                <div className="grid gap-2">
                  <Label htmlFor="googleClientId">Microsoft Client ID</Label>
                  <div className="flex gap-2">
                    <Input
                      id="meta"
                      type={showKeys.microsoftClientId ? 'text' : 'password'}
                      value={settings.oauth.microsoft.clientId}
                      onChange={(e) => updateSetting('oauth.microsoft.clientId', e.target.value)}
                      className="flex-1"
                    />
                    <Button variant="outline" size="icon" onClick={() => toggleKeyVisibility('microsoftClientId')}>
                      {showKeys.microsoftClientId ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="grid gap-2">
                <div className="grid gap-2">
                  <Label htmlFor="googleClientId">Microsoft Secret Key</Label>
                  <div className="flex gap-2">
                    <Input
                      id="meta"
                      type={showKeys.microsoftSecretKey ? 'text' : 'password'}
                      value={settings.oauth.microsoft.secretKey}
                      onChange={(e) => updateSetting('oauth.microsoft.secretKey', e.target.value)}
                      className="flex-1"
                    />
                    <Button variant="outline" size="icon" onClick={() => toggleKeyVisibility('microsoftSecretKey')}>
                      {showKeys.microsoftSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="grid gap-2">
                <div className="grid gap-2">
                  <Label htmlFor="googleClientId">Facebook Client ID</Label>
                  <div className="flex gap-2">
                    <Input
                      id="meta"
                      type={showKeys.facebookClientId ? 'text' : 'password'}
                      value={settings.oauth.facebook.clientId}
                      onChange={(e) => updateSetting('oauth.facebook.clientId', e.target.value)}
                      className="flex-1"
                    />
                    <Button variant="outline" size="icon" onClick={() => toggleKeyVisibility('facebookClientId')}>
                      {showKeys.facebookClientId ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="grid gap-2">
                <div className="grid gap-2">
                  <Label htmlFor="googleClientId">Facebook Secret Key</Label>
                  <div className="flex gap-2">
                    <Input
                      id="meta"
                      type={showKeys.facebookSecretKey ? 'text' : 'password'}
                      value={settings.oauth.facebook.secretKey}
                      onChange={(e) => updateSetting('oauth.facebook.secretKey', e.target.value)}
                      className="flex-1"
                    />
                    <Button variant="outline" size="icon" onClick={() => toggleKeyVisibility('facebookSecretKey')}>
                      {showKeys.facebookSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
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
    </>
  );
}
