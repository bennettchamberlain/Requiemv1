import { takeNativePhoto } from '@ci/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { capturePhoto, captureVideo, chooseFiles, chooseFromLibrary } from './captureMedia';
import { captureWithSystemCamera, pickDocuments, pickMediaFromLibrary } from './pickPhotosFromLibrary';

vi.mock('@ci/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ci/common')>();

  return {
    ...actual,
    takeNativePhoto: vi.fn(),
  };
});

vi.mock('./pickPhotosFromLibrary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pickPhotosFromLibrary')>();

  return {
    ...actual,
    captureWithSystemCamera: vi.fn(),
    pickDocuments: vi.fn(),
    pickMediaFromLibrary: vi.fn(),
  };
});

const mockedTakeNativePhoto = vi.mocked(takeNativePhoto);
const mockedCaptureWithSystemCamera = vi.mocked(captureWithSystemCamera);
const mockedPickDocuments = vi.mocked(pickDocuments);
const mockedPickMediaFromLibrary = vi.mocked(pickMediaFromLibrary);

describe('captureMedia', () => {
  beforeEach(() => {
    mockedTakeNativePhoto.mockReset();
    mockedCaptureWithSystemCamera.mockReset();
    mockedPickDocuments.mockReset();
    mockedPickMediaFromLibrary.mockReset();
  });

  it('prefers the native system camera for stills', async () => {
    const photo = new File(['p'], 'IMG.jpg', { type: 'image/jpeg' });
    mockedTakeNativePhoto.mockResolvedValue(photo);

    await expect(capturePhoto()).resolves.toBe(photo);
    expect(mockedCaptureWithSystemCamera).not.toHaveBeenCalled();
  });

  it('falls back to a capture file input when the Camera plugin is absent', async () => {
    const photo = new File(['p'], 'shot.jpg', { type: 'image/jpeg' });
    mockedTakeNativePhoto.mockResolvedValue(null);
    mockedCaptureWithSystemCamera.mockResolvedValue([photo]);

    await expect(capturePhoto()).resolves.toBe(photo);
    expect(mockedCaptureWithSystemCamera).toHaveBeenCalledWith('photo');
  });

  it('records video through the system camera capture input', async () => {
    const video = new File(['v'], 'clip.mov', { type: 'video/quicktime' });
    mockedCaptureWithSystemCamera.mockResolvedValue([video]);

    await expect(captureVideo()).resolves.toBe(video);
    expect(mockedCaptureWithSystemCamera).toHaveBeenCalledWith('video');
  });

  it('library and files pickers stay on the PHPicker / document path', async () => {
    mockedPickMediaFromLibrary.mockResolvedValue([]);
    mockedPickDocuments.mockResolvedValue([]);

    await chooseFromLibrary();
    await chooseFiles();

    expect(mockedPickMediaFromLibrary).toHaveBeenCalledWith({ multiple: true });
    expect(mockedPickDocuments).toHaveBeenCalledWith({ multiple: true });
  });
});
