import { Field, ID, ObjectType, Float, Directive } from '@nestjs/graphql';

import { type SignedFile } from '@ci/domains/files';

import { EntityTagType } from './EntityTagType';
import { GlobalUID } from './GlobalUID';
import { ItemConnection } from './ItemConnection';
import { Node } from './Node';
import { Taggable } from './Taggable';

@ObjectType({ implements: () => [Node, Taggable] })
export class FileType implements Node, Taggable {
  __typename = FileType.name;

  __source!: SignedFile;

  @Field(() => ID)
  id!: string;

  @Field(() => String)
  filename!: string;

  @Field(() => String)
  originalName!: string;

  @Field(() => String)
  contentType!: string;

  @Field(() => Float)
  size!: number;

  // This doesn't seem to do anything yet, but set up for future caching after
  // requisite tweaking. Just want don't to lose context.
  @Directive('@cacheControl(maxAge: 60)')
  @Field(() => String)
  url!: string;

  @Field(() => Boolean)
  analysisCompleted!: boolean;

  @Field(() => ItemConnection, { nullable: true, complexity: 5 })
  items?: ItemConnection | null;

  @Field(() => [EntityTagType])
  tags!: EntityTagType[];

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;

  static toType(file: SignedFile): FileType {
    return {
      __typename: FileType.name,
      __source: file,
      id: GlobalUID.encode('file', file.id),
      filename: file.filename,
      originalName: file.originalName,
      contentType: file.contentType,
      size: Number(file.size),
      url: file.url,
      analysisCompleted: file.analysisCompleted,
      tags: [], // Hydrated by resolver
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    };
  }
}
