import { useAuth } from '@/hooks';
import { useEffect, useState } from 'react';

interface FileMeta {
  id: string;
  name: string;
  contentType: string;
  size: string;
  url?: string;
}

export function FilesGalleryPage() {
  const [{ authToken }] = useAuth();

  const [files, setFiles] = useState<FileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch files and get presigned links
  useEffect(() => {
    const fetchFiles = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/files', {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });

        if (!res.ok) {
          throw new Error('Failed to fetch file list');
        }

        const metaList: FileMeta[] = (await res.json()).map((file: FileMeta) => ({
          ...file,
          url: `/static${file.url}`,
        }));

        setFiles(metaList);
      } catch (err: any) {
        setError(err.message || 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchFiles();
  }, []);

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
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-10">
      <h1 className="text-3xl font-bold mb-8">File Gallery</h1>

      {/* File Upload */}
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
      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {files.map((file) =>
            file.contentType.startsWith('image/') ? (
              <div
                key={file.id}
                className="flex flex-col items-center border rounded-lg p-2 bg-gray-50 shadow"
              >
                <img
                  src={file.url}
                  alt={file.name}
                  className="w-full h-48 object-cover rounded mb-2"
                  loading="lazy"
                />
                <div className="text-xs font-medium">{file.name}</div>
                <div className="text-[10px] text-gray-400">{(Number(file.size) / 1024).toFixed(1)} KB</div>
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
