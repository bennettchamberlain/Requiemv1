type ResourceType = 'thread' | 'message';

export class GlobalUID {
  static toGUID(type: ResourceType, id: string): string {
    return Buffer.from(`${type}:${id}`).toString('base64');
  }

  static fromGUID(type: ResourceType, globalId: string): string {
    let decoded;

    try {
      decoded = Buffer.from(globalId, 'base64').toString('utf-8');
    } catch {
      throw new Error('Invalid global id');
    }

    const [decodedType, id] = decoded.split(':');

    if (!decodedType || !id) {
      throw new Error('Invalid global id format');
    }

    if (decodedType !== type) {
      throw new Error('Unexpected global id type');
    }

    return id;
  }
}
