import { Field, ID, ObjectType } from '@nestjs/graphql';

import { type Note } from '@ci/domains/notes';

import { GlobalUID } from './GlobalUID';
import { Node } from './Node';

@ObjectType({ implements: () => [Node] })
export class NoteType implements Node {
  __typename = NoteType.name;

  __source!: Note;

  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  title!: string | null;

  @Field(() => String, { nullable: true })
  content!: string | null;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;

  static toType(source: Note): NoteType {
    return {
      __typename: NoteType.name,
      __source: source,
      id: GlobalUID.encode('note', source.id),
      title: source.title,
      content: source.content,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    };
  }
}
