/**
 * Picker-first photo ingest. On iOS WKWebView, `input accept="image/*"` uses
 * PHPickerViewController and does not need `NSPhotoLibraryUsageDescription`.
 * Do not add full-library PhotoKit / READ_MEDIA_* for this path.
 */
export function pickPhotosFromLibrary(options?: { multiple?: boolean }): Promise<File[]> {
  const multiple = options?.multiple ?? true;

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.style.display = 'none';

    const finish = (files: File[]) => {
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => {
      finish(Array.from(input.files ?? []));
    });
    input.addEventListener('cancel', () => finish([]));

    document.body.appendChild(input);
    input.click();
  });
}
