import type { HookContext } from '@feathersjs/feathers';
import ollama from 'ollama';

export const generateEmbeddings = async (context: HookContext) => {
  const { data } = context;

  if (!data) {
    return context;
  }

  const embeddingPromises = Object.keys(data)
    .filter(key => key.endsWith('_vector'))
    .map(async vectorKey => {
      const fieldKey = vectorKey.slice(0, -7); // remove '_vector'

      if (data[fieldKey] && typeof data[fieldKey] === 'string') {
        const response = await ollama.embeddings({
          model: 'nomic-embed-text',
          prompt: data[fieldKey],
        });

        data[vectorKey] = response.embedding;
      }
    });

  await Promise.all(embeddingPromises);

  return context;
};
