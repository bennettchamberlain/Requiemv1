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
    upload: (file: File[], isInventory?: boolean, model?: string) => Promise<FileData[]>;
    reset: () => void;
  },
];

export function useUploadFile(): ReturnType {
  const [{ authToken }] = useAuth();

  const [files, setFiles] = useState<FileData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  const upload = useCallback(
    async (files: File[], isInventory = false, model?: string) => {
      setFiles([]);
      setError(null);
      setLoading(true);

      const formData = new FormData();

      files.forEach((file) => {
        formData.append('files', file);
      });

      try {
        const queryParams = new URLSearchParams();
        if (isInventory) {
          queryParams.append('inventory', 'true');
        }

        if (model) {
          queryParams.append('model', model);
        }

        const url = `/api/files/upload?${queryParams.toString()}`;

        const data = await fetchJson<FileData[]>(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
          body: formData,
        });

        setFiles(data);

        return data;
      } catch (err) {
        setError(err);

        throw err;
      } finally {
        setLoading(false);
      }
    },
    [authToken],
  );

  const reset = useCallback(() => {
    setFiles([]);
    setError(null);
    setLoading(false);
  }, []);

  return [
    {
      files,
      loading,
      error,
    },
    {
      upload,
      reset,
    },
  ];
}
