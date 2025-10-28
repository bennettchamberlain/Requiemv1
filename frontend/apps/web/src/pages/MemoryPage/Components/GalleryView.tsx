import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks';

import { useMemoryTimeline } from '../MemoryProvider';

interface FileMeta {
  id: string;
  name: string;
  contentType: string;
  size: string;
  url?: string;
}

export function GalleryView() {
  const [{ authToken }] = useAuth();

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<FileMeta[]>([]);

  const { memories } = useMemoryTimeline();

  const hydrateFiles = useCallback(async () => {
    const tempFiles: FileMeta[] = [];
    const filtered = memories.filter((memory) => memory.metadata?.entityType === 'File');

    for (const memory of filtered) {
      if (memory.metadata) {
        const tempFile = await (
          await fetch(`/api/files/${memory.metadata.linkedId}`, {
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          })
        ).json();
        if (tempFile) {
          tempFiles.push(tempFile);
        }
      }
    }

    setFiles(tempFiles);
  }, [memories]);

  useEffect(() => {
    hydrateFiles();
  }, [memories]);

  // File upload handler
  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const form = e.currentTarget;
    const input = form.elements.namedItem('file') as HTMLInputElement;

    if (!input.files || input.files.length === 0) {
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();

    formData.append('file', input.files[0]);

    try {
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      });

      if (!res.ok) {
        throw new Error('Upload failed');
      }

      // After upload, refresh file list
      window.location.reload(); // Or call fetchFiles() if you refactor fetchFiles out of useEffect
    } catch (err) {
      setError((err as Error).message || 'Unknown error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <form className="flex items-center gap-4 mb-8" onSubmit={handleUpload} encType="multipart/form-data">
        <input
          type="file"
          name="file"
          className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:bg-blue-50 file:text-blue-700"
          required
        />
        <button
          type="submit"
          disabled={uploading}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      </form>

      {error && <div className="mb-4 text-red-500">{error}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {files.map((file) => {
          if (file.contentType?.startsWith('image/')) {
            return (
              <div
                key={file.id}
                className="flex flex-col items-center border rounded-lg p-2 bg-gray-50 shadow"
              >
                <img
                  src={`/static/${file.url}`}
                  alt={file.name}
                  className="w-full h-48 object-cover rounded mb-2"
                  loading="lazy"
                />
                <div className="text-xs font-medium">{file.name}</div>
                <div className="text-[10px] text-gray-400">{(Number(file.size) / 1024).toFixed(1)} KB</div>
              </div>
            );
          }

          if (file.contentType?.startsWith('video/')) {
            return (
              <div
                key={file.id}
                className="flex flex-col items-center border rounded-lg p-2 bg-gray-50 shadow"
              >
                <video
                  src={file.url}
                  controls
                  className="w-full h-48 object-cover rounded mb-2 bg-black"
                  preload="metadata"
                />
                <div className="text-xs font-medium">{file.name}</div>
                <div className="text-[10px] text-gray-400">
                  {(Number(file.size) / 1024 / 1024).toFixed(1)} MB
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>
    </>
  );
}
