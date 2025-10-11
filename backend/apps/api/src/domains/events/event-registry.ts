interface EventPayload {
  name?: never;
}

export enum Events {
  API_ENQUEUE = 'api.enqueue',
  FILE_UPLOAD = 'file.upload',
  CHAT_SUMMARIZATION = 'chat.summarization',
  INFER_QUESTION_ANSWER = 'infer.question.answer',
  SYNC_CONNECTION = 'sync.connection',
  MCP_TOOL_CALL = 'mcp.tool.call',
  PROMOTE_GMAIL_MESSAGES = 'promote.gmail.messages',
  PROMOTE_CALENDAR_EVENTS = 'promote.calendar.events',
  PROMOTE_YOUTUBE_DATA = 'promote.youtube.data',
  PROMOTE_DRIVE_DATA = 'promote.drive.data',
  PROMOTE_CONTACTS = 'promote.contacts',
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

interface InferQuestionAnswerPayload extends EventPayload {
  ownerId: string | null;
  questionId: string;
}

interface SyncConnectionPayload extends EventPayload {
  connectionId: string;
  userId: string;
}

interface McpToolCallPayload extends EventPayload {
  userId: string;
  toolName: string;
  arguments: unknown;
}

interface PromoteGmailMessagesPayload extends EventPayload {
  apiLogId: string;
  userId: string;
  connectionId: string;
  content: unknown;
}

interface PromoteCalendarEventsPayload extends EventPayload {
  apiLogId: string;
  userId: string;
  connectionId: string;
  content: unknown;
}

interface PromoteYouTubeDataPayload extends EventPayload {
  apiLogId: string;
  userId: string;
  connectionId: string;
  content: unknown;
}

interface PromoteDriveDataPayload extends EventPayload {
  apiLogId: string;
  userId: string;
  connectionId: string;
  content: unknown;
}

interface PromoteContactsPayload extends EventPayload {
  apiLogId: string;
  userId: string;
  connectionId: string;
  content: unknown;
}

export type EventPayloads = {
  [Events.API_ENQUEUE]: ApiEnqueuePayload;
  [Events.FILE_UPLOAD]: FileUploadPayload;
  [Events.CHAT_SUMMARIZATION]: ChatSummarizationPayload;
  [Events.INFER_QUESTION_ANSWER]: InferQuestionAnswerPayload;
  [Events.SYNC_CONNECTION]: SyncConnectionPayload;
  [Events.MCP_TOOL_CALL]: McpToolCallPayload;
  [Events.PROMOTE_GMAIL_MESSAGES]: PromoteGmailMessagesPayload;
  [Events.PROMOTE_CALENDAR_EVENTS]: PromoteCalendarEventsPayload;
  [Events.PROMOTE_YOUTUBE_DATA]: PromoteYouTubeDataPayload;
  [Events.PROMOTE_DRIVE_DATA]: PromoteDriveDataPayload;
  [Events.PROMOTE_CONTACTS]: PromoteContactsPayload;
};
