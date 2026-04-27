import { Button, Input, Label, Sheet } from '@ci/shadcn';

import { type FragmentType, useFragment } from '@/graphql';

import { getFileChunkPreview, getFileChunkSubtitle, getFileChunkTitle } from '../../fileChunks';
import { FILE_CHUNK_CARD_FRAGMENT } from '../EntityCard/FileChunkCard';

interface Props {
  entity: FragmentType<typeof FILE_CHUNK_CARD_FRAGMENT>;
}

export function FileChunkDetails({ entity }: Props) {
  const data = useFragment(FILE_CHUNK_CARD_FRAGMENT, entity);
  const title = getFileChunkTitle(data);
  const subtitle = getFileChunkSubtitle(data);
  const sourceUrl = data.file?.sourceUrl ? `/static${data.file.sourceUrl}` : null;

  return (
    <Sheet.Content className="z-index-1000">
      <Sheet.Header>
        <Sheet.Title>{title}</Sheet.Title>
        <Sheet.Description>{subtitle ?? 'Document excerpt'}</Sheet.Description>
      </Sheet.Header>

      <div className="grid flex-1 auto-rows-min gap-6 px-4">
        {data.file?.filename && (
          <div className="grid gap-3">
            <Label htmlFor="fileName">File</Label>
            <Input id="fileName" disabled defaultValue={data.file.filename} />
          </div>
        )}

        {data.createdAt && (
          <div className="grid gap-3">
            <Label htmlFor="chunkCreatedAt">Indexed At</Label>
            <Input id="chunkCreatedAt" disabled defaultValue={new Date(data.createdAt).toLocaleString()} />
          </div>
        )}

        <div className="grid gap-3">
          <Label>Excerpt</Label>
          <div className="rounded-md border bg-muted/40 p-4 text-sm whitespace-pre-wrap leading-relaxed">
            {getFileChunkPreview(data.chunkContent, data.chunkContent.length)}
          </div>
        </div>

        {sourceUrl && (
          <div className="grid gap-3">
            <Label>Source</Label>
            <div>
              <Button type="button" variant="outline" onClick={() => window.open(sourceUrl, '_blank')}>
                Open File
              </Button>
            </div>
          </div>
        )}
      </div>
    </Sheet.Content>
  );
}
