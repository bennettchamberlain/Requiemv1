import { createHmac } from 'crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import parseDuration from 'parse-duration';
import { MoreThan, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import config from '@ci/configuration';

import { SessionEntity } from '../entities/SessionEntity';
import type { JwtPayload, SessionMetadata } from '../types';

const SESSION_EXPIRES_IN = parseDuration(config.auth.session.duration) ?? 0;

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    @InjectRepository(SessionEntity)
    private readonly sessionRepository: Repository<SessionEntity>,
  ) {}

  async issueSessionToken(userId: string, meta: SessionMetadata): Promise<string> {
    const now = new Date().getTime();

    const token = this.generateSessionToken(userId);
    const expiresAt = new Date(now + SESSION_EXPIRES_IN);

    const hashedToken = await bcrypt.hash(token, config.auth.session.saltRounds);
    const hashedIp = this.digest(meta.ip);
    const hashedUserAgent = this.digest(meta.userAgent);

    const session = this.sessionRepository.create({
      id: uuidv7(),
      token: hashedToken,
      ip: hashedIp,
      user_agent: hashedUserAgent,
      expires_at: expiresAt,
      user: {
        id: userId,
      },
    });

    await this.sessionRepository.save(session);

    return token;
  }

  validateSessionToken(token: string): JwtPayload {
    return this.jwtService.verify(token, {
      secret: config.auth.jwt.refreshTokenSecret,
    });
  }

  async rotateSessionToken(userId: string, token: string, meta: SessionMetadata): Promise<string> {
    const session = await this.findSession(userId, token, meta);

    const nextToken = this.generateSessionToken(userId);

    session.token = await bcrypt.hash(nextToken, config.auth.session.saltRounds);

    await this.sessionRepository.save(session);

    return nextToken;
  }

  async invalidateSession(userId: string, token: string, meta: SessionMetadata): Promise<void> {
    const session = await this.findSession(userId, token, meta);

    await this.sessionRepository.delete({
      id: session.id,
    });
  }

  issueAccessToken(userId: string): string {
    const payload = {
      sub: userId,
    } satisfies JwtPayload;

    const accessToken = this.jwtService.sign(payload);

    return accessToken;
  }

  private async findSession(userId: string, token: string, data: SessionMetadata): Promise<SessionEntity> {
    const now = new Date();
    const hashedIp = this.digest(data.ip);
    const hashedUserAgent = this.digest(data.userAgent);

    const existingSessions = await this.sessionRepository.find({
      where: {
        ip: hashedIp,
        user_agent: hashedUserAgent,
        expires_at: MoreThan(now),
        user: {
          id: userId,
        },
      },
    });

    const session = existingSessions.find((session) => bcrypt.compareSync(token, session.token));

    if (!session) {
      throw new UnauthorizedException('Invalid session');
    }

    return session;
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

  private digest(value?: string) {
    if (value == null) {
      return value;
    }

    return createHmac('sha256', config.auth.session.fieldPepper).update(value).digest('hex');
  }
}
