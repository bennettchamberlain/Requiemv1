import { useMemo, useState } from 'react';

import { Portal, usePageTitle } from '@ci/common';
import { Badge, Breadcrumb, Button, Card, Drawer, Input, Skeleton } from '@ci/shadcn';

import { PageContent } from '@/components/layout';
import { useAuth } from '@/hooks';

import { ForceGraph } from './ForceGraph';
import { useGraphOverview } from './use-graph-overview';
import { useNodeDetails } from './use-node-details';

type GraphSummary = {
  nodeCount: number;
  linkCount: number;
  topTypes: Array<{ type: string; count: number }>;
};

export function KnowledgePage() {
  usePageTitle('Knowledge - Companion Intelligence');

  const [{ user, loading: authLoading, error: authError, authToken }] = useAuth();
  const {
    loading: graphLoading,
    error: graphError,
    subgraph,
    userEntityId,
    quickStats,
    currentUser,
  } = useGraphOverview(authToken);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [nodeLimitInput, setNodeLimitInput] = useState('10');
  const [activeType, setActiveType] = useState<string>('ALL');

  const {
    loading: nodeLoading,
    error: nodeError,
    data: nodeData,
  } = useNodeDetails(drawerOpen ? selectedNodeId : null, authToken);
  const [relationshipFilter, setRelationshipFilter] = useState<string>('ALL');

  const handleNodeSelect = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setDrawerOpen(true);
  };

  const availableTypes = useMemo(() => {
    if (!subgraph) {
      return new Set<string>();
    }

    const types = new Set<string>();
    for (const node of subgraph.nodes) {
      if (node.entity_type) {
        types.add(node.entity_type);
      }
    }

    return types;
  }, [subgraph]);

  const nodeLimit = useMemo(() => {
    const parsed = Number.parseInt(nodeLimitInput, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return 10;
    }

    return Math.min(parsed, 100);
  }, [nodeLimitInput]);

  const filteredGraph = useMemo(() => {
    if (!subgraph || !userEntityId) {
      return subgraph;
    }

    const centerNode = subgraph.nodes.find((node) => node.id === userEntityId);
    if (!centerNode) {
      return subgraph;
    }

    const others = subgraph.nodes.filter((node) => node.id !== userEntityId);

    let candidateNodes = others;
    if (activeType !== 'ALL') {
      candidateNodes = candidateNodes.filter((node) => node.entity_type === activeType);
    }

    const selectionLimit = Math.max(0, nodeLimit - 1);
    const limitedNodes =
      candidateNodes.length <= selectionLimit
        ? candidateNodes
        : pickRandomSubset(candidateNodes, selectionLimit);

    const selectedIds = new Set<string>([userEntityId, ...limitedNodes.map((node) => node.id)]);

    const nodes = subgraph.nodes.filter((node) => selectedIds.has(node.id));
    const links = subgraph.links.filter(
      (link) => selectedIds.has(link.source) && selectedIds.has(link.target),
    );

    return { nodes, links };
  }, [subgraph, userEntityId, activeType, nodeLimit]);

  const graphSummary = useMemo<GraphSummary>(() => {
    const fallback: GraphSummary = { nodeCount: 0, linkCount: 0, topTypes: [] };

    if (!subgraph) {
      return fallback;
    }

    const typeCounts = new Map<string, number>();
    for (const node of subgraph.nodes) {
      typeCounts.set(node.entity_type, (typeCounts.get(node.entity_type) ?? 0) + 1);
    }

    const topTypes = Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));

    return {
      nodeCount: subgraph.nodes.length,
      linkCount: subgraph.links.length,
      topTypes,
    };
  }, [subgraph]);

  if (authLoading) {
    return <div className="p-6">Loading analytics…</div>;
  }

  if (authError) {
    return <div className="p-6 text-red-600">Error: {String(authError)}</div>;
  }

  if (!user) {
    return <div className="p-6">Please log in to view analytics.</div>;
  }

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
              <Breadcrumb.Page>Knowledge</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <Card.Header>
              <Card.Title className="flex items-center gap-2">Knowledge Graph</Card.Title>
              <Card.Description>
                {currentUser ? `Connections around ${currentUser.name}` : 'Connections around your profile'}
              </Card.Description>
            </Card.Header>
            <Card.Content>
              {graphLoading ? (
                <Skeleton className="h-[420px] w-full" />
              ) : graphError ? (
                <p className="text-sm text-red-600">{graphError}</p>
              ) : filteredGraph && userEntityId ? (
                <ForceGraph
                  nodes={filteredGraph.nodes}
                  links={filteredGraph.links}
                  highlightedNodeId={userEntityId}
                  centerNodeId={userEntityId}
                  selectedNodeId={selectedNodeId}
                  onNodeSelect={handleNodeSelect}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No graph data available yet.</p>
              )}
            </Card.Content>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title>Graph Stats</Card.Title>
              <Card.Description>Live numbers from your personal graph</Card.Description>
            </Card.Header>
            <Card.Content className="space-y-4">
              <div className="space-y-2 text-sm">
                <StatLine label="Nodes in view" value={graphSummary.nodeCount} />
                <StatLine label="Relationships in view" value={graphSummary.linkCount} />
                <StatLine label="Total entities" value={quickStats?.totalEntities ?? '—'} />
                <StatLine label="Family connections" value={quickStats?.familySize ?? '—'} />
                <StatLine label="Preferences" value={quickStats?.totalPreferences ?? '—'} />
                <StatLine label="Dislikes" value={quickStats?.totalDislikes ?? '—'} />
              </div>

              {graphSummary.topTypes.length > 0 && (
                <div className="border-t pt-4">
                  <h3 className="text-sm font-medium mb-2">Top node types</h3>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {graphSummary.topTypes.map((item) => (
                      <li key={item.type} className="flex items-center justify-between">
                        <span>{item.type}</span>
                        <span>{item.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card.Content>
          </Card>
        </div>
        <Card>
          <Card.Header>
            <Card.Title>Filters</Card.Title>
            <Card.Description>Adjust which neighbors appear in the graph</Card.Description>
          </Card.Header>
          <Card.Content className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs uppercase text-muted-foreground" htmlFor="graph-node-limit">
                Node limit
              </label>
              <Input
                id="graph-node-limit"
                type="number"
                min={1}
                max={100}
                value={nodeLimitInput}
                onChange={(event) => setNodeLimitInput(event.target.value)}
                className="w-32"
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs uppercase text-muted-foreground">Entity types</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={activeType === 'ALL' ? 'default' : 'secondary'}
                  onClick={() => setActiveType('ALL')}
                >
                  All
                </Button>
                {Array.from(availableTypes)
                  .sort()
                  .map((type) => (
                    <Button
                      key={type}
                      type="button"
                      size="sm"
                      variant={activeType === type ? 'default' : 'secondary'}
                      onClick={() => setActiveType(type)}
                    >
                      {type}
                    </Button>
                  ))}
              </div>
            </div>
          </Card.Content>
        </Card>
      </PageContent>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Drawer.Content className="flex max-h-[85vh] flex-col">
          <Drawer.Header>
            <Drawer.Title>
              {nodeLoading
                ? 'Loading node…'
                : (nodeData?.node.name ?? nodeData?.node.entityType ?? 'Node details')}
            </Drawer.Title>
            <Drawer.Description>
              {nodeLoading ? 'Fetching the latest information from your graph' : (nodeError ?? '')}
            </Drawer.Description>
          </Drawer.Header>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto px-6 pb-6">
              {nodeLoading && <Skeleton className="h-24 w-full" />}

              {!nodeLoading && nodeData && (
                <div className="space-y-6">
                  <section className="space-y-2 text-sm">
                    <h3 className="text-xs uppercase text-muted-foreground">Node</h3>
                    <div className="rounded-lg border bg-background p-4">
                      <p className="text-base font-medium text-foreground">
                        {nodeData.node.name ?? nodeData.node.entityType}
                      </p>
                      {nodeData.node.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{nodeData.node.description}</p>
                      )}
                      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>
                          <dt>Entity ID</dt>
                          <dd className="font-mono text-[11px] text-foreground">{nodeData.node.entityId}</dd>
                        </div>
                        <div>
                          <dt>Type</dt>
                          <dd className="text-foreground">{nodeData.node.entityType}</dd>
                        </div>
                        <div>
                          <dt>Created</dt>
                          <dd>{new Date(nodeData.node.createdAt).toLocaleString()}</dd>
                        </div>
                        <div>
                          <dt>Updated</dt>
                          <dd>{new Date(nodeData.node.updatedAt).toLocaleString()}</dd>
                        </div>
                      </dl>
                    </div>
                  </section>

                  {Object.keys(nodeData.node.properties ?? {}).length > 0 && (
                    <section className="space-y-2 text-sm">
                      <h3 className="text-xs uppercase text-muted-foreground">Properties</h3>
                      <PropertyBlocks properties={nodeData.node.properties ?? {}} />
                    </section>
                  )}
                </div>
              )}

              {!nodeLoading && nodeError && <p className="text-sm text-red-600">{nodeError}</p>}
            </div>

            <section className="border-t bg-muted/50 px-6 py-4">
              <div className="mb-2 flex items-center justify-between text-xs uppercase text-muted-foreground">
                <span>Relationships</span>
                <span>{nodeData?.relationships.length ?? 0} linked</span>
              </div>
              {nodeLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : !nodeData || nodeData.relationships.length === 0 ? (
                <p className="text-xs text-muted-foreground">No relationships recorded.</p>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={relationshipFilter === 'ALL' ? 'default' : 'secondary'}
                      onClick={() => setRelationshipFilter('ALL')}
                    >
                      All
                    </Button>
                    {Array.from(
                      new Set(
                        nodeData.relationships
                          .map((rel) => rel.otherEntity?.entityType)
                          .filter((type): type is string => Boolean(type)),
                      ),
                    )
                      .sort()
                      .map((type) => (
                        <Button
                          key={type}
                          type="button"
                          size="sm"
                          variant={relationshipFilter === type ? 'default' : 'secondary'}
                          onClick={() => setRelationshipFilter(type)}
                        >
                          {type}
                        </Button>
                      ))}
                  </div>

                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {nodeData.relationships
                      .filter((rel) => {
                        if (relationshipFilter === 'ALL') {
                          return true;
                        }

                        return rel.otherEntity?.entityType === relationshipFilter;
                      })
                      .map((rel) => {
                        const canNavigate = !!rel.otherEntity;
                        const handleRelationshipClick = () => {
                          if (rel.otherEntity) {
                            handleNodeSelect(rel.otherEntity.entityId);
                          }
                        };

                        return (
                          <button
                            key={rel.relationshipId}
                            type="button"
                            disabled={!canNavigate}
                            onClick={handleRelationshipClick}
                            className="min-w-[220px] rounded-lg border bg-background p-4 text-left shadow-sm transition-colors hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{rel.direction === 'outbound' ? 'Outbound' : 'Inbound'}</span>
                              <span>{rel.relationshipType}</span>
                            </div>
                            {rel.otherEntity && (
                              <div className="mt-2 text-sm text-foreground">
                                <p className="font-medium">
                                  {rel.otherEntity.name ?? rel.otherEntity.entityType}
                                </p>
                                <p className="text-xs text-muted-foreground">{rel.otherEntity.entityId}</p>
                              </div>
                            )}
                            {Object.keys(rel.properties ?? {}).length > 0 && (
                              <div className="mt-3">
                                <PropertyBlocks properties={rel.properties ?? {}} size="sm" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                  </div>
                </>
              )}
            </section>
          </div>
        </Drawer.Content>
      </Drawer>
    </>
  );
}

function StatLine({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function pickRandomSubset<T>(items: T[], limit: number): T[] {
  if (limit <= 0) {
    return [];
  }

  const pool = [...items];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }

  return pool.slice(0, limit);
}

function PropertyBlocks({
  properties,
  size = 'md',
}: {
  properties: Record<string, unknown>;
  size?: 'sm' | 'md';
}) {
  const entries = Object.entries(properties ?? {});
  if (entries.length === 0) {
    return null;
  }

  const containerClass = size === 'sm' ? 'gap-2 text-xs' : 'gap-3 text-sm';
  const blockClass =
    size === 'sm' ? 'rounded-md border bg-muted/40 p-2' : 'rounded-md border bg-muted/40 p-3';

  return (
    <div className={`grid ${containerClass}`}>
      {entries.map(([key, value]) => (
        <div key={key} className={blockClass}>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium text-foreground">{key}</span>
            <Badge variant="secondary" className="uppercase tracking-wide text-[10px]">
              {typeof value}
            </Badge>
          </div>
          <p className="whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
            {formatPropertyValue(value)}
          </p>
        </div>
      ))}
    </div>
  );
}

function formatPropertyValue(value: unknown): string {
  if (value == null) {
    return 'null';
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '[unserializable]';
    }
  }

  return String(value);
}
