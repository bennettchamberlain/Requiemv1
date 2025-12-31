import { createUnionType } from '@nestjs/graphql';

import { CommunicationType } from './CommunicationType';
import { ContentType } from './ContentType';
import { GlobalUID } from './GlobalUID';
import type { Node } from './Node';
import { PersonType } from './PersonType';
import { ThreadType } from './ThreadType';

export const SearchResultType = createUnionType({
  name: 'SearchResultType',
  types: () => [CommunicationType, ContentType, PersonType, ThreadType] as const,
  resolveType(instance): typeof Node {
    const { type } = GlobalUID.decode(instance.id);

    switch (type) {
      case 'communication':
        return CommunicationType;
      case 'content':
        return ContentType;
      case 'person':
        return PersonType;
      case 'thread':
        return ThreadType;
      default:
        throw new Error('Invalid type');
    }
  },
});

export type SearchResult = typeof SearchResultType;
