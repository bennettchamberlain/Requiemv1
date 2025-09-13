import { createHookContext } from '@ci/common';
import { useCallback, useState } from 'react';

type RecordingMode = 'photo' | 'video';

function useRecordingMode() {
  const [recordingMode, setRecordingMode] = useState<RecordingMode>('photo');

  const swapRecordingMode = useCallback(
    () => setRecordingMode((current) => (current === 'photo' ? 'video' : 'photo')),
    [setRecordingMode],
  );

  return [
    {
      recordingMode,
    },
    {
      swapRecordingMode,
    },
  ];
}

const { Provider, useHookContext } = createHookContext(useRecordingMode);

export { Provider as RecordingModeProvider, useHookContext as useRecordingMode };
