import { useCallback, useRef, useState, type DragEvent } from 'react';

import { Button, Card, cn } from '@ci/shadcn';
import { Upload } from '@ci/shadcn/icons';

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
 * Drag-and-drop over a click-to-browse fallback, because the thing being dropped
 * is a file someone just downloaded from Google or Apple and dragging it out of
 * a Downloads folder is the shortest path from there to here.
 *
 * The counter matters more than it looks: `dragenter` and `dragleave` fire for
 * every child element the pointer crosses, so tracking a boolean makes the
 * highlight flicker as the cursor moves over the text inside the zone. Counting
 * enters against leaves is what keeps it steady.
 */
export function DropZone({ onFiles, disabled, hint, label, compact }: DropZoneProps) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    depth.current = 0;
    setActive(false);
  }, []);

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

      const files = Array.from(event.dataTransfer?.files ?? []);

      if (files.length) {
        onFiles(files);
      }
    },
    [disabled, onFiles, reset],
  );

  return (
    <Card
      className={cn(
        'flex flex-col items-center justify-center gap-3 border-2 border-dashed text-center transition-colors',
        compact ? 'p-5' : 'p-10',
        active && !disabled ? 'border-primary bg-primary/5' : 'border-muted',
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
          {hint ?? 'A .zip straight from Google Takeout, Apple, Twitter or anywhere else.'}
        </p>
      </div>

      <Button variant="outline" disabled={disabled} onClick={() => input.current?.click()}>
        Choose a file
      </Button>

      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        aria-label="Choose an export to import"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);

          if (files.length) {
            onFiles(files);
          }

          // Clear it, or picking the SAME file twice fires no change event and
          // a retry after a failed upload silently does nothing.
          event.target.value = '';
        }}
      />
    </Card>
  );
}
