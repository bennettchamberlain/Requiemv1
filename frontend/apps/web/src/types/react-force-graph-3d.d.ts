declare module 'react-force-graph-3d' {
  import type { ComponentType, Ref } from 'react';

  import type { ForceGraphInstance, ForceGraphProps } from 'force-graph';
  import type { Object3D, PerspectiveCamera, Scene } from 'three';

  export interface ForceGraph3DPropTypes<N = unknown, L = unknown> extends ForceGraphProps<N, L> {
    backgroundColor?: string;
    nodeThreeObject?: (node: N) => Object3D;
    nodeThreeObjectExtend?: boolean;
    linkThreeObject?: (link: L) => Object3D;
    linkThreeObjectExtend?: boolean;
    nodeLabel?: string | ((node: N) => string);
    linkLabel?: string | ((link: L) => string);
    enableNavigationControls?: boolean;
    enableNodeDrag?: boolean;
    controlType?: 'trackball' | 'orbit' | 'fly';
    showNavInfo?: boolean;
    warmupTicks?: number;
    cooldownTicks?: number;
    cooldownTime?: number;
    d3AlphaDecay?: number;
    d3VelocityDecay?: number;
    glScale?: number;
    width?: number;
    height?: number;
    [key: string]: unknown;
  }

  export interface ForceGraphMethods<N = unknown, L = unknown> extends ForceGraphInstance<N, L> {
    cameraPosition(
      position?: { x: number; y: number; z: number },
      lookAt?: { x: number; y: number; z: number },
      ms?: number,
    ): this;
    scene(): Scene;
    camera(): PerspectiveCamera;
    graphData(): { nodes: N[]; links: L[] };
  }

  const ForceGraph3D: ComponentType<ForceGraph3DPropTypes & { ref?: Ref<ForceGraphMethods> }>;
  export default ForceGraph3D;
}
