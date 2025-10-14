import { useCallback, useRef, useEffect } from 'react';

import { useSynthesizeService } from '@/api/useSynthesizeService';

interface UseCompanionAudioPlaybackProps {
  onAudioStart?: () => void;
  onAudioEnd?: () => void;
  onError?: (error: string) => void;
  voice?: string; // Default voice to use for TTS
}

export function useCompanionAudioPlayback({
  onAudioStart,
  onAudioEnd,
  onError,
  voice,
}: UseCompanionAudioPlaybackProps = {}) {
  const [synthesisState, { synthesizeSpeech, switchVoice, cancelSynthesis }] = useSynthesizeService();
  const audioBlobRef = useRef<Blob | null>(null);
  const isPlayingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Keep ref in sync with synthesis state - only update if different
  useEffect(() => {
    if (audioBlobRef.current !== synthesisState.audioBlob) {
      audioBlobRef.current = synthesisState.audioBlob;
    }
  }, [synthesisState.audioBlob]);

  // Switch voice when it changes
  useEffect(() => {
    if (voice) {
      switchVoice(voice).catch((error) => {
        console.error('Failed to switch voice:', error);
        onError?.('Failed to switch voice');
      });
    }
  }, [voice, switchVoice, onError]);

  const playCompanionResponse = useCallback(
    async (text: string) => {
      if (!text.trim() || isPlayingRef.current) {
        return;
      }

      try {
        isPlayingRef.current = true;
        onAudioStart?.();
        await synthesizeSpeech(text, voice);

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
          currentAudioRef.current = audioElement;

          audioElement.onended = () => {
            isPlayingRef.current = false;
            currentAudioRef.current = null;
            onAudioEnd?.();
            URL.revokeObjectURL(audioUrl);
          };

          audioElement.onerror = (error) => {
            console.error('🎤 useCompanionAudioPlayback: Audio playback error:', error);
            isPlayingRef.current = false;
            currentAudioRef.current = null;
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
    [synthesizeSpeech, onAudioStart, onAudioEnd, onError, voice],
  );

  const stopAudioPlayback = useCallback(() => {
    // Stop any currently playing audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }

    // Cancel any pending synthesis
    cancelSynthesis();

    // Reset playing state
    isPlayingRef.current = false;
    onAudioEnd?.();

    console.log('🎤 Audio playback stopped');
  }, [cancelSynthesis, onAudioEnd]);

  return {
    playCompanionResponse,
    stopAudioPlayback,
    isPlaying: synthesisState.loading,
    error: synthesisState.error,
  };
}
