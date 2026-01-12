import { Field, ObjectType } from '@nestjs/graphql';

import { SavedSearchType } from './SavedSearchType';
import { Edge } from './Edge';

@ObjectType({ implements: () => [Edge] })
export class SavedSearchEdge implements Edge {
  @Field(() => String)
  cursor!: string;

  @Field(() => SavedSearchType)
  node!: SavedSearchType;
}
