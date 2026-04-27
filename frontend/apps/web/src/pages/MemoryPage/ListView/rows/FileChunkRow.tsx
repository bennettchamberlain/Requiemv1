import { type MouseEvent } from 'react';

import { FileText } from '@ci/shadcn/icons';

import { gql, useFragment, type FragmentType } from '@/graphql';

import { getFileChunkPreview, getFileChunkSubtitle, getFileChunkTitle } from '../../fileChunks';
import { SearchTable } from '../SearchTable';

export const FILE_CHUNK_ROW_FRAGMENT = gql(`
  fragment TableFileChunkRowData on FileChunkType {
    id
    sectionTitle
    chunkContent: content
    sourceLocator
    file {
      id
      filename
    }
  }
`);

interface Props {
  fileChunk: FragmentType<typeof FILE_CHUNK_ROW_FRAGMENT>;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function FileChunkRow({ fileChunk, onClick }: Props) {
  const data = useFragment(FILE_CHUNK_ROW_FRAGMENT, fileChunk);
  const title = getFileChunkTitle(data);
  const subtitle = getFileChunkSubtitle(data);
  const preview = getFileChunkPreview(data.chunkContent, 260);

  return (
    <SearchTable.Row onClick={onClick}>
      <SearchTable.Cell className="align-middle w-15 px-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-muted text-muted-foreground">
          <FileText className="h-4 w-4" />
        </div>
      </SearchTable.Cell>

      <SearchTable.Cell className="align-middle w-75">
        <div className="font-medium">{title}</div>
        {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
      </SearchTable.Cell>

      <SearchTable.Cell className="align-middle">
        <div className="line-clamp-2 text-sm text-muted-foreground">{preview}</div>
      </SearchTable.Cell>
    </SearchTable.Row>
  );
}
