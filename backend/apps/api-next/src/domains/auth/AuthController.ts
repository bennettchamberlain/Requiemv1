import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { z } from 'zod';

import { ValidationPipe } from '../../common/pipes';
import { RequestContextService } from '../context';

import { AuthService } from './AuthService';
import { JwtPayload, LoginDto } from './types';

const localStrategySchema = z.object({
  username: z.string(),
  password: z.string(),
});

@Controller('authenticate')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly contextService: RequestContextService,
    private readonly jwtService: JwtService,
  ) {}

  @Post()
  @HttpCode(200)
  async login(@Req() req: Request, @Body(new ValidationPipe(localStrategySchema)) input: LoginDto) {
    const user = await this.authService.validateUser(input.username, input.password);

    if (user == null) {
      throw new UnauthorizedException('Invalid credentials');
    }

    this.contextService.extend(req, {
      user,
    });

    const payload = {
      sub: user.id,
    } satisfies JwtPayload;

    const access_token = await this.jwtService.sign(payload);

    return {
      access_token: access_token,
      user,
    };
  }
}
