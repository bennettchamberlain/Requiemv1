import { takeNativePhoto } from '@ci/common';

import { captureWithSystemCamera, pickDocuments, pickMediaFromLibrary } from './pickPhotosFromLibrary';

/**
 * Still photo: native Capacitor Camera (system UI) when the plugin is present,
 * otherwise the browser/WKWebView capture file input.
 */
export async function capturePhoto(): Promise<File | null> {
  const native = await takeNativePhoto();

  if (native) {
    return native;
  }

  const files = await captureWithSystemCamera('photo');

  return files[0] ?? null;
}

/** System camera video (UIImagePicker / HTML capture). Capacitor Camera has no video API. */
export async function captureVideo(): Promise<File | null> {
  const files = await captureWithSystemCamera('video');

  return files[0] ?? null;
}

export async function chooseFromLibrary(): Promise<File[]> {
  return pickMediaFromLibrary({ multiple: true });
}

export async function chooseFiles(): Promise<File[]> {
  return pickDocuments({ multiple: true });
}
