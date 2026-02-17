import { type MouseEvent } from 'react';

import { ItemIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { SearchTable } from '../SearchTable';

export const ITEM_FRAGMENT = gql(`
  fragment TableItemRowData on ItemType {
    id
    name
    description
    file {
      id
      sourceUrl
    }
  }
`);

interface Props {
  item: FragmentType<typeof ITEM_FRAGMENT>;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function ItemRow({ item, onClick }: Props) {
  const data = useFragment(ITEM_FRAGMENT, item);

  // TODO: Handle picture expansion.

  return (
    <SearchTable.Row onClick={onClick}>
      <SearchTable.Cell className="align-middle w-0 px-2.5">
        <ItemIcon />
      </SearchTable.Cell>

      <SearchTable.Cell className="align-middle w-100">{data.name}</SearchTable.Cell>

      <SearchTable.Cell className="align-middle">{data.description}</SearchTable.Cell>
    </SearchTable.Row>
  );
}

// {data.file && (
//           <div className="rounded-sm overflow-hidden min-h-0 grow">
//             <img
//               src={data.file.url}
//               alt={data.name ? `${data.name} image` : 'Item image'}
//               className="object-cover w-full h-full"
//             />
//           </div>
//         )}
