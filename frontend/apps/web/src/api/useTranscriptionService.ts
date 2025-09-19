import { useCallback, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { AUDIO_CONSTANTS } from '@/lib/audio-utils';
import { fetchJson } from '@ci/common';

type ReturnType = [
  {
  text: string | null;
  loading: boolean;
  error: unknown | null;
  },
  {
    transcribeAudio: (audioBlob: Blob) => void;
  }
];

interface STTResponse {
  text: string;
}

export function useTranscriptionService(): ReturnType {
  const [{ authToken }] = useAuth();
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<unknown  | null>(null);
  

  const transcribeAudio = useCallback(
    async (audioBlob: Blob) => {
      setLoading(true);
      setError(null);
      setText(null);

      try {
    
        // Convert audio blob to base64 using utility function
        const base64Audio = await convertBlobToBase64(audioBlob);

        console.log('Sending STT request with audio size:', base64Audio.length, 'characters');

        const response = await fetchJson<STTResponse>('/api/stt/transcribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ audio: base64Audio }),
          timeout: AUDIO_CONSTANTS.TIMEOUT_MS,
        });

        setText(response.text);
      } catch (error) {
        setError(error);
      }
      finally {
        setLoading(false);
      }
    },
    [authToken],
  );

  return [
    {
      text,
      loading,
      error,
    },
    {
      transcribeAudio,
    },
  ];
}

/**
 * Converts a Blob to base64 string
 * @param blob - The audio blob to convert
 * @returns Promise that resolves to base64 string
 */
const convertBlobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:audio/webm;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };

    reader.onerror = () => reject(new Error('Failed to read audio file'));
    reader.readAsDataURL(blob);
  });
};
