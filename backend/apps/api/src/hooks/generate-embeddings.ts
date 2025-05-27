import type { HookContext } from '@feathersjs/feathers';
import ollama from 'ollama';

export const generateEmbedding = async (context: HookContext) => {
  const { data } = context;

  // TODO generalize by looking for _vector

  if (data?.question_string) {
    const response = await ollama.embeddings({
      model: 'nomic-embed-text',
      prompt: data.question_string,
    });

    data.question_string_vector = response.embedding;
  }

  return context;
};
