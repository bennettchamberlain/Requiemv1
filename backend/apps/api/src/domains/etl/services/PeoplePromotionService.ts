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
          external_id: `${source}_${participant.email}`,
          source_data: {
            source,
            connectionId,
            originalName: participant.name,
            email: participant.email,
          },
        });

        // Parse name into first and last name
        const nameParts = participant.name.split(' ').filter(part => part.length > 0);
        if (nameParts.length > 0) {
          personEntity.first_name = nameParts[0];
          if (nameParts.length > 1) {
            personEntity.last_name = nameParts.slice(1).join(' ');
          }
        }

        await this.personRepository.save(personEntity);

        this.logger.log('Created new person from ' + source, {
          personId: personEntity.id,
          name: participant.name,
          email: participant.email,
          source,
        });
      } else {
        // Update existing person with additional source data if needed
        const currentSourceData = (personEntity.source_data || {}) as Record<string, unknown>;
        const sources = (currentSourceData.sources || []) as string[];
        
        if (!sources.includes(source)) {
          sources.push(source);
          personEntity.source_data = {
            ...currentSourceData,
            sources,
            [`${source}Data`]: {
              connectionId,
              originalName: participant.name,
              email: participant.email,
              lastSeen: new Date().toISOString(),
            },
          };
          
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
          name: participant.name,
          provider_name: source === 'calendar' ? 'google_calendar' : 'gmail',
          external_id: `${source}_${participant.email}`,
          source_data: {
            source,
            connectionId,
            participantType: participant.type,
            responseStatus: participant.responseStatus,
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
