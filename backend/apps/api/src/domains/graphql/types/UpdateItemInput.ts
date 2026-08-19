import { Field, Float, ID, InputType } from '@nestjs/graphql';
import GraphQLJSONObject from 'graphql-type-json';

import { ItemCondition } from './ItemType';
import { PhysicalItemPropertiesInput } from './PhysicalItemProperties';

/**
 * Editing a thing. Every field except `id`/`name` is optional and patch-shaped:
 * an omitted field is left alone, an explicit null clears it.
 */
@InputType()
export class UpdateItemInput extends PhysicalItemPropertiesInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => String, { nullable: true })
  category?: string;

  @Field(() => String, { nullable: true })
  subcategory?: string;

  @Field(() => String, { nullable: true })
  brand?: string;

  @Field(() => String, { nullable: true })
  model?: string;

  @Field(() => Float, { nullable: true })
  currentValue?: number;

  @Field(() => Float, { nullable: true })
  purchasePrice?: number;

  @Field(() => String, { nullable: true })
  currency?: string;

  @Field(() => Date, { nullable: true, description: 'When it was bought or received.' })
  acquiredAt?: Date;

  @Field(() => ItemCondition, { nullable: true })
  condition?: ItemCondition;

  @Field(() => GraphQLJSONObject, { nullable: true })
  metadata?: Record<string, unknown>;
}
