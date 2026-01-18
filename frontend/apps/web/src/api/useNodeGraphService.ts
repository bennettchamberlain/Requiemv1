import { useEffect, useState, useRef, useCallback } from 'react';

import { useAuth } from '@/hooks';

export interface NodeDetailsResponse {
  node: {
    entityId: string;
    entityType: string;
    name: string | null;
    description: string | null;
    properties: Record<string, unknown>;
  };
  relationships: Array<{
    relationshipId: string;
    relationshipType: string;
    direction: 'inbound' | 'outbound';
    properties: Record<string, unknown>;
    strength?: number;
    otherEntity: {
      entityId: string;
      entityType: string;
      name: string | null;
      description: string | null;
      properties: Record<string, unknown>;
    };
  }>;
}

export interface GraphNode {
  id: string;
  entity_id: string;
  entity_type: string;
  name: string | null;
  description: string | null;
  properties: Record<string, unknown>;
}

export interface GraphLink {
  id: string;
  relationship_id: string;
  source: string;
  target: string;
  relationship_type: string;
  strength: number;
  properties: Record<string, unknown>;
}

export interface Subgraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

function buildNeighborhoodGraph(details: NodeDetailsResponse, nodeLimit: number): Subgraph {
  const centerNode: GraphNode = {
    id: details.node.entityId,
    entity_id: details.node.entityId,
    entity_type: details.node.entityType,
    name: details.node.name,
    description: details.node.description,
    properties: details.node.properties ?? {},
  };

  const nodes: GraphNode[] = [centerNode];
  const links: GraphLink[] = [];

  const neighborSlots = Math.max(0, nodeLimit - 1);

  if (neighborSlots > 0) {
    const included = new Set<string>();

    for (const rel of details.relationships) {
      const other = rel.otherEntity;
      if (!other) {
        continue;
      }

      if (included.has(other.entityId)) {
        continue;
      }

      included.add(other.entityId);

      nodes.push({
        id: other.entityId,
        entity_id: other.entityId,
        entity_type: other.entityType,
        name: other.name,
        description: other.description,
        properties: other.properties ?? {},
      });

      const source = rel.direction === 'outbound' ? details.node.entityId : other.entityId;
      const target = rel.direction === 'outbound' ? other.entityId : details.node.entityId;

      links.push({
        id: rel.relationshipId,
        relationship_id: rel.relationshipId,
        source,
        target,
        relationship_type: rel.relationshipType,
        strength: rel.strength ?? 0.5,
        properties: rel.properties ?? {},
      });

      if (included.size >= neighborSlots) {
        break;
      }
    }
  }

  return { nodes, links };
}

interface Props {
  entityId?: string;
  nodeLimit?: number;
  skip?: boolean;
}

export function useNodeGraphService({ entityId, nodeLimit = 20, skip = false }: Props) {
  const [{ authToken }] = useAuth();

  const tokenRef = useRef(authToken);

  const [data, setData] = useState<Subgraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    tokenRef.current = authToken;
  }, [authToken]);

  const fetchNodeGraph = useCallback(async (id: string, limit: number) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/graph/node?entityId=${encodeURIComponent(id)}`, {
        headers: tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : undefined,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch node graph: ${response.statusText}`);
      }

      const rawData: NodeDetailsResponse = await response.json();
      const graphData = buildNeighborhoodGraph(rawData, limit);

      setData(graphData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error occurred'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (skip || !entityId) {
      return;
    }

    fetchNodeGraph(entityId, nodeLimit);
  }, [entityId, nodeLimit, skip, fetchNodeGraph]);

  return {
    data,
    loading,
    error,
    refresh: () => entityId && fetchNodeGraph(entityId, nodeLimit),
  };
}
