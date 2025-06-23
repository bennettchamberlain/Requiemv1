interface EventPayload {
  name?: never;
}

export enum Events {
  API_ENQUEUE = 'api.enqueue',
  FILE_UPLOAD = 'file.upload',
  CHAT_SUMMARIZATION = 'chat.summarization',
}

interface ApiEnqueuePayload extends EventPayload {
  foo: string;
  bar: string;
}

interface FileUploadPayload extends EventPayload {
  fileId: string;
}

interface ChatSummarizationPayload extends EventPayload {
  ownerId: string;
  threadId: string;
}

export type EventPayloads = {
  [Events.API_ENQUEUE]: ApiEnqueuePayload;
  [Events.FILE_UPLOAD]: FileUploadPayload;
  [Events.CHAT_SUMMARIZATION]: ChatSummarizationPayload;
};
