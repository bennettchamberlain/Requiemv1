import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EventsModule } from '@ci/domains/events';

import { UserController } from './controllers/UserController';
import { SignupCodeEntity } from './entities/SignupCodeEntity';
import { UserEntity } from './entities/UserEntity';
import { SignupCodeService } from './services/SignupCodeService';
import { UserService } from './services/UserService';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, SignupCodeEntity]), EventsModule],
  providers: [UserService, SignupCodeService],
  controllers: [UserController],
  exports: [UserService, SignupCodeService],
})
export class UserModule {}

// Entities
export { UserEntity, SignupCodeEntity };

// Services
export { SignupCodeService, UserService };

// Types
export type { CreateUserDto, UpdateUserDto, User, SignupCode, SignupDto, UpdateSignupCodeDto } from './types';
