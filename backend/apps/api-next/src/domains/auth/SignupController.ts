import { ConflictException, Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { z } from 'zod';

import { PgErrorCode } from '../../common/constants';
import { ValidationPipe } from '../../common/pipes';

import { UserService, type CreateUserDto } from '../../domains/user';
import { AuthService } from './AuthService';

const signupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 chars'),
});

@Controller('signup')
export class SignupController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  async signup(@Body(new ValidationPipe(signupSchema)) input: CreateUserDto) {
    try {
      const user = await this.userService.create(input);
      const accessToken = await this.authService.issueAccessToken(user.id);

      return {
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
}
