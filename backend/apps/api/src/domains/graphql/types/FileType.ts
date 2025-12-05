import { Field, ID, ObjectType, Float, Directive } from '@nestjs/graphql';

import { type SignedFile } from '@ci/domains/files';

import { GlobalUID } from './GlobalUID';
import { Node } from './Node';

@ObjectType({ implements: () => [Node] })
export class FileType implements Node {
  __typename = FileType.name;

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

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;

  static toType(file: SignedFile): FileType {
    return {
      __typename: FileType.name,
      id: GlobalUID.encode('file', file.id),
      filename: file.filename,
      originalName: file.originalName,
      contentType: file.contentType,
      size: Number(file.size),
      url: file.url,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    };
  }
}
