import { useState } from 'react';
import { isReference, useMutation, useQuery } from '@apollo/client';
import { GlobalUID } from '@ci/common';

import { Portal, usePageTitle } from '@ci/common';
import {
  Breadcrumb,
  Button,
  Table,
  Dialog,
  Input,
  Label,
  Select,
  useToast,
  Form,
  useForm,
  formDataResolver,
  formDataSchema as s,
} from '@ci/shadcn';
import { AlertCircle, RefreshCw, Settings, Trash2, Plus } from '@ci/shadcn/icons';
import { Link } from 'react-router-dom';

import { PageContent } from '@/components/layout';
import {gql, makeFragmentData, useFragment} from '@/graphql';
import { useAuth } from '@/hooks';
import { Endpoints, ENDPOINTS_FRAGMENT } from '@/pages/ProviderPage/Endpoints';
import { useConnectService } from '@/pages/ProviderPage/useConnectService';
import {GET_ITEM} from "@/pages/ItemPage/ItemPage.tsx";
import {ACTION_FRAGMENT} from "@/components/entities/grid/ActionGridItem.tsx";

export interface Provider {
  readonly id: string;
  readonly name: string | null;
  readonly endpoints: {
    name: string;
    description: string;
  }[];
}

export interface Connection {
  readonly id: string;
  readonly name: string | null;
  readonly active: boolean;
  readonly clientid: string | null;
  readonly clientkey: string | null;
  readonly clientsecret: string | null;
  readonly externalId: string | null;
  readonly schedule: string | null;
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
  readonly tokenExpiry: Date | null;
  readonly provider?: Provider;
  readonly activeEndpoints?: string[];
  readonly needsReauth: boolean;
  lastSyncedAt?: string;
}

export const EditConnectFormSchema = s.object({
  endpoints: s.array(s.string()).nullable().default(null),
});

export type EditConnectFormData = s.input<typeof EditConnectFormSchema>;

const CREATE_CONNECTION = gql(`
  mutation CreateConnection($input: CreateConnectionInput!) {
    createConnection(input: $input) {
      success
      connection {
        id
        name
        active
        schedule
        tokenExpiry
        syncState
        activeEndpoints
        providerId
        needsReauth
        externalId
      }
    }
  }
`);
const UPDATE_CONNECTION = gql(`
  mutation UpdateConnection($input: UpdateConnectionInput!) {
    updateConnection(input: $input) {
      success
      connection {
          id
          name
          active
          schedule
          tokenExpiry
          syncState
          activeEndpoints
          providerId
          needsReauth
          externalId
      }
    }
  }
`);


const DELETE_CONNECTION = gql(`
  mutation DeleteConnection($input: DeleteByIdInput!) {
    deleteConnection(input: $input) {
      success
      deletedId
    }
  }
`);

const GET_CONNECTION = gql(`
  query GetConnection($connectionId: ID!) {
    connection(id: $connectionId) {
      id
      name
      active
      schedule
      tokenExpiry
      syncState
      activeEndpoints
      providerId
      needsReauth
      externalId
      provider {
          id
          name
          ...ProviderEndpointsFragment
      }
    }
  }
`);

const GET_CONNECTIONS = gql(`
  query GetConnections {
    connections {
      edges {
        cursor
        node {
          id
          name
          active
          schedule
          tokenExpiry
          syncState
          activeEndpoints
          providerId
          needsReauth
          externalId
          provider {
            id
            name
            ...ProviderEndpointsFragment
          }
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
`)

