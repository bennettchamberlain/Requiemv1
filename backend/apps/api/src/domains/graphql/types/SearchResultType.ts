import { createUnionType } from '@nestjs/graphql';

import { CommunicationType } from './CommunicationType';
import { ContentType } from './ContentType';
import { EventType } from './EventType';
import { FileType } from './FileType';
import { GlobalUID } from './GlobalUID';
import { ItemType } from './ItemType';
import type { Node } from './Node';
import { PersonType } from './PersonType';
import { PlaceType } from './PlaceType';
import { ThreadType } from './ThreadType';

export const SearchResultType = createUnionType({
  name: 'SearchResultType',
  types: () =>
    [
      CommunicationType,
      ContentType,
      EventType,
      FileType,
      ItemType,
      PersonType,
      PlaceType,
      ThreadType,
    ] as const,
  resolveType(instance): typeof Node {
    const { type } = GlobalUID.decode(instance.id);

    switch (type) {
      case 'communication':
        return CommunicationType;
      case 'content':
        return ContentType;
      case 'event':
        return EventType;
      case 'file':
        return FileType;
      case 'item':
        return ItemType;
      case 'person':
        return PersonType;
      case 'place':
        return PlaceType;
      case 'thread':
        return ThreadType;
      default:
        throw new Error('Invalid type');
    }
  },
});

export type SearchResult = typeof SearchResultType;
