export interface File {
  id: string;
  name: string;
  key: string | null;
  contentType: string;
  size: number;
  url?: string;
}
