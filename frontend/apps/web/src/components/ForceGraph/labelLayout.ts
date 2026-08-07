/**
 * Label geometry for the 2D force graph.
 *
 * The simulation repels node CENTRES, but a node is a 6px dot with up to ~140px of text hanging off
 * its right-hand side. So a layout can be perfectly well spaced by the simulation's own measure and
 * still stack four names on top of each other — which is exactly what a 25-node person graph does.
 * The halo behind each glyph only ever rescued the topmost label; the ones underneath stayed mush.
 *
 * Everything here treats a node as the box it actually occupies — dot PLUS label — so the layout can
 * keep those boxes apart instead of keeping the dots apart and hoping.
 *
 * Kept out of ForceGraph.tsx as pure geometry so the `node` vitest project can exercise it.
 */

/** Average advance of a `text-xs` glyph, which is what the labels are rendered at. */
export const LABEL_CHAR_PX = 6.4;
/** Gap between the edge of the circle and the start of the text. */
export const LABEL_GAP_PX = 4;
/** Half the line box of a `text-xs` label, measured about the node centre. */
export const LABEL_HALF_HEIGHT_PX = 8;
/**
 * Longest label drawn in full. Past this the layout spends more space on one name than the picture
 * can afford, so it is clipped and the full value moves to the hover tooltip.
 */
export const MAX_LABEL_CHARS = 22;

const MIN_NODE_RADIUS = 5;
const MAX_NODE_RADIUS = 14;
const DEGREE_RADIUS_FACTOR = 1.8;
const SELECTED_MIN_RADIUS = 12;
const HIGHLIGHTED_MIN_RADIUS = 10;

export type NodeEmphasis = 'selected' | 'highlighted' | 'none';

