import { createHookContext } from '@ci/common';
import { useEffect, useState } from 'react';

import type { Device } from './types';

type ReturnType = [
  {
    microphones: Device[];
    cameras: Device[];
    selectedMicrophone: Device | null;
    selectedCamera: Device | null;
  },
];

function useInputDevices(): ReturnType {
  const [microphones, setMicrophones] = useState<Device[]>([]);
  const [cameras, setCameras] = useState<Device[]>([]);
  const [selectedMicrophone, setSelectedMicrophone] = useState<Device | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<Device | null>(null);

  useEffect(() => {
    (async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();

      const microphones = devices.filter((device) => device.kind === 'audioinput');
      console.log('microphones', microphones);
      const cameras = devices.filter((device) => device.kind === 'videoinput');
      console.log('cameras', cameras);

      const defaultMicrophoneGroupId = microphones.find((device) => device.deviceId === 'default')?.groupId;
      console.log('defaultMicrophoneGroupId', defaultMicrophoneGroupId);
      const defaultCameraGroupId = cameras.find((device) => device.deviceId === 'default')?.groupId;

      const filteredMicrophones = microphones.filter((device) => device.deviceId !== 'default');
      console.log('filteredMicrophones', filteredMicrophones);
      const filteredCameras = cameras.filter((device) => device.deviceId !== 'default');

      const availableMicrophones = filteredMicrophones.map(
        (device) =>
          ({
            id: device.deviceId,
            name: device.label,
            default: device.groupId === defaultMicrophoneGroupId || filteredMicrophones.length === 1,
          }) satisfies Device,
      );
      console.log('availableMicrophones', availableMicrophones);

      const availableCameras = filteredCameras.map(
        (device) =>
          ({
            id: device.deviceId,
            name: device.label,
            default: device.groupId === defaultCameraGroupId || filteredCameras.length === 1,
          }) satisfies Device,
      );

      setMicrophones(availableMicrophones);
      setCameras(availableCameras);
      setSelectedMicrophone(availableMicrophones.find((device) => device.default) ?? null);
      setSelectedCamera(availableCameras.find((device) => device.default) ?? null);
    })();
  }, []);

  return [
    {
      microphones,
      cameras,
      selectedMicrophone,
      selectedCamera,
    },
  ];
}

const { Provider, useHookContext } = createHookContext(useInputDevices);

export { Provider as InputDevicesProvider, useHookContext as useInputDevices };
