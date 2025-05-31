import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import config from '../../config';
import { UserModule } from '../user';

import { AuthService } from './AuthService';
import { AuthController } from './AuthController';
import { SignupController } from './SignupController';
import { JwtStrategy } from './JwtStrategy';

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

export { JwtAuthGuard } from './JwtAuthGuard';
export type { LoginDto } from './types';
