import { Field, ObjectType } from '@nestjs/graphql';

import { Connection } from './Connection';
import { SearchEdge } from './SearchEdge';

@ObjectType()
export class SearchConnection extends Connection {
  @Field(() => [SearchEdge])
  edges!: SearchEdge[];
}
