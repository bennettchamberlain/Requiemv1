import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/services';

interface CalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  start?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
    organizer?: boolean;
    self?: boolean;
  }>;
  organizer?: {
    email?: string;
    displayName?: string;
    self?: boolean;
  };
  location?: string;
  status?: string;
  created?: string;
  updated?: string;
  recurringEventId?: string;
  recurrence?: string[];
}

@Injectable()
export class CalendarEventPromotionService {
  private logger = new LoggerService(CalendarEventPromotionService.name);

  async promoteCalendarEvents(apiLogContent: unknown, userId: string, connectionId: string): Promise<void> {
    this.logger.log('Starting calendar event promotion', {
      userId,
      connectionId,
      contentType: typeof apiLogContent,
    });

    try {
      // Extract events from the API log content
      const events = this.extractCalendarEvents(apiLogContent);
      
      if (events.length === 0) {
        this.logger.log('No calendar events found to promote', {
          userId,
          connectionId,
        });
        return;
      }

      this.logger.log(`Found ${events.length} calendar events to process`, {
        userId,
        connectionId,
      });

      // Process each event
      for (const event of events) {
        await this.processCalendarEvent(event, userId, connectionId);
      }

      this.logger.log('Calendar event promotion completed', {
        userId,
        connectionId,
        totalEvents: events.length,
      });
    } catch (error) {
      this.logger.error('Error promoting calendar events', {
        userId,
        connectionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private extractCalendarEvents(content: unknown): CalendarEvent[] {
    if (!content || typeof content !== 'object') {
      return [];
    }

    const contentObj = content as Record<string, unknown>;
    
    // Handle the structure from Google Calendar API
    if ('items' in contentObj && Array.isArray(contentObj.items)) {
      return contentObj.items as CalendarEvent[];
    }

    // Handle single event
    if ('id' in contentObj && ('summary' in contentObj || 'start' in contentObj)) {
      return [contentObj as CalendarEvent];
    }

    return [];
  }

  private async processCalendarEvent(event: CalendarEvent, userId: string, connectionId: string): Promise<void> {
    // Extract event details
    const eventDetails = this.extractEventDetails(event);
    
    // For now, just log the details - later this will save to database
    this.logger.log('Calendar Event Details', {
      userId,
      connectionId,
      eventId: eventDetails.id,
      summary: eventDetails.summary,
      startTime: eventDetails.startTime,
      endTime: eventDetails.endTime,
      location: eventDetails.location,
      organizerEmail: eventDetails.organizerEmail,
      organizerName: eventDetails.organizerName,
      participantCount: eventDetails.participants.length,
      participants: eventDetails.participants,
      isRecurring: eventDetails.isRecurring,
      status: eventDetails.status,
    });

    // TODO: In the future, this is where we'll save to the database
    // await this.saveEventToDatabase(eventDetails, userId, connectionId);
  }

  private extractEventDetails(event: CalendarEvent) {
    // Extract start time
    const startTime = event.start?.dateTime || event.start?.date || null;
    const endTime = event.end?.dateTime || event.end?.date || null;

    // Extract participants (attendees)
    const participants = (event.attendees || []).map(attendee => ({
      email: attendee.email || 'unknown',
      name: attendee.displayName || attendee.email || 'unknown',
      responseStatus: attendee.responseStatus || 'unknown',
      isOrganizer: attendee.organizer || false,
      isSelf: attendee.self || false,
    }));

    // Extract organizer info
    const organizerEmail = event.organizer?.email || 'unknown';
    const organizerName = event.organizer?.displayName || event.organizer?.email || 'unknown';

    return {
      id: event.id || 'unknown',
      summary: event.summary || 'Untitled Event',
      description: event.description || null,
      startTime,
      endTime,
      location: event.location || null,
      organizerEmail,
      organizerName,
      participants,
      isRecurring: !!event.recurringEventId || !!event.recurrence,
      status: event.status || 'unknown',
      created: event.created || null,
      updated: event.updated || null,
    };
  }
}
