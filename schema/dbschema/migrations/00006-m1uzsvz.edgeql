CREATE MIGRATION m1uzsvz5cj4nifedylmz2tk3ht2sqbulqs2bcj6emxrzdt7ztsm4ja
    ONTO m1hkmuqc542xo4zqhk24rhcvnjaje6ikk6qdilc3lpkzdmy2v4rjaa
{
  CREATE SCALAR TYPE default::EmbeddingCloud EXTENDING ext::pgvector::vector<1024>;
  ALTER TYPE default::MemoryItem {
      CREATE PROPERTY embedding_cloud: default::EmbeddingCloud;
      CREATE INDEX ext::pgvector::hnsw_cosine(m := 16, ef_construction := 128) ON (.embedding_cloud);
      CREATE PROPERTY embedded_cloud_at: std::datetime;
      CREATE PROPERTY embedding_cloud_model: std::str;
  };
  CREATE TYPE default::OneGrant EXTENDING default::Owned {
      ALTER PROPERTY data_class {
          SET default := 'connection';
          SET OWNED;
          SET REQUIRED;
          SET TYPE std::str;
      };
      CREATE CONSTRAINT std::exclusive ON (.owner);
      CREATE REQUIRED PROPERTY one_user_id: std::str;
      CREATE INDEX ON (.one_user_id);
      CREATE PROPERTY connected_at: std::datetime {
          SET default := (std::datetime_of_statement());
      };
      CREATE REQUIRED PROPERTY platforms: array<std::str> {
          SET default := (<array<std::str>>[]);
      };
      CREATE PROPERTY revoked_at: std::datetime;
      CREATE PROPERTY space_id: std::str;
  };
  CREATE TYPE default::SyncCursor EXTENDING default::Owned {
      ALTER PROPERTY data_class {
          SET default := 'connection';
          SET OWNED;
          SET REQUIRED;
          SET TYPE std::str;
      };
      CREATE REQUIRED PROPERTY endpoint: std::str;
      CREATE REQUIRED PROPERTY platform: std::str;
      CREATE CONSTRAINT std::exclusive ON ((.owner, .platform, .endpoint));
      CREATE INDEX ON ((.owner, .platform));
      CREATE PROPERTY cursor: std::json;
      CREATE PROPERTY last_error: std::str;
      CREATE PROPERTY last_synced_at: std::datetime;
  };
  ALTER SCALAR TYPE default::EntityKind EXTENDING enum<person, organization, place, object, concept, event, `group`>;
};
