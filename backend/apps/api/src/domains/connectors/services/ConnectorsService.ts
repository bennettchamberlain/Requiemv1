import { Injectable, NotFoundException, OnModuleInit, Req } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';

import config from '@ci/config';
import { LoggerService } from '@ci/common/services';
import { RequestContext, RequestWithContext } from '@ci/common/types';
import { EventService, Events, type EventPayloads } from '@ci/domains/events';

import { google } from 'googleapis';

import dotenv from 'dotenv';
dotenv.config();

const CLIENT_ID = '558239792217-e6jfhfdqmecgpcod1tvvnl4p8itn3h97.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const API_KEY = 'AIzaSyAm5tJWdOW3eZlW4PokmTkYAqmgFeW7yac';

// use process.env.CLIENT_ID ...

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  'http://dev.companionintelligence.com/api/connectors/callback'
);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
];

@Injectable()
export class ConnectorsService implements OnModuleInit {
  private logger = new LoggerService(ConnectorsService.name);

  constructor(
  ) {}

  async onModuleInit() {
  }

  async connect(context: RequestContext): Promise<{}> {
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });
    return {url};
  }

  async callback(context: RequestContext): Promise<any> {
    if(!context.query || !context.query.code) {
      this.logger.error('Connector service failed to get oauth2 token back');
      throw new NotFoundException();
    }
    try {
      const code = context.query.code;
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      // - redirect user to somewhere useful - unsure how to do this from here @todo
      // - store tokens somewhere durable 
    } catch (err) {
      this.logger.error('Connector service failed to get oauth2 token back');
      throw new NotFoundException();
    }

    return {}
  }

  async getCalendar(context: RequestContext, id: string): Promise<any> {

    /*

    // here ordinary work is done, fetching calender events

      oauth2Client.setCredentials(req.session.tokens);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const result = await calendar.events.list({
        calendarId: 'primary',
        timeMin: new Date().toISOString(),
        maxResults: 5,
        singleEvents: true,
        orderBy: 'startTime',
      });

    */

  }

}

