import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge, Button, Input, Separator, Tabs } from '@ci/shadcn';
import { AlertCircle, Anchor, Loader2, Sparkles, Users } from '@ci/shadcn/icons';

import { useAuth } from '@/hooks';

import { ForceGraph, ForceGraph3DView, useGraphOverview } from '../../AnalyticsPage';

const TYPE_COLOR_PALETTE = [
  '#38bdf8',
  '#a855f7',
  '#f97316',
  '#22c55e',
  '#facc15',
  '#ec4899',
  '#14b8a6',
  '#60a5fa',
  '#f87171',
  '#c084fc',
];

const DEFAULT_SPAWN_LIMIT = 10;

function getTypeColor(entityType: string): string {
  if (!entityType) {
    return TYPE_COLOR_PALETTE[0];
  }

  const normalized = entityType.toLowerCase();
  if (normalized === 'location' || normalized === 'place') {
    return '#22c55e';
  }

  let hash = 0;
  for (let i = 0; i < entityType.length; i += 1) {
    hash = (hash << 5) - hash + entityType.charCodeAt(i);
    hash |= 0;
  }

  const index = Math.abs(hash) % TYPE_COLOR_PALETTE.length;

  return TYPE_COLOR_PALETTE[index];
}

interface GraphTabPanelProps {
  variant: 'desktop' | 'mobile';
}

function hashWithSeed(value: string, seed: string): number {
  const combined = `${seed}:${value}`;
  let hash = 0;

  for (let i = 0; i < combined.length; i += 1) {
    hash = (hash << 5) - hash + combined.charCodeAt(i);
    hash |= 0;
  }

  return hash;
}

const resolveEndpointId = (endpoint: unknown): string | undefined => {
  if (typeof endpoint === 'string' || typeof endpoint === 'number') {
    return String(endpoint);
  }

  if (endpoint && typeof endpoint === 'object' && 'id' in endpoint) {
    const candidate = (endpoint as { id?: unknown }).id;
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      return String(candidate);
    }
  }

  return undefined;
};

export function GraphTabPanel({ variant }: GraphTabPanelProps) {
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<string[]>([]);
  const [spawnLimitInput, setSpawnLimitInput] = useState(String(DEFAULT_SPAWN_LIMIT));
  const [nodeClickCounts, setNodeClickCounts] = useState<Record<string, number>>({});
  const [anchoringEnabled, setAnchoringEnabled] = useState(true);
  const previousVisibleRef = useRef<Set<string>>(new Set());

  const [{ authToken }] = useAuth();
  const { loading, error, subgraph, userEntityId, quickStats } = useGraphOverview(authToken, { maxDepth: 3 });

  const spawnLimit = useMemo(() => {
    const parsed = Number.parseInt(spawnLimitInput, 10);

    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }

    return DEFAULT_SPAWN_LIMIT;
  }, [spawnLimitInput]);

  const handleSpawnLimitBlur = useCallback(() => {
    const parsed = Number.parseInt(spawnLimitInput, 10);

    if (Number.isNaN(parsed) || parsed <= 0) {
      setSpawnLimitInput(String(DEFAULT_SPAWN_LIMIT));
    }
  }, [spawnLimitInput]);

  const rawNodes = subgraph?.nodes ?? [];
  const rawLinks = subgraph?.links ?? [];

  const adjacencyMap = useMemo(() => {
    const map = new Map<string, Set<string>>();

    for (const link of rawLinks) {
      const sourceId = resolveEndpointId(link.source);
      const targetId = resolveEndpointId(link.target);

      if (!sourceId || !targetId) {
        continue;
      }

      if (!map.has(sourceId)) {
        map.set(sourceId, new Set());
      }

      if (!map.has(targetId)) {
        map.set(targetId, new Set());
      }

      map.get(sourceId)!.add(targetId);
      map.get(targetId)!.add(sourceId);
    }

    return map;
  }, [rawLinks]);

  const getOrderedNeighbors = useCallback(
    (nodeId: string) => {
      const neighbors = adjacencyMap.get(nodeId);

      if (!neighbors) {
        return [] as string[];
      }

      return Array.from(neighbors).sort((a, b) => hashWithSeed(a, nodeId) - hashWithSeed(b, nodeId));
    },
    [adjacencyMap],
  );

  const getSpawnedNeighbors = useCallback(
    (nodeId: string) => {
      const orderedNeighbors = getOrderedNeighbors(nodeId);

      if (orderedNeighbors.length === 0) {
        return [] as string[];
      }

      const clickCount = nodeClickCounts[nodeId] ?? 0;

      if (clickCount === 0) {
        return [] as string[];
      }

      const effectiveLimit = Math.max(spawnLimit, 1);
      const limit = Math.min(orderedNeighbors.length, clickCount * effectiveLimit);

      return orderedNeighbors.slice(0, limit);
    },
    [getOrderedNeighbors, nodeClickCounts, spawnLimit],
  );

  useEffect(() => {
    if (rawNodes.length === 0) {
      setExpandedNodes([]);
      setNodeClickCounts({});
      setSelectedNodeId(null);

      return;
    }

    const existingIds = new Set(rawNodes.map((node) => node.id));
    const filtered = expandedNodes.filter((id) => existingIds.has(id));
    const initialId = userEntityId ?? rawNodes[0].id;

    if (!initialId) {
      return;
    }

    if (filtered.length === 0) {
      setExpandedNodes([initialId]);
      setNodeClickCounts({ [initialId]: 1 });
      setSelectedNodeId((current) => current ?? initialId);

      return;
    }

    if (filtered.length !== expandedNodes.length) {
      setExpandedNodes(filtered);
    }

    setNodeClickCounts((prev) => {
      let changed = false;
      const next: Record<string, number> = {};

      for (const id of filtered) {
        const existingCount = prev[id] ?? 1;
        next[id] = existingCount;

        if (prev[id] !== existingCount) {
          changed = true;
        }
      }

      if (Object.keys(prev).length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [expandedNodes, rawNodes, userEntityId]);

  const visibility = useMemo(() => {
    const set = new Set<string>();

    for (const nodeId of expandedNodes) {
      set.add(nodeId);
      getSpawnedNeighbors(nodeId).forEach((neighborId) => set.add(neighborId));
    }

    if (selectedNodeId) {
      set.add(selectedNodeId);
    }

    if (userEntityId) {
      set.add(userEntityId);
    }

    const ids = Array.from(set);

    return { ids, set };
  }, [expandedNodes, getSpawnedNeighbors, selectedNodeId, userEntityId]);

  const anchoredNodeIds = useMemo(() => {
    const previous = previousVisibleRef.current;
    const anchored: string[] = [];

    for (const id of visibility.ids) {
      if (previous.has(id)) {
        anchored.push(id);
      }
    }

    return anchoringEnabled ? anchored : [];
  }, [anchoringEnabled, visibility.ids]);

  useEffect(() => {
    previousVisibleRef.current = new Set(visibility.ids);
  }, [visibility.ids]);

  useEffect(() => {
    if (visibility.ids.length === 0) {
      setSelectedNodeId(null);

      return;
    }

    const visibleSet = new Set(visibility.ids);

    if (!selectedNodeId || !visibleSet.has(selectedNodeId)) {
      const fallback = userEntityId ?? visibility.ids[0];
      setSelectedNodeId(fallback ?? null);
    }
  }, [visibility.ids, selectedNodeId, userEntityId]);

  const visibleNodes = useMemo(() => {
    const visibleSet = new Set(visibility.ids);

    return rawNodes.filter((node) => visibleSet.has(node.id));
  }, [rawNodes, visibility.ids]);

  const visibleLinks = useMemo(() => {
    const visibleSet = new Set(visibility.ids);

    return rawLinks.filter((link) => {
      const sourceId = resolveEndpointId(link.source);
      const targetId = resolveEndpointId(link.target);

      return sourceId && targetId && visibleSet.has(sourceId) && visibleSet.has(targetId);
    });
  }, [rawLinks, visibility.ids]);

  const relatedLinks = useMemo(() => {
    if (!selectedNodeId) {
      return [] as typeof visibleLinks;
    }

    return visibleLinks.filter((link) => {
      const sourceId = resolveEndpointId(link.source);
      const targetId = resolveEndpointId(link.target);

      return sourceId === selectedNodeId || targetId === selectedNodeId;
    });
  }, [visibleLinks, selectedNodeId]);

  const selectedNode = useMemo(
    () => visibleNodes.find((node) => node.id === selectedNodeId) ?? null,
    [visibleNodes, selectedNodeId],
  );

  const handleNodeSelect = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      setExpandedNodes((prev) => (prev.includes(nodeId) ? prev : [...prev, nodeId]));

      setNodeClickCounts((prev) => {
        const totalNeighbors = adjacencyMap.get(nodeId)?.size ?? 0;
        if (totalNeighbors === 0) {
          return prev[nodeId] ? { ...prev, [nodeId]: 0 } : prev;
        }

        const effectiveLimit = Math.max(spawnLimit, 1);
        const maxClicks = Math.max(1, Math.ceil(totalNeighbors / effectiveLimit));
        const current = prev[nodeId] ?? 0;
        const nextValue = Math.min(maxClicks, current + 1);

        if (nextValue === current) {
          return prev;
        }

        return { ...prev, [nodeId]: nextValue };
      });
    },
    [adjacencyMap, spawnLimit],
  );

  const detailGridClass = variant === 'desktop' ? 'grid gap-4 md:grid-cols-3' : 'grid gap-4';

  if (loading) {
    return (
      <div className="flex h-[540px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[540px] items-center justify-center">
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (visibleNodes.length === 0) {
    return (
      <div className="flex h-[540px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-muted px-4 py-6 text-center text-muted-foreground">
        <Sparkles className="h-6 w-6" />
        <p className="text-sm">
          No graph data available yet. Start connecting memories to build your knowledge graph.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Knowledge Graph</h2>
          <p className="text-sm text-muted-foreground">
            Explore how memories, people, places, and events interconnect. Click nodes to reveal additional
            neighbors, or adjust the batch size to control how many load per click.
          </p>
        </div>

        <div className="space-y-1 md:text-right">
          <label
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            htmlFor="neighbor-limit"
          >
            Neighbors per click
          </label>
          <Input
            id="neighbor-limit"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            className="w-32 md:ml-auto"
            value={spawnLimitInput}
            onChange={(event) => setSpawnLimitInput(event.target.value)}
            onBlur={handleSpawnLimitBlur}
          />
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              size="sm"
              variant={anchoringEnabled ? 'default' : 'secondary'}
              onClick={() => setAnchoringEnabled((prev) => !prev)}
            >
              <Anchor className="mr-2 h-4 w-4" />
              {anchoringEnabled ? 'Anchoring on' : 'Anchoring off'}
            </Button>
          </div>
        </div>
      </div>

      <Tabs
        value={viewMode}
        onValueChange={(value) => setViewMode(value as '2d' | '3d')}
        className="space-y-4"
      >
        <Tabs.List className="grid w-[220px] grid-cols-2">
          <Tabs.Trigger value="2d">2D View</Tabs.Trigger>
          <Tabs.Trigger value="3d">3D View</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="2d">
          <div className="h-[520px] rounded-lg border bg-background/90 p-2">
            <ForceGraph
              nodes={visibleNodes}
              links={visibleLinks}
              centerNodeId={userEntityId ?? undefined}
              highlightedNodeId={selectedNodeId ?? undefined}
              selectedNodeId={selectedNodeId ?? undefined}
              onNodeSelect={handleNodeSelect}
              anchoredNodeIds={anchoredNodeIds}
              height={520}
            />
          </div>
        </Tabs.Content>

        <Tabs.Content value="3d">
          <div className="h-[520px] rounded-lg border bg-background/90 p-2">
            <ForceGraph3DView
              nodes={visibleNodes}
              links={visibleLinks}
              centerNodeId={userEntityId ?? undefined}
              selectedNodeId={selectedNodeId ?? undefined}
              onNodeSelect={handleNodeSelect}
              anchoredNodeIds={anchoredNodeIds}
              height={520}
            />
          </div>
        </Tabs.Content>
      </Tabs>

      <Separator />

      <div className={detailGridClass}>
        <div className="rounded-lg border bg-muted/30 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-primary" />
            Graph Summary
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Nodes</dt>
              <dd className="font-medium">{visibleNodes.length}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Relationships</dt>
              <dd className="font-medium">{visibleLinks.length}</dd>
            </div>
            {quickStats && (
              <>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Preferences</dt>
                  <dd className="font-medium">{quickStats.totalPreferences}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Dislikes</dt>
                  <dd className="font-medium">{quickStats.totalDislikes}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Family Size</dt>
                  <dd className="font-medium">{quickStats.familySize}</dd>
                </div>
              </>
            )}
          </dl>
        </div>

        <div className="md:col-span-2 space-y-3 rounded-lg border bg-muted/10 p-4">
          <h3 className="text-sm font-semibold">Entity Details</h3>
          {selectedNode ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold">{selectedNode.name ?? 'Untitled Entity'}</span>
                <Badge variant="outline" style={{ borderColor: getTypeColor(selectedNode.entity_type) }}>
                  {selectedNode.entity_type}
                </Badge>
              </div>
              {selectedNode.description && (
                <p className="text-muted-foreground">{selectedNode.description}</p>
              )}
              {selectedNode.properties && Object.keys(selectedNode.properties).length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Properties
                  </p>
                  <ul className="space-y-1">
                    {Object.entries(selectedNode.properties)
                      .slice(0, 8)
                      .map(([key, value]) => (
                        <li key={key} className="flex gap-2 text-xs">
                          <span className="min-w-[96px] text-muted-foreground">{key}</span>
                          <span className="max-w-[320px] truncate">{String(value)}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              {relatedLinks.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Connected Entities
                  </p>
                  <ul className="space-y-1">
                    {relatedLinks.slice(0, 8).map((link) => {
                      const sourceId = resolveEndpointId(link.source);
                      const targetId = resolveEndpointId(link.target);
                      const otherId = sourceId === selectedNode.id ? targetId : sourceId;
                      const targetNode = rawNodes.find((node) => node.id === otherId);

                      return (
                        <li key={link.id} className="flex items-center justify-between text-xs">
                          <span>{targetNode?.name ?? targetNode?.entity_type ?? 'Unknown'}</span>
                          <Badge variant="secondary">{link.relationship_type}</Badge>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select a node to view entity details.</p>
          )}
        </div>
      </div>
    </div>
  );
}
