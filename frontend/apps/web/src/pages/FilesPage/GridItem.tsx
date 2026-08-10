import { useMemo } from 'react';

import { Tooltip } from '@ci/shadcn';
import { File as FileIcon } from '@ci/shadcn/icons';
import { useTranslation } from 'react-i18next';

import { gql, type FragmentType, useFragment } from '@/graphql';

const FileGridItemFragment = gql(`
  fragment FileGridItemFragment on FileType {
    id
    filename
    previewUrl
  }
`);

export function GridItem({
  file: fileMasked,
  onSelect,
}: {
  file: FragmentType<typeof FileGridItemFragment>;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const file = useFragment(FileGridItemFragment, fileMasked);

  // The filename itself is user data and goes in verbatim; only the fallback is
  // copy, so only the fallback is keyed.
  const name = file.filename || t('FILES_UNTITLED');

  const previewUrl = useMemo(() => {
    return file.previewUrl ? `/static${file.previewUrl}` : undefined;
  }, [file.previewUrl]);

  return (
    <div className="flex flex-col gap-1.5">
      <Tooltip delayDuration={600}>
        <Tooltip.Content>{name}</Tooltip.Content>
        <Tooltip.Trigger asChild>
          <button
            onClick={() => onSelect(file.id)}
            className="relative group aspect-square rounded-lg overflow-hidden border border-border bg-muted transition-transform hover:shadow-md w-full cursor-pointer"
            aria-label={name}
          >
            {previewUrl && (
              <img src={previewUrl} alt={file.filename || ''} className="w-full h-full object-cover" />
            )}

            {!previewUrl && (
              <>
                <div className="absolute p-2 px-3 bottom-0 w-full text-sm truncate text-muted-foreground">
                  {file.filename}
                </div>

                <div className="flex flex-col items-center justify-center w-full h-full gap-2 p-4">
                  <FileIcon className="h-10 w-10 text-muted-foreground" />
                </div>
              </>
            )}
          </button>
        </Tooltip.Trigger>
      </Tooltip>
    </div>
  );
}
