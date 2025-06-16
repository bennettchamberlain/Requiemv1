import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';

import config from '@ci/config';
import { LoggerService } from '@ci/common/services';
import { RequestContext } from '@ci/common/types';
import { EventService, Events, type EventPayloads } from '@ci/domains/events';

// @todo how do we want to configure process env vars?

import dotenv from 'dotenv';
dotenv.config();

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  'http://dev.companionintelligence.com/auth/callback'
);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
];


@Injectable()
export class ServiceProvidersService implements OnModuleInit {
  private logger = new LoggerService(ServiceProvidersService.name);

  constructor(
  ) {}

  async onModuleInit() {
  }

  async oauthLogin(context: RequestContext): Promise<[]> {

    // @todo
    // the user flow is something like this
    //    - a user creates a new service provider on a front side ux panel (such as to google calendar)
    //    - they're invited to activate or connect the actual live service
    //    - now is a good time to compute the below url, and then force the client to that url
    //    - and then that should return to /auth/callback or /api/auth/callback or something we invent
    //    - meaning that this service will be asked for that url (see below)
    //    - and then we have everything we need

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });
    // res.redirect(url);

    return []
  }

  async oauthCallback(context: RequestContext, id: string): Promise<any> {

    /*

    // the client should be now requesting something like /auth/callback

    //const code = req.query.code;

    try {
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      req.session.tokens = tokens;
      res.redirect('/'); // or serve an app page
    } catch (err) {
      console.error('Error exchanging code:', err);
      res.status(500).send('Auth failed');
    }
      */


    return {}
  }

  async oauthDoSomeWork(context: RequestContext, id: string): Promise<any> {

    /*

    // here ordinary work is done, fetching calender events

      if (!req.session.tokens) return res.status(401).send('Not signed in');

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

