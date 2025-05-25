import { authenticate } from '@feathersjs/authentication';
import type { HookContext } from '@feathersjs/feathers';
import { KnexService } from '@feathersjs/knex';
import { resolve, resolveData, validateData } from '@feathersjs/schema';
import { Type, Static, getValidator } from '@feathersjs/typebox';
import { iff } from 'feathers-hooks-common';
import type { Knex } from 'knex';

import { queryValidator } from '../configuration/validators';

export const AnswerData = Type.Object(
  {
    id: Type.Optional(Type.String({ format: 'uuid' })),
    created: Type.Optional(Type.String({ format: 'date-time' })),
    updated: Type.Optional(Type.String({ format: 'date-time' })),
    user_id: Type.String({ format: 'uuid' }),
    question_id: Type.String({ format: 'uuid' }),
    rag_answer_1: Type.Optional(Type.String()),
    rag_answer_2: Type.Optional(Type.String()),
    rag_answer_3: Type.Optional(Type.String()),
    give_answer_current: Type.Optional(Type.String()),
    give_answer_2: Type.Optional(Type.String()),
    give_answer_3: Type.Optional(Type.String()),
    give_answer_4: Type.Optional(Type.String()),
    give_answer_5: Type.Optional(Type.String()),
  },
  {
    additionalProperties: false,
  },
);

export type AnswerType = Static<typeof AnswerData>;

const validator = getValidator(AnswerData, queryValidator);

const answerDataResolver = resolve<AnswerType, HookContext>({
  properties: {
    created: async () => new Date().toISOString(),
    updated: async () => new Date().toISOString(),
  },
});

export class AnswersService extends KnexService {
  constructor(db: Knex) {
    super({
      Model: db,
      name: 'answers',
      id: 'id',
    });
  }

  static hooks = {
    before: {
      all: [
        // Only authenticate if it's an external request
        iff((context: HookContext) => context.params.provider, authenticate('jwt')),
      ],
      create: [validateData(validator), resolveData(answerDataResolver)],
      update: [
        validateData(validator),
        resolveData(answerDataResolver),
//        resolve<AnswerType, HookContext>({
//          properties: {
//            updated: async () => new Date().toISOString(),
//          },
//        }),
      ],
      patch: [
        validateData(validator),
        resolveData(answerDataResolver),
//        resolve<AnswerType, HookContext>({
//          properties: {
//            updated: async () => new Date().toISOString(),
//          },
//        }),
      ],
    },
  };
}
