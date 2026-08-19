import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import { PersonEntity } from '../entities/PersonEntity';

export interface PersonInteractionStats {
  eventCount: number;
  communicationCount: number;
  lastInteractionAt: Date | null;
}

const EMPTY_STATS: PersonInteractionStats = {
  eventCount: 0,
  communicationCount: 0,
  lastInteractionAt: null,
};

/**
 * Activity aggregates for a batch of people: how many events someone appears
 * in (organizer or participant), how many communications (sender or
 * recipient), and the most recent of either — the PersonType.interactionStats
 * read surface. Two grouped queries per batch regardless of batch size;
 * events_participants_gin_idx / communications_to_idx keep the array-overlap
 * scans indexed.
 */
@Injectable()
export class PersonActivityService {
  constructor(
    @InjectRepository(PersonEntity)
    private readonly personRepository: Repository<PersonEntity>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PersonActivityService.name);
  }

  async getInteractionStats(
    context: UserServiceContext,
    personIds: string[],
  ): Promise<Map<string, PersonInteractionStats>> {
    const out = new Map<string, PersonInteractionStats>();
    if (personIds.length === 0) {
      return out;
    }

    for (const id of personIds) {
      out.set(id, { ...EMPTY_STATS });
    }

    const eventRows: Array<{ pid: string; n: string; last_time: Date | null }> =
      await this.personRepository.manager.query(
        `SELECT pid, COUNT(DISTINCT event_id) AS n, MAX(start_time) AS last_time
           FROM (
             SELECT organizer_entity_id AS pid, event_id, start_time
               FROM ci.events
              WHERE user_id = $1 AND organizer_entity_id = ANY($2::uuid[])
             UNION ALL
             SELECT p.pid, e.event_id, e.start_time
               FROM ci.events e, LATERAL unnest(e.participant_entity_ids) AS p(pid)
              WHERE e.user_id = $1 AND e.participant_entity_ids && $2::uuid[]
                AND p.pid = ANY($2::uuid[])
           ) t
          GROUP BY pid`,
        [context.userId, personIds],
      );

    for (const row of eventRows) {
      const stats = out.get(row.pid);
      if (stats) {
        stats.eventCount = Number(row.n);
        stats.lastInteractionAt = laterOf(stats.lastInteractionAt, row.last_time);
      }
    }

    const commRows: Array<{ pid: string; n: string; last_time: Date | null }> =
      await this.personRepository.manager.query(
        `SELECT pid, COUNT(DISTINCT id) AS n, MAX(time) AS last_time
           FROM (
             SELECT from_entity_id AS pid, id, time
               FROM ci.communications
              WHERE user_id = $1 AND from_entity_id = ANY($2::uuid[])
             UNION ALL
             SELECT p.pid, c.id, c.time
               FROM ci.communications c, LATERAL unnest(c.to_entity_ids) AS p(pid)
              WHERE c.user_id = $1 AND c.to_entity_ids && $2::uuid[]
                AND p.pid = ANY($2::uuid[])
           ) t
          GROUP BY pid`,
        [context.userId, personIds],
      );

    for (const row of commRows) {
      const stats = out.get(row.pid);
      if (stats) {
        stats.communicationCount = Number(row.n);
        stats.lastInteractionAt = laterOf(stats.lastInteractionAt, row.last_time);
      }
    }

    return out;
  }
}

function laterOf(a: Date | null, b: Date | null): Date | null {
  if (a == null) {
    return b;
  }

  if (b == null) {
    return a;
  }

  return a.getTime() >= b.getTime() ? a : b;
}
