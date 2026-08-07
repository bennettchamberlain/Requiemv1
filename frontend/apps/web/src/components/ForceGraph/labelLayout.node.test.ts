import { describe, expect, it } from 'vitest';

import {
  LABEL_GAP_PX,
  MAX_LABEL_CHARS,
  type CollidableNode,
  graphHeightForNodeCount,
  labelBox,
  labelWidthPx,
  LABEL_ALL_THRESHOLD,
  PROMINENT_LABEL_COUNT,
  nodeRadius,
  overlapsVisibly,
  relaxLabelCollisions,
  simulationBounds,
  standingLabelIds,
  truncateLabel,
} from './labelLayout';

function node(x: number, y: number, label = 'Abdul Ameer', overrides: Partial<CollidableNode> = {}) {
  return {
    x,
    y,
    radius: 6,
    labelWidth: labelWidthPx(label),
    ...overrides,
  } satisfies CollidableNode;
}

/**
 * Run the relaxation to convergence the way the simulation's polish loop does.
 *
 * The default budget matches `COLLISION_POLISH_PASSES` in ForceGraph.tsx: relaxation spreads a pile
 * by diffusion, so a dense one needs passes on the order of hundreds, not tens.
 */
function relaxToRest(nodes: CollidableNode[], passes = 600): number {
  let remaining = 0;

  for (let pass = 0; pass < passes; pass += 1) {
    remaining = relaxLabelCollisions(nodes, 1);
    if (remaining === 0) {
      break;
    }
  }

  return remaining;
}

describe('truncateLabel', () => {
  it('leaves a label that fits alone', () => {
    expect(truncateLabel('Abdul Ameer')).toBe('Abdul Ameer');
  });

  it('clips a long label to the budget, ellipsis included', () => {
    const clipped = truncateLabel('Muhammad Abdul Mateen Al-Rahman');

    expect(clipped.length).toBeLessThanOrEqual(MAX_LABEL_CHARS);
    expect(clipped.endsWith('…')).toBe(true);
  });

  it('does not leave a dangling space before the ellipsis', () => {
    // 'Logan Ryan Golemanov' + ' X' would otherwise clip to '...Golemanov …'.
    expect(truncateLabel('Logan Ryan Golemanov Xu')).not.toContain(' …');
  });

  it('measures the width of the label as drawn, not as supplied', () => {
    const long = 'Muhammad Abdul Mateen Al-Rahman';

    expect(labelWidthPx(long)).toBeLessThan(long.length * 6.4);
    expect(labelWidthPx(long)).toBe(truncateLabel(long).length * 6.4);
  });
});

describe('nodeRadius', () => {
  it('grows with connection count so hubs read as hubs', () => {
    expect(nodeRadius(12)).toBeGreaterThan(nodeRadius(1));
    expect(nodeRadius(1)).toBeGreaterThan(nodeRadius(0));
  });

  it('flattens out rather than letting one hub swallow its neighbours', () => {
    expect(nodeRadius(500)).toBeLessThanOrEqual(14);
    // A 40-connection hub is not 40x the area of a 1-connection leaf.
    expect(nodeRadius(40)).toBeLessThan(nodeRadius(1) * 3);
  });

  it('keeps selected and highlighted nodes visible even at degree zero', () => {
    expect(nodeRadius(0, 'selected')).toBeGreaterThanOrEqual(12);
    expect(nodeRadius(0, 'highlighted')).toBeGreaterThanOrEqual(10);
  });
});

describe('labelBox', () => {
  it('extends to the right of the node, because that is where the text is drawn', () => {
    const box = labelBox(node(100, 100, 'Abdul Ameer'));

    expect(box.left).toBe(100 - 6);
    expect(box.right).toBe(100 + 6 + LABEL_GAP_PX + labelWidthPx('Abdul Ameer'));
  });

  it('reserves no horizontal room for an unlabelled node', () => {
    const box = labelBox(node(100, 100, '', { labelWidth: 0 }));

    expect(box.right).toBe(100 + 6);
  });

  it('is only as tall as the circle when there is no label to make room for', () => {
    // Hover-only dots reserving a full line box would push each other apart for text that is never
    // drawn — spreading the layout is the exact cost dropping their labels was meant to avoid.
    const box = labelBox(node(0, 0, '', { radius: 4, labelWidth: 0 }));

    expect(box.bottom - box.top).toBe(8);
  });

  it('does not separate two unlabelled dots that are merely near each other', () => {
    const a = node(400, 300, '', { radius: 4, labelWidth: 0 });
    const b = node(400, 312, '', { radius: 4, labelWidth: 0 });

    expect(relaxLabelCollisions([a, b])).toBe(0);
  });

  it('is at least as tall as the line box, so a small dot still owns its text', () => {
    const box = labelBox(node(0, 0, 'Abdul Ameer', { radius: 2 }));

    expect(box.bottom - box.top).toBeGreaterThanOrEqual(16);
  });
});

