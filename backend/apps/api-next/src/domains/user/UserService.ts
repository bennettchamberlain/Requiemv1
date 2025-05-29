import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { DeleteResult, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { UserEntity } from './UserEntity';
import { CreateUserDto, UpdateUserDto, User } from './types';

const SALT_ROUNDS = 10;

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  async create(data: CreateUserDto): Promise<User> {
    const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);

    const user = this.userRepository.create({
      ...data,
      external_id: uuidv7(),
      password: hashedPassword,
    });

    const userResult = await this.userRepository.save(user);

    return userResult.toUser();
  }

  async findAll(): Promise<User[]> {
    const result = await this.userRepository.find();

    return result.map((entity) => entity.toUser());
  }

  async findOne(id: string): Promise<User | null> {
    const result = await this.userRepository.findOne({
      where: {
        id,
      },
    });

    return result?.toUser() ?? null;
  }

  async findOneByExternalId(externalId: string): Promise<User | null> {
    const result = await this.userRepository.findOne({
      where: {
        external_id: externalId,
      },
    });

    return result?.toUser() ?? null;
  }

  async update(id: string, data: UpdateUserDto): Promise<User | null> {
    await this.userRepository.update(id, data);

    return this.findOne(id);
  }

  remove(id: string): Promise<DeleteResult> {
    return this.userRepository.delete(id);
  }

  async validatePassword(email: string, password: string): Promise<User | null> {
    const result = await this.userRepository.findOne({
      where: {
        email,
      },
    });

    if (result == null) {
      return null;
    }

    const validCredentials = await bcrypt.compare(password, result.password);

    if (!validCredentials) {
      return null;
    }

    return result.toUser();
  }
}
