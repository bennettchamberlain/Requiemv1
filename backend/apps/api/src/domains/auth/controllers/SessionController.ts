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
import { SignupCodeService } from '@ci/domains/user/services/SignupCodeService';
import { SignupDto } from '@ci/domains/user/types';

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

    const user = await this.userService.create({
      name,
      email,
      password,
    });

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
    } catch {
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
