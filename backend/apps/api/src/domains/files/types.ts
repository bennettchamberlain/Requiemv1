export interface FileQuery {
  filePath?: string;
  mimeType?: string;
  filename?: string;
  storageType?: string;
  storageProvider?: string;
  cloudFileId?: string;
  storageAccount?: string;
  modifiedAtSource?: Date | undefined;
  bucket?: string;
  key?: string;
  originalName?: string;
  contentType?: string;
  fileHash?: string;
  size?: number;
  user?: { id: string };
}

export interface UpdateFileDto {
  analysisCompleted?: boolean;
}

export interface CreateSavedSearchDto {
  id?: string;
  name?: string;
  description?: string;
  query?: string;
  entityTypes?: string[];
  tags?: string[];
}

export interface UpdateSavedSearchDto {
  name?: string;
  description?: string;
  query?: string;
  entityTypes?: string[];
  tags?: string[];
}
