export interface CalendarSyncState {
  syncToken?: string;
  lastFullSyncAt?: string;
  lastUpdatedMinUsed?: string;
}

export interface GmailSyncState {
  lastHistoryId?: string;
  trackedLabels?: string[];
  watchChannelId?: string;
  watchResourceId?: string;
  watchExpiration?: string;
}

export interface DriveSyncState {
  lastSyncAt?: string;
  lastPageToken?: string;
}

export interface GoogleSyncState {
  calendar?: CalendarSyncState;
  gmail?: GmailSyncState;
  drive?: DriveSyncState;
  [key: string]: unknown;
}

export interface SyncResult {
  data: unknown;
  syncState: CalendarSyncState | GmailSyncState | DriveSyncState;
}

export interface CalendarSyncResult {
  data: unknown;
  syncState: CalendarSyncState;
}

export interface GmailSyncResult {
  data: unknown;
  syncState: GmailSyncState;
}
