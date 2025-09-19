import { useCallback, useState } from "react";

type ReturnType = [
    {
      isActive: boolean;
      isRecording: boolean;
      isPlaying: boolean;
      userStream: MediaStream | null;
      companionStream: MediaStream | null;
      error: string | null;
    },
    {
      playCompanionResponse: (text: string) => Promise<void>;
    },
  ];
  
  export function useVoiceMode(): ReturnType {
    const [isActive, setIsActive] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [userStream, setUserStream] = useState<MediaStream | null>(null);
    const [companionStream, setCompanionStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);
  
  // TTS and audio playback
  const playCompanionResponse = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        return;
      }
  
      setIsPlaying(true);
  
      try {
        const audioBlob = synthesizeSpeech(text);
        console.log('🎤 TTS completed, blob size:', audioBlob.size, 'type:', audioBlob.type);
  
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
  
        // Set up audio stream for waveform visualization
        setupCompanionAudioStream(audio);
  
        audio.onended = () => {
          console.log('🎤 Audio playback ended');
          URL.revokeObjectURL(audioUrl);
          setIsPlaying(false);
          // Clean up companion stream when audio ends
          if (companionAudioContextRef.current) {
            companionAudioContextRef.current.close();
            companionAudioContextRef.current = null;
          }
  
          companionStreamRef.current = null;
          setCompanionStream(null);
        };
  
        audio.onerror = (e) => {
          console.error('🎤 Audio playback error:', e);
          URL.revokeObjectURL(audioUrl);
          setIsPlaying(false);
          setError('Failed to play audio - check browser console for details');
          // Clean up on error
          if (companionAudioContextRef.current) {
            companionAudioContextRef.current.close();
            companionAudioContextRef.current = null;
          }
  
          companionStreamRef.current = null;
          setCompanionStream(null);
        };
  
        audio.onloadstart = () => console.log('🎤 Audio loading started');
        audio.oncanplay = () => console.log('🎤 Audio can play');
        audio.oncanplaythrough = () => console.log('🎤 Audio can play through');
  
        currentAudioRef.current = audio;
        console.log('🎤 Starting audio playback...');
        await audio.play();
        console.log('🎤 Audio playback started successfully');
      } catch (err) {
        console.error('🎤 Error in TTS/playback:', err);
        setError(`Failed to play audio: ${err instanceof Error ? err.message : 'Unknown error'}`);
        setIsPlaying(false);
      }
    },
    [synthesizeSpeech, setupCompanionAudioStream],
  );
  }