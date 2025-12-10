import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import type { UserServiceContext } from '@ci/common/types';
import { FileService, type SignedFile } from '@ci/domains/files';

import { Loader } from './Loader';

@Injectable()
export class ItemFileLoader extends Loader<SignedFile | null, string> {
  constructor(
    private readonly fileService: FileService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(ItemFileLoader.name);
  }

  protected async batchLoad(
    context: UserServiceContext,
    ids: readonly string[],
  ): Promise<readonly (SignedFile | null)[]> {
    const files = await this.fileService.findByIds(context, [...ids]);

    const fileMap = new Map<string, SignedFile>();

    for (const file of files) {
      fileMap.set(file.id, file);
    }

    return ids.map((id) => fileMap.get(id) ?? null);
  }
}
