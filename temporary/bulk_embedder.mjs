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

async function job_row_to_embeddings(client,source,row) {

  // Go through each desired field name
  for(let k = 0; k < source.fields.length; k++) {

    // Get field name
    const fieldName = source.fields[k];

    // Get live field value from sql query result
    const text = row[fieldName];

    // Skip if field is null or empty
    if (!text) {
      console.log(`Skipping empty ${fieldName} for row ${row.id}`);
      continue;
    }

    // This is the source label for tracking
    const sourceLabel = `${source.name}.${fieldName}`;

    // Check if embedding already exists for this source_id and source_label
    const checkQuery = `
      SELECT id FROM embeddings 
      WHERE source_id = $1 AND source_label = $2
      LIMIT 1
    `;
    
    const existingResult = await client.query(checkQuery, [row.id, sourceLabel]);
    
    if (existingResult.rows.length > 0) {
      console.log(`Embedding already exists for ${sourceLabel} (row ${row.id}), skipping...`);
      continue;
    }

    console.log(`Generating embedding for ${sourceLabel} (row ${row.id})`);

    try {
      // Generate an embedding
      const response = await ollama.embeddings({
        model: 'nomic-embed-text',
        prompt: text,
      });

      // Format embedding as PostgreSQL vector
      const embeddingVector = `[${response.embedding.join(',')}]`;
      //   const vectorString = JSON.stringify(embeddingVector);


      // Insert into the embeddings table
      const insertQuery = `
        INSERT INTO embeddings (
          model, 
          raw_input, 
          embedding_vector,
          source_id,
          source_label,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3::vector, $4, $5, $6, $7
        )
        ON CONFLICT (source_id, source_label) 
        DO UPDATE SET 
          raw_input = EXCLUDED.raw_input,
          embedding_vector = EXCLUDED.embedding_vector,
          updated_at = EXCLUDED.updated_at
      `;

      await client.query(insertQuery, [
        'nomic-embed-text',
        text,
        embeddingVector,
        row.id,
        sourceLabel,
        new Date(),
        new Date()
      ]);

      console.log(`Successfully embedded ${sourceLabel} for row ${row.id}`);

    } catch (embedError) {
      console.error(`Error embedding ${sourceLabel} for row ${row.id}:`, embedError);
      // Continue with next field/row
    }

  }

}

// Main workflow
async function run() {

  try {

    await client.connect();
    console.log('Connected to database');

    // Visit all source tables
    for(let i = 0; i < sources.length; i++) {

      // Get rows from table
      const source = sources[i];
      console.log(`Processing table: ${source.name}`);
      
      // TODO -> get a cursor and visit every record rather than having a limit
      const query = `SELECT * FROM ${source.name} LIMIT 999`;
      const { rows } = await client.query(query);
      console.log(`Found ${rows.length} rows in ${source.name}`);

      // Visit all rows found
      for(let j = 0; j < rows.length; j++) {

       await job_row_to_embeddings(client,source,rows[j])

      }

    }

    console.log('Bulk embedding completed successfully');

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

run();
