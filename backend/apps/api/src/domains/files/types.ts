export interface File {
  id: string;
  name: string;
  key: string;
  contentType: string;
  size: number;
  url?: string;
}

export interface FileContent {
  Body: Buffer;
  ContentType: string;
}
