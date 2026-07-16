import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { ServiceContext, SYSTEM_USER } from '@ci/common/context';
import config from '@ci/configuration';
import { EventService } from '@ci/domains/events';

import { type User, UserEntity } from '../entities/UserEntity';
import { UserCreatedEvent, UserUpdatedEvent, UserRemovedEvent } from '../events';
import { CreateUserDto, UpdateUserDto } from '../types';

/**
 * Grace period between "delete my account" and the irreversible purge of the data.
 * Stamped onto the row when deletion is requested, so changing this value never moves
 * a deadline already promised to someone who has left.
 *
 * TODO: move to config once the background purge job exists — until something is
 * actually reading `purgeAfter` to delete rows, this is a promise, not a schedule.
 */
const PURGE_GRACE_DAYS = 30;

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly eventService: EventService,
  ) {}

  async create(context: ServiceContext, data: CreateUserDto): Promise<User> {
    if (context.userId !== SYSTEM_USER) {
      throw new Error('Unauthorized');
    }

    const id = data.id ?? uuidv7();
    const hashedPassword = await bcrypt.hash(data.password, config.auth.local.saltRounds);

    const instance = this.userRepository.create({
      ...data,
      id,
      password: hashedPassword,
    });

    const entity = await this.userRepository.save(instance);

    await this.eventService.send(UserCreatedEvent, {
      userId: entity.id,
    });

    return UserEntity.toEgressType(entity);
  }

  async findAll(): Promise<User[]> {
    const result = await this.userRepository.find();

    return result.map((entity) => UserEntity.toEgressType(entity));
  }

  async findById(context: ServiceContext, id: string): Promise<User | null> {
    if (context.userId !== SYSTEM_USER && context.userId !== id) {
      throw new UnauthorizedException();
    }

    const result = await this.userRepository.findOne({
      where: {
        id,
      },
    });

    return result ? UserEntity.toEgressType(result) : null;
  }

  async update(context: ServiceContext, id: string, data: UpdateUserDto): Promise<User | null> {
    if (context.userId !== SYSTEM_USER && context.userId !== id) {
      throw new UnauthorizedException();
    }

    await this.userRepository.update(id, data);

    await this.eventService.send(UserUpdatedEvent, {
      userId: id,
    });

    return this.findById(context, id);
  }

  /**
   * Request account deletion — the in-app path App Store Guideline 5.1.1(v) and
   * Google Play's Data Deletion policy require of any app that offers in-app signup.
   *
   * Access dies here, data dies later. Stamping `deletedAt` is the whole access
   * revocation: `@DeleteDateColumn` makes every read on this repository skip the row,
   * so login, JWT, API-key and OIDC resolution all start failing on the next request
   * without any of them knowing this feature exists. The rows themselves are removed
   * afterwards by the background purge, no earlier than `purgeAfter` — a hard delete
   * here would raise a foreign-key violation anyway (33 tables reference users(id)
   * with no ON DELETE action; see the migration).
   *
   * Idempotent: a second request finds nothing (the first one hid the row) and
   * returns false rather than throwing.
   */
  async requestDeletion(context: ServiceContext, id: string): Promise<boolean> {
    if (context.userId !== SYSTEM_USER && context.userId !== id) {
      throw new UnauthorizedException();
    }

    const existing = await this.findById(context, id);

    if (!existing) {
      return false;
    }

    const purgeAfter = new Date(Date.now() + PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000);

    // One write, not `softDelete()` then `update()`: the access gate (`deletedAt`) and
    // the promise about when the data goes (`purgeAfter`) must never exist apart.
    await this.userRepository.update(id, { deletedAt: new Date(), purgeAfter });

    await this.eventService.send(UserRemovedEvent, {
      userId: id,
    });

    return true;
  }

  /**
   * Hard-delete a user row.
   *
   * ⚠️ This is not the account-deletion path — use {@link requestDeletion}. It cannot
   * succeed for any account that has stored anything: 33 tables reference users(id)
   * with no ON DELETE action, so Postgres raises a foreign-key violation. It survives
   * only because nothing calls it; the background purge will supersede it.
   */
  async remove(context: ServiceContext, id: string): Promise<boolean> {
    if (context.userId !== SYSTEM_USER && context.userId !== id) {
      throw new UnauthorizedException();
    }

    const existingUser = this.findById(context, id);

    if (!existingUser) {
      return false;
    }

    await this.userRepository.delete(id);

    await this.eventService.send(UserRemovedEvent, {
      userId: id,
    });

    return true;
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
      // Must see soft-deleted rows. They keep their address — ci.users.email is UNIQUE
      // across them — so an INSERT would still collide. Reading through the default
      // filter would report a deleted user's address as free and signup would get a
      // raw constraint violation instead of "email already registered".
      withDeleted: true,
    });

    return !!result;
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await this.userRepository.findOne({
      where: {
        email,
      },
    });

    return result ? UserEntity.toEgressType(result) : null;
  }

  async onboard(id: string): Promise<void> {
    await this.userRepository.update(id, {
      onboarded: true,
    });
  }
}
