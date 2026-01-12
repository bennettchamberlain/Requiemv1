import { Field, ID, InputType } from '@nestjs/graphql';
import GraphQLJSONObject from 'graphql-type-json';

@InputType()
export class UpdateSavedSearchInput {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => String, { nullable: true })
  query?: string;

  @Field(() => [String], { nullable: true })
  entityTypes?: string[];

  @Field(() => [ID], { nullable: true })
  tags?: string[];
}
