import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';

import { ValidationPipe } from '@ci/common/pipes';
import { UserService } from '@ci/domains/user';

import { AuthService } from '../services/AuthService';
import { JwtPayload, LoginDto } from '../types';

const localStrategySchema = z.object({
  username: z.string(),
  password: z.string(),
});

@Controller('authenticate')
export class SessionController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  @HttpCode(200)
  async login(@Req() req: Request, @Body(new ValidationPipe(localStrategySchema)) input: LoginDto) {
    const user = await this.userService.validatePassword(input.username, input.password);

    if (user == null) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const sessionToken = await this.authService.issueSessionToken(
      user.id,
      this.authService.getSessionMetadata(req),
    );

    const accessToken = await this.authService.issueAccessToken(user.id);

    return {
      sessionToken,
      accessToken,
    };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request) {
    const token = this.getSessionToken(req);
    const payload = this.validateSessionToken(token);
    const userId = payload.sub;
    const user = await this.userService.findById({ userId }, userId);

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const newSessionToken = await this.authService.rotateSessionToken(
      userId,
      token,
      this.authService.getSessionMetadata(req),
    );

    const accessToken = await this.authService.issueAccessToken(userId);

    return {
      sessionToken: newSessionToken,
      accessToken,
    };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request) {
    const token = this.getSessionToken(req);
    const payload = this.validateSessionToken(token);
    const userId = payload.sub;
    const user = await this.userService.findById({ userId }, userId);

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    await this.authService.invalidateSession(userId, token, this.authService.getSessionMetadata(req));
  }

  private getSessionToken(req: Request) {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];

    if (!authHeader) {
      throw new UnauthorizedException('No token provided');
    } else if (Array.isArray(authHeader)) {
      throw new BadRequestException('Multiple authorization headers');
    }

    return authHeader.replace(/^Bearer /, '').trim();
  }

  private validateSessionToken(token: string): JwtPayload {
    try {
      return this.authService.validateSessionToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
