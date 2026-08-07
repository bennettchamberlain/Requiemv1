import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import type { GraphLink, GraphNode } from '@/api/useGraphOverview';
import { colorForRawType } from '@/components/entities/entityVisuals';

import { clampScale, fitTransform } from './fitTransform';
import {
  LABEL_GAP_PX,
  graphHeightForNodeCount,
  labelWidthPx,
  nodeRadius,
  relaxLabelCollisions,
  simulationBounds,
  standingLabelIds,
  truncateLabel,
} from './labelLayout';

type ForceNode = GraphNode & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  anchored?: boolean;
  /** How many links touch this node — drives its drawn size. */
  degree: number;
  /** Drawn radius, resolved once per layout so the simulation and the renderer agree. */
  radius: number;
  /** The label as drawn, clipped to the label budget. */
  label: string;
  /** Untruncated label, for the hover tooltip. */
  fullLabel: string;
  /** Drawn width of `label`, which is the horizontal room the layout has to reserve. */
  labelWidth: number;
  /** Never moved to resolve a label overlap. */
  pinned: boolean;
};

type SimulationLink = {
  id: string;
  sourceId: string;
  targetId: string;
  relationship_type: string;
  strength: number;
};

interface ForceGraphProps {
  nodes: GraphNode[];
  links: GraphLink[];
  highlightedNodeId?: string | null;
  centerNodeId?: string | null;
  height?: number;
  selectedNodeId?: string | null;
  onNodeSelect?: (nodeId: string) => void;
  anchoredNodeIds?: string[];
}

function useContainerWidth(defaultWidth: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(defaultWidth);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setWidth(entry.contentRect.width);
        }
      }
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return { ref, width } as const;
}

const REPULSION_STRENGTH = 1200;
const MIN_SPRING_LENGTH = 30;
const MAX_SPRING_LENGTH = 300;
const MIN_SPRING_STRENGTH = 0.025;
const MAX_SPRING_STRENGTH = 0.16;
const STRENGTH_CURVE_EXPONENT = 2.2;
const DAMPING = 0.85;
const MAX_TICKS = 240;
const MIN_ALPHA = 0.02;
const ALPHA_DECAY = 0.96;
/**
 * How much of each label overlap to resolve per tick. Under-relaxed on purpose: a node squeezed by
 * several neighbours converges instead of ping-ponging between them.
 */
const COLLISION_STRENGTH = 0.45;
/**
 * Budget for the passes run once the simulation settles, to land on a frame with no overlaps left
 * rather than whatever the last tick happened to leave.
 *
 * Generous because it is a CEILING, not a cost: a layout that has already had 240 ticks of repulsion
 * and per-tick separation is close to clean, so the loop exits after a handful of passes. Only a
 * genuine pile-up spends the budget, and relaxation converges by diffusion — a 25-node pile started
 * from a single spot measures ~580 passes, so a small bound would quietly give up on exactly the
 * case this exists for. Bounded at all so an unsatisfiable layout still terminates.
 */
const COLLISION_POLISH_PASSES = 600;

// Colour nodes by entity type from the shared LifeScope palette so the graph
// matches the map/list/gallery.
function getTypeColor(entityType: string): string {
  return colorForRawType(entityType);
}

function clampRelationshipStrength(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}

function getSpringLengthFromStrength(value: number): number {
  const normalized = clampRelationshipStrength(value);
  const curved = Math.pow(normalized, STRENGTH_CURVE_EXPONENT);

  return MAX_SPRING_LENGTH - curved * (MAX_SPRING_LENGTH - MIN_SPRING_LENGTH);
}

function getSpringStrengthFromRelationship(value: number): number {
  const normalized = clampRelationshipStrength(value);
  const curved = Math.pow(normalized, STRENGTH_CURVE_EXPONENT);

  return MIN_SPRING_STRENGTH + curved * (MAX_SPRING_STRENGTH - MIN_SPRING_STRENGTH);
}

