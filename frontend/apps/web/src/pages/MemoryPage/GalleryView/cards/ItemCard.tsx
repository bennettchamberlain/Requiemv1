import { type MouseEvent } from 'react';

import { ItemIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { SearchCard } from '../SearchCard';

export const ITEM_FRAGMENT = gql(`
  fragment GalleryItemCardData on ItemType {
    id
    name
    description
    file {
      id
      url
    }
  }
`);

interface Props {
  item: FragmentType<typeof ITEM_FRAGMENT>;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function ItemCard({ item, onClick }: Props) {
  const data = useFragment(ITEM_FRAGMENT, item);

  return (
    <SearchCard onClick={onClick}>
      <SearchCard.Header>
        <ItemIcon />

        <div className="text-md font-semibold truncate">{data.name}</div>
      </SearchCard.Header>

      <SearchCard.Content>
        <div className="line-clamp-3 leading-tight min-h-0 shrink-0">{data.description}</div>

        {data.file && (
          <div className="rounded-sm overflow-hidden min-h-0 grow">
            <img
              src={data.file.url}
              alt={data.name ? `${data.name} image` : 'Item image'}
              className="object-cover w-full h-full"
            />
          </div>
        )}
      </SearchCard.Content>

      <SearchCard.Footer className="self-end">
        <div className="text-sm text-muted-foreground">Item</div>
      </SearchCard.Footer>
    </SearchCard>
  );
}
