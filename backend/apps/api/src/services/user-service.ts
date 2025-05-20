import { authenticate } from '@feathersjs/authentication';
import { passwordHash } from '@feathersjs/authentication-local';
import type { HookContext } from '@feathersjs/feathers';
import { KnexService } from '@feathersjs/knex';
import { resolve, resolveData, validateData } from '@feathersjs/schema';
import { Type, Static, getValidator } from '@feathersjs/typebox';
import { iff } from 'feathers-hooks-common';
import type { Knex } from 'knex';

import { queryValidator } from '../configuration/validators';

export class UserService extends KnexService {
  constructor(db: Knex) {
    super({
      Model: db,
      name: 'users',
      id: 'id',
    });
  }
}

export const UserData = Type.Object(
  {
    name: Type.String(),
    email: Type.String({ format: 'email' }),
    password: Type.String({ minLength: 6 }),
  },
  {
    additionalProperties: false,
  },
);

export type UserType = Static<typeof UserData>;

const validator = getValidator(UserData, queryValidator);

const userDataResolver = resolve<UserType, HookContext>({
  properties: {
    password: passwordHash({ strategy: 'local' }),
  },
});

export const hooks = {
  before: {
    all: [
      // Only authenticate if it's an external request
      iff((context: HookContext) => context.params.provider, authenticate('jwt')),
    ],
    create: [validateData(validator), resolveData(userDataResolver)],
  },
  // TODO:
  //  We're additionally interested in making sure the password hash isn't yielded out of the API.
  //  This wasn't cooperating, but it doesn't matter much for now. There's little risk because nobody
  //  is on the system yet. So cutting the corner and looping back.
  //  https://feathersjs.com/api/authentication/local#protecting-fields
};
