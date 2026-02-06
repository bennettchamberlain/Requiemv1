import { BadRequestException, Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';

import { SYSTEM_USER } from '@ci/common/context';
import { FeatureService } from '@ci/common/feature';
import { ValidationPipe } from '@ci/common/pipes';
import { UserService } from '@ci/domains/user';

import { AuthService } from '../services/AuthService';
import { SignupCodeService } from '../services/SignupCodeService';
import { SignupDto } from '../types';

const signupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 chars'),
  signup_code: z.string().optional(),
});

@Controller()
export class SignupController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly signupCodeService: SignupCodeService,
    private readonly featureService: FeatureService,
  ) {}

  @Post('signup')
  async signup(@Req() req: Request, @Body(new ValidationPipe(signupSchema)) input: SignupDto) {
    const { name, email, password, signup_code } = input;

    const isSignupCodeRequired = await this.featureService.isFeatureEnabled('require.signup.codes');

    if (isSignupCodeRequired) {
      if (signup_code == null) {
        throw new BadRequestException('Must provide a valid signup code');
      }

      const signupCodeLookup = await this.signupCodeService.findOne(signup_code);

      if (!signupCodeLookup) {
        throw new BadRequestException('Must provide a valid signup code');
      }
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

    if (isSignupCodeRequired) {
      await this.signupCodeService.update(signup_code!, {
        used: true,
      });
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
}
