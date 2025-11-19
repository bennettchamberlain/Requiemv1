export interface File {
  id: string;
  name: string;
  key: string | null;
  contentType: string;
  size: number;
  fileHash?: string;
  url?: string;
}

export interface FileQuery {
  file_path?: string;
  mime_type?: string;
  filename?: string;
  storage_type?: string;
  storage_provider?: string;
  cloud_file_id?: string;
  storage_account?: string;
  modified_at_source?: Date | undefined;
  bucket?: string;
  key?: string;
  original_name?: string;
  content_type?: string;
  file_hash?: string;
  size?: number;
  user?: { id: string };
}
