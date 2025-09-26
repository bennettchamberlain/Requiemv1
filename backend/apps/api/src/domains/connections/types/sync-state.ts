// Sync state types for different Google APIs

export interface CalendarSyncState {
  syncToken?: string;
  lastFullSyncAt?: string; // ISO date string
  lastUpdatedMinUsed?: string; // ISO date string for fallback
}

export interface GmailSyncState {
  lastHistoryId?: string;
  trackedLabels?: string[]; // e.g., ['INBOX', 'SENT']
  watchChannelId?: string;
  watchResourceId?: string;
  watchExpiration?: string; // ISO date string
}

export interface GoogleSyncState {
  calendar?: CalendarSyncState;
  gmail?: GmailSyncState;
  drive?: {
    lastSyncAt?: string; // ISO date string
    lastPageToken?: string;
  };
  [key: string]: unknown; // Index signature for compatibility with Record<string, unknown>
}

// Helper functions for working with sync state
export class SyncStateHelper {
  static getCalendarSyncState(syncState: Record<string, unknown> | null): CalendarSyncState | null {
    if (!syncState?.calendar) {
      return null;
    }

    return syncState.calendar as CalendarSyncState;
  }

  static getGmailSyncState(syncState: Record<string, unknown> | null): GmailSyncState | null {
    if (!syncState?.gmail) {
      return null;
    }

    return syncState.gmail as GmailSyncState;
  }

  static getDriveSyncState(
    syncState: Record<string, unknown> | null,
  ): { lastSyncAt?: string; lastPageToken?: string } | null {
    if (!syncState?.drive) {
      return null;
    }

    return syncState.drive as { lastSyncAt?: string; lastPageToken?: string };
  }

  static updateCalendarSyncState(
    currentSyncState: Record<string, unknown> | null,
    updates: Partial<CalendarSyncState>,
  ): Record<string, unknown> {
    const newSyncState = { ...currentSyncState } as GoogleSyncState;
    newSyncState.calendar = { ...(newSyncState.calendar || {}), ...updates };

    return newSyncState;
  }

  static updateGmailSyncState(
    currentSyncState: Record<string, unknown> | null,
    updates: Partial<GmailSyncState>,
  ): Record<string, unknown> {
    const newSyncState = { ...currentSyncState } as GoogleSyncState;
    newSyncState.gmail = { ...(newSyncState.gmail || {}), ...updates };

    return newSyncState;
  }

  static updateDriveSyncState(
    currentSyncState: Record<string, unknown> | null,
    updates: { lastSyncAt?: string; lastPageToken?: string },
  ): Record<string, unknown> {
    const newSyncState = { ...currentSyncState } as GoogleSyncState;
    newSyncState.drive = { ...(newSyncState.drive || {}), ...updates };

    return newSyncState;
  }
}
