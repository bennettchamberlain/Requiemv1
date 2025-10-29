declare module 'three' {
  export class Object3D {
    add(...objects: Object3D[]): void;
  }

  export class Group extends Object3D {}

  export class SphereGeometry {
    constructor(...args: unknown[]);
  }

  export class Material {}

  export class MeshLambertMaterial extends Material {
    constructor(parameters?: Record<string, unknown>);
  }

  export class MeshBasicMaterial extends Material {
    constructor(parameters?: Record<string, unknown>);
  }

  export class Texture {}

  export class CanvasTexture extends Texture {
    constructor(canvas: HTMLCanvasElement);
  }

  export class Mesh extends Object3D {
    constructor(geometry?: unknown, material?: unknown);
  }

  export class SpriteMaterial extends Material {
    constructor(parameters?: Record<string, unknown>);
  }

  export class Sprite extends Object3D {
    constructor(material?: SpriteMaterial);

    scale: { set: (x: number, y: number, z: number) => void };

    position: { set: (x: number, y: number, z: number) => void };
  }
}
