import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { DeleteResult, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import config from '@ci/configuration';
import { GraphNodeEntity } from '@ci/domains/memory/entities/GraphNodeEntity';

import { UserEntity } from '../entities/UserEntity';
import { CreateUserDto, UpdateUserDto, User } from '../types';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  async create(data: CreateUserDto): Promise<User> {
    const hashedPassword = await bcrypt.hash(data.password, config.auth.local.saltRounds);
    const nameForEntity = data.name ?? data.email;

    const userResult = await this.userRepository.manager.transaction(async (entityManager) => {
      const userRepo = entityManager.getRepository(UserEntity);
      const graphRepo = entityManager.getRepository(GraphNodeEntity);

      const user = userRepo.create({
        ...data,
        id: uuidv7(),
        password: hashedPassword,
      });

      const savedUser = await userRepo.save(user);

      const entityId = uuidv7();
      const nameParts = (data.name ?? '').trim().split(/\s+/).filter(Boolean);
      const [firstName, ...restName] = nameParts;

      const properties: Record<string, unknown> = {
        email: data.email,
      };
      if (firstName) {
        properties.first_name = firstName;
      }

      if (restName.length > 0) {
        properties.last_name = restName.join(' ');
      }

      const personNode = graphRepo.create({
        entity_id: entityId,
        entity_type: 'Person',
        name: nameForEntity,
        description: nameForEntity,
        properties,
        search_content: nameForEntity,
        linked_table: 'users',
        linked_id: savedUser.id,
        is_active: true,
        is_archived: false,
      });

      await graphRepo.save(personNode);
      await userRepo.update(savedUser.id, { entityId });

      savedUser.entityId = entityId;

      return savedUser;
    });

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
