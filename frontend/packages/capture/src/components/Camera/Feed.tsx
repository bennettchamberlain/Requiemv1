import { useDeviceLayout } from '@ci/common';
import { Button, cn, Spinner } from '@ci/shadcn';
import {
  Camera as CameraIcon,
  Circle,
  CircleStop,
  Mic,
  MicOff,
  Settings,
  SwitchCamera,
  Video,
  VideoIcon,
  VideoOff,
} from '@ci/shadcn/icons';
import { useCallback } from 'react';

import { Controls } from './Controls';
import { Information } from './Information';
import { useFacingMode } from './useFacingMode';
import { useInputDevices } from './useInputDevices';
import { useMuteControls } from './useMuteControls';
import { useRecorder } from './useRecorder';
import { useRecordingMode } from './useRecordingMode';
import { useStream } from './useStream';

export function Feed() {
  const { isMobile, isMobileBrowser } = useDeviceLayout();
  const [{ isActive, videoRef }] = useStream();

  return (
    <div className="relative flex flex-col w-full flex-1 min-h-0 min-w-0 overflow-hidden items-center justify-center bg-black">
      <video
        className={cn('w-full h-full object-contain', isActive ? 'block' : 'hidden')}
        ref={videoRef}
        autoPlay
        playsInline
        muted
      ></video>

      {isActive && (
        <>
          {!isMobileBrowser && !isMobile && <Information />}
          {!isMobile && <DesktopControls />}
        </>
      )}

      {!isActive && (
        <div className="flex items-center justify-center flex-1">
          <Spinner size={64} variant="circle" />
        </div>
      )}

      {isMobile && <MobileControls />}
    </div>
  );
}

function DesktopControls() {
  const [{ isRecording }, { captureFrame, toggleRecording }] = useRecorder();
  const [{ microphoneEnabled, cameraEnabled }, { toggleMicrophone, toggleCamera }] = useMuteControls();
  const [{ facingMode }, { swapFacingMode }] = useFacingMode();
  const [{ cameras, selectedCamera, setSelectedCamera }] = useInputDevices();

  const RecordingIcon = isRecording ? CircleStop : Circle;
  const VideoIcon = cameraEnabled ? Video : VideoOff;
  const MicrophoneIcon = microphoneEnabled ? Mic : MicOff;

  function swapCamera() {
    swapFacingMode!();
    setSelectedCamera(cameras.filter((camera) => camera.id !== selectedCamera?.id)[0] || selectedCamera);
  }

  return (
    <Controls>
      <Controls.Icon
        className={isRecording ? 'text-red-500' : 'text-white'}
        icon={RecordingIcon}
        tooltip={isRecording ? 'Stop recording' : 'Record video'}
        onClick={toggleRecording}
      />

      <Controls.Icon icon={CameraIcon} tooltip="Capture picture" onClick={captureFrame} />

      <Controls.Divider />

      <Controls.Icon
        icon={VideoIcon}
        tooltip={cameraEnabled ? 'Disable video' : 'Enable video'}
        onClick={toggleCamera}
      />

      <Controls.Icon
        icon={MicrophoneIcon}
        tooltip={microphoneEnabled ? 'Disable mic' : 'Enable mic'}
        onClick={toggleMicrophone}
      />

      <Controls.Divider />

      <Controls.Icon
        icon={SwitchCamera}
        tooltip="Swap camera"
        className={facingMode === 'environment' ? '[transform:rotateY(180deg)]' : '[transform:rotateY(0deg)]'}
        onClick={swapCamera}
      />

      <Controls.Icon icon={Settings} tooltip="Settings" />
    </Controls>
  );
}

function MobileControls() {
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
    <Controls>
      <Controls.Icon icon={recordingMode === 'photo' ? CameraIcon : VideoIcon} onClick={swapRecordingMode} />

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

      <Controls.Icon
        icon={SwitchCamera}
        className={facingMode === 'environment' ? '[transform:rotateY(180deg)]' : '[transform:rotateY(0deg)]'}
        onClick={swapFacingMode}
      />
    </Controls>
  );
}
