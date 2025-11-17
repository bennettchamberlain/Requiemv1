import { Field, ObjectType, createUnionType } from '@nestjs/graphql';

import { GlobalUID } from './GlobalUID';
import { PersonType } from './PersonType';
import { ThreadType } from './ThreadType';

export const SearchResult = createUnionType({
  name: 'SearchResult',
  types: () => [ThreadType, PersonType] as const,
  resolveType(instance) {
    try {
      const { type } = GlobalUID.parse(instance.id);

      switch (type) {
        case 'thread':
          return ThreadType;
        case 'person':
          return PersonType;
        default:
          return null;
      }
    } catch {
      return null;
    }
  },
});

@ObjectType()
export class SearchEdge {
  @Field(() => String)
  cursor!: string;

  @Field(() => SearchResult)
  node!: typeof SearchResult;
}
