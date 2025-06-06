import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { QueryFailedError } from 'typeorm';
import { z } from 'zod';

import { PgErrorCode } from '@ci/common/constants';
import { ValidationPipe } from '@ci/common/pipes';
import { UserService, type CreateUserDto } from '@ci/domains/user';

import { AuthService } from '../services/AuthService';
import { JwtPayload, LoginDto } from '../types';

const localStrategySchema = z.object({
  username: z.string(),
  password: z.string(),
});

const signupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 chars'),
});

@Controller()
export class SessionController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
  ) {}

  @Post('authenticate')
  @HttpCode(200)
  async login(@Req() req: Request, @Body(new ValidationPipe(localStrategySchema)) input: LoginDto) {
    const user = await this.authService.validateUser(input.username, input.password);

    if (user == null) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const sessionToken = await this.authService.issueSessionToken(user.id, this.getSessionMeta(req));
    const accessToken = await this.authService.issueAccessToken(user.id);

    return {
      sessionToken,
      accessToken,
      user,
    };
  }

  @Post('signup')
  async signup(@Req() req: Request, @Body(new ValidationPipe(signupSchema)) input: CreateUserDto) {
    try {
      const user = await this.userService.create(input);
      const sessionToken = await this.authService.issueSessionToken(user.id, this.getSessionMeta(req));
      const accessToken = await this.authService.issueAccessToken(user.id);

      return {
        sessionToken,
        accessToken,
        user,
      };
    } catch (error) {
      if (error instanceof QueryFailedError && error.driverError?.code === PgErrorCode.UNIQUE_VIOLATION) {
        // TODO: Obfuscate this error message? We're revealing DB details here.
        throw new ConflictException(error.message);
      }

      throw error;
    }
  }

  @Post('authenticate/refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request) {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];

    if (!authHeader) {
      throw new UnauthorizedException('No refresh token provided');
    } else if (Array.isArray(authHeader)) {
      throw new BadRequestException('Multiple authorization headers');
    }

    const sessionToken = authHeader.replace(/^Bearer /, '').trim();
    let payload: JwtPayload;

    try {
      payload = this.authService.validateSessionToken(sessionToken);
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const userId = payload.sub;

    const user = await this.userService.findOne(userId);
    const newSessionToken = await this.authService.rotateSessionToken(
      userId,
      sessionToken,
      this.getSessionMeta(req),
    );
    const accessToken = await this.authService.issueAccessToken(userId);

    return {
      sessionToken: newSessionToken,
      accessToken,
      user,
    };
  }

  getSessionMeta(request: Request) {
    return {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }
}
