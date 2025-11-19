import { Field, ObjectType, createUnionType } from '@nestjs/graphql';

import { GlobalUID } from './GlobalUID';
import { Node } from './Node';
import { PersonType } from './PersonType';
import { ThreadType } from './ThreadType';

export const SearchResult = createUnionType({
  name: 'SearchResult',
  types: () => [ThreadType, PersonType] as const,
  resolveType(instance): typeof Node {
    const { type } = GlobalUID.parse(instance.id);

    switch (type) {
      case 'thread':
        return ThreadType;
      case 'person':
        return PersonType;
      default:
        throw new Error('Invalid type');
    }
  },
});

// Notably this class does not implement the generic Edge.
// The type for the `node` field is a union type and violates
// the strict enforcement of GraphQL typegen even though all
// return types from `resolveType` satisfy the generic Node.
// We are accepting this as an exclusion to strict type
// enforcement.
@ObjectType()
export class SearchEdge {
  @Field(() => String)
  cursor!: string;

  @Field(() => SearchResult)
  node!: typeof SearchResult;
}