function ForceGraphBase({
  nodes,
  links,
  highlightedNodeId,
  centerNodeId,
  selectedNodeId,
  onNodeSelect,
  anchoredNodeIds = [],
  height,
}: ForceGraphProps) {
  const { ref, width } = useContainerWidth(720);
  const [simNodes, setSimNodes] = useState<ForceNode[]>([]);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // A caller that sizes its own container (the graph explorer modal) keeps control of the height;
  // the entity panel, which does not, gets one that grows with how much there is to show.
  const canvasHeight = height ?? graphHeightForNodeCount(nodes.length);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const panStartRef = useRef({ x: 0, y: 0 });
  const translateStartRef = useRef({ x: 0, y: 0 });
  const previousPositionsRef = useRef<Map<string, ForceNode>>(new Map());
  const anchoredKey = useMemo(() => anchoredNodeIds.join('|'), [anchoredNodeIds]);
  const nodesKey = useMemo(() => nodes.map((node) => node.id).join('|'), [nodes]);
  const fittedKeyRef = useRef<string | null>(null);
  const viewerMovedCameraRef = useRef(false);

  // A new node set is a new picture, so it earns a new frame even if the viewer
  // moved the camera around the old one.
  useEffect(() => {
    viewerMovedCameraRef.current = false;
  }, [nodesKey]);

  const renderLinks = useMemo<SimulationLink[]>(
    () =>
      links.map((link) => ({
        id: link.id,
        sourceId: link.source,
        targetId: link.target,
        relationship_type: link.relationship_type,
        strength: link.strength,
      })),
    [links],
  );

  /** Link count per node, which is what node size encodes. */
  const degreeById = useMemo(() => {
    const degrees = new Map<string, number>();

    for (const link of renderLinks) {
      degrees.set(link.sourceId, (degrees.get(link.sourceId) ?? 0) + 1);
      degrees.set(link.targetId, (degrees.get(link.targetId) ?? 0) + 1);
    }

    return degrees;
  }, [renderLinks]);

  /** Who is one hop from whom, so hovering a node can pick out its own corner of the graph. */
  const neighborsById = useMemo(() => {
    const neighbors = new Map<string, Set<string>>();

    const connect = (from: string, to: string) => {
      const existing = neighbors.get(from);
      if (existing) {
        existing.add(to);
      } else {
        neighbors.set(from, new Set([to]));
      }
    };

    for (const link of renderLinks) {
      connect(link.sourceId, link.targetId);
      connect(link.targetId, link.sourceId);
    }

    return neighbors;
  }, [renderLinks]);

  /**
   * Which nodes carry a standing label.
   *
   * Anchored on `centerNodeId` ONLY. This feeds the layout effect, and the graph explorer passes its
   * live selection as `highlightedNodeId` — including that here would restart the whole simulation
   * on every node click and throw away the picture the viewer was reading. A selected or hovered
   * node still gets its label at render time, which costs nothing and moves nothing.
   */
  const standingLabels = useMemo(
    () => standingLabelIds(nodes, (id) => degreeById.get(id) ?? 0, [centerNodeId]),
    [centerNodeId, degreeById, nodes],
  );

  useEffect(() => {
    if (nodes.length === 0) {
      previousPositionsRef.current = new Map();
      setSimNodes([]);

      return;
    }

    const canvasWidth = width || 720;
    // The simulation lays out in a world sized for the labels that have to fit, which is larger than
    // the canvas once the graph is dense; `fitTransform` scales the result back down to the canvas.
    const { width: boundsWidth, height: boundsHeight } = simulationBounds(
      standingLabels.size,
      canvasWidth,
      canvasHeight,
    );
    const previousPositions = previousPositionsRef.current;

    const anchoredSet = new Set(anchoredNodeIds);

    const findNeighborPosition = (nodeId: string) => {
      for (const link of renderLinks) {
        if (link.sourceId === nodeId) {
          const neighbor = previousPositions.get(link.targetId);
          if (neighbor) {
            return { x: neighbor.x, y: neighbor.y };
          }
        } else if (link.targetId === nodeId) {
          const neighbor = previousPositions.get(link.sourceId);
          if (neighbor) {
            return { x: neighbor.x, y: neighbor.y };
          }
        }
      }

      return undefined;
    };

    const withOffset = (base?: { x: number; y: number }) => {
      if (!base) {
        return {
          x: boundsWidth / 2 + (Math.random() - 0.5) * 40,
          y: boundsHeight / 2 + (Math.random() - 0.5) * 40,
        };
      }

      const angle = Math.random() * Math.PI * 2;
      const distance = 60 + Math.random() * 30;

      return {
        x: base.x + Math.cos(angle) * distance,
        y: base.y + Math.sin(angle) * distance,
      };
    };

    const nodeCopies: ForceNode[] = nodes.map((node) => {
      const previous = previousPositions.get(node.id);
      const anchored = anchoredSet.has(node.id);

      // Drawn size and label extent are resolved ONCE, here, and carried on the node: the layout
      // has to reserve exactly the room the renderer will use, or the collision pass separates
      // boxes that are not the boxes on screen.
      const fullLabel = node.name ?? node.entity_type ?? '';
      // A node without a standing label is a bare dot that answers on hover, so the layout reserves
      // no horizontal room for it — which is the whole point of dropping the label.
      const labelled = standingLabels.has(node.id);
      const label = labelled ? truncateLabel(fullLabel) : '';
      const degree = degreeById.get(node.id) ?? 0;

      const shape = {
        degree,
        // Degree only — selection/highlight enlarge a node at RENDER time. Baking them in here
        // would rebuild the whole layout on every click for a few pixels on a single node.
        radius: nodeRadius(degree),
        label,
        fullLabel,
        labelWidth: label ? labelWidthPx(fullLabel) : 0,
        // The pinned centre node is the one thing on screen guaranteed to stay put; letting a
        // label overlap shove it would undo that.
        pinned: anchored || node.id === centerNodeId,
      };

      if (previous) {
        return {
          ...node,
          ...shape,
          x: previous.x,
          y: previous.y,
          vx: previous.vx ?? 0,
          vy: previous.vy ?? 0,
          anchored,
        };
      }

      const neighborPosition = findNeighborPosition(node.id);
      const position = withOffset(neighborPosition);

      return {
        ...node,
        ...shape,
        x: position.x,
        y: position.y,
        vx: 0,
        vy: 0,
        anchored,
      };
    });

    const nodeIndex = new Map<string, number>();
    nodeCopies.forEach((node, idx) => nodeIndex.set(node.id, idx));

    let tickCount = 0;
    let alpha = 1;
    let animationFrame = 0;

    const publishSnapshot = () => {
      const snapshot = nodeCopies.map((node) => ({ ...node }));
      setSimNodes(snapshot);
      previousPositionsRef.current = new Map(snapshot.map((node) => [node.id, node]));
    };

    // Identifies the picture being framed: the same nodes at the same canvas size
    // are the same shot, so they are fitted once.
    const fitKey = `${nodesKey}@${canvasWidth}x${canvasHeight}`;

    const fitToNodes = () => {
      if (viewerMovedCameraRef.current || fittedKeyRef.current === fitKey) {
        return;
      }

      // A pinned centre node is an explicit "put this in the middle"; the fit
      // reframes around it rather than overriding it. The anchor is in WORLD
      // coordinates, the canvas it is framed into is not.
      const anchor = centerNodeId ? { x: boundsWidth / 2, y: boundsHeight / 2 } : null;
      const fitted = fitTransform(nodeCopies, canvasWidth, canvasHeight, anchor);

      if (!fitted) {
        return;
      }

      fittedKeyRef.current = fitKey;
      setScale(fitted.scale);
      setTranslate(fitted.translate);
    };

    const clampToBounds = () => {
      for (const node of nodeCopies) {
        if (node.anchored || node.id === centerNodeId) {
          continue;
        }

        const padding = 32;
        node.x = Math.min(boundsWidth - padding, Math.max(padding, node.x));
        node.y = Math.min(boundsHeight - padding, Math.max(padding, node.y));
      }
    };

    const tick = () => {
      tickCount += 1;

      // Repulsion between every pair of nodes
      for (let i = 0; i < nodeCopies.length; i += 1) {
        for (let j = i + 1; j < nodeCopies.length; j += 1) {
          const source = nodeCopies[i];
          const target = nodeCopies[j];
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const distanceSq = Math.max(dx * dx + dy * dy, 0.01);
          const distance = Math.sqrt(distanceSq);
          const force = (REPULSION_STRENGTH * alpha) / distanceSq;
          const fx = (force * dx) / distance;
          const fy = (force * dy) / distance;

          if (!source.anchored) {
            source.vx -= fx;
            source.vy -= fy;
          }

          if (!target.anchored) {
            target.vx += fx;
            target.vy += fy;
          }
        }
      }

      // Spring forces for relationships
      for (const link of renderLinks) {
        const sourceIdx = nodeIndex.get(link.sourceId);
        const targetIdx = nodeIndex.get(link.targetId);
        if (sourceIdx === undefined || targetIdx === undefined) {
          continue;
        }

        const source = nodeCopies[sourceIdx];
        const target = nodeCopies[targetIdx];
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const desired = getSpringLengthFromStrength(link.strength);
        const springStrength = getSpringStrengthFromRelationship(link.strength);
        const springForce = (distance - desired) * springStrength * alpha;
        const fx = (springForce * dx) / distance;
        const fy = (springForce * dy) / distance;

        if (!source.anchored) {
          source.vx += fx;
          source.vy += fy;
        }

        if (!target.anchored) {
          target.vx -= fx;
          target.vy -= fy;
        }
      }

      // Integrate velocities, apply damping, and keep within bounds
      for (const node of nodeCopies) {
        if (centerNodeId && node.id === centerNodeId) {
          node.vx = 0;
          node.vy = 0;
          node.x = boundsWidth / 2;
          node.y = boundsHeight / 2;
        } else if (!node.anchored) {
          node.vx *= DAMPING;
          node.vy *= DAMPING;

          node.x += node.vx;
          node.y += node.vy;
        } else {
          node.vx = 0;
          node.vy = 0;
        }
      }

      clampToBounds();

      // Separate overlapping LABELS, not just node centres. The forces above only know about
      // positions, so without this a well-spaced layout still stacks four names on one spot.
      // Resolved positionally rather than through the velocity integrator, which would let labels
      // oscillate through each other instead of settling.
      relaxLabelCollisions(nodeCopies, COLLISION_STRENGTH);
      clampToBounds();

      // Recentre around the world middle
      let centerX = 0;
      let centerY = 0;
      for (const node of nodeCopies) {
        centerX += node.x;
        centerY += node.y;
      }

      centerX /= nodeCopies.length;
      centerY /= nodeCopies.length;
      const offsetX = boundsWidth / 2 - centerX;
      const offsetY = boundsHeight / 2 - centerY;
      for (const node of nodeCopies) {
        // `pinned` rather than `anchored`: the centre node is re-pinned at the top of every tick,
        // so letting the recentring nudge it here just made it jitter around the middle.
        if (!node.pinned) {
          node.x += offsetX * 0.1;
          node.y += offsetY * 0.1;
        }
      }

      if (tickCount % 2 === 0 || tickCount === 1) {
        publishSnapshot();
      }

      alpha *= ALPHA_DECAY;
      if (tickCount < MAX_TICKS && alpha > MIN_ALPHA) {
        animationFrame = requestAnimationFrame(tick);
      } else {
        // The per-tick pass is under-relaxed, so the last tick can still leave a little overlap.
        // Drive it to zero at full strength before the frame the viewer actually reads.
        for (let pass = 0; pass < COLLISION_POLISH_PASSES; pass += 1) {
          if (relaxLabelCollisions(nodeCopies, 1) === 0) {
            break;
          }

          clampToBounds();
        }

        publishSnapshot();
        fitToNodes();
      }
    };

    publishSnapshot();
    animationFrame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrame);
      previousPositionsRef.current = new Map(nodeCopies.map((node) => [node.id, { ...node }]));
    };
  }, [
    anchoredKey,
    canvasHeight,
    centerNodeId,
    degreeById,
    nodes,
    nodesKey,
    renderLinks,
    standingLabels,
    width,
  ]);

  const handleWheel = useCallback((event: WheelEvent) => {
    if (event.cancelable) {
      event.preventDefault();
    }

    const svgElement = svgRef.current;
    if (!svgElement) {
      return;
    }

    const rect = svgElement.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;

    setScale((prevScale) => {
      const delta = -event.deltaY * 0.0015;
      const nextScale = clampScale(prevScale * (1 + delta));

      setTranslate((prevTranslate) => ({
        x: cursorX - ((cursorX - prevTranslate.x) * nextScale) / prevScale,
        y: cursorY - ((cursorY - prevTranslate.y) * nextScale) / prevScale,
      }));

      return nextScale;
    });

    viewerMovedCameraRef.current = true;
  }, []);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) {
      return;
    }

    const listener = (event: WheelEvent) => {
      handleWheel(event);
    };

    svgElement.addEventListener('wheel', listener, { passive: false });

    return () => {
      svgElement.removeEventListener('wheel', listener);
    };
  }, [handleWheel]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target && target.closest('[data-force-node]')) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      panStartRef.current = { x: event.clientX, y: event.clientY };
      translateStartRef.current = translate;
      setIsPanning(true);
    },
    [translate],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!isPanning) {
        return;
      }

      const dx = event.clientX - panStartRef.current.x;
      const dy = event.clientY - panStartRef.current.y;

      if (dx !== 0 || dy !== 0) {
        viewerMovedCameraRef.current = true;
      }

      setTranslate({
        x: translateStartRef.current.x + dx,
        y: translateStartRef.current.y + dy,
      });
    },
    [isPanning],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!isPanning) {
        return;
      }

      event.currentTarget.releasePointerCapture(event.pointerId);
      setIsPanning(false);
    },
    [isPanning],
  );

  const positionsById = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of simNodes) {
      if (typeof node.x === 'number' && typeof node.y === 'number') {
        map.set(node.id, { x: node.x, y: node.y });
      }
    }

    return map;
  }, [simNodes]);

  /**
   * Hovering picks out one node's own corner of the graph: it and its direct neighbours stay lit,
   * everything else fades back. A dense graph is legible in pieces long before it is legible whole.
   */
  const hoveredNeighbors = hoveredNodeId ? neighborsById.get(hoveredNodeId) : undefined;
  const isDimmed = (nodeId: string) =>
    hoveredNodeId != null && nodeId !== hoveredNodeId && !hoveredNeighbors?.has(nodeId);

  // SVG paints in document order, so the emphasised nodes are drawn last: a hovered node expands to
  // its full name, and that name has to land on top of its neighbours rather than under them.
  const renderOrder = useMemo(() => {
    const rank = (nodeId: string) => {
      if (nodeId === hoveredNodeId) {
        return 3;
      }

      if (nodeId === selectedNodeId) {
        return 2;
      }

      return nodeId === highlightedNodeId ? 1 : 0;
    };

    return [...simNodes].sort((a, b) => rank(a.id) - rank(b.id));
  }, [highlightedNodeId, hoveredNodeId, selectedNodeId, simNodes]);

  return (
    <div ref={ref} className="w-full">
      <svg
        ref={svgRef}
        width={width}
        height={canvasHeight}
        role="img"
        aria-label="Knowledge graph overview"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={(event) => {
          setHoveredNodeId(null);
          handlePointerUp(event);
        }}
        style={{ cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}
        className="fill-foreground text-foreground"
      >
        <defs>
          <marker
            id="arrowhead"
            viewBox="0 -5 10 10"
            refX={12}
            refY={0}
            markerWidth={6}
            markerHeight={6}
            orient="auto"
          >
            <path d="M0,-5L10,0L0,5" fill="rgba(148, 163, 184, 0.25)" />
          </marker>
        </defs>
        <g transform={`translate(${translate.x}, ${translate.y}) scale(${scale})`}>
          <g stroke="rgba(148, 163, 184, 0.35)" strokeWidth={1.1} strokeLinecap="round">
            {renderLinks.map((link) => {
              const source = positionsById.get(link.sourceId);
              const target = positionsById.get(link.targetId);

              if (!source || !target) {
                return null;
              }

              const touchesHovered =
                hoveredNodeId != null && (link.sourceId === hoveredNodeId || link.targetId === hoveredNodeId);

              return (
                <line
                  key={link.id}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  markerEnd="url(#arrowhead)"
                  opacity={hoveredNodeId == null ? 1 : touchesHovered ? 1 : 0.12}
                  strokeWidth={touchesHovered ? 2 : undefined}
                >
                  <title>{link.relationship_type.split('_').join(' ').toLowerCase()}</title>
                </line>
              );
            })}
          </g>

          <g>
            {renderOrder.map((node) => {
              if (typeof node.x !== 'number' || typeof node.y !== 'number') {
                return null;
              }

              const isHighlighted = node.id === highlightedNodeId;
              const isSelected = node.id === selectedNodeId;
              const isHovered = node.id === hoveredNodeId;
              const dimmed = isDimmed(node.id);
              const radius = nodeRadius(
                node.degree,
                isSelected ? 'selected' : isHighlighted ? 'highlighted' : 'none',
              );
              const baseColor = getTypeColor(node.entity_type);
              const fillColor = isSelected ? 'hsl(var(--primary))' : baseColor;
              const opacity = isSelected ? 1 : isHighlighted ? 0.95 : 0.85;
              const emphasised = isSelected || isHighlighted || isHovered;

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="cursor-pointer"
                  data-force-node
                  data-testid="force-node"
                  opacity={dimmed ? 0.2 : 1}
                  onPointerEnter={() => setHoveredNodeId(node.id)}
                  onPointerLeave={() => setHoveredNodeId((current) => (current === node.id ? null : current))}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    onNodeSelect?.(node.id);
                  }}
                >
                  <title>
                    {node.fullLabel}
                    {node.degree > 0 ? ` — ${node.degree} connection${node.degree === 1 ? '' : 's'}` : ''}
                  </title>
                  <circle
                    r={radius}
                    fill={fillColor}
                    fillOpacity={opacity}
                    stroke={isSelected ? 'hsl(var(--primary-foreground))' : 'rgba(15, 23, 42, 0.2)'}
                    strokeWidth={isSelected ? 2 : 1}
                  />
                  {/*
                    The layout keeps these boxes from overlapping (see labelLayout.ts), so the halo
                    below is no longer load-bearing — it just keeps a label legible where it crosses
                    a link line. Long names are clipped to a fixed budget so one label cannot eat the
                    room several others need; the full value lives in the <title> above and is drawn
                    in full on hover.

                    A dense graph gives a standing label only to the nodes worth naming, so a node
                    without one draws no text until it is hovered or selected. That text is NOT in
                    the layout's budget — it is transient, and reflowing the graph under the pointer
                    to make room for it would be worse than letting it overlap for the moment.
                  */}
                  {(node.label !== '' || emphasised) && (
                    <text
                      x={radius + LABEL_GAP_PX}
                      y={4}
                      className={emphasised ? 'text-xs font-semibold' : 'text-xs'}
                      fill="hsl(var(--foreground))"
                      stroke="hsl(var(--background))"
                      strokeWidth={emphasised ? 4 : 3}
                      strokeLinejoin="round"
                      style={{ paintOrder: 'stroke fill' }}
                    >
                      {emphasised ? node.fullLabel : node.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
    </div>
  );
}

export const ForceGraph = memo(ForceGraphBase);

export type { ForceGraphProps };
