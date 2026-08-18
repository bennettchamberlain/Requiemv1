import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { toServiceContext, type UserServiceContext, type ServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { ConnectionEntity } from '@ci/domains/connections';
import { EventService } from '@ci/domains/events';
import { NodeService, RelationshipService } from '@ci/domains/graph';
import { Person, PersonService } from '@ci/domains/memory';
import { UserService } from '@ci/domains/user';

interface ParticipantInfo {
  email: string;
  name: string;
  type?: string; // 'organizer', 'attendee', 'from', 'to', 'cc', 'bcc'
  responseStatus?: string;
}

@Injectable()
export class PromoteService {
  constructor(
    @InjectRepository(ConnectionEntity)
    private readonly connectionRepository: Repository<ConnectionEntity>,
    private readonly eventService: EventService,
    private readonly personService: PersonService,
    private readonly userService: UserService,
    private readonly nodeService: NodeService,
    private readonly relationshipService: RelationshipService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PromoteService.name);
  }

  /**
   * Transforms a list of participant data into a list of Person entity ids. The
   * entity ids will correspond either to previously created Person entities
   * retrieved by email address or new Person entities created from the provided
   * participant data.
   *
   * Note that the returned list of entities can contain the user's
   * corresponding Person entity. For the purposes of building relationships
   * this method will return the list of entity ids and a filtered list
   * excluding the user's Person entity.
   *
   * @param context
   * @param participants
   */
  async upsertPeopleFromParticipants(
    context: UserServiceContext,
    {
      connectionId,
      source,
      participants,
    }: {
      connectionId: string;
      source: string;
      participants: ParticipantInfo[];
    },
  ) {
    const { user, userNode } = await this.getUserAndEntity(context, context.userId);

    const taskMap = new Map<string, Promise<Person>>();

    // Populate one resolution task per UNIQUE (lowercased) email synchronously
    // in this for-loop, before any of them get a chance to run past their
    // first `await`. This is deliberately NOT `participants.map(async ...)`:
    // calling N async callbacks back-to-back via .map() runs every callback's
    // synchronous prefix (including a `taskMap.has(email)` cache check) before
    // ANY of them resumes past its first await — so two participants sharing
    // an email would both see a cache miss and both race their own
    // search-then-create call, defeating the cache entirely regardless of key
    // casing. Building the map in a plain synchronous loop first means the
    // second occurrence of an email always finds the first occurrence's
    // already-registered (still in-flight) promise.
    for (const participant of participants) {
      const email = participant.email.toLowerCase();

      if (taskMap.has(email)) {
        continue;
      }

      taskMap.set(
        email,
        this.resolvePerson(context, participant, email, user, userNode, connectionId, source),
      );
    }

    const entities = await Promise.all(
      participants.map((participant) => taskMap.get(participant.email.toLowerCase())!),
    );
    const relationships = entities.map((entity) => (entity.id === userNode.entityId ? null : entity));

    return {
      entities,
      relationships,
    };
  }

  /**
   * Resolves a single participant to a Person: the caller's own graph node if
   * the email matches them, an existing Person found by email search, or a
   * newly created one. Split out of {@link upsertPeopleFromParticipants} so
   * that loop can register the returned promise in `taskMap` synchronously,
   * before this function's first `await` — see the comment there for why that
   * ordering is what makes the in-request dedup cache actually work.
   */
  private async resolvePerson(
    context: UserServiceContext,
    participant: ParticipantInfo,
    email: string,
    user: NonNullable<Awaited<ReturnType<UserService['findById']>>>,
    userNode: NonNullable<Awaited<ReturnType<NodeService['findNodeByUserId']>>>,
    connectionId: string,
    source: string,
  ): Promise<Person> {
    if (email === user.email.toLowerCase()) {
      const person = await this.personService.findById(context, userNode.entityId);

      if (person == null) {
        throw new Error('User graph node could not be obtained');
      }

      return person;
    }

    const existingPeople = await this.personService.search(context, {
      properties: {
        email,
        owner_user_id: context.userId,
      },
    });

    if (existingPeople.length > 0) {
      return existingPeople[0];
    }

    const id = uuid7();
    const [firstName, ...restName] = participant.name.trim().split(/\s+/).filter(Boolean);
    const lastName = restName.length > 0 ? restName.join(' ') : null;

    const properties: Record<string, unknown> = {
      email,
      first_name: firstName || participant.name,
      last_name: lastName,
      contact_type: source,
      owner_user_id: context.userId,
      connection_id: connectionId,
    };

    return this.personService.create(context, {
      id,
      name: participant.name,
      description: `Contact from ${source}`,
      properties,
    });
  }

  /**
   * Process multiple participants and create entities with relationships
   */
  async processParticipants(
    participants: ParticipantInfo[],
    userId: string,
    connectionId: string,
    source: 'calendar' | 'email' | 'drive',
    relationshipType: 'MET_WITH' | 'EMAILED' | 'RECEIVED_EMAIL_FROM' | 'ORGANIZED_EVENT_WITH' | 'EDITED_WITH',
    startDate?: Date,
    endDate?: Date,
  ): Promise<string[]> {
    const context = toServiceContext({ userId });
    const { userNode } = await this.getUserAndEntity(context, context.userId);

    const { entities } = await this.upsertPeopleFromParticipants(context, {
      source,
      connectionId,
      participants,
    });

    await Promise.all(
      entities.map(async (entity) => {
        try {
          if (userNode.entityId !== entity.id) {
            await this.relationshipService.create(context, {
              fromNodeId: userNode.entityId,
              fromNodeType: 'person',
              toNodeId: entity.id,
              toNodeType: 'person',
              type: relationshipType,
              startDate: startDate,
              endDate: endDate,
              properties: {
                source,
                connection_id: connectionId,
                participant_type: (entity.properties?.type as string) ?? null,
                last_interaction: new Date().toISOString(),
              },
            });
          }
        } catch (err) {
          this.logger.error('Error creating relationship', {
            error: err instanceof Error ? err.message : 'Unknown error',
            userId,
            entityId: entity.id,
          });
        }
      }),
    );

    return entities.map((entity) => entity.id);
  }

  /**
   * Gets a user entity and their corresponding graph node entity. If either of
   * these don't exist an error will be thrown.
   */
  async getUserAndEntity(context: ServiceContext, userId: string) {
    const user = await this.userService.findById(context, userId);

    if (user == null) {
      throw new Error('User could not be obtained');
    }

    const userNode = await this.nodeService.findNodeByUserId(context, userId);

    // This is a degenerate case resulting from an unlikely race condition. When
    // a user signs up we will asynchronously create a graph node for them. If
    // this work hasn't processed we cannot build relationships to the current
    // user so we should fail the job and retry.
    if (userNode == null) {
      throw new Error('User graph node could not be obtained');
    }

    return {
      user,
      userNode,
    };
  }
}
