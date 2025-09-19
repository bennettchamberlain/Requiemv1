/**
 * Audio processing utilities for speech services
 */

/**
 * Audio processing constants
 */
export const AUDIO_CONSTANTS = {
  MIME_TYPES: {
    WAV: 'audio/wav',
    WEBM: 'audio/webm',
    MP3: 'audio/mpeg',
  },
  TIMEOUT_MS: 120000, // 2 minutes
} as const;
