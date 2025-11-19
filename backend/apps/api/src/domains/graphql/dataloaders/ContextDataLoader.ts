import DataLoader from 'dataloader';

import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';

export abstract class ContextDataLoader<V, K = string> {
  private readonly logger = new LoggerService(ContextDataLoader.name);

  private readonly loaders = new WeakMap<RequestContext, DataLoader<K, V>>();

  protected abstract batchLoad(context: RequestContext, keys: readonly K[]): Promise<readonly V[]>;

  protected getLoader(context: RequestContext): DataLoader<K, V> {
    let loader = this.loaders.get(context);

    if (!loader) {
      this.logger.log('Creating new data loader');

      loader = new DataLoader<K, V>((keys) => this.batchLoad(context, keys));

      this.loaders.set(context, loader);
    }

    return loader;
  }

  load(context: RequestContext, key: K): Promise<V> {
    return this.getLoader(context).load(key);
  }

  loadMany(context: RequestContext, keys: readonly K[]): Promise<readonly (V | Error)[]> {
    return this.getLoader(context).loadMany(keys);
  }

  clear(context: RequestContext, key: K): this {
    this.getLoader(context).clear(key);

    return this;
  }

  clearAll(context: RequestContext): this {
    this.getLoader(context).clearAll();

    return this;
  }

  prime(context: RequestContext, key: K, value: V): this {
    this.getLoader(context).prime(key, value);

    return this;
  }
}
