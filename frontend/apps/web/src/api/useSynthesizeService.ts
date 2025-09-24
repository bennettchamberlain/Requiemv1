import { useCallback, useState } from 'react';

import { fetchJson } from '@ci/common';

import { useAuth } from '@/hooks/use-auth';
import { MimeTypes } from '@/lib/mime_types';

type ReturnType = [
  {
    audioBlob: Blob | null;
    loading: boolean;
    error: unknown | null;
  },
  {
    synthesizeSpeech: (text: string) => Promise<void>;
  },
];

interface TTSResponse {
  audio: string;
}

export function useSynthesizeService(): ReturnType {
  const [{ authToken }] = useAuth();
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<unknown | null>(null);

  const synthesizeSpeech = useCallback(
    async (text: string): Promise<void> => {
      setLoading(true);
      setError(null);
      setAudioBlob(null);

      try {
        const result = await fetchJson<TTSResponse>('/api/tts/convert', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ text }),
        });

        // Convert base64 to audio blob using utility function
        const audioBlob = convertBase64ToBlob(result.audio, MimeTypes.WAV);
        console.log('🎤 Created audio blob:', { size: audioBlob.size, type: audioBlob.type });

        setAudioBlob(audioBlob);
      } catch (error) {
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [authToken],
  );

  return [
    {
      audioBlob,
      loading,
      error,
    },
    {
      synthesizeSpeech,
    },
  ];
}

/**
 * Converts base64 string to Blob
 * @param base64Audio - The base64 encoded audio data
 * @param mimeType - The MIME type for the blob (defaults to 'audio/wav')
 * @returns Blob object
 */
const convertBase64ToBlob = (base64Audio: string, mimeType: string = 'audio/wav'): Blob => {
  const binaryString = atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
};
