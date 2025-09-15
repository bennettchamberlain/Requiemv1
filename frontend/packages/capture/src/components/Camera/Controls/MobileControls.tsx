import { Button, cn } from '@ci/shadcn';
import { Camera as CameraIcon, SwitchCamera, VideoIcon } from '@ci/shadcn/icons';
import { useCallback } from 'react';

import { useFacingMode } from '../useFacingMode';
import { useRecorder } from '../useRecorder';
import { useRecordingMode } from '../useRecordingMode';

import { Icon } from './Icon';

export function MobileControls() {
  const [{ isRecording }, { captureFrame, toggleRecording }] = useRecorder();
  const [{ facingMode }, { swapFacingMode }] = useFacingMode();
  const [{ recordingMode }, { swapRecordingMode }] = useRecordingMode();

  const handleRecordClick = useCallback(() => {
    if (recordingMode === 'photo') {
      captureFrame();
    } else {
      toggleRecording();
    }
  }, [captureFrame, toggleRecording, recordingMode, isRecording]);

  return (
    <div className="w-full px-14 flex flex-row items-center justify-between pb-[max(2.5rem,env(safe-area-inset-bottom))] select-none">
      <Icon icon={recordingMode === 'photo' ? CameraIcon : VideoIcon} onClick={swapRecordingMode} />

      <Button
        className="relative w-16 h-16 group focus:outline-none cursor-pointer"
        variant="ghost"
        onClick={handleRecordClick}
      >
        <div className="absolute inset-0 rounded-full border-3 border-white"></div>
        <div
          className={cn(
            'absolute inset-1.5 rounded-2xl transform transition-radius transition-transform duration-100 ease-in-out group-active:scale-[.95] will-change-transform',
            recordingMode === 'photo' ? 'bg-white' : 'bg-red-500',
            recordingMode === 'video' && isRecording ? 'rounded-xl scale-[0.5]' : 'rounded-full',
          )}
        ></div>
      </Button>

      <Icon
        icon={SwitchCamera}
        className={facingMode === 'environment' ? '[transform:rotateY(180deg)]' : '[transform:rotateY(0deg)]'}
        onClick={swapFacingMode}
      />
    </div>
  );
}
