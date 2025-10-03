
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';

//import { ConnectionService } from '@ci/domains/connections';

import { ApiLogEntity } from '../../etl/entities/ApiLogEntity';

import { GoogleCalendarEventPromotionService } from './GoogleCalendarEventPromotionService';
import { GmailPromotionService } from './GmailPromotionService';
import { PeoplePromotionService  } from './PeoplePromotionService';

@Injectable()
export class PromoteService {
  private logger = new LoggerService(PromoteService.name);

  constructor(
    @InjectRepository(ApiLogEntity)
    private readonly calendarEventPromotionService: GoogleCalendarEventPromotionService,
    private readonly gmailPromotionService: GmailPromotionService,
    private readonly peoplePromotionService: PeoplePromotionService,
    private readonly apiLogRepository: Repository<ApiLogEntity>,
  ) {}

  /**
   * Main entry point for PromoteService
   */
  async promoteApiLogs(context: RequestContext): Promise<void> {
    this.logger.log('Starting promote api logs', {
      userId: context.userId,
    });

    /* @TODO

    // get the collection of unprocessed api log events
    let artifacts = []   //this.apiLogRepository.get()

    // visit each one
    artifacts.forEach(artifact => {

        switch the event type on the artifact from the api log {
            // is a google calendar event api log object? 
            await this.calendarEventPromotionService.promoteCalendarEvents()

            // is a google email api log object?
            await this.calendarEventPromotionService.fixEmail()
        }

        // @todo mark each one as done
    })

    */

  }

}