import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { DeleteResult, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import config from '@ci/configuration';
import { EventService, Events } from '@ci/domains/events';

import { type User, UserEntity } from '../entities/UserEntity';
import { CreateUserDto, UpdateUserDto } from '../types';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly eventService: EventService,
  ) {}

  async create(data: CreateUserDto): Promise<User> {
    const hashedPassword = await bcrypt.hash(data.password, config.auth.local.saltRounds);

    const instance = this.userRepository.create({
      ...data,
      id: uuidv7(),
      password: hashedPassword,
    });

    const entity = await this.userRepository.save(instance);

    await this.eventService.send(Events.USER_CREATED, {
      userId: entity.id,
    });

    return UserEntity.toEgressType(entity);
  }

  async findAll(): Promise<User[]> {
    const result = await this.userRepository.find();

    return result.map((entity) => UserEntity.toEgressType(entity));
  }

  async findOne(id: string): Promise<User | null> {
    const result = await this.userRepository.findOne({
      where: {
        id,
      },
    });

    return result ? UserEntity.toEgressType(result) : null;
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

    return UserEntity.toEgressType(result);
  }

  async checkEmailAvailability(email: string): Promise<boolean> {
    const result = await this.userRepository.findOne({
      where: {
        email,
      },
    });

    return !!result;
  }

  async onboard(id: string): Promise<void> {
    await this.userRepository.update(id, {
      onboarded: true,
    });
  }
}
