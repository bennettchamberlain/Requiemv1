import type { HookContext } from '@feathersjs/feathers';
import ollama from 'ollama';

export const generateEmbeddings = async (context: HookContext) => {

  // Only process create operations
  // TODO handle other operations also
  if (context.method !== 'create') {
    return context;
  }

  // TODO -> register a job that will do something similar to /temporary/bulk_embedder.js
  return context;
};
