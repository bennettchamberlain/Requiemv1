import type { HookContext } from '@feathersjs/feathers';
import ollama from 'ollama';

export const generateEmbeddings = async (context: HookContext) => {
  // Only process if this is a create operation on the content table
  if (context.method !== 'create' || context.path !== 'content') {
    return context;
  }

  const { data, app } = context;

  if (!data || !data.text) {
    return context;
  }

  try {
    // Generate embedding for the text field
    const response = await ollama.embeddings({
      model: 'nomic-embed-text',
      prompt: data.text,
    });

    // Get the database client
    const db = app.get('postgresqlClient');

    // Insert the embedding into the embeddings table
    await db('embeddings').insert({
      model: 'nomic-embed-text',
      raw_input: data.text,
      embedding_vector: `[${response.embedding.join(',')}]`, // Format as PostgreSQL vector
      created_at: new Date(),
      updated_at: new Date(),
    });

    console.log(`Generated and stored embedding for content with text: ${data.text.substring(0, 50)}...`);
  } catch (error) {
    console.error('Error generating embedding:', error);
    // Don't fail the main operation if embedding fails
  }

  return context;
};
