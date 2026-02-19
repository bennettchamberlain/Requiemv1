export type MediaItem = {
  type: 'image' | 'video';
  sourceUrl: string;
  previewUrl?: string;
  filename?: string | null;
};

export interface PreviewableImageFile {
  id: string;
  filename: string | null;
  contentType: string;
  sourceUrl: string | null;
  previewUrl: string | null;
  createdAt: string | Date;
}

/** Minimal selection info passed from grid to modals */
export interface FileSelection {
  id: string;
  type: 'image' | 'video' | 'file';
}
