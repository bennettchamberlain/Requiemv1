import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
  Redirect,
  Res,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { z } from 'zod';

import { Context } from '@ci/common/decorators';
import { ValidationPipe } from '@ci/common/pipes';
import type { RequestContext } from '@ci/common/types';

import { ConnectionService } from '../services/ConnectionService';
import type { CreateConnectionDto, UpdateConnectionDto } from '../types';

const createConnectionSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  providerId: z.string().uuid('Invalid provider ID'),
  clientid: z.string().optional(),
  clientkey: z.string().optional(),
  clientsecret: z.string().optional(),
  schedule: z.string().optional(),
});

const updateConnectionSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  active: z.boolean().optional(),
  clientid: z.string().optional(),
  clientkey: z.string().optional(),
  clientsecret: z.string().optional(),
  schedule: z.string().optional(),
});

@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connectionService: ConnectionService) {
    console.log('********** ConnectionsController initialized **********');
  }

  @UseGuards(AuthGuard('jwt'))
  @Get()
  async findAll(@Context() context: RequestContext) {
    return this.connectionService.findAll(context);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  async findOne(@Context() context: RequestContext, @Param('id') id: string) {
    return this.connectionService.findOne(context, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post()
  async create(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(createConnectionSchema)) input: CreateConnectionDto,
  ) {
    return this.connectionService.create(context, input);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch(':id')
  async update(
    @Context() context: RequestContext,
    @Param('id') id: string,
    @Body(new ValidationPipe(updateConnectionSchema)) input: UpdateConnectionDto,
  ) {
    return this.connectionService.update(context, id, input);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':id/activate')
  @HttpCode(200)
  async activate(@Context() context: RequestContext, @Param('id') id: string) {
    return this.connectionService.activate(context, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':id/deactivate')
  @HttpCode(200)
  async deactivate(@Context() context: RequestContext, @Param('id') id: string) {
    return this.connectionService.deactivate(context, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  @HttpCode(204)
  async delete(@Context() context: RequestContext, @Param('id') id: string) {
    await this.connectionService.delete(context, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id/connect')
  async connect(@Context() context: RequestContext, @Param('id') id: string) {
    return this.connectionService.connect(context, id);
  }

  @Get('test')
  async test(@Res() res: Response) {
    console.log('********** Test endpoint hit **********');
    return res.json({ message: 'Test endpoint working', timestamp: new Date().toISOString() });
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('scope') scope: string,
    @Res() res: Response
  ) {
    console.log("********** ConnectionsController.callback START **********");
    console.log("Query params:", { code: code?.substring(0, 20) + '...', state, scope });
    console.log("Headers:", res.req.headers);

    try {
      // Create a minimal context for the callback
      const context: RequestContext = {
        query: { code, state, scope }
      };
      
      console.log("********** Calling connectionService.callback **********");
      const result = await this.connectionService.callback(context);
      console.log("********** connectionService.callback returned:", result);
      
      // If the service returns a redirect URL, perform the redirect
      if (result.redirect) {
        console.log("********** Redirecting to:", result.redirect);
        return res.redirect(302, result.redirect);
      }
      
      // Otherwise return the result as JSON
      console.log("********** Returning JSON result **********");
      return res.json(result);
    } catch (error) {
      // Log the error and redirect to frontend with error
      console.error('********** OAuth callback error:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
      const frontendUrl = process.env.FRONTEND_URL || 'http://dev.companionintelligence.com';
      return res.redirect(302, `${frontendUrl}/connections?oauth=error&message=${encodeURIComponent('Authentication failed')}`);
    }
  }


}
