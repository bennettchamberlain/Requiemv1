export interface TTSConvertRequest {
  text: string;
  voice?: string;
}

export interface TTSConvertResponse {
  audio: string;
  sample_rate: number;
  duration?: number;
}
