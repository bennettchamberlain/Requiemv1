import { type ReactNode, useState } from 'react';

import { isReference, type Reference, useMutation, useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import {
  Breadcrumb,
  Card,
  Label,
  Button,
  Dialog,
  Input,
  Select,
  useToast,
  Form,
  useForm,
  formDataResolver,
  formDataSchema as s,
} from '@ci/shadcn';
import { AlertCircle, RefreshCw, Settings, Trash2 } from '@ci/shadcn/icons';
import { useNavigate, useParams, Link } from 'react-router-dom';

import { PageContent } from '@/components/layout';
import { gql, makeFragmentData } from '@/graphql';
import { useAuth } from '@/hooks';
import { Endpoints, ENDPOINTS_FRAGMENT } from '@/pages/ProviderPage/Endpoints';
import { useConnectService } from '@/pages/ProviderPage/useConnectService';

export interface Provider {
  readonly id: string;
  readonly name?: string | null;
  readonly endpoints: {
    name: string;
    description: string;
  }[];
}

export interface Connection {
  readonly id: string;
  readonly name?: string | null;
  readonly active: boolean;
  readonly externalId?: string | null;
  readonly schedule?: string | null;
  readonly tokenExpiry?: Date | null;
  readonly provider?: Provider;
  readonly activeEndpoints?: string[];
  readonly needsReauth: boolean;
  lastSyncedAt?: string;
}

interface EndpointStatus {
  [endpointName: string]: {
    lastSuccess?: Date;
    lastFailure?: Date;
    error?: Record<string, unknown>;
  };
}

export const EditConnectFormSchema = s.object({
  endpoints: s.array(s.string()).nullable().default(null),
});

export type EditConnectFormData = s.input<typeof EditConnectFormSchema>;

const GET_CONNECTION = gql(`
  query GetConnection($id: ID!) {
    connection(id: $id) {
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
        endpoints {
          name
          description
        }
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
          provider {
              id
              name
              endpoints {
                name
                description
              }
          }
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

const GET_CONNECTION_SYNC_JOBS = gql(`
  query GetConnectionSyncJobs($connectionId: ID!) {
    connectionSyncJobs(connectionId: $connectionId) {
      edges {
        cursor
        node {
          id
          cursor
          endpointName
          nextCursor
          connectionId
          status
          type
          createdAt
          updatedAt
          completedAt
          error
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
`);

export function ConnectionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [{ authToken }] = useAuth();

  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState({
    name: '',
    schedule: '1 hour',
  });
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [{ endpoints, setEndpoints }] = useConnectService();

  const { data, loading } = useQuery(GET_CONNECTION, {
    variables: {
      id: GlobalUID.encode('connection', id!),
    },
  });

  const { data: syncJobData } = useQuery(GET_CONNECTION_SYNC_JOBS, {
    variables: {
      connectionId: GlobalUID.encode('connection', id!),
    },
  });

  console.log('syncJobData', syncJobData);

  const connection = data?.connection;
  const syncJobs = syncJobData?.connectionSyncJobs.edges.map((edge) => edge.node) || [];

  const endpointStatus: EndpointStatus = {};

  for (const syncJob of syncJobs) {
    if (!endpointStatus[syncJob.endpointName]) {
      endpointStatus[syncJob.endpointName] = {};
    }

    if (syncJob.status === 'success' && !endpointStatus[syncJob.endpointName].lastSuccess) {
      endpointStatus[syncJob.endpointName].lastSuccess = new Date(syncJob.completedAt);
    }

    if (syncJob.status === 'failed' && !endpointStatus[syncJob.endpointName].lastFailure) {
      endpointStatus[syncJob.endpointName].lastFailure = new Date(syncJob.completedAt);
      endpointStatus[syncJob.endpointName].error = syncJob.error;
    }
  }

  console.log('endpointStatus', endpointStatus);

  const [updateConnection] = useMutation(UPDATE_CONNECTION);

  const [deleteConnection, { loading: deleteLoading }] = useMutation(DELETE_CONNECTION, {
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

  const form = useForm<EditConnectFormData>({
    resolver: formDataResolver(EditConnectFormSchema),
    shouldUnregister: false,
  });

  usePageTitle(
    connection?.name
      ? `Connection - ${connection.name} - Companion Intelligence`
      : 'Connection - Companion Intelligence',
  );

  const handleEditSubmit = async () => {
    try {
      setModalLoading(true);
      setModalError(null);

      if (!authToken || !connection) {
        throw new Error('Authentication token or connection not found');
      }

      if (!editFormData.name) {
        throw new Error('Name is required');
      }

      await updateConnection({
        variables: {
          input: {
            id: connection.id,
            name: editFormData.name || '',
            schedule: editFormData.schedule || '1 hour',
            activeEndpoints: endpoints,
          },
        },
      });

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

  const handleDeleteConnection = async () => {
    if (
      !confirm(
        'Are you sure you want to delete this connection? Data from this connection will not be deleted.',
      )
    ) {
      return;
    }

    try {
      await deleteConnection({
        variables: {
          input: {
            id: connection!.id,
          },
        },
      });

      toast.success('Connection deleted successfully');
      navigate('/connections');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      console.error('Error deleting connection:', errorMessage, err);
      toast.error(errorMessage);
    }
  };

  const handleReauthConnection = async () => {
    try {
      const response = await fetch(
        `/api/connections/${GlobalUID.parse('connection', connection!.id)}/connect`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Error getting new auth URL: ${response.statusText}`);
      }

      const data = await response.json();
      window.location.href = data.url;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      console.error('Error reauthorizing connection:', errorMessage, err);
      toast.error(errorMessage);
    }
  };

  const connectionEdit = () => {
    if (connection) {
      setEditFormData({
        name: connection.name || '',
        schedule: connection.schedule || '1 hour',
      });
      setModalError(null);
      setShowEditModal(true);
    }
  };

  let content: ReactNode | null = null;

  if (loading) {
    content = <LoadingPage />;
  } else if (connection == null) {
    content = <EmptyState icon={<Settings size={48} />} message="Connection not found" />;
  } else {
    content = (
      <PageContent>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">{connection.name}</h1>
          <div className="flex gap-2">
            {connection.needsReauth && (
              <Button
                variant="outline"
                onClick={handleReauthConnection}
                className="text-yellow-600 dark:text-yellow-500 hover:text-yellow-700 dark:hover:text-yellow-400"
              >
                <AlertCircle className="h-4 w-4 mr-2" />
                Reauthorize Connection
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={connectionEdit}>
              <Settings className="h-4 w-4 mr-2" />
              Edit
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDeleteConnection} disabled={deleteLoading}>
              {deleteLoading ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete
            </Button>
          </div>
        </div>

        <Card>
          <Card.Content className="p-6 flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Label>Provider</Label>
              <div className="text-sm">{connection.provider?.name || 'N/A'}</div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>External ID</Label>
              <div className="text-sm">{connection.externalId || 'N/A'}</div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Update Schedule</Label>
              <div className="text-sm">{connection.schedule || 'N/A'}</div>
            </div>

            {connection.needsReauth && (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0 text-yellow-600 dark:text-yellow-500" />
                <div>
                  <h3 className="font-medium text-yellow-900 dark:text-yellow-100">
                    Connection Needs Reauthorization
                  </h3>
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    This connection requires reauthorization to continue syncing data.
                  </p>
                </div>
              </div>
            )}

            {Object.keys(endpointStatus).length > 0 &&
              Object.entries(endpointStatus).map(([endpointName, status]) => {
                const errorMessage =
                  // @ts-expect-error  Errors can vary in shape, so we try a few different paths for where it could be
                  status.error?.error?.details?.message || status.error?.error || 'Unknown error';

                return (status.lastFailure && !status.lastSuccess) ||
                  (status.lastFailure && status.lastSuccess && status.lastFailure > status.lastSuccess) ? (
                  <div
                    key={endpointName}
                    className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4 flex items-start gap-3"
                  >
                    <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0 text-red-600 dark:text-red-500" />
                    <div>
                      <h3 className="font-medium text-red-900 dark:text-red-100">
                        Issue with {endpointName} Endpoint
                      </h3>
                      <p className="text-sm text-red-800 dark:text-red-200">
                        The last sync attempt for this endpoint failed on{' '}
                        {status.lastFailure?.toLocaleString()}.
                      </p>
                      <p className="text-sm text-red-800 dark:text-red-200">Error logs: {errorMessage}</p>
                    </div>
                  </div>
                ) : null;
              })}
          </Card.Content>
        </Card>
      </PageContent>
    );
  }

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

            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link asChild>
                <Link to="/connections">Connections</Link>
              </Breadcrumb.Link>
            </Breadcrumb.Item>

            {connection && (
              <>
                <Breadcrumb.Separator className="hidden md:block" />
                <Breadcrumb.Item>
                  <Breadcrumb.Page>{connection.name}</Breadcrumb.Page>
                </Breadcrumb.Item>
              </>
            )}
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      {content}

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

                {connection?.provider && (
                  <div className="grid gap-2">
                    <Label>Provider</Label>
                    <div className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded-md">
                      {connection.provider.name} (cannot be changed)
                    </div>
                  </div>
                )}

                {connection?.externalId && (
                  <div className="grid gap-2">
                    <Label>External ID</Label>
                    <div className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded-md">
                      {connection.externalId} (cannot be changed)
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

              {connection?.provider && (
                <>
                  <div className="grid gap-2">Endpoints</div>
                  <Endpoints
                    provider={makeFragmentData(connection.provider, ENDPOINTS_FRAGMENT)}
                    setEndpoints={setEndpoints}
                    startEndpoints={connection.activeEndpoints}
                  />
                </>
              )}

              <Dialog.Footer>
                <Button
                  variant="outline"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowEditModal(false);
                  }}
                  disabled={modalLoading}
                >
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
