import { Body, Controller, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';

import { ValidationPipe } from '../../common/pipes';

import { AuthService } from './AuthService';
import { LoginDto } from './types';

const localStrategySchema = z.object({
  username: z.string(),
  password: z.string(),
});

@Controller('authenticate')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post()
  @HttpCode(200)
  async login(@Body(new ValidationPipe(localStrategySchema)) input: LoginDto) {
    const user = await this.authService.validateUser(input.username, input.password);

    if (user == null) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = await this.authService.issueAccessToken(user.id);

    return {
      accessToken,
      user,
    };
  }
}
