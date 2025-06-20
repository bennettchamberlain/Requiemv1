import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import config from '@ci/configuration';
import { UserService } from '@ci/domains/user';

import { SessionService } from '../services/SessionService';
import type { JwtPayload } from '../types';

interface SessionMetadata {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private sessionService: SessionService,
    private userService: UserService,
  ) {}

  validateUser(username: string, password: string) {
    return this.userService.validatePassword(username, password);
  }

  validateSessionToken(token: string): JwtPayload {
    return this.jwtService.verify(token, {
      secret: config.auth.jwt.refreshTokenSecret,
    });
  }

  async issueSessionToken(userId: string, meta: SessionMetadata): Promise<string> {
    const sessionToken = this.generateSessionToken(userId);

    await this.sessionService.create(userId, {
      ...meta,
      token: sessionToken,
    });

    return sessionToken;
  }

  async rotateSessionToken(userId: string, token: string, meta: SessionMetadata): Promise<string> {
    const sessionToken = this.generateSessionToken(userId);

    await this.sessionService.rotate(userId, {
      ...meta,
      token,
      newToken: sessionToken,
    });

    return sessionToken;
  }

  issueAccessToken(userId: string): string {
    const payload = {
      sub: userId,
    } satisfies JwtPayload;

    const accessToken = this.jwtService.sign(payload);

    return accessToken;
  }

  private generateSessionToken(userId: string) {
    const payload = {
      sub: userId,
    } satisfies JwtPayload;

    return this.jwtService.sign(payload, {
      secret: config.auth.jwt.refreshTokenSecret,
      expiresIn: config.auth.jwt.refreshTokenExpiration,
    });
  }
}
