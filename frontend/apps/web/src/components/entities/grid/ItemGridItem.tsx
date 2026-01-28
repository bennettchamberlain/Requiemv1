import { type MouseEvent } from 'react';

import { ItemIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { EntityGridItem } from './EntityGridItem';

export const ITEM_FRAGMENT = gql(`
  fragment ItemGridItemData on ItemType {
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

export function ItemGridItem({ item, onClick }: Props) {
  const data = useFragment(ITEM_FRAGMENT, item);

  return (
    <EntityGridItem onClick={onClick}>
      <EntityGridItem.Header>
        <ItemIcon className="shrink-0" />

        <div className="text-md font-semibold truncate">{data.name}</div>
      </EntityGridItem.Header>

      <EntityGridItem.Content>
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
      </EntityGridItem.Content>

      <EntityGridItem.Footer className="self-end">
        <div className="text-sm text-muted-foreground">Item</div>
      </EntityGridItem.Footer>
    </EntityGridItem>
  );
}
