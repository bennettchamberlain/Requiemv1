import { useCallback, useState } from 'react';

import { Badge, Button, Dialog } from '@ci/shadcn';
import { FilePlus, Scan, X } from '@ci/shadcn/icons';
import { useDropzone } from 'react-dropzone';

interface Props {
  open?: boolean;
  onClose?: () => void;
}

export function UploadModal({ open, onClose }: Props) {
  const [files, setFiles] = useState<File[]>([]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      const newFiles = acceptedFiles.filter((file) => !existingNames.has(file.name));

      return [...prev, ...newFiles];
    });
  }, []);

  const removeFile = useCallback((fileName: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== fileName));
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
  });

  const DropIcon = isDragActive ? Scan : FilePlus;
  const dropText = isDragActive ? 'Drop files here' : 'Drag or click to upload';

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Upload files</Dialog.Title>
        </Dialog.Header>

        <div
          {...getRootProps()}
          className="flex flex-col items-center justify-center h-40 border-8 p-2 rounded-lg gap-2"
        >
          <input {...getInputProps()} />

          <DropIcon className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />

          <div>{dropText}</div>
        </div>

        <div className="inline-flex gap-2 flex-wrap">
          {files.map((f) => (
            <Badge
              key={f.name}
              className="max-w-32 flex flex-row justify-between items-center p-1 pl-2 gap-1"
            >
              <div className="truncate">{f.name}</div>
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 p-1 hover:bg-primary! hover:text-primary-foreground!"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(f.name);
                }}
                aria-label={`Remove ${f.name}`}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
        </div>

        <Dialog.Footer>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onClose} disabled={files.length === 0}>
            Upload
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
