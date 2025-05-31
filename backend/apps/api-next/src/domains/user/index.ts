import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserController } from './UserController';
import { UserEntity } from './UserEntity';
import { UserService } from './UserService';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])],
  providers: [UserService],
  controllers: [UserController],
  exports: [UserService],
})
export class UserModule {}

export { UserService };
export type { CreateUserDto, UpdateUserDto, User } from './types';
