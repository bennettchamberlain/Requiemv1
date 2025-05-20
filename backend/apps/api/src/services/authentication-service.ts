import type { HookContext } from '@feathersjs/feathers';

export const hooks = {
  after: {
    create: [
      (context: HookContext) => {
        delete context.result.authentication;

        return context;
      },
    ],
  },
};
