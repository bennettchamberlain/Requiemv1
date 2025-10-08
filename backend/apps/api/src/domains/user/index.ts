import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MemoryModule } from '@ci/domains/memory';

import { UserController } from './controllers/UserController';
import { SignupCodeEntity } from './entities/SignupCodeEntity';
import { UserEntity } from './entities/UserEntity';
import { SignupCodeService } from './services/SignupCodeService';
import { UserService } from './services/UserService';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, SignupCodeEntity]), MemoryModule],
  providers: [UserService, SignupCodeService],
  controllers: [UserController],
  exports: [UserService, SignupCodeService],
})
export class UserModule {}

// Entities
export { UserEntity, SignupCodeEntity };

// Services
export { UserService };

// Types
export type { CreateUserDto, UpdateUserDto, User, SignupCode, UpdateSignupCodeDto } from './types';
