import { useCallback, useEffect, useRef, useState } from 'react';

import { useTranscriptionService } from '@/api/useTranscriptionService';

interface UseVoiceModeProps {
  isActive: boolean;
  onSubmitMessage?: (message: string) => void;
  onStopAudio?: () => void;
}

export function useVoiceMode({ isActive, onSubmitMessage, onStopAudio }: UseVoiceModeProps) {
  // State
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [userStream, setUserStream] = useState<MediaStream | null>(null);
  const [companionStream, setCompanionStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const userStreamRef = useRef<MediaStream | null>(null);
  const companionAudioContextRef = useRef<AudioContext | null>(null);
  const companionStreamRef = useRef<MediaStream | null>(null);

  // Services
  const [transcriptionState, { transcribeAudio }] = useTranscriptionService();

  // Helper to get error message
  const getErrorMessage = () => {
    if (error) {
      return error;
    }

    if (transcriptionState.error) {
      return String(transcriptionState.error);
    }

    return null;
  };

  // Initialize microphone access
  const initializeMicrophone = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      userStreamRef.current = stream;
      setUserStream(stream);
      setError(null);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError('Could not access microphone. Please check permissions.');
    }
  }, []);

  // Cleanup streams
  const cleanupStreams = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }

    if (userStreamRef.current) {
      userStreamRef.current.getTracks().forEach((track) => track.stop());
      userStreamRef.current = null;
      setUserStream(null);
    }

    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    if (companionAudioContextRef.current) {
      companionAudioContextRef.current.close();
      companionAudioContextRef.current = null;
    }

    companionStreamRef.current = null;
    setCompanionStream(null);

    setIsRecording(false);
    setIsPlaying(false);
    audioChunksRef.current = [];
  }, []);

  // Start recording
  const startRecording = useCallback(async () => {
    if (!userStreamRef.current) {
      return;
    }

    // Stop any playing audio when starting to record
    onStopAudio?.();

    try {
      const mediaRecorder = new MediaRecorder(userStreamRef.current, {
        mimeType: 'audio/webm;codecs=opus',
      });
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm;codecs=opus' });
          try {
            await transcribeAudio(audioBlob);
            // The transcription result will be handled by the useEffect below
          } catch (err) {
            console.error('Error transcribing audio:', err);
            setError('Failed to transcribe audio');
          }
        }

        audioChunksRef.current = [];
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Failed to start recording');
    }
  }, [transcribeAudio, onStopAudio]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  // Toggle recording
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // Initialize microphone when voice mode becomes active (but don't start recording)
  useEffect(() => {
    if (isActive) {
      initializeMicrophone();
    } else {
      // Stop audio when voice mode is closed
      onStopAudio?.();
      cleanupStreams();
    }

    return () => {
      // Stop audio when component unmounts
      onStopAudio?.();
      cleanupStreams();
    };
  }, [isActive, initializeMicrophone, cleanupStreams, onStopAudio]);

  // Handle transcription results
  useEffect(() => {
    if (transcriptionState.text && transcriptionState.text.trim()) {
      onSubmitMessage?.(transcriptionState.text.trim());
    }
  }, [transcriptionState.text, onSubmitMessage]);

  return {
    // State
    isRecording,
    isPlaying,
    userStream,
    companionStream,
    error: getErrorMessage(),
    loading: transcriptionState.loading,

    // Actions
    toggleRecording,
  };
}
