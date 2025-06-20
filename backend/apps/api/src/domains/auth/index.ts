import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import config from '@ci/configuration';
import { UserModule } from '@ci/domains/user';

import { SessionController } from './controllers/SessionController';
import { SessionEntity } from './entities/SessionEntity';
import { AuthService } from './services/AuthService';
import { JwtStrategy } from './services/JwtStrategy';
import { SessionService } from './services/SessionService';

@Module({
  imports: [
    TypeOrmModule.forFeature([SessionEntity]),
    UserModule,
    PassportModule,
    JwtModule.register({
      secret: config.auth.jwt.authTokenSecret,
      signOptions: {
        expiresIn: config.auth.jwt.authTokenExpiration,
      },
    }),
  ],
  providers: [AuthService, JwtStrategy, SessionService],
  controllers: [SessionController],
})
export class AuthModule {}

export type { LoginDto } from './types';
