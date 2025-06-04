import type { Params } from '@feathersjs/feathers';

import { Application } from '../configuration/types';

import type { UserType } from './user-service';

export class SignupService {
  app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  async create(data: UserType, params: Params) {
    const userService = this.app.service('users');

    // Pass through internal params to bypass external hooks if needed
    const createdUser = await userService.create(data, {
      ...params,
      provider: undefined, // mark as internal call
    });

    // Return the new user (omit password if needed)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...rest } = createdUser;

    return rest;
  }
}
