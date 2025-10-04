import { useCallback, useRef, useState } from 'react';

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
    synthesizeSpeech: (text: string, voice?: string) => Promise<void>;
    switchVoice: (voice: string) => Promise<void>;
    cancelSynthesis: () => void;
  },
];

interface TTSResponse {
  audio: string;
  sample_rate: number;
  duration?: number;
}

/**
 * Helper function to remove markdown formatting from text
 */
function removeMarkdown(text: string): string {
  return (
    text
      // Remove headers (# ## ###)
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bold/italic (**text** or __text__)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      // Remove single asterisk/underscore emphasis
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Remove strikethrough (~~text~~)
      .replace(/~~([^~]+)~~/g, '$1')
      // Remove inline code (`code`)
      .replace(/`([^`]+)`/g, '$1')
      // Remove code blocks (```code```)
      .replace(/```[\s\S]*?```/g, '')
      // Remove links [text](url)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove images ![alt](url)
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      // Remove horizontal rules (--- or ***)
      .replace(/^[-*]{3,}$/gm, '')
      // Remove blockquotes (> text)
      .replace(/^>\s*/gm, '')
      // Remove list markers (- * + 1.)
      .replace(/^[\s]*[-*+]\s+/gm, '')
      .replace(/^[\s]*\d+\.\s+/gm, '')
      // Remove table formatting (| col |)
      .replace(/\|/g, ' ')
      // Clean up multiple spaces
      .replace(/\s+/g, ' ')
      // Remove leading/trailing whitespace
      .trim()
  );
}

/**
 * Helper function to remove emojis from text
 */
function removeEmojis(text: string): string {
  // Unicode ranges for emojis and symbols
  const emojiRegex =
    /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F018}-\u{1F0F5}]|[\u{1F200}-\u{1F2FF}]|[\u{1FA70}-\u{1FAFF}]|[\u{1F004}]|[\u{1F0CF}]|[\u{1F170}-\u{1F251}]/gu;

  return text.replace(emojiRegex, '');
}

/**
 * Helper function to clean text for TTS synthesis
 * Removes markdown, emojis, and normalizes whitespace
 */
function cleanTextForTTS(text: string): string {
  if (!text) {
    return '';
  }

  // First remove markdown
  let cleaned = removeMarkdown(text);
  // Then remove emojis
  cleaned = removeEmojis(cleaned);
  // Clean up any remaining special characters that might cause issues
  cleaned = cleaned.replace(/[^\w\s.,!?;:'"()-]/g, '');
  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

export function useSynthesizeService(): ReturnType {
  const [{ authToken }] = useAuth();
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<unknown | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const synthesizeSpeech = useCallback(
    async (text: string, voice?: string): Promise<void> => {
      // Cancel any existing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setLoading(true);
      setError(null);
      setAudioBlob(null);

      try {
        // Clean the text before sending to TTS
        const cleanedText = cleanTextForTTS(text);
        console.log('🎤 Original text:', text);
        console.log('🎤 Cleaned text:', cleanedText);

        const result = await fetchJson<TTSResponse>('/api/tts/convert', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ text: cleanedText, voice }),
          signal: abortController.signal,
        });

        // Check if request was aborted
        if (abortController.signal.aborted) {
          return;
        }

        // Convert base64 to audio blob using utility function
        const audioBlob = convertBase64ToBlob(result.audio, MimeTypes.WAV);
        console.log('🎤 Created audio blob:', { size: audioBlob.size, type: audioBlob.type });

        setAudioBlob(audioBlob);
      } catch (error) {
        // Don't set error if request was aborted
        if (!abortController.signal.aborted) {
          setError(error);
          throw error;
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [authToken],
  );

  const switchVoice = useCallback(
    async (voice: string): Promise<void> => {
      try {
        await fetchJson('/api/tts/switch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ voice }),
        });
        console.log(`🎤 Switched to voice: ${voice}`);
      } catch (error) {
        console.error('Error switching voice:', error);
        throw error; // Throw error for voice switching
      }
    },
    [authToken],
  );

  const cancelSynthesis = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setLoading(false);
      setError(null);
      console.log('🎤 Synthesis cancelled');
    }
  }, []);

  return [
    {
      audioBlob,
      loading,
      error,
    },
    {
      synthesizeSpeech,
      switchVoice,
      cancelSynthesis,
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
