import { useState, useCallback } from 'react';

import { fetchJson } from '@ci/common';

import { useAuth } from '@/hooks';

import type { File as FileData } from './types';

type ReturnType = [
  {
    files: FileData[];
    loading: boolean;
    error: unknown | null;
  },
  {
    upload: (file: File[]) => void;
  },
];

export function useUploadFile(): ReturnType {
  const [{ authToken }] = useAuth();

  const [files, setFiles] = useState<FileData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  const upload = useCallback(
    async (files: File[]) => {
      setFiles([]);
      setError(null);
      setLoading(true);

      const formData = new FormData();

      files.forEach((file) => {
        formData.append('files', file);
      });

      let success = false;

      try {
        const data = await fetchJson<FileData[]>('/api/files/upload', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
          body: formData,
        });

        setFiles(data);

        success = true;
      } catch (err) {
        setError(err);

        success = false;
      } finally {
        setLoading(false);
      }

      return success;
    },
    [authToken],
  );

  return [
    {
      files,
      loading,
      error,
    },
    {
      upload,
    },
  ];
}
