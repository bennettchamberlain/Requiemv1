import type { File } from '@ci/domains/files';
import type { User } from '@ci/domains/user';

export interface CreateMessageDto {
  threadId: string;
  role: string;
  model: string;
  content: string;
  mimetype?: string;
  toolCalls?: Record<string, unknown>[] | null;
  canceled?: boolean;
  promptMessageId?: string;
  fileIds?: string[]; // IDs of files to link to this message
}

export interface UpdateMessageDto {
  content?: string;
  canceled?: boolean;
}

export interface CreateThreadDto {
  name?: string;
  model?: string;
  description?: string;
}

export interface UpdateThreadDto {
  name?: string;
  description?: string;
}

export interface Message {
  readonly id: string;
  readonly model: string | null;
  readonly role: string;
  readonly content: string;
  readonly mimetype: string | null;
  readonly toolCalls: Record<string, unknown>[] | null;
  readonly canceled: boolean | null;
  readonly user?: User;
  readonly thread?: Thread;
  readonly promptMessage?: Message | null;
  readonly files?: File[];
}

export interface Thread {
  readonly id: string;
  readonly name: string | null;
  readonly model: string | null;
  readonly description: string | null;
  readonly user?: User;
}
