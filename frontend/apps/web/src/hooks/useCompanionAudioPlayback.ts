import { useCallback, useRef, useEffect } from 'react';

import { useSynthesizeService } from '@/api/useSynthesizeService';

interface UseCompanionAudioPlaybackProps {
  onAudioStart?: () => void;
  onAudioEnd?: () => void;
  onError?: (error: string) => void;
}

export function useCompanionAudioPlayback({
  onAudioStart,
  onAudioEnd,
  onError,
}: UseCompanionAudioPlaybackProps = {}) {
  const [synthesisState, { synthesizeSpeech }] = useSynthesizeService();
  const audioBlobRef = useRef<Blob | null>(null);
  const isPlayingRef = useRef(false);

  // Keep ref in sync with synthesis state - only update if different
  useEffect(() => {
    if (audioBlobRef.current !== synthesisState.audioBlob) {
      audioBlobRef.current = synthesisState.audioBlob;
    }
  }, [synthesisState.audioBlob]);

  const playCompanionResponse = useCallback(
    async (text: string) => {
      if (!text.trim() || isPlayingRef.current) {
        return;
      }

      try {
        isPlayingRef.current = true;
        onAudioStart?.();
        await synthesizeSpeech(text);

        // Wait for the audio blob to be available
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds max wait
        while (!audioBlobRef.current && attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          attempts++;
        }

        // Create audio element and play the synthesized audio
        if (audioBlobRef.current) {
          const audioUrl = URL.createObjectURL(audioBlobRef.current);
          const audioElement = new Audio(audioUrl);

          audioElement.onended = () => {
            isPlayingRef.current = false;
            onAudioEnd?.();
            URL.revokeObjectURL(audioUrl);
          };

          audioElement.onerror = (error) => {
            console.error('🎤 useCompanionAudioPlayback: Audio playback error:', error);
            isPlayingRef.current = false;
            onAudioEnd?.();
            URL.revokeObjectURL(audioUrl);
            onError?.('Failed to play audio response');
          };

          await audioElement.play();
        } else {
          isPlayingRef.current = false;
        }
      } catch (err) {
        console.error('Error playing companion response:', err);
        isPlayingRef.current = false;
        onAudioEnd?.();
        onError?.('Failed to play audio response');
      }
    },
    [synthesizeSpeech, onAudioStart, onAudioEnd, onError],
  );

  return {
    playCompanionResponse,
    isPlaying: synthesisState.loading,
    error: synthesisState.error,
  };
}
