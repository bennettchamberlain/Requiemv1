import { Field, Int, ObjectType } from '@nestjs/graphql';

import { SavedSearchEdge } from './SavedSearchEdge';
import { Connection } from './Connection';
import { PageInfo } from './PageInfo';

@ObjectType({ implements: () => [Connection] })
export class SavedSearchConnection implements Connection {
  @Field(() => [SavedSearchEdge])
  edges!: SavedSearchEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;

  @Field(() => Int)
  totalCount!: number;
}
