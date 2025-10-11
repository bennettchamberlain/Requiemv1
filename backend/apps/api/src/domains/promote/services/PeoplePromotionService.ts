import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { LoggerService } from '@ci/common/services';
import { PersonEntity, ContactEntity } from '@ci/domains/memory';

interface ParticipantInfo {
  email: string;
  name: string;
  type?: string; // 'organizer', 'attendee', 'from', 'to', 'cc', 'bcc'
  responseStatus?: string;
}

@Injectable()
export class PeoplePromotionService {
  private logger = new LoggerService(PeoplePromotionService.name);

  constructor(
    @InjectRepository(PersonEntity)
    private readonly personRepository: Repository<PersonEntity>,
    @InjectRepository(ContactEntity)
    private readonly contactRepository: Repository<ContactEntity>,
  ) {}

  async createOrUpdatePersonFromParticipant(
    participant: ParticipantInfo,
    userId: string,
    connectionId: string,
    source: 'calendar' | 'email',
  ): Promise<{ personId: string; contactId: string }> {
    try {
      // Check if person already exists by email
      // First check if there's a contact with this email
      const existingContact = await this.contactRepository.findOne({
        where: {
          user: { id: userId },
          identifier: participant.email,
        },
        relations: ['person'],
      });

      let personEntity = existingContact?.person;

      if (!personEntity) {
        // Parse name into first and last name
        const nameParts = participant.name.split(' ').filter((part) => part.length > 0);
        const firstName = nameParts[0] ?? null;
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

        const baseSourceData = {
          source,
          connectionId,
          originalName: participant.name,
          email: participant.email,
          sources: [source],
          [`${source}Data`]: {
            connectionId,
            originalName: participant.name,
            email: participant.email,
            lastSeen: new Date().toISOString(),
          },
        } as Record<string, unknown>;

        const properties: Record<string, unknown> = {
          type: 'individual',
          first_name: firstName,
          last_name: lastName,
          external_id: `${source}_${participant.email}`,
          source_data: baseSourceData,
        };

        // Create new person
        personEntity = this.personRepository.create({
          id: uuid7(),
          entity_type: 'Person',
          name: participant.name,
          description: null,
          properties,
          userId,
        });

        personEntity.first_name = firstName;
        personEntity.last_name = lastName;
        personEntity.source_data = baseSourceData;

        await this.personRepository.save(personEntity);

        this.logger.log('Created new person from ' + source, {
          personId: personEntity.id,
          name: participant.name,
          email: participant.email,
          source,
        });
      } else {
        // Update existing person with additional source data if needed
        const currentProperties = (personEntity.properties || {}) as Record<string, unknown>;
        const currentSourceData = (currentProperties.source_data || {}) as Record<string, unknown>;
        const sources = (currentSourceData.sources || []) as string[];

        if (!sources.includes(source)) {
          sources.push(source);
          const updatedSourceData = {
            ...currentSourceData,
            sources,
            [`${source}Data`]: {
              connectionId,
              originalName: participant.name,
              email: participant.email,
              lastSeen: new Date().toISOString(),
            },
          };

          personEntity.properties = {
            ...currentProperties,
            source_data: updatedSourceData,
          };
          personEntity.source_data = updatedSourceData;

          await this.personRepository.save(personEntity);

          this.logger.log('Updated existing person with ' + source + ' data', {
            personId: personEntity.id,
            sources,
          });
        }
      }

      // Check if contact already exists
      let contactEntity = await this.contactRepository.findOne({
        where: {
          identifier: participant.email,
          user: { id: userId },
          person: { id: personEntity.id },
        },
      });

      if (!contactEntity) {
        // Create contact
        contactEntity = this.contactRepository.create({
          id: uuid7(),
          type: 'email',
          identifier: participant.email,
          handle: participant.email,
          external_id: `${source}_${participant.email}`,
          source_data: {
            source,
            connectionId,
            participantType: participant.type,
            responseStatus: participant.responseStatus,
            name: participant.name, // Store name in source_data since ContactEntity doesn't have a name field
          },
          user: { id: userId },
          person: { id: personEntity.id },
        });

        await this.contactRepository.save(contactEntity);

        this.logger.log('Created new contact from ' + source, {
          contactId: contactEntity.id,
          personId: personEntity.id,
          email: participant.email,
          source,
        });
      } else {
        // Update existing contact with additional source data
        const currentSourceData = (contactEntity.source_data || {}) as Record<string, unknown>;
        const sources = (currentSourceData.sources || []) as string[];

        if (!sources.includes(source)) {
          sources.push(source);
          contactEntity.source_data = {
            ...currentSourceData,
            sources,
            [`${source}Data`]: {
              connectionId,
              participantType: participant.type,
              responseStatus: participant.responseStatus,
              lastSeen: new Date().toISOString(),
            },
          };

          await this.contactRepository.save(contactEntity);

          this.logger.log('Updated existing contact with ' + source + ' data', {
            contactId: contactEntity.id,
            sources,
          });
        }
      }

      return {
        personId: personEntity.id,
        contactId: contactEntity.id,
      };
    } catch (error) {
      this.logger.error('Failed to create/update person and contact', {
        participant,
        source,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async processParticipants(
    participants: ParticipantInfo[],
    userId: string,
    connectionId: string,
    source: 'calendar' | 'email',
  ): Promise<void> {
    this.logger.log(`Processing ${participants.length} participants from ${source}`, {
      userId,
      connectionId,
      source,
    });

    for (const participant of participants) {
      try {
        await this.createOrUpdatePersonFromParticipant(participant, userId, connectionId, source);
      } catch (error) {
        // Log error but continue processing other participants
        this.logger.error('Failed to process participant', {
          participant,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log(`Completed processing participants from ${source}`, {
      userId,
      connectionId,
      processedCount: participants.length,
    });
  }
}
