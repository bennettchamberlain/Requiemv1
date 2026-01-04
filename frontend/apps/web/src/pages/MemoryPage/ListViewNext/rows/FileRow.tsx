import { type MouseEvent } from 'react';

import { FileIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { SearchTable } from '../SearchTable';

export const FILE_FRAGMENT = gql(`
  fragment TableFileRowData on FileType {
    id
    url
  }
`);

interface Props {
  file: FragmentType<typeof FILE_FRAGMENT>;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function FileRow({ file, onClick }: Props) {
  const data = useFragment(FILE_FRAGMENT, file);

  return (
    <SearchTable.Row onClick={onClick}>
      <SearchTable.Cell className="align-middle w-10">
        <FileIcon />
      </SearchTable.Cell>

      <SearchTable.Cell className="align-middle w-100">File ID: {data.id}</SearchTable.Cell>

      <SearchTable.Cell className="align-middle">{data.url}</SearchTable.Cell>
    </SearchTable.Row>
  );
}

{
  /* <SearchTable.Row className="relative p-0" onClick={onClick}>
      <div className="rounded-md overflow-hidden min-h-0 grow inset-0">
        <div className="rounded-tl-md absolute w-full flex flex-wrap gap-1 z-10 p-3 [background-image:radial-gradient(circle_at_top_left,_rgba(255,255,255,0.9),_rgba(255,255,255,0.1))]">
          <File size={24} strokeWidth={1} />
        </div>
        <img src={data.url} className="object-cover w-full h-full" />
      </div>
    </SearchTable.Row> */
}
