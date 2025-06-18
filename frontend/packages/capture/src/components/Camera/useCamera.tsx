import type { Device } from './types';
import { useStream } from './useStream';
import { useRecorder } from './useRecorder';
import { useInputDevices } from './useInputDevices';

type ReturnType = [
  {
    error: string | null;
    isActive: boolean;
    microphones: Device[];
    cameras: Device[];
    selectedMicrophone: Device | null;
    selectedCamera: Device | null;
  },
  {
    startCamera: () => void;
    stopCamera: () => void;
    captureFrame: () => void;
  },
];

export function useCamera(): ReturnType {
  const [{ isActive, error }, { startCamera, stopCamera }] = useStream();
  const [, { captureFrame }] = useRecorder();
  const [{ microphones, cameras, selectedMicrophone, selectedCamera }] = useInputDevices();

  return [
    {
      error,
      isActive,
      microphones,
      cameras,
      selectedMicrophone,
      selectedCamera,
    },
    {
      startCamera,
      stopCamera,
      captureFrame,
    },
  ];
}
