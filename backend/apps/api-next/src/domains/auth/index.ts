import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import config from '@ci/config';
import { UserModule } from '@ci/domains/user';

import { AuthService } from './services/AuthService';
import { AuthController } from './controllers/AuthController';
import { SignupController } from './controllers/SignupController';
import { JwtStrategy } from './services/JwtStrategy';

@Module({
  imports: [
    UserModule,
    PassportModule,
    JwtModule.register({
      secret: config.auth.jwt.secret,
      signOptions: {
        expiresIn: '60s',
      },
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController, SignupController],
})
export class AuthModule {}

export type { LoginDto } from './types';
