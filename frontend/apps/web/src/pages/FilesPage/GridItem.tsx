import { useMemo } from 'react';

import { Download, File as FileIcon, Image as ImageIcon } from '@ci/shadcn/icons';

import { gql, type FragmentType, useFragment } from '@/graphql';

import { Tile } from './Tile';
import type { FileSelection } from './types';

const FileGridItemFragment = gql(`
  fragment FileGridItemFragment on FileType {
    id
    filename
    contentType
    sourceUrl
    previewUrl
    createdAt
  }
`);

export function GridItem({
  file: fileMasked,
  onSelect,
}: {
  file: FragmentType<typeof FileGridItemFragment>;
  onSelect: (item: FileSelection) => void;
}) {
  const file = useFragment(FileGridItemFragment, fileMasked);
  const isImage = file.contentType.startsWith('image/');
  const isVideo = file.contentType.startsWith('video/');

  const sourceUrl = useMemo(() => {
    return file.sourceUrl ? `/static${file.sourceUrl}` : undefined;
  }, [file.sourceUrl]);

  const previewUrl = useMemo(() => {
    return file.previewUrl ? `/static${file.previewUrl}` : undefined;
  }, [file.previewUrl]);

  if (isImage && sourceUrl) {
    return (
      <Tile
        label={file.filename}
        onClick={() => onSelect({ id: file.id, type: 'image' })}
      >
        <img src={previewUrl ?? sourceUrl} alt={file.filename || ''} className="w-full h-full object-cover" />

        <div className="absolute bottom-2 left-2">
          <ImageIcon className="h-4 w-4 text-white drop-shadow-md opacity-0 group-hover:opacity-70 transition-opacity" />
        </div>
      </Tile>
    );
  }

  if (isVideo && sourceUrl) {
    return (
      <Tile
        label={file.filename}
        onClick={() => onSelect({ id: file.id, type: 'video' })}
      >
        <img src={previewUrl} alt={file.filename || ''} className="w-full h-full object-cover" />

        <div className="absolute bottom-2 left-2">
          <ImageIcon className="h-4 w-4 text-white drop-shadow-md opacity-0 group-hover:opacity-70 transition-opacity" />
        </div>
      </Tile>
    );
  }

  return (
    <Tile label={file.filename}>
      <a
        href={sourceUrl}
        download={file.filename}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-col items-center justify-center w-full h-full gap-2 p-4 hover:bg-muted/80 transition-colors"
      >
        <FileIcon className="h-10 w-10 text-muted-foreground" />
        <Download className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </a>
    </Tile>
  );
}
