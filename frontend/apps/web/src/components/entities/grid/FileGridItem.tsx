import { type MouseEvent } from 'react';

import { FileIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { EntityGridItem } from './EntityGridItem';

export const FILE_FRAGMENT = gql(`
  fragment FileGridItemData on FileType {
    id
    url
  }
`);

interface Props {
  file: FragmentType<typeof FILE_FRAGMENT>;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function FileGridItem({ file, onClick }: Props) {
  const data = useFragment(FILE_FRAGMENT, file);

  return (
    <EntityGridItem className="relative p-0" onClick={onClick}>
      <div className="rounded-md overflow-hidden min-h-0 grow inset-0">
        <div className="rounded-tl-md absolute w-full flex flex-wrap gap-1 z-10 p-3 [background-image:radial-gradient(circle_at_top_left,_rgba(255,255,255,0.9),_rgba(255,255,255,0.1))]">
          <FileIcon className="shrink-0" />
        </div>
        <img src={data.url} className="object-cover w-full h-full" />
      </div>
    </EntityGridItem>
  );
}
