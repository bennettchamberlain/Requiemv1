import { authenticate } from '@feathersjs/authentication';
import type { HookContext } from '@feathersjs/feathers';
import { KnexService } from '@feathersjs/knex';
import { resolve, resolveData, validateData } from '@feathersjs/schema';
import { Type, Static, getValidator } from '@feathersjs/typebox';
import { iff } from 'feathers-hooks-common';
import type { Knex } from 'knex';

import { queryValidator } from '../configuration/validators';

export const QuestionData = Type.Object(
  {
    id: Type.Optional(Type.String({ format: 'uuid' })),
    created: Type.Optional(Type.String({ format: 'date-time' })),
    updated: Type.Optional(Type.String({ format: 'date-time' })),
    tag: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
    category: Type.Optional(Type.String()),
    user_id: Type.String({ format: 'uuid' }),
    question_string: Type.String(),
    example_answer_1: Type.Optional(Type.String()),
    example_answer_2: Type.Optional(Type.String()),
    example_answer_3: Type.Optional(Type.String()),
  },
  {
    additionalProperties: false,
  },
);

export type QuestionType = Static<typeof QuestionData>;

const validator = getValidator(QuestionData, queryValidator);

const questionDataResolver = resolve<QuestionType, HookContext>({
  properties: {
    created: async () => new Date().toISOString(),
    updated: async () => new Date().toISOString(),
  },
});

export class QuestionsService extends KnexService {
  constructor(db: Knex) {
    super({
      Model: db,
      name: 'questions',
      id: 'id',
    });
  }

  static hooks = {
    before: {
      all: [
        // Only authenticate if it's an external request
        iff((context: HookContext) => context.params.provider, authenticate('jwt')),
      ],
      create: [validateData(validator), resolveData(questionDataResolver)],
      update: [
        validateData(validator),
        resolveData(questionDataResolver),
      ],
      patch: [
        validateData(validator),
        resolveData(questionDataResolver),
      ],
    },
  };
}