/** The label as drawn: clipped to `MAX_LABEL_CHARS`, with the ellipsis inside the budget. */
export function truncateLabel(label: string, maxChars: number = MAX_LABEL_CHARS): string {
  if (label.length <= maxChars) {
    return label;
  }

  return `${label.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/** Width of the label as drawn — i.e. of the TRUNCATED text, so framing and collision agree. */
export function labelWidthPx(label: string, maxChars: number = MAX_LABEL_CHARS): number {
  return truncateLabel(label, maxChars).length * LABEL_CHAR_PX;
}

/**
 * Node size by connection count, so the hubs of the graph read as hubs.
 *
 * Fixed 6px dots gave a person's closest collaborator and a one-off mention identical weight, which
 * is a large part of why the picture read as noise. Square-rooted because degree is long-tailed and
 * a linear map turns one hub into a blob that swallows its neighbours.
 */
export function nodeRadius(degree: number, emphasis: NodeEmphasis = 'none'): number {
  const byDegree = MIN_NODE_RADIUS + Math.sqrt(Math.max(0, degree)) * DEGREE_RADIUS_FACTOR;
  const base = Math.min(MAX_NODE_RADIUS, byDegree);

  if (emphasis === 'selected') {
    return Math.max(base, SELECTED_MIN_RADIUS);
  }

  if (emphasis === 'highlighted') {
    return Math.max(base, HIGHLIGHTED_MIN_RADIUS);
  }

  return base;
}

export type CollidableNode = {
  x: number;
  y: number;
  /** Drawn radius of the circle. */
  radius: number;
  /** Drawn width of the label, already truncated. Zero for an unlabelled node. */
  labelWidth: number;
  /** Pinned nodes (the centre node, user-anchored nodes) are never moved to resolve an overlap. */
  pinned?: boolean;
};

export type Box = { left: number; right: number; top: number; bottom: number };

/**
 * Overlap at or below this is not an overlap.
 *
 * Relaxation approaches contact asymptotically — each pass halves what is left — so a stack settles
 * with neighbours a hair short of clear and a strict `> 0` test reports every adjacent pair as
 * overlapping forever. Sub-pixel overlap is also, definitionally, not visible.
 */
const MIN_OVERLAP_PX = 0.5;

/** The full extent of a node as drawn: the circle, plus the label running off to its right. */
export function labelBox(node: CollidableNode): Box {
  const halfHeight = Math.max(node.radius, LABEL_HALF_HEIGHT_PX);

  return {
    left: node.x - node.radius,
    right: node.x + node.radius + (node.labelWidth > 0 ? LABEL_GAP_PX + node.labelWidth : 0),
    top: node.y - halfHeight,
    bottom: node.y + halfHeight,
  };
}

/** How far two drawn extents overlap on each axis. Non-positive on an axis means they are clear. */
function overlapBetween(a: CollidableNode, b: CollidableNode): { x: number; y: number } {
  const boxA = labelBox(a);
  const boxB = labelBox(b);

  return {
    x: Math.min(boxA.right, boxB.right) - Math.max(boxA.left, boxB.left),
    y: Math.min(boxA.bottom, boxB.bottom) - Math.max(boxA.top, boxB.top),
  };
}

/** Whether two nodes overlap by enough to be seen — the condition the layout exists to resolve. */
export function overlapsVisibly(a: CollidableNode, b: CollidableNode): boolean {
  const overlap = overlapBetween(a, b);

  return overlap.x > MIN_OVERLAP_PX && overlap.y > MIN_OVERLAP_PX;
}

/**
 * One relaxation pass that pushes overlapping label boxes apart, in place.
 *
 * A positional resolve rather than a velocity force: overlap is a hard constraint, and feeding it
 * through the velocity integrator makes labels oscillate through each other instead of settling.
 *
 * Pairs separate along whichever axis costs less travel. Labels are wide and short, so that is
 * almost always vertical — which is also how a reader wants a stack of names laid out.
 *
 * Every contact is measured against the SAME starting positions and each node then moves by the
 * AVERAGE of what its neighbours asked for. Applying each pair the moment it is found instead — the
 * obvious way to write this — means a node in the middle of a 25-way pile-up gets shoved 24 separate
 * times per pass and bounces around the canvas forever; a pile that dense never resolved at all.
 * Averaging also makes the result independent of the order the pairs happen to be visited in.
 *
 * `strength` damps each pass; 1 is a full resolve. Returns the number of overlapping pairs found,
 * which lets the caller stop once the layout is clean.
 */
export function relaxLabelCollisions(nodes: readonly CollidableNode[], strength = 0.5): number {
  const count = nodes.length;
  if (count < 2) {
    return 0;
  }

  const shiftX = new Float64Array(count);
  const shiftY = new Float64Array(count);
  const contacts = new Int32Array(count);
  let overlaps = 0;

  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const a = nodes[i];
      const b = nodes[j];

      const { x: overlapX, y: overlapY } = overlapBetween(a, b);
      if (overlapX <= MIN_OVERLAP_PX || overlapY <= MIN_OVERLAP_PX) {
        continue;
      }

      overlaps += 1;

      if (a.pinned && b.pinned) {
        continue;
      }

      // Half-separation pointing from `a` towards `b`, along the cheaper axis.
      let dx = 0;
      let dy = 0;
      if (overlapY <= overlapX) {
        dy = (overlapY / 2) * (a.y <= b.y ? 1 : -1);
      } else {
        dx = (overlapX / 2) * (a.x <= b.x ? 1 : -1);
      }

      // A pinned end carries the whole separation on the other, so the pair still ends up clear
      // rather than half-resolved against an immovable node.
      const share = a.pinned || b.pinned ? 2 : 1;

      if (!a.pinned) {
        shiftX[i] -= dx * share;
        shiftY[i] -= dy * share;
        contacts[i] += 1;
      }

      if (!b.pinned) {
        shiftX[j] += dx * share;
        shiftY[j] += dy * share;
        contacts[j] += 1;
      }
    }
  }

  for (let i = 0; i < count; i += 1) {
    if (contacts[i] === 0) {
      continue;
    }

    nodes[i].x += (shiftX[i] / contacts[i]) * strength;
    nodes[i].y += (shiftY[i] / contacts[i]) * strength;
  }

  return overlaps;
}

/** Node count the simulation world is sized for before it needs to grow. */
const BASELINE_NODE_COUNT = 25;
const MAX_WORLD_SCALE = 2.2;

/**
 * The world the simulation lays out in, which is NOT the canvas it is drawn on.
 *
 * Nodes are clamped inside these bounds, so at 100 nodes a canvas-sized world leaves collision
 * resolution nowhere to put anything and the overflow piles up against the walls. The world grows
 * with the square root of the node count — area scales linearly with the boxes that have to fit —
 * and `fitTransform` scales the result back down to the canvas.
 */
export function simulationBounds(
  nodeCount: number,
  canvasWidth: number,
  canvasHeight: number,
): { width: number; height: number } {
  const scale = Math.min(MAX_WORLD_SCALE, Math.max(1, Math.sqrt(nodeCount / BASELINE_NODE_COUNT)));

  return { width: canvasWidth * scale, height: canvasHeight * scale };
}

const MIN_GRAPH_HEIGHT = 420;
const MAX_GRAPH_HEIGHT = 640;

/**
 * How tall to draw the canvas for a given node count.
 *
 * 25 nodes in a 420px box is dense however well they are laid out; past the baseline the panel earns
 * some more vertical room rather than shrinking everything to fit.
 */
export function graphHeightForNodeCount(nodeCount: number): number {
  if (nodeCount <= BASELINE_NODE_COUNT) {
    return MIN_GRAPH_HEIGHT;
  }

  const growth = Math.sqrt(nodeCount / BASELINE_NODE_COUNT);

  return Math.round(Math.min(MAX_GRAPH_HEIGHT, MIN_GRAPH_HEIGHT * growth));
}
