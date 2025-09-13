import { type ReactNode, useEffect } from 'react';

import { Feed } from './Feed';
import { FacingModeProvider, useFacingMode } from './useFacingMode';
import { InputDevicesProvider } from './useInputDevices';
import { MuteControlsProvider } from './useMuteControls';
import { RecorderProvider } from './useRecorder';
import { RecordingModeProvider } from './useRecordingMode';
import { StreamProvider, useStream } from './useStream';

interface CameraProps {
  onFrameCaptured?: (file: File) => void;
  onRecordingFinished?: (file: File) => void;
  children: ReactNode;
}

function Camera({ children }: CameraProps) {
  const [, { startCamera, stopCamera }] = useStream();
  const [{ facingMode }] = useFacingMode();

  useEffect(() => {
    startCamera();

    return () => {
      console.log('CameraFeed component unmounting. Stopping camera...');
      stopCamera();
    };
  }, [facingMode]);

  return <>{children}</>;
}

function CameraWithContext({ children, onFrameCaptured, onRecordingFinished, ...props }: CameraProps) {
  return (
    <FacingModeProvider args={[]}>
      <RecordingModeProvider args={[]}>
        <StreamProvider args={[]}>
          <RecorderProvider args={[{ onFrameCaptured, onRecordingFinished }]}>
            <MuteControlsProvider args={[]}>
              <InputDevicesProvider args={[]}>
                <Camera {...props}>{children}</Camera>
              </InputDevicesProvider>
            </MuteControlsProvider>
          </RecorderProvider>
        </StreamProvider>
      </RecordingModeProvider>
    </FacingModeProvider>
  );
}

type CameraComponent = typeof CameraWithContext & {
  Feed: typeof Feed;
};

const AugmentedCamera = CameraWithContext as CameraComponent;

AugmentedCamera.Feed = Feed;

export { AugmentedCamera as Camera };