describe('relaxLabelCollisions', () => {
  it('reports nothing to do when the boxes are already clear', () => {
    const nodes = [node(0, 0), node(0, 400)];

    expect(relaxLabelCollisions(nodes)).toBe(0);
    expect(nodes[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('separates the stacked labels the halo could not rescue', () => {
    // The reported defect: dots 8px apart, names 70px wide, four deep in one spot.
    const nodes = [
      node(400, 300, 'Aqsa Anwar'),
      node(408, 302, 'Muhammad Nadeem'),
      node(402, 298, 'Alexandra Hartman'),
      node(410, 304, 'Abdelrahman Abdullah'),
    ];

    expect(relaxToRest(nodes)).toBe(0);

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        expect(overlapsVisibly(nodes[i], nodes[j])).toBe(false);
      }
    }
  });

  it('separates vertically, because labels are wide and short', () => {
    const nodes = [node(400, 300, 'Muhammad Nadeem'), node(404, 302, 'Muhammad Bilal')];

    relaxToRest(nodes);

    // Stacking names is how a reader wants them; shoving them a label-width apart is not.
    expect(Math.abs(nodes[0].y - nodes[1].y)).toBeGreaterThanOrEqual(16);
    expect(Math.abs(nodes[0].x - nodes[1].x)).toBeLessThan(20);
  });

  it('never moves a pinned node, and still clears the pair', () => {
    const pinned = node(400, 300, 'Abdul Ameer', { pinned: true });
    const other = node(404, 302, 'Hanzla Mateen');
    const nodes = [pinned, other];

    relaxToRest(nodes);

    expect(pinned.x).toBe(400);
    expect(pinned.y).toBe(300);
    expect(overlapsVisibly(pinned, other)).toBe(false);
  });

  it('leaves two pinned nodes alone rather than spinning on an unsatisfiable pair', () => {
    const a = node(400, 300, 'Abdul Ameer', { pinned: true });
    const b = node(404, 302, 'Hanzla Mateen', { pinned: true });

    expect(relaxLabelCollisions([a, b])).toBe(1);
    expect(a).toMatchObject({ x: 400, y: 300 });
    expect(b).toMatchObject({ x: 404, y: 302 });
  });

  it('resolves a full 25-node pile-up, which is the page default', () => {
    // Every node within 4px of its neighbour: harsher than anything the simulation hands over,
    // since repulsion has already done most of the spreading by the time this runs.
    const nodes = Array.from({ length: 25 }, (_, index) =>
      node(400 + (index % 5) * 4, 300 + Math.floor(index / 5) * 4, `Person Number ${index}`),
    );

    expect(relaxToRest(nodes)).toBe(0);

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        expect(overlapsVisibly(nodes[i], nodes[j])).toBe(false);
      }
    }
  });

  it('spreads a pile only as far as it has to', () => {
    // Guards the other failure mode: a scheme that resolves overlap by flinging nodes apart is
    // just as unreadable as one that leaves them stacked. 25 labels need ~25 line boxes of room.
    const nodes = Array.from({ length: 25 }, (_, index) =>
      node(400 + (index % 5) * 4, 300 + Math.floor(index / 5) * 4, `Person Number ${index}`),
    );

    relaxToRest(nodes);

    const ys = nodes.map((n) => n.y);
    const span = Math.max(...ys) - Math.min(...ys);

    expect(span).toBeGreaterThan(16 * 10);
    expect(span).toBeLessThan(16 * 40);
  });

  it('under-relaxes proportionally, so a single damped pass does not overshoot', () => {
    const gentle = [node(400, 300), node(400, 304)];
    const full = [node(400, 300), node(400, 304)];

    relaxLabelCollisions(gentle, 0.45);
    relaxLabelCollisions(full, 1);

    expect(Math.abs(gentle[0].y - gentle[1].y)).toBeLessThan(Math.abs(full[0].y - full[1].y));
  });
});

