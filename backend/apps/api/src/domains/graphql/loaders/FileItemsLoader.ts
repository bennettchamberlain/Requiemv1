import { Injectable } from '@nestjs/common';

import type { UserServiceContext } from '@ci/common/types';
import { ItemService, type Item } from '@ci/domains/memory';

import { Loader } from './Loader';

@Injectable()
export class FileItemsLoader extends Loader<Item[]> {
  constructor(private readonly itemService: ItemService) {
    super();
  }

  protected async batchLoad(
    context: UserServiceContext,
    fileIds: readonly string[],
  ): Promise<readonly Item[][]> {
    const itemsMap = await this.itemService.findByFileIds(context, [...fileIds]);

    return fileIds.map((fileId) => itemsMap.get(fileId) ?? []);
  }
}
