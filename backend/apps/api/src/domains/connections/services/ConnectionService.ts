import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import type { RequestContext } from '@ci/common/types';

import { ConnectionEntity } from '../entities/ConnectionEntity';
import type { CreateConnectionDto, Connection, UpdateConnectionDto } from '../types';






/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// hardcoded test for google
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

import { google } from 'googleapis';
import { LoggerService } from '@ci/common/services/LoggerService';

//import dotenv from 'dotenv';
//dotenv.config();

const CLIENT_ID = '558239792217-e6jfhfdqmecgpcod1tvvnl4p8itn3h97.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const API_KEY = 'AIzaSyAm5tJWdOW3eZlW4PokmTkYAqmgFeW7yac';

// use process.env.CLIENT_ID ...

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  'http://dev.companionintelligence.com/api/connections/callback'
);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
];
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////






@Injectable()
export class ConnectionService {

  private logger = new LoggerService(ConnectionService.name);

  constructor(
    @InjectRepository(ConnectionEntity)
    private readonly connectionRepository: Repository<ConnectionEntity>,
  ) {}

  async create(context: RequestContext, data: CreateConnectionDto): Promise<Connection> {
    const { providerId, ...rest } = data;

    const instance = this.connectionRepository.create({
      ...rest,
      id: uuid7(),
      active: true,
      user: {
        id: context.userId,
      },
      provider: {
        id: providerId,
      },
    });

    const entity = await this.connectionRepository.save(instance);

    return this.findOne(context, entity.id);
  }

  async findAll(context: RequestContext): Promise<Connection[]> {
    const entities = await this.connectionRepository.find({
      where: {
        user: {
          id: context.userId,
        },
      },
      relations: ['provider'],
    });

    return entities.map((entity) => entity.toConnection());
  }

  async findOne(context: RequestContext, id: string): Promise<Connection> {
    const entity = await this.connectionRepository.findOne({
      where: {
        id,
        user: {
          id: context.userId,
        },
      },
      relations: ['provider'],
    });

    if (entity == null) {
      throw new NotFoundException();
    }

    return entity.toConnection();
  }

  async update(context: RequestContext, id: string, data: UpdateConnectionDto): Promise<Connection> {
    const result = await this.connectionRepository.update(
      {
        id,
        user: {
          id: context.userId,
        },
      },
      data,
    );

    if (result.affected === 0) {
      throw new NotFoundException();
    }

    return this.findOne(context, id);
  }

  async activate(context: RequestContext, id: string): Promise<Connection> {
    return this.update(context, id, { active: true });
  }

  async deactivate(context: RequestContext, id: string): Promise<Connection> {
    return this.update(context, id, { active: false });
  }

  async delete(context: RequestContext, id: string): Promise<boolean> {
    const result = await this.connectionRepository.delete({
      id,
      user: {
        id: context.userId,
      },
    });

    if (result.affected === 0) {
      throw new NotFoundException();
    }

    return true;
  }



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


  async connect(context: RequestContext): Promise<{}> {
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });
    return {url};
  }

  async callback(context: RequestContext): Promise<any> {

    // @todo we need to know which connection was invoked
    console.log("connection service backend authentication callback has been called",context)

    if(!context.query || !context.query.code) {
      this.logger.error('Connection service failed to get oauth2 token back');
      throw new NotFoundException();
    }
    try {
      const code = context.query.code;
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      // - redirect user to somewhere useful - unsure how to do this from here @todo
      // - store tokens somewhere durable 
    } catch (err) {
      this.logger.error('Connection service failed to get oauth2 token back');
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

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////




}
