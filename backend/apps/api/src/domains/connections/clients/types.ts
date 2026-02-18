import type { Buffer } from 'node:buffer';

export interface SyncResponse {
  success: boolean;
  message: string;
  data?: {
    results: SyncResult[];
    errors: string[];
  };
  cursor?: unknown;
}

export interface SyncResult {
  api: string;
  data: unknown;
  syncState?: Record<string, unknown>;
  error?: string;
}

export interface TokenExchange {
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: Date | null;
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface Calendar {
  id: string;
  name: string;
  isDefaultCalendar: boolean;
  changeKey: string;
  owner: {
    name: string;
    address: string;
  };
  events?: unknown[];
}

export interface CalendarEvent {
  id: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  changeKey: string;
  categories: string[];
  originalStartTimeZone: string;
  originalEndTimeZone: string;
  iCalUId: string;
  reminderMinutesBeforeStart: number;
  isReminderOn: boolean;
  hasAttachments: boolean;
  subject: string;
  bodyPreview: string;
  importance: string;
  sensitivity: string;
  isAllDay: boolean;
  isCancelled: boolean;
  isOrganizer: boolean;
  responseRequested: boolean;
  seriesMasterId?: string;
  attachments?: OutlookAttachment[];
}

export interface OneDriveUser {
  email: string;
  displayName: string;
}

export interface OneDrivePageEntity {
  '@odata.etag': string;
  createdDateTime: string;
  eTag: string;
  id: string;
  lastModifiedDateTime: string;
  webUrl: string;
  createdBy: {
    user: OneDriveUser;
  };
  lastModifiedBy: {
    user: OneDriveUser;
  };
  file?: Record<string, unknown>;
  content?: OneDriveFileEntity;
}

export interface OneDriveFileEntity {
  '@microsoft.graph.downloadUrl': string;
  createdDateTime: string;
  eTag: string;
  id: string;
  lastModifiedDateTime: string;
  name: string;
  webUrl: string;
  size: number;
  createdBy: {
    user: OneDriveUser;
  };
  lastModifiedBy: {
    user: OneDriveUser;
  };
  file: {
    mimeType: string;
    hashes: {
      [key: string]: string;
    };
  };
  image?: {
    height: number;
    width: number;
  };
  photo?: {
    orientation?: number;
  };
  raw?: Buffer;
}

export interface OutlookAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentBytes?: string;
  lastModifiedDateTime: string;
}

export interface OutlookMailMessageEntity {
  id: string;
  subject: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  changeKey: string;
  categories: string[];
  receivedDateTime: string;
  sentDateTime: string;
  hasAttachments: boolean;
  body?: {
    contentType: string;
    content: string | null;
  };
  from?: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
  toRecipients?: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  ccRecipients?: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  bccRecipients?: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  attachments?: OutlookAttachment[];
}
