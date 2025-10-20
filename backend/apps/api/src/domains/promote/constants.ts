/**
 * API Log scope constants for promotion events
 */
export const ApiLogScopes = {
  GMAIL: 'Gmail',
  GOOGLE_CALENDAR: 'Google Calendar',
  YOUTUBE: 'YouTube',
  GOOGLE_DRIVE: 'Google Drive',
  GOOGLE_CONTACTS: 'Google Contacts',
  OUTLOOK_MAIL: 'Microsoft Graph - Mail',
} as const;

export type ApiLogScope = (typeof ApiLogScopes)[keyof typeof ApiLogScopes];
