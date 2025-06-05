interface EventPayload {
  name?: never;
}

export enum Events {
  API_ENQUEUE = 'api.enqueue',
}

interface ApiEnqueuePayload extends EventPayload {
  foo: string;
  bar: string;
}

export type EventPayloads = {
  [Events.API_ENQUEUE]: ApiEnqueuePayload;
};
