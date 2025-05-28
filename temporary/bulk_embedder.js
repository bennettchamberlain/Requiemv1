import ollama from 'ollama';
import { Client } from 'pg';

// PostgreSQL connection setup
const client = new Client({
  user: 'companion_intel',
  host: 'localhost',
  database: 'companion_intel',
  password: 'comp4nion_1ntel_ftw!',
  port: 5432,
});

// Enumeration of source tables and fields to register as vector embeddings
const sources = [
  { name: 'content', fields: [ 'text' ] },
  { name: 'questions', fields: [ 'question_string' ] },
]

// Main workflow
async function run() {

  try {

    await client.connect();

    // Visit all source tables

    for(let i = 0; i < sources.length; i++) {

      // Get rows from table
      const source = sources[i];
      const query = `SELECT * FROM ${source.name} LIMIT 999`;
      const { rows } = await client.query(query);

      // Visit all rows found
      for(let j = 0; j < rows.length; j++) {

        // get the table row
        const row = rows[j]

        // Go through each desired field name
        for(let k = 0; k < source.fields.length; k++) {

          // Get field name
          const fieldName = source.fields[k]

          // Get live field value from sql query result
          const text = row[fieldName]

          // This is the ID that will be used for the embedding
          const id = `${source.name}-${row.id}-${fieldName}`

          // Generate an embedding
          const response = await ollama.embeddings({
            model: 'nomic-embed-text',
            prompt: text,
          });

          // Remember it into the embeddings table
          const insertQuery = `
            INSERT INTO embeddings (
              id, raw_input, embedding_vector, 
            ) VALUES (
              $1, $2, $3::vector
            )
          `;

          await client.query(insertQuuery,[id,text,response.embedding])

        }

      }

    }

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await client.end();
  }
}

run();


