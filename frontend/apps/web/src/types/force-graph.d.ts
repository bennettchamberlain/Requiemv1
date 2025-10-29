declare module 'force-graph' {
  export interface Coords {
    x?: number;
    y?: number;
    z?: number;
  }

  export interface NodeObject<NodeShape = Record<string, unknown>> extends NodeShape {
    id?: string | number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
  }

  export interface LinkObject<NodeType = NodeObject, LinkExtra = Record<string, unknown>> extends LinkExtra {
    source?: string | number | NodeType;
    target?: string | number | NodeType;
  }

  export interface ForceGraphProps<N = unknown, L = unknown> {
    graphData?: { nodes: N[]; links: L[] };
  }

  export interface ForceGraphInstance<N = unknown, L = unknown> {
    graphData(graphData: { nodes: N[]; links: L[] }): this;
    onNodeClick(callback: (node: N) => void): this;
  }
}
