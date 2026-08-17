import { useCallback, useRef, useState, type DragEvent } from 'react';

import { Button, Card, cn } from '@ci/shadcn';
import { Upload } from '@ci/shadcn/icons';

import { collectDroppedFiles } from './collectDroppedFiles';

export interface DropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  /** Shown under the prompt — what the appliance is waiting for. */
  hint?: string;
  /** Headline override, e.g. "Drop your Spotify export here" on a wizard card. */
  label?: string;
  /** Tighter padding for embedding inside another card. */
  compact?: boolean;
}

/**
 * Where an export lands.
 *
 * Drag-and-drop over click-to-browse, because the thing being dropped is a
 * file or unzipped folder someone just downloaded. A folder is walked via
 * `webkitGetAsEntry` so it becomes the real files, not a 0-byte directory
 * placeholder that FormData cannot send.
 *
 * The counter matters more than it looks: `dragenter` and `dragleave` fire for
 * every child element the pointer crosses, so tracking a boolean makes the
 * highlight flicker as the cursor moves over the text inside the zone. Counting
 * enters against leaves is what keeps it steady.
 */
export function DropZone({ onFiles, disabled, hint, label, compact }: DropZoneProps) {
  const [active, setActive] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const depth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    depth.current = 0;
    setActive(false);
  }, []);

  const emitFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) {
        setDropError('Nothing readable in that drop. Choose a folder, or drop the .zip.');

        return;
      }

      setDropError(null);
      onFiles(files);
    },
    [onFiles],
  );

  const handleDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      if (disabled) {
        return;
      }

      depth.current += 1;
      setActive(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    depth.current = Math.max(0, depth.current - 1);

    if (depth.current === 0) {
      setActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      reset();

      if (disabled) {
        return;
      }

      void collectDroppedFiles(event.dataTransfer)
        .then(emitFiles)
        .catch(() => {
          setDropError('Could not read that folder. Choose folder, or drop the .zip.');
        });
    },
    [disabled, emitFiles, reset],
  );

  return (
    <Card
      className={cn(
        // border-primary matches the card's action buttons — the zone is the
        // main thing to do here, and a muted dashed box read as decoration.
        'flex flex-col items-center justify-center gap-3 border-2 border-dashed border-primary text-center transition-colors',
        compact ? 'p-5' : 'p-10',
        active && !disabled && 'bg-primary/5',
        disabled && 'opacity-60',
      )}
      onDragEnter={handleDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid="import-dropzone"
      data-active={active ? 'true' : 'false'}
    >
      <Upload className="h-8 w-8 text-muted-foreground" aria-hidden />

      <div className="space-y-1">
        <p className="font-medium">{label ?? 'Drop your export here'}</p>
        <p className="text-sm text-muted-foreground">
          {hint ?? 'A .zip, a single file, or the unzipped folder.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" disabled={disabled} onClick={() => fileInput.current?.click()}>
          Choose files
        </Button>
        <Button variant="outline" disabled={disabled} onClick={() => folderInput.current?.click()}>
          Choose folder
        </Button>
      </div>

      {dropError != null && <p className="text-sm text-destructive">{dropError}</p>}

      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        aria-label="Choose export files to import"
        onChange={(event) => {
          emitFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        className="hidden"
        aria-label="Choose an export folder to import"
        {...{ webkitdirectory: '', directory: '' }}
        onChange={(event) => {
          emitFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
    </Card>
  );
}
