interface EventPayload {
  name?: never;
}

export enum Events {
  API_ENQUEUE = 'api.enqueue',
  FILE_UPLOAD = 'file.upload',
}

interface ApiEnqueuePayload extends EventPayload {
  foo: string;
  bar: string;
}

interface FileUploadPayload extends EventPayload {
  fileId: string;
}

export type EventPayloads = {
  [Events.API_ENQUEUE]: ApiEnqueuePayload;
  [Events.FILE_UPLOAD]: FileUploadPayload;
};
