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

import { SYSTEM_USER } from '@ci/common/context';
import { ValidationPipe } from '@ci/common/pipes';
import { SignupCodeService, type SignupDto, UserService } from '@ci/domains/user';

import { AuthService } from '../services/AuthService';
import { JwtPayload, LoginDto, SessionMetadata } from '../types';

const localStrategySchema = z.object({
  username: z.string(),
  password: z.string(),
});

const signupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 chars'),
  signup_code: z.string(),
});

@Controller()
export class SessionController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly signupCodeService: SignupCodeService,
  ) {}

  @Post('authenticate')
  @HttpCode(200)
  async login(@Req() req: Request, @Body(new ValidationPipe(localStrategySchema)) input: LoginDto) {
    const user = await this.userService.validatePassword(input.username, input.password);

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
  async signup(@Req() req: Request, @Body(new ValidationPipe(signupSchema)) input: SignupDto) {
    const { name, email, password, signup_code } = input;

    if (signup_code == null) {
      throw new BadRequestException('Must provide a valid signup code');
    }

    const signupCodeLookup = await this.signupCodeService.findOne(signup_code);

    if (!signupCodeLookup) {
      throw new BadRequestException('Must provide a valid signup code');
    }

    const userExists = await this.userService.checkEmailAvailability(email);

    if (userExists) {
      throw new BadRequestException('Email already in use');
    }

    const user = await this.userService.create(
      { userId: SYSTEM_USER },
      {
        name,
        email,
        password,
      },
    );

    await this.signupCodeService.update(signup_code, {
      used: true,
    });

    const sessionToken = await this.authService.issueSessionToken(user.id, this.getSessionMeta(req));
    const accessToken = await this.authService.issueAccessToken(user.id);

    return {
      sessionToken,
      accessToken,
      user,
    };
  }

  @Post('authenticate/refresh')
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
      this.getSessionMeta(req),
    );

    const accessToken = await this.authService.issueAccessToken(userId);

    return {
      sessionToken: newSessionToken,
      accessToken,
      user,
    };
  }

  @Post('authenticate/logout')
  @HttpCode(204)
  async logout(@Req() req: Request) {
    const token = this.getSessionToken(req);
    const payload = this.validateSessionToken(token);
    const userId = payload.sub;
    const user = await this.userService.findById({ userId }, userId);

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    await this.authService.invalidateSession(userId, token, this.getSessionMeta(req));
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

  private getSessionMeta(request: Request): SessionMetadata {
    return {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }
}