describe('standingLabelIds', () => {
  const degreeOf = (id: string) => Number.parseInt(id.replace('n', ''), 10);
  const graph = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `n${i}` }));

  it('labels everything while the graph is small enough to read', () => {
    const nodes = graph(LABEL_ALL_THRESHOLD);

    expect(standingLabelIds(nodes, degreeOf).size).toBe(LABEL_ALL_THRESHOLD);
  });

  it('labels only the busiest nodes once every label would shrink the picture', () => {
    const nodes = graph(LABEL_ALL_THRESHOLD + 1);
    const labelled = standingLabelIds(nodes, degreeOf);

    expect(labelled.size).toBe(PROMINENT_LABEL_COUNT);
    // Highest degree wins; the quietest nodes drop to hover-only.
    expect(labelled.has(`n${LABEL_ALL_THRESHOLD}`)).toBe(true);
    expect(labelled.has('n0')).toBe(false);
  });

  it('always names the node the graph is centred on, however quiet it is', () => {
    const nodes = graph(100);
    const labelled = standingLabelIds(nodes, degreeOf, ['n0']);

    // n0 has the lowest degree of all, so only an explicit request keeps it.
    expect(labelled.has('n0')).toBe(true);
    expect(labelled.size).toBe(PROMINENT_LABEL_COUNT + 1);
  });

  it('ignores absent anchors rather than reserving a slot for them', () => {
    const labelled = standingLabelIds(graph(100), degreeOf, [null, undefined, '']);

    expect(labelled.size).toBe(PROMINENT_LABEL_COUNT);
  });

  it('ignores an anchor that is not in the graph, rather than spending a label on it', () => {
    // A centre node trimmed out of the subgraph would otherwise hold a slot no label is drawn in.
    const labelled = standingLabelIds(graph(100), degreeOf, ['not-in-this-graph']);

    expect(labelled.has('not-in-this-graph')).toBe(false);
    expect(labelled.size).toBe(PROMINENT_LABEL_COUNT);
  });

  it('picks the same nodes every time for the same graph', () => {
    const nodes = graph(100);
    const first = [...standingLabelIds(nodes, () => 1)];
    const second = [...standingLabelIds(nodes, () => 1)];

    // All degrees tied — a stable sort has to keep this deterministic.
    expect(first).toEqual(second);
  });
});

describe('simulationBounds', () => {
  it('lays out in the canvas itself while the graph is small', () => {
    expect(simulationBounds(10, 720, 420)).toEqual({ width: 720, height: 420 });
  });

  it('does not grow for bare dots, which need no label room', () => {
    // 100 nodes but only 13 labelled: growing the world here would shrink the fit, and the
    // labels that ARE drawn with it — the exact failure the label budget exists to avoid.
    expect(simulationBounds(13, 720, 420)).toEqual({ width: 720, height: 420 });
  });

  it('grows the world once there is more label than canvas', () => {
    const dense = simulationBounds(100, 720, 420);

    expect(dense.width).toBeGreaterThan(720);
    expect(dense.height).toBeGreaterThan(420);
  });

  it('stops growing, so the fit never has to scale past the zoom floor', () => {
    expect(simulationBounds(10000, 720, 420).width).toBe(720 * 2.2);
  });
});

describe('graphHeightForNodeCount', () => {
  it('keeps the established height for a graph that fits', () => {
    expect(graphHeightForNodeCount(25)).toBe(420);
    expect(graphHeightForNodeCount(4)).toBe(420);
  });

  it('gives a denser graph more vertical room, up to a ceiling', () => {
    expect(graphHeightForNodeCount(60)).toBeGreaterThan(420);
    expect(graphHeightForNodeCount(100)).toBeLessThanOrEqual(640);
    expect(graphHeightForNodeCount(1000)).toBe(640);
  });
});
