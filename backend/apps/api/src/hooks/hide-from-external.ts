import { NotFound } from '@feathersjs/errors';
import type { HookContext } from '@feathersjs/feathers';

export const hideFromExternal = async (context: HookContext) => {
  if (context.params.provider) {
    throw new NotFound();
  }

  return context;
};
