import { DeviceLayoutProvider } from '@ci/common';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { capturePhoto } from '@/lib/captureMedia';
import { enqueueMemoryUpload } from '@/lib/memoryUploadQueue';

import { CaptureModal } from './CaptureModal';

vi.mock('@/hooks', () => ({
  useAuth: () => [{ authToken: 'tok' }],
  useModel: () => [{ selectedVisionModel: 'vision' }],
}));

vi.mock('@/lib/captureMedia', () => ({
  capturePhoto: vi.fn(),
  captureVideo: vi.fn(),
  chooseFiles: vi.fn(),
  chooseFromLibrary: vi.fn(),
}));

vi.mock('@/lib/memoryUploadQueue', () => ({
  enqueueMemoryUpload: vi.fn(async () => []),
}));

vi.mock('@/lib/recordAudio', () => ({
  canRecordAudio: () => false,
  startAudioRecording: vi.fn(),
}));

vi.mock('@ci/capture', () => ({
  Camera: Object.assign(() => <div data-testid="live-camera" />, {
    Information: () => null,
    Feed: () => null,
    DesktopControls: () => null,
  }),
}));

const mockedCapturePhoto = vi.mocked(capturePhoto);
const mockedEnqueue = vi.mocked(enqueueMemoryUpload);

function setViewport(mobile: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('max-width') ? mobile : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function renderCapture() {
  return render(
    <DeviceLayoutProvider args={[]}>
      <CaptureModal open onClose={() => undefined} />
    </DeviceLayoutProvider>,
  );
}

describe('CaptureModal', () => {
  beforeEach(() => {
    mockedCapturePhoto.mockReset();
    mockedEnqueue.mockClear();
    setViewport(true);
  });

  it('offers photo, video, audio, files, and library — and does not open chat', async () => {
    renderCapture();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Photo' })).toBeInTheDocument());
    expect(screen.getByText('Save to Memory')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Video' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Audio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose from library' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Ask about this content...')).not.toBeInTheDocument();
    expect(screen.queryByTestId('live-camera')).not.toBeInTheDocument();
  });

  it('portals the mobile shell to document.body so header tooltips cannot paint over it', async () => {
    render(
      <DeviceLayoutProvider args={[]}>
        <header className="z-20">
          <button type="button">Add</button>
          <CaptureModal open onClose={() => undefined} />
        </header>
      </DeviceLayoutProvider>,
    );

    const shell = await screen.findByTestId('capture-shell');

    expect(shell.parentElement).toBe(document.body);
    expect(shell).toHaveClass('z-[100]');
  });

  it('saves a captured photo to Memory instead of creating a thread', async () => {
    const photo = new File(['p'], 'IMG.jpg', { type: 'image/jpeg' });
    mockedCapturePhoto.mockResolvedValue(photo);

    renderCapture();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Photo' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Photo' }));

    await waitFor(() =>
      expect(mockedEnqueue).toHaveBeenCalledWith([photo], expect.objectContaining({ authToken: 'tok' })),
    );
    expect(screen.queryByPlaceholderText('Ask about this content...')).not.toBeInTheDocument();
  });
});
