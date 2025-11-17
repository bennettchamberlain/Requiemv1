import { Field, ObjectType } from '@nestjs/graphql';

import { Connection } from './Connection';
import { PersonEdge } from './PersonEdge';

@ObjectType()
export class PersonConnection extends Connection {
  @Field(() => [PersonEdge])
  edges!: PersonEdge[];
}
