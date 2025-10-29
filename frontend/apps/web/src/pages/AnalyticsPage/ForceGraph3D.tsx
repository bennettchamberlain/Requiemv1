import { useEffect, useMemo, useRef, useState } from 'react';

import type { LinkObject as ForceGraphLink, NodeObject as ForceGraphNode } from 'force-graph';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
} from 'three';

import type { GraphLink, GraphNode } from './use-graph-overview';

export interface ForceGraph3DProps {
  nodes: GraphNode[];
  links: GraphLink[];
  highlightedNodeId?: string | null;
  centerNodeId?: string | null;
  selectedNodeId?: string | null;
  onNodeSelect?: (nodeId: string) => void;
  height?: number;
}

interface TransformedNode extends GraphNode {
  name: string;
  entityType: string;
  color: string;
}

type GraphNodeObject = ForceGraphNode<TransformedNode> & TransformedNode & { id: string };

type GraphLinkObject = ForceGraphLink<
  GraphNodeObject,
  { relationship_type: string; relationshipType?: string; strength?: number }
>;

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

export function ForceGraph3DView({
  nodes,
  links,
  centerNodeId,
  selectedNodeId,
  onNodeSelect,
  height = 600,
}: ForceGraph3DProps) {
  const graphRef = useRef<ForceGraphMethods | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [activeParticleType, setActiveParticleType] = useState<string | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });

    observer.observe(element);
    setContainerWidth(element.offsetWidth);

    return () => observer.disconnect();
  }, []);

  const graphData = useMemo(() => {
    const transformedNodes = nodes.map((node) => ({
      ...node,
      name: node.name ?? node.entity_type ?? 'Unknown',
      entityType: node.entity_type,
      color: getTypeColor(node.entity_type),
    })) as GraphNodeObject[];

    const transformedLinks = links.map((link) => ({
      ...link,
      relationshipType: link.relationship_type,
    })) as GraphLinkObject[];

    return {
      nodes: transformedNodes,
      links: transformedLinks,
    };
  }, [nodes, links]);

  const entityTypes = useMemo(() => {
    const types = new Set<string>();
    graphData.nodes.forEach((node) => {
      if (node.entityType) {
        types.add(node.entityType);
      }
    });

    return Array.from(types)
      .sort((a, b) => a.localeCompare(b))
      .map((type) => ({ type, color: getTypeColor(type) }));
  }, [graphData.nodes]);

  useEffect(() => {
    if (entityTypes.length === 0) {
      return;
    }

    let currentIndex = 0;
    setActiveParticleType(entityTypes[0].type);

    const interval = setInterval(() => {
      currentIndex = (currentIndex + 1) % entityTypes.length;
      setActiveParticleType(entityTypes[currentIndex].type);
    }, 5000);

    return () => clearInterval(interval);
  }, [entityTypes]);

  useEffect(() => {
    if (!graphRef.current || !centerNodeId) {
      return;
    }

    const targetNode = graphData.nodes.find((node) => node.id === centerNodeId);
    if (!targetNode) {
      return;
    }

    const lookAt = {
      x: typeof targetNode.x === 'number' ? targetNode.x : 0,
      y: typeof targetNode.y === 'number' ? targetNode.y : 0,
      z: typeof targetNode.z === 'number' ? targetNode.z : 0,
    };

    graphRef.current.cameraPosition({ x: lookAt.x, y: lookAt.y, z: 300 }, lookAt, 1000);
  }, [centerNodeId, graphData.nodes]);

  const handleNodeClick = (node: GraphNodeObject) => {
    if (onNodeSelect && node.id) {
      onNodeSelect(node.id);
    }
  };

  const createNodeObject = (node: GraphNodeObject) => {
    const isCenter = node.id === centerNodeId;
    const isSelected = node.id === selectedNodeId;
    const size = isSelected ? 5 : isCenter ? 6 : 3;

    const geometry = new SphereGeometry(size, 32, 32);
    const material = new MeshLambertMaterial({
      color: node.color,
      emissive: isCenter ? node.color : 0x000000,
      emissiveIntensity: isCenter ? 1.2 : 0,
      transparent: true,
      opacity: 0.9,
    });
    const sphere = new Mesh(geometry, material);

    if (isCenter) {
      const glowGeometry = new SphereGeometry(size * 1.3, 32, 32);
      const glowMaterial = new MeshBasicMaterial({
        color: node.color,
        transparent: true,
        opacity: 0.3,
      });
      const glow = new Mesh(glowGeometry, glowMaterial);
      sphere.add(glow);
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context) {
      canvas.width = 256;
      canvas.height = 64;
      context.fillStyle = isCenter ? '#ffffff' : 'rgba(255, 255, 255, 0.9)';
      context.font = isCenter ? 'bold 28px Arial' : '20px Arial';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(node.name, 128, 32);
    }

    const texture = new CanvasTexture(canvas);
    const spriteMaterial = new SpriteMaterial({ map: texture, transparent: true });
    const sprite = new Sprite(spriteMaterial);
    sprite.scale.set(20, 5, 1);
    sprite.position.set(0, size + 4, 0);

    const group = new Group();
    group.add(sphere);
    group.add(sprite);

    return group;
  };

  const getLinkParticles = (link: GraphLinkObject) => {
    if (!activeParticleType) {
      return 0;
    }

    const resolveNodeId = (endpoint: GraphLinkObject['source']) => {
      if (typeof endpoint === 'string' || typeof endpoint === 'number') {
        return String(endpoint);
      }

      if (endpoint && typeof endpoint === 'object' && 'id' in endpoint && endpoint.id != null) {
        return String(endpoint.id);
      }

      return undefined;
    };

    const sourceId = resolveNodeId(link.source);
    const targetId = resolveNodeId(link.target);

    if (!sourceId || !targetId) {
      return 0;
    }

    const sourceNode = graphData.nodes.find((node) => node.id === sourceId);
    const targetNode = graphData.nodes.find((node) => node.id === targetId);

    const isActive =
      sourceNode?.entityType === activeParticleType || targetNode?.entityType === activeParticleType;

    if (!isActive) {
      return 0;
    }

    const linkHash = `${sourceId}-${targetId}`.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

    return linkHash % 10 < 3 ? 1 : 0;
  };

  const getParticleColor = () => {
    if (!activeParticleType) {
      return 'rgba(255, 255, 255, 0.8)';
    }

    return getTypeColor(activeParticleType);
  };

  const graphWidth = containerWidth > 0 ? containerWidth : 600;

  return (
    <div ref={containerRef} style={{ width: '100%', height: `${height}px`, position: 'relative' }}>
      <ForceGraph3D
        ref={graphRef}
        graphData={graphData}
        width={graphWidth}
        height={height}
        nodeLabel={(node) => {
          const typed = node as GraphNodeObject;

          return `${typed.name} (${typed.entityType})`;
        }}
        nodeThreeObject={(node) => createNodeObject(node as GraphNodeObject)}
        nodeThreeObjectExtend
        linkColor={() => 'rgba(255, 255, 255, 0.25)'}
        linkWidth={1}
        linkOpacity={0.6}
        linkDirectionalParticles={getLinkParticles}
        linkDirectionalParticleWidth={0.7}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleColor={getParticleColor}
        onNodeClick={handleNodeClick}
        backgroundColor="rgba(0, 0, 0, 0)"
        showNavInfo={false}
        enableNodeDrag
        enableNavigationControls
        controlType="orbit"
        d3VelocityDecay={0.3}
        d3AlphaDecay={0.02}
        warmupTicks={100}
        cooldownTicks={200}
      />
    </div>
  );
}
