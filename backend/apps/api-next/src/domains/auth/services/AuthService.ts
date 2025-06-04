import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { UserService } from '@ci/domains/user';

import type { JwtPayload } from '../types';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
  ) {}

  validateUser(username: string, password: string) {
    return this.userService.validatePassword(username, password);
  }

  async issueAccessToken(userId: string) {
    const payload = {
      sub: userId,
    } satisfies JwtPayload;

    const accessToken = await this.jwtService.sign(payload);

    return accessToken;
  }
}
