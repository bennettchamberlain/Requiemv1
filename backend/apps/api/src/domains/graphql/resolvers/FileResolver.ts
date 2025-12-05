import { UseGuards } from '@nestjs/common';
import { Query, Resolver, Args, ID } from '@nestjs/graphql';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { RequestContext } from '@ci/common/types';
import { toServiceContext } from '@ci/common/utils';
import { FileService } from '@ci/domains/files';

import { FileConnection } from '../types/FileConnection';
import { FileEdge } from '../types/FileEdge';
import { FileType } from '../types/FileType';
import { GlobalUID } from '../types/GlobalUID';
import { PaginationArgs } from '../types/PaginationArgs';
import { Paginator } from '../utils/Paginator';

@UseGuards(JwtAuthGuard)
@Resolver(() => FileType)
export class FileResolver {
  constructor(private readonly fileService: FileService) {}

  @Query(() => FileConnection)
  async files(
    @Context() context: RequestContext,
    @Args() pagination: PaginationArgs,
  ): Promise<FileConnection> {
    const serviceContext = toServiceContext(context);

    const entities = await this.fileService.findAll(serviceContext);

    const { slice, pageInfo, totalCount } = Paginator.paginate(entities, {
      ...pagination,
      getId: (entity) => GlobalUID.encode('file', entity.id),
    });

    const edges: FileEdge[] = slice.map((entity) => {
      const node = FileType.toType(entity);

      return {
        node,
        cursor: node.id,
      };
    });

    return {
      edges,
      pageInfo,
      totalCount,
    };
  }

  @Query(() => FileType, { nullable: true })
  async file(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<FileType | null> {
    const serviceContext = toServiceContext(context);

    const id = GlobalUID.parse('file', gid);

    const entity = await this.fileService.findById(serviceContext, id);

    return entity ? FileType.toType(entity) : null;
  }
}