export function ConnectionsPage() {
  usePageTitle('Connections - Companion Intelligence');

  const { toast } = useToast();

  const [{ authToken }] = useAuth();

  const [Connections, setConnections] = useState<Connection[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);
  const [editFormData, setEditFormData] = useState({
    name: '',
    schedule: '1 hour',
  });
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [{ endpoints, setEndpoints }] = useConnectService();

  console.log('selectedConnection', selectedConnection, selectedConnection?.activeEndpoints);

  const [createConnection, { createLoading }] = useMutation(CREATE_CONNECTION, {
    update(cache, { data }) {
      if (data?.createItem && data.createItem.success && data.createItem.item) {
        cache.writeQuery({
          query: GET_ITEM,
          variables: {
            id: data.createItem.item.id,
          },
          data: {
            item: data.createItem.item,
          },
        });

        cache.modify({
          fields: {
            items(existingItems = { edges: [] }) {
              const newItemRef = cache.writeFragment({
                data: data.createItem.item,
                fragment: gql(`
                  fragment NewItem on ItemType {
                    id
                    name
                    category
                    description
                    brand
                    model
                    currentValue
                  }
                `),
              });

              return {
                ...existingItems,
                edges: [{ node: newItemRef }, ...existingItems.edges],
              };
            },
          },
        });
      }
    },
  });

  const [updateConnection, { updateLoading }] = useMutation(UPDATE_CONNECTION, {
    update(cache, { data }) {
      const updatedConnectionId = data?.updateConnection?.connection?.id;

      if (updatedConnectionId) {
        cache.modify({
          fields: {
            connections(
              existingConnections:
                | {
                edges: { node: Reference }[];
              }
                | Reference = { edges: [] },
              { readField },
            ) {
              if (isReference(existingConnections)) {
                return existingConnections;
              }

              return {
                ...existingConnections,
                edges: existingConnections.edges.map((edge) => {
                  const edgeNodeId = readField('id', edge.node);

                  if (!data?.updateConnection?.connection) {
                    return edge;
                  }

                  return edgeNodeId !== updatedConnectionId
                    ? edge
                    : {
                      ...edge,
                      ...data.updateConnection.connection,
                    };
                }),
              };
            },
          },
        });
      }
    },
  });

  const [deleteConnection, { deleteLoading }] = useMutation(DELETE_CONNECTION, {
    update(cache, { data }) {
      const deletedConnectionId = data?.deleteConnection?.deletedId;

      if (deletedConnectionId) {
        cache.modify({
          fields: {
            connections(
              existingConnections:
                | {
                edges: { node: Reference }[];
              }
                | Reference = { edges: [] },
              { readField },
            ) {
              if (isReference(existingConnections)) {
                return existingConnections;
              }

              return {
                ...existingConnections,
                edges: existingConnections.edges.filter((edge) => {
                  const edgeNodeId = readField('id', edge.node);

                  return edgeNodeId !== deletedConnectionId;
                }),
              };
            },
          },
        });

        const normalizedId = cache.identify({
          id: deletedConnectionId,
          __typename: 'ConnectionType',
        });

        if (normalizedId) {
          cache.evict({ id: normalizedId });
          cache.gc();
        }
      }
    },
  });

  const { data: getConnection, loading: connectionLoading } = useQuery(GET_CONNECTION, {
    variables: {
      connectionId: GlobalUID.encode('item', selectedConnection?.id),
    },
  });

  const { data: getConnections, loading: connectionsLoading }= useQuery(GET_CONNECTIONS);

  console.log('getConnections', getConnections)

  const connections = getConnections?.connections.edges.map((edge) => edge.node) || [];
  console.log('connections', connections)

  const form = useForm<EditConnectFormData>({
    resolver: formDataResolver(EditConnectFormSchema),
    shouldUnregister: false,
  });

  const truncateText = (text: string | undefined, maxLength: number = 50) => {
    if (!text) {
      return 'N/A';
    }

    if (text.length <= maxLength) {
      return text;
    }

    return text.substring(0, maxLength) + '...';
  };

  const connectionEdit = (connection: Connection) => {
    console.log('connection edit called', connection);
    setSelectedConnection(connection);
    setEditFormData({
      name: connection.name || '',
      schedule: connection.schedule || '1 hour',
    });
    setModalError(null);
    setShowEditModal(true);
  };

  const handleEditSubmit = async () => {
    try {
      setModalLoading(true);
      setModalError(null);

      if (!authToken || !selectedConnection) {
        throw new Error('Authentication token or connection not found');
      }

      if (!editFormData.name) {
        throw new Error('Name is required');
      }

      console.log('Updating connection with data:', editFormData);

      await updateConnection({
        variables: {
          input: {
            id: selectedConnection!.id,
            name: editFormData.name || '',
            schedule: editFormData.schedule || '1 hour',
            activeEndpoints: endpoints,
          },
        },
      });

      // Close modal
      setShowEditModal(false);

      toast.success('Connection updated successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      console.error('Error updating connection:', errorMessage, err);
      setModalError(errorMessage);
    } finally {
      setModalLoading(false);
    }
  };

  const handleDeleteConnection = async (connectionId: string) => {
    if (
      !confirm(
        'Are you sure you want to delete this connection? Data from this connection will not be deleted.',
      )
    ) {
      return;
    }

    try {
      await deleteConnection(connectionId);

      toast.success('Connection deleted successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      console.error('Error deleting connection:', errorMessage, err);

      toast.error(errorMessage);
    } finally {
      setDeleteLoading(null);
    }
  };

  const handleSyncConnection = async (connectionId: string) => {
    if (!confirm('Are you sure you want to sync data for this connection?')) {
      return;
    }

    try {
      setDeleteLoading(connectionId);

      if (!authToken) {
        throw new Error('Authentication token not found');
      }

      const response = await fetch(`/api/connections/${connectionId}/sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Error syncing connection: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('Successfully synced connection:', result);

      // Update the connection's last sync time in the local state
      setConnections((prevConnections) =>
        prevConnections.map((conn) =>
          conn.id === connectionId ? { ...conn, lastSyncedAt: new Date().toISOString() } : conn,
        ),
      );

      toast.success(`Data synced successfully for connection: ${result.connection?.name || connectionId}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      console.error('Error syncing connection:', errorMessage, err);

      toast.error(errorMessage);
    } finally {
      setDeleteLoading(null);
    }
  };

  const handleReauthConnection = async (connectionId: string) => {
    const id = (GlobalUID.decode(connectionId)).id;
    const response = await fetch(`/api/connections/${id}/connect`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Error getting new auth URL: ${response.statusText}`);
    }

    const data = await response.json();

    window.location.href = data.url;
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
              <Breadcrumb.Page>Connections</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        <div className="flex flex-row items-center justify-between">
          <h1 className="text-2xl font-bold">Connections</h1>

          <Button variant="outline" size="icon" title="Create Connection" asChild>
            <Link to={'/connect'}>
              <Plus />
            </Link>
          </Button>
        </div>

        {connectionsLoading ? (
          <div className="text-center py-8">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto" />
            <p>Loading...</p>
          </div>
        ) : error ? (
          <div className="bg-destructive/10 text-destructive rounded-md p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-medium">Error loading</h3>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        ) : (
          <>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.Head>Name</Table.Head>
                  <Table.Head>Provider</Table.Head>
                  <Table.Head>External ID</Table.Head>
                  <Table.Head>Schedule</Table.Head>
                  <Table.Head>Actions</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {connections.map((connection) => (
                  <Table.Row key={connection.id}>
                    <Table.Cell
                      className={`text-sm ${connection.needsReauth ? 'text-yellow-600 dark:text-yellow-500' : ''}`}
                    >
                      {connection.name}
                    </Table.Cell>
                    <Table.Cell
                      className={`text-sm ${connection.needsReauth ? 'text-yellow-600 dark:text-yellow-500' : ''}`}
                    >
                      {connection.provider?.name || 'N/A'}
                    </Table.Cell>
                    <Table.Cell
                      className={`text-sm ${connection.needsReauth ? 'text-yellow-600 dark:text-yellow-500' : ''}`}
                    >
                      {connection.externalId}
                    </Table.Cell>
                    <Table.Cell
                      className={`text-sm ${connection.needsReauth ? 'text-yellow-600 dark:text-yellow-500' : ''}`}
                    >
                      {truncateText(connection.schedule ?? '')}
                    </Table.Cell>
                    <Table.Cell className="text-sm">
                      <div className="flex gap-2">
                        {connection.needsReauth && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-yellow-600 dark:text-yellow-500 hover:text-yellow-700 dark:hover:text-yellow-400"
                            disabled={deleteLoading === connection.id}
                            title="Connection needs reauthorization"
                            onClick={() => handleReauthConnection(connection.id)}
                          >
                            <AlertCircle className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => connectionEdit(connection)}
                          disabled={deleteLoading === connection.id}
                          title="Edit"
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteConnection(connection.id)}
                          disabled={deleteLoading === connection.id}
                          title="Delete"
                        >
                          {deleteLoading === connection.id ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleSyncConnection(connection.id)}
                          disabled={deleteLoading === connection.id}
                          title="Sync Data"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>

            <div className="text-xs text-muted-foreground">Total Connections: {Connections.length}</div>
          </>
        )}
      </PageContent>

      {/* Edit Connection Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <Dialog.Content className="sm:max-w-[500px]">
          <Dialog.Header>
            <Dialog.Title>Edit Connection</Dialog.Title>
            <Dialog.Description>Update the settings for this connection.</Dialog.Description>
          </Dialog.Header>

          <Form {...form}>
            <form className="relative flex flex-col gap-2">
              <div className="grid gap-4 py-4">
                {modalError && (
                  <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
                    {modalError}
                  </div>
                )}

                <div className="grid gap-2">
                  <Label htmlFor="edit-name">Connection Name</Label>
                  <Input
                    id="edit-name"
                    placeholder="My Google Connection"
                    value={editFormData.name}
                    onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                    disabled={modalLoading}
                  />
                </div>

                {selectedConnection?.provider && (
                  <div className="grid gap-2">
                    <Label>Provider</Label>
                    <div className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded-md">
                      {selectedConnection.provider.name} (cannot be changed)
                    </div>
                  </div>
                )}

                {selectedConnection?.externalId && (
                  <div className="grid gap-2">
                    <Label>External ID</Label>
                    <div className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded-md">
                      {selectedConnection.externalId} (cannot be changed)
                    </div>
                  </div>
                )}

                <div className="grid gap-2">
                  <Label htmlFor="edit-schedule">Sync Schedule</Label>
                  <Select
                    value={editFormData.schedule}
                    onValueChange={(value) => setEditFormData({ ...editFormData, schedule: value })}
                    disabled={modalLoading}
                  >
                    <Select.Trigger id="edit-schedule">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="1 min">1 Minute</Select.Item>
                      <Select.Item value="5 min">5 Minutes</Select.Item>
                      <Select.Item value="10 min">10 Minutes</Select.Item>
                      <Select.Item value="30 min">30 Minutes</Select.Item>
                      <Select.Item value="1 hour">1 Hour</Select.Item>
                      <Select.Item value="2 hours">2 Hours</Select.Item>
                      <Select.Item value="6 hours">6 Hours</Select.Item>
                      <Select.Item value="12 hours">12 Hours</Select.Item>
                      <Select.Item value="daily">Daily</Select.Item>
                      <Select.Item value="weekly">Weekly</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
              </div>

              {selectedConnection?.provider && (
                <>
                  <div className="grid gap-2">Endpoints</div>
                  <Endpoints
                    provider={makeFragmentData(selectedConnection.provider, ENDPOINTS_FRAGMENT)}
                    setEndpoints={setEndpoints}
                    startEndpoints={selectedConnection.activeEndpoints}
                  />
                </>
              )}

              <Dialog.Footer>
                <Button variant="outline" onClick={() => setShowEditModal(false)} disabled={modalLoading}>
                  Cancel
                </Button>
                <Button onClick={handleEditSubmit} disabled={modalLoading || !editFormData.name}>
                  {modalLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                      Saving...
                    </>
                  ) : (
                    'Save'
                  )}
                </Button>
              </Dialog.Footer>
            </form>
          </Form>
        </Dialog.Content>
      </Dialog>
    </>
  );
}
