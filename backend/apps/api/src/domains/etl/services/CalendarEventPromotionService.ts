import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { LoggerService } from '@ci/common/services';
import { EventEntity, PersonEntity, ContactEntity, PlaceEntity } from '@ci/domains/memory';

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

  constructor(
    @InjectRepository(EventEntity)
    private readonly eventRepository: Repository<EventEntity>,
    @InjectRepository(PersonEntity)
    private readonly personRepository: Repository<PersonEntity>,
    @InjectRepository(ContactEntity)
    private readonly contactRepository: Repository<ContactEntity>,
    @InjectRepository(PlaceEntity)
    private readonly placeRepository: Repository<PlaceEntity>,
  ) {}

  async promoteCalendarEvents(apiLogContent: unknown, userId: string, connectionId: string): Promise<void> {
    this.logger.log('Starting calendar event promotion', {
      userId,
      connectionId,
      contentType: typeof apiLogContent,
      contentKeys: apiLogContent && typeof apiLogContent === 'object' ? Object.keys(apiLogContent) : [],
    });

    try {
      // Extract events from the API log content
      const events = this.extractCalendarEvents(apiLogContent);
      
      if (events.length === 0) {
        this.logger.log('No calendar events found to promote', {
          userId,
          connectionId,
          apiLogContent: JSON.stringify(apiLogContent).substring(0, 200), // Log first 200 chars for debugging
        });
        return;
      }

      this.logger.log(`Found ${events.length} calendar events to process`, {
        userId,
        connectionId,
        eventIds: events.map(e => e.id || 'no-id'),
        eventSummaries: events.map(e => e.summary || 'no-summary').slice(0, 5), // First 5 summaries
      });

      // Process each event
      let processedCount = 0;
      for (const event of events) {
        await this.processCalendarEvent(event, userId, connectionId);
        processedCount++;
        
        // Log progress every 10 events
        if (processedCount % 10 === 0) {
          this.logger.log('Calendar event promotion progress', {
            userId,
            connectionId,
            processedCount,
            totalEvents: events.length,
          });
        }
      }

      this.logger.log('Calendar event promotion completed', {
        userId,
        connectionId,
        totalEvents: events.length,
        processedCount,
      });
    } catch (error) {
      this.logger.error('Error promoting calendar events', {
        userId,
        connectionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  private extractCalendarEvents(content: unknown): CalendarEvent[] {
    if (!content || typeof content !== 'object') {
      this.logger.warn('Invalid content type for calendar events', {
        contentType: typeof content,
        contentNull: content === null,
      });
      return [];
    }

    const contentObj = content as Record<string, unknown>;
    
    // Handle the structure from Google Calendar API
    if ('items' in contentObj && Array.isArray(contentObj.items)) {
      this.logger.log('Extracting events from items array', {
        itemCount: contentObj.items.length,
      });
      return contentObj.items as CalendarEvent[];
    }

    // Handle single event
    if ('id' in contentObj && ('summary' in contentObj || 'start' in contentObj)) {
      this.logger.log('Extracting single event', {
        eventId: contentObj.id,
      });
      return [contentObj as CalendarEvent];
    }

    this.logger.warn('No events found in content', {
      contentKeys: Object.keys(contentObj),
    });
    return [];
  }

  private async processCalendarEvent(event: CalendarEvent, userId: string, connectionId: string): Promise<void> {
    try {
      // Extract event details
      const eventDetails = this.extractEventDetails(event);
      
      // Enhanced logging with more details
      this.logger.log('');
      this.logger.log('##########################################################');
      this.logger.log('📅 CALENDAR EVENT DETAILS (SAVING TO DATABASE)');
      this.logger.log('##########################################################');
      this.logger.log('Event ID: ' + eventDetails.id);
      this.logger.log('Summary: ' + eventDetails.summary);
      this.logger.log('Start Time: ' + eventDetails.startTime);
      this.logger.log('End Time: ' + eventDetails.endTime);
      this.logger.log('Location: ' + (eventDetails.location || 'No location'));
      this.logger.log('Organizer: ' + eventDetails.organizerName + ' (' + eventDetails.organizerEmail + ')');
      this.logger.log('Status: ' + eventDetails.status);
      this.logger.log('Recurring: ' + (eventDetails.isRecurring ? 'Yes' : 'No'));
      this.logger.log('Created: ' + eventDetails.created);
      this.logger.log('Updated: ' + eventDetails.updated);
      this.logger.log('');
      this.logger.log('PARTICIPANTS (' + eventDetails.participants.length + ' total):');
      eventDetails.participants.slice(0, 10).forEach((participant, index) => {
        this.logger.log(`  ${index + 1}. ${participant.name} (${participant.email})`);
        this.logger.log(`     - Response: ${participant.responseStatus}`);
        this.logger.log(`     - Role: ${participant.isOrganizer ? 'Organizer' : 'Attendee'}${participant.isSelf ? ' (You)' : ''}`);
      });
      if (eventDetails.participants.length > 10) {
        this.logger.log(`  ... and ${eventDetails.participants.length - 10} more participants`);
      }
      this.logger.log('##########################################################');
      this.logger.log('');

      // Save to database
      await this.saveEventToDatabase(eventDetails, event, userId, connectionId);

      this.logger.log('');
      this.logger.log('✅ EVENT SAVED TO DATABASE SUCCESSFULLY');
      this.logger.log('');

      // Log if this is a future event
      if (eventDetails.startTime) {
        const startDate = new Date(eventDetails.startTime);
        const now = new Date();
        if (startDate > now) {
          const daysInFuture = Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          this.logger.log('');
          this.logger.log('🔮🔮🔮 FUTURE EVENT ALERT 🔮🔮🔮');
          this.logger.log(`This event is ${daysInFuture} days in the future`);
          this.logger.log('');
        }
      }

      // Save to database
      await this.saveEventToDatabase(eventDetails, event, userId, connectionId);
    } catch (error) {
      this.logger.error('Error processing individual calendar event', {
        userId,
        connectionId,
        eventId: event.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw - continue processing other events
    }
  }

  private async saveEventToDatabase(
    eventDetails: ReturnType<typeof this.extractEventDetails>,
    rawEvent: CalendarEvent,
    userId: string,
    connectionId: string,
  ): Promise<void> {
    try {
      // 1. Create or update the Event
      let eventEntity = await this.eventRepository.findOne({
        where: {
          external_id: eventDetails.id,
          user: { id: userId },
        },
      });

      if (!eventEntity) {
        eventEntity = this.eventRepository.create({
          id: uuid7(),
          external_id: eventDetails.id,
          user: { id: userId },
        });
      }

      // Update event fields
      eventEntity.name = eventDetails.summary;
      eventEntity.description = eventDetails.description;
      eventEntity.type = 'calendar_event';
      eventEntity.start_time = eventDetails.startTime ? new Date(eventDetails.startTime) : null;
      eventEntity.end_time = eventDetails.endTime ? new Date(eventDetails.endTime) : null;
      eventEntity.source_url = `https://calendar.google.com/calendar/event?eid=${eventDetails.id}`;
      eventEntity.source_data = {
        ...rawEvent,
        connectionId,
        isRecurring: eventDetails.isRecurring,
        organizerEmail: eventDetails.organizerEmail,
        participantCount: eventDetails.participants.length,
      };

      await this.eventRepository.save(eventEntity);

      this.logger.log('Saved event to database', {
        eventId: eventEntity.id,
        externalId: eventDetails.id,
        summary: eventDetails.summary,
      });

      // 2. Create People and Contacts for participants
      for (const participant of eventDetails.participants) {
        await this.createPersonAndContact(participant, userId, connectionId);
      }

      // 3. Create a Place if location exists
      if (eventDetails.location) {
        await this.createPlaceFromLocation(eventDetails.location, userId, connectionId, eventEntity.id);
      }

    } catch (error) {
      this.logger.error('Failed to save event to database', {
        eventId: eventDetails.id,
        userId,
        connectionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private async createPersonAndContact(
    participant: {
      email: string;
      name: string;
      responseStatus: string;
      isOrganizer: boolean;
      isSelf: boolean;
    },
    userId: string,
    connectionId: string,
  ): Promise<void> {
    try {
      // Check if person already exists by email
      let personEntity = await this.personRepository.findOne({
        where: {
          user: { id: userId },
          contacts: {
            identifier: participant.email,
          },
        },
        relations: ['contacts'],
      });

      if (!personEntity) {
        // Create new person
        personEntity = this.personRepository.create({
          id: uuid7(),
          type: 'individual',
          user: { id: userId },
        });

        // Parse name into first and last name
        const nameParts = participant.name.split(' ');
        if (nameParts.length > 0) {
          personEntity.first_name = nameParts[0];
          if (nameParts.length > 1) {
            personEntity.last_name = nameParts.slice(1).join(' ');
          }
        }

        await this.personRepository.save(personEntity);

        this.logger.log('Created new person', {
          personId: personEntity.id,
          name: participant.name,
          email: participant.email,
        });
      }

      // Check if contact already exists
      const existingContact = await this.contactRepository.findOne({
        where: {
          identifier: participant.email,
          user: { id: userId },
          person: { id: personEntity.id },
        },
      });

      if (!existingContact) {
        // Create contact
        const contactEntity = this.contactRepository.create({
          id: uuid7(),
          identifier: participant.email,
          handle: participant.email,
          name: participant.name,
          provider_name: 'google_calendar',
          user: { id: userId },
          person: { id: personEntity.id },
        });

        await this.contactRepository.save(contactEntity);

        this.logger.log('Created new contact', {
          contactId: contactEntity.id,
          personId: personEntity.id,
          email: participant.email,
        });
      }
    } catch (error) {
      this.logger.error('Failed to create person/contact', {
        participant,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw - continue processing other participants
    }
  }

  private async createPlaceFromLocation(
    location: string,
    userId: string,
    connectionId: string,
    eventId: string,
  ): Promise<void> {
    try {
      // Check if place already exists with this exact name
      let placeEntity = await this.placeRepository.findOne({
        where: {
          name: location,
          user: { id: userId },
        },
      });

      if (!placeEntity) {
        // Create new place
        placeEntity = this.placeRepository.create({
          id: uuid7(),
          name: location,
          type: 'venue',
          user: { id: userId },
          // Mark as estimated since we don't have exact coordinates yet
          estimated: true,
          tracked: false,
          uploaded: false,
        });

        // Try to parse location for basic geocoding hints
        // This is a simple heuristic - in production you'd use a geocoding API
        const locationLower = location.toLowerCase();
        if (locationLower.includes('room') || locationLower.includes('conference') || locationLower.includes('office')) {
          placeEntity.type = 'room';
        } else if (locationLower.includes('restaurant') || locationLower.includes('cafe') || locationLower.includes('coffee')) {
          placeEntity.type = 'restaurant';
        } else if (locationLower.includes('park') || locationLower.includes('beach')) {
          placeEntity.type = 'outdoor';
        }

        await this.placeRepository.save(placeEntity);

        this.logger.log('Created new place from location', {
          placeId: placeEntity.id,
          name: location,
          type: placeEntity.type,
          eventId,
        });
      }
    } catch (error) {
      this.logger.error('Failed to create place', {
        location,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw - place creation is optional
    }
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
