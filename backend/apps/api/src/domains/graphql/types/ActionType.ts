import { Field, ID, ObjectType } from '@nestjs/graphql';

import { type Action } from '@ci/domains/intelligence';

import { EntityTagType } from './EntityTagType';
import { GlobalUID } from './GlobalUID';
import { Node } from './Node';
import { Taggable } from './Taggable';

@ObjectType({ implements: () => [Node, Taggable] })
export class ActionType implements Node, Taggable {
  __typename = ActionType.name;

  __source!: Action;

  @Field(() => ID)
  id!: string;

  @Field(() => String)
  title!: string | null;

  @Field(() => String)
  text!: string | null;

  @Field(() => String)
  imageUrl!: string | null;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;

  @Field(() => [EntityTagType])
  tags!: EntityTagType[];

  static toType(action: Action): ActionType {
    return {
      __typename: ActionType.name,
      __source: action,
      id: GlobalUID.encode('action', action.id),
      title: action.title,
      text: action.text,
      imageUrl: action.imageUrl,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
      tags: [], // Resolved by ActionResolver
    };
  }
}
