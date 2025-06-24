import { useState, useEffect } from 'react';
import { Portal, usePageTitle } from '@ci/common';
import { Breadcrumb, Button, Card, Table, Toggle, Dialog, Input, Label, Select } from '@ci/shadcn';
import { AlertCircle, RefreshCw } from '@ci/shadcn/icons';

import { useAuth } from '@/hooks';

export interface Provider {
  readonly id: string;
  readonly name: string | null;
}

export interface Connection {
  readonly id: string;
  readonly name: string | null;
  readonly active: boolean;
  readonly clientid: string | null;
  readonly clientkey: string | null;
  readonly clientsecret: string | null;
  readonly schedule: string | null;
  readonly provider?: Provider;
}

export function ConnectorsPage() {
  usePageTitle('Connectors - Companion Intelligence');

  const [{ authToken }] = useAuth();

  const [Providers, setProviders] = useState<Provider[]>([]);
  const [Connections, setConnections] = useState<Connection[]>([]);
 
  const [changes, setChanges] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createFormData, setCreateFormData] = useState({
    name: '',
    providerId: '',
    clientid: '',
    clientkey: '',
    clientsecret: '',
    schedule: 'daily'
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchConnections = async () => {
    try {

      setLoading(true);
      setError(null);

      if (!authToken) {
        console.error('ConnectorsPage: No authentication token found');
        throw new Error('Authentication token not found');
      }

      console.log('ConnectorsPage: Making API request to /api/connections');
      const response = await fetch('/api/connections', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // Handle different HTTP error codes
        console.error(
          `ConnectorsPage: API request failed with status ${response.status}: ${response.statusText}`,
        );
        if (response.status === 401) {
          throw new Error('Unauthorized: You do not have permission to access this resource');
        } else if (response.status === 403) {
          throw new Error('Forbidden: Access denied');
        } else if (response.status === 404) {
          throw new Error('API endpoint not found');
        } else if (response.status >= 500) {
          throw new Error('Server error: Please try again later');
        } else {
          throw new Error(`Error fetching Connectors: ${response.statusText}`);
        }
      }

      console.log('ConnectorsPage: API request successful, parsing response');
      const data = await response.json();

      // Handle both array response and paginated response
      let ConnectionsData: Connection[] = [];
      if (Array.isArray(data)) {
        ConnectionsData = data;
      } else if (data.data && Array.isArray(data.data)) {
        ConnectionsData = data.data;
      } else {
        console.error('ConnectorsPage: Invalid response format', data);
        throw new Error('Invalid response format: Expected an array of Connectors');
      }

      console.log(`ConnectorsPage: Successfully fetched ${ConnectionsData.length} Connections`, {ConnectionsData});
      setConnections(ConnectionsData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      console.error('ConnectorsPage: Error in fetchConnectors():', errorMessage, err);
      setError(errorMessage);
    } finally {
      console.log('ConnectorsPage: Fetch operation completed');
      setLoading(false);
    }
  };

  const fetchProviders = async () => {
    try {

      setLoading(true);
      setError(null);

      if (!authToken) {
        console.error('ConnectorsPage: No authentication token found');
        throw new Error('Authentication token not found');
      }

      console.log('ConnectorsPage: Making API request to /api/providers');
      const response = await fetch('/api/providers', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // Handle different HTTP error codes
        console.error(
          `ConnectorsPage: API request failed with status ${response.status}: ${response.statusText}`,
        );
        if (response.status === 401) {
          throw new Error('Unauthorized: You do not have permission to access this resource');
        } else if (response.status === 403) {
          throw new Error('Forbidden: Access denied');
        } else if (response.status === 404) {
          throw new Error('API endpoint not found');
        } else if (response.status >= 500) {
          throw new Error('Server error: Please try again later');
        } else {
          throw new Error(`Error fetching Connectors: ${response.statusText}`);
        }
      }

      console.log('ConnectorsPage: API request successful, parsing response');
      const data = await response.json();

      // Handle both array response and paginated response
      let ProvidersData: Provider[] = [];
      if (Array.isArray(data)) {
        ProvidersData = data;
      } else if (data.data && Array.isArray(data.data)) {
        ProvidersData = data.data;
      } else {
        console.error('ConnectorsPage: Invalid response format', data);
        throw new Error('Invalid response format: Expected an array of Connectors');
      }

      console.log(`ConnectorsPage: Successfully fetched ${ProvidersData.length} Connectors`, {ProvidersData});
      setProviders(ProvidersData);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      console.error('ConnectorsPage: Error in fetchConnectors():', errorMessage, err);
      setError(errorMessage);
    } finally {
      console.log('ConnectorsPage: Fetch operation completed');
      setLoading(false);
    }
  };

  const fetchState = async () => {
    await fetchConnections()
    await fetchProviders()
  }

  useEffect(() => {
    console.log('ConnectorsPage: Component mounted, fetching Connectors');
    fetchState();
    return () => {
      console.log('ConnectorsPage: Component unmounting');
    };
  }, []);

  const truncateText = (text: string | undefined, maxLength: number = 50) => {
    if (!text) return 'N/A';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const connectionToggle = (connection:Connection) => {
    /*
    const c = connections.find(c => c.id === connector.id);
    if(c) {
        c.active = !c.active;
        setChanges(changes+1);
    }
    setConnectors(connections);
    */
  }

  const connectionConfigure = async (connection:Connection) => {
    console.log("configuring connection",connection)
    /*
    // @todo
    // generate a connection that will be related to a given provider
    // @todo
    // using a supplied provider attempt to do actual oauth2 login
    const res = await fetch("/api/connections");
    const {url} = await res.json();
    location.href = url
    */
  }

  const connectionCreate = async () => {
    console.log("connection create called");
    
    // Reset form and errors
    setCreateFormData({
      name: '',
      providerId: Providers.length > 0 ? Providers[0].id : '',
      clientid: '',
      clientkey: '',
      clientsecret: '',
      schedule: 'daily'
    });
    setCreateError(null);
    setShowCreateModal(true);
  }

  const handleCreateSubmit = async () => {
    try {
      setCreateLoading(true);
      setCreateError(null);

      if (!authToken) {
        throw new Error('Authentication token not found');
      }

      if (!createFormData.name || !createFormData.providerId) {
        throw new Error('Name and Provider are required');
      }

      console.log('Creating connection with data:', createFormData);

      const response = await fetch('/api/connections', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createFormData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Error creating connection: ${response.statusText}`);
      }

      const newConnection = await response.json();
      console.log('Successfully created connection:', newConnection);

      // Close modal and refresh the connections list
      setShowCreateModal(false);
      await fetchConnections();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      console.error('Error creating connection:', errorMessage, err);
      setCreateError(errorMessage);
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link href="/">Home</Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator className="hidden md:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Page>Connectors</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <Card className="w-full">
        <Card.Header className="flex flex-row items-center justify-between">
          <Card.Title className="text-2xl">Connections and Providers</Card.Title>
          <Button
            variant="outline"
            size="icon"
            disabled={loading}
            title="Refresh Providers"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={loading}
            onClick={connectionCreate}
            title="Create Connection"
          >Create
          </Button>
        </Card.Header>
        <Card.Content>
          {loading ? (
            <div className="text-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p>Loading...</p>
            </div>
          ) : error ? (
            <div className="bg-destructive/10 text-destructive rounded-md p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-medium">Error loading</h3>
                <p className="text-sm">{error}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={fetchState()}>
                  Try Again
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <hr></hr>
                <h1>Connections</h1>
                <hr></hr>
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>Name</Table.Head>
                      <Table.Head>Schedule</Table.Head>
                      <Table.Head>Last Run</Table.Head>
                      <Table.Head>Enabled</Table.Head>
                      <Table.Head>Configure</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {Providers.length === 0 ? (
                      <Table.Row>
                        <Table.Cell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No Providers found in the system
                        </Table.Cell>
                      </Table.Row>
                    ) : (
                      Connections.map((connection) => (
                        <Table.Row key={connection.id}>
                          <Table.Cell className="text-sm">{connection.name}</Table.Cell>
                          <Table.Cell className="text-sm">{truncateText(connection.schedule)}</Table.Cell>
                          <Table.Cell className="text-sm">-</Table.Cell>
                          <Table.Cell className="text-sm">
                            <Toggle aria-label="Toggle italic" onClick={() => { connectionToggle(connection) }} >
                                { connection.active ? "enabled" : "disabled" }
                            </Toggle>
                          </Table.Cell>
                          <Table.Cell className="text-sm">
                            <Button onClick={() => { connectionConfigure(connection) }}>
                                Configure
                            </Button>
                          </Table.Cell>
                        </Table.Row>
                      ))
                    )}
                  </Table.Body>
                </Table>
              </div>
              <div className="text-xs text-muted-foreground mt-4">Total Connections: {Connections.length}</div>
            </>
          )}
        </Card.Content>
      </Card>

      {/* Create Connection Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <Dialog.Content className="sm:max-w-[500px]">
          <Dialog.Header>
            <Dialog.Title>Create New Connection</Dialog.Title>
            <Dialog.Description>
              Configure a new connection to sync data from an external provider.
            </Dialog.Description>
          </Dialog.Header>
          
          <div className="grid gap-4 py-4">
            {createError && (
              <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
                {createError}
              </div>
            )}
            
            <div className="grid gap-2">
              <Label htmlFor="name">Connection Name</Label>
              <Input
                id="name"
                placeholder="My Google Connection"
                value={createFormData.name}
                onChange={(e) => setCreateFormData({ ...createFormData, name: e.target.value })}
                disabled={createLoading}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="provider">Provider</Label>
              <Select
                value={createFormData.providerId}
                onValueChange={(value) => setCreateFormData({ ...createFormData, providerId: value })}
                disabled={createLoading}
              >
                <Select.Trigger id="provider">
                  <Select.Value placeholder="Select a provider" />
                </Select.Trigger>
                <Select.Content>
                  {Providers.map((provider) => (
                    <Select.Item key={provider.id} value={provider.id}>
                      {provider.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="clientid">Client ID (Optional)</Label>
              <Input
                id="clientid"
                placeholder="your-client-id"
                value={createFormData.clientid}
                onChange={(e) => setCreateFormData({ ...createFormData, clientid: e.target.value })}
                disabled={createLoading}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="clientkey">Client Key (Optional)</Label>
              <Input
                id="clientkey"
                placeholder="your-client-key"
                value={createFormData.clientkey}
                onChange={(e) => setCreateFormData({ ...createFormData, clientkey: e.target.value })}
                disabled={createLoading}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="clientsecret">Client Secret (Optional)</Label>
              <Input
                id="clientsecret"
                type="password"
                placeholder="your-client-secret"
                value={createFormData.clientsecret}
                onChange={(e) => setCreateFormData({ ...createFormData, clientsecret: e.target.value })}
                disabled={createLoading}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="schedule">Sync Schedule</Label>
              <Select
                value={createFormData.schedule}
                onValueChange={(value) => setCreateFormData({ ...createFormData, schedule: value })}
                disabled={createLoading}
              >
                <Select.Trigger id="schedule">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="hourly">Hourly</Select.Item>
                  <Select.Item value="daily">Daily</Select.Item>
                  <Select.Item value="weekly">Weekly</Select.Item>
                </Select.Content>
              </Select>
            </div>
          </div>

          <Dialog.Footer>
            <Button
              variant="outline"
              onClick={() => setShowCreateModal(false)}
              disabled={createLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateSubmit}
              disabled={createLoading || !createFormData.name || !createFormData.providerId}
            >
              {createLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                'Create Connection'
              )}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </>
  );
}
