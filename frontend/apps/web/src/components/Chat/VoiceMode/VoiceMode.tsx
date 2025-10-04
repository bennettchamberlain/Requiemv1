import { Button, cn, Select } from '@ci/shadcn';
import { Mic, MicOff, Volume2, X } from '@ci/shadcn/icons';

import { useVoiceMode } from '@/hooks/useVoiceMode';

import { AudioWaveform } from '../AudioWaveform';

interface Props {
  isActive: boolean;
  onToggle: () => void;
  onSubmitMessage?: (message: string) => void;
  className?: string;
  selectedVoice?: string;
  onVoiceChange?: (voice: string) => void;
  onStopAudio?: () => void;
}

// Available voices
const VOICE_OPTIONS = [
  { value: 'ryan', label: 'Ryan' },
  { value: 'amy', label: 'Amy' },
  { value: 'sam', label: 'Sam' },
  { value: 'sarah', label: 'Sarah' },
  { value: 'david', label: 'David' },
  { value: 'norman', label: 'Norman' },
  { value: 'robot', label: 'Robot' },
];

export function VoiceMode({
  isActive,
  onToggle,
  onSubmitMessage,
  className,
  selectedVoice = 'ryan',
  onVoiceChange,
  onStopAudio,
}: Props) {
  const { isRecording, isPlaying, userStream, companionStream, error, loading, toggleRecording } =
    useVoiceMode({
      isActive,
      onSubmitMessage,
      onStopAudio,
    });

  if (!isActive) {
    return null;
  }

  return (
    <div className={cn('w-full p-3 bg-muted/30 border rounded-lg mb-3', className)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-xs font-medium">Voice Mode</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {isRecording ? (
              <>
                <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                Recording
              </>
            ) : isPlaying ? (
              <>
                <Volume2 className="w-3 h-3" />
                Speaking
              </>
            ) : userStream ? (
              <>
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                Ready
              </>
            ) : (
              <>
                <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full" />
                Initializing
              </>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onToggle} className="h-6 w-6 p-0">
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-3 p-2 bg-destructive/10 border border-destructive/20 rounded text-xs">
          <p className="text-destructive">{error}</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        {/* User Audio Waveform */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 h-4">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            <span className="text-xs text-muted-foreground">You</span>
          </div>
          <AudioWaveform
            audioStream={userStream || undefined}
            isActive={isRecording}
            color="user"
            className="w-full h-12"
          />
        </div>

        {/* Companion Audio Waveform */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 h-4">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-xs text-muted-foreground">Companion</span>
            {onVoiceChange && (
              <Select value={selectedVoice} onValueChange={onVoiceChange} disabled={isPlaying}>
                <Select.Trigger className="h-4 px-1 text-xs border-0 bg-transparent focus:ring-0 shadow-none min-w-0">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content className="p-0 shadow-none border-0 bg-background/95 backdrop-blur-sm">
                  {VOICE_OPTIONS.map((voice) => (
                    <Select.Item
                      key={voice.value}
                      value={voice.value}
                      className="text-xs px-1 py-0.5 hover:bg-muted/50"
                    >
                      {voice.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            )}
          </div>
          <AudioWaveform
            audioStream={companionStream || undefined}
            isActive={isPlaying}
            color="companion"
            className="w-full h-12"
          />
        </div>

        {/* Record/Stop Button */}
        <div className="flex flex-col items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={toggleRecording}
            disabled={!userStream || loading}
            className={`h-8 w-8 rounded-full p-0 ${
              isRecording
                ? 'bg-red-500 hover:bg-red-600 text-white border-red-500 hover:border-red-600'
                : 'bg-blue-500 hover:bg-blue-600 text-white border-blue-500 hover:border-blue-600'
            }`}
          >
            {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <span className="text-xs text-muted-foreground">{isRecording ? 'Stop' : 'Record'}</span>
        </div>
      </div>
    </div>
  );
}
