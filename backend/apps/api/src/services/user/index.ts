import type { Knex } from 'knex';
import type { Params, ServiceMethods } from '@feathersjs/feathers';

interface User {
  id: number;
  name: string;
}

interface CreateUserData {
  name: string;
}

export class UserService implements Partial<ServiceMethods<User>> {
  constructor(private readonly db: Knex) {}

  async find(params?: Params): Promise<User[]> {
    return this.db<User>('users').select('*');
  }

  async get(id: number, params?: Params): Promise<User> {
    const user = await this.db<User>('users').where({ id }).first();

    if (!user) {
      throw new Error(`User with id ${id} not found`);
    }

    return user;
  }

  async create(data: CreateUserData, params?: Params): Promise<User> {
    const [user] = await this.db<User>('users').insert(data).returning('*');

    return user;
  }

  async remove(id: number, params?: Params): Promise<User> {
    const [user] = await this.db<User>('users').where({ id }).delete().returning('*');

    if (!user) {
      throw new Error(`User with id ${id} not found`);
    }

    return user;
  }
}
