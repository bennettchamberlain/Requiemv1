CREATE MIGRATION m1rpq3dxz4gp7xivosikwpjljy464uephk666y662wk2gvknpkiq2a
    ONTO initial
{
  CREATE EXTENSION pgvector VERSION '0.7';
  CREATE SCALAR TYPE default::AskStatus EXTENDING enum<pending, approved, denied, answered, expired, revoked>;
  CREATE SCALAR TYPE default::Disclosure EXTENDING enum<none, boolean, count, summary, redacted, full>;
  CREATE SCALAR TYPE default::Embedding EXTENDING ext::pgvector::vector<768>;
  CREATE SCALAR TYPE default::GrantMode EXTENDING enum<auto, review, block>;
  CREATE SCALAR TYPE default::JobState EXTENDING enum<created, retry, active, completed, cancelled, failed>;
  CREATE SCALAR TYPE default::Tier EXTENDING enum<stranger, acquaintance, coworker, peer, work_friend, friend, close_friend, family, household, best_friend>;
  CREATE GLOBAL default::current_person_id -> std::uuid;
  CREATE TYPE default::Person {
      CREATE REQUIRED PROPERTY created_at: std::datetime {
          SET default := (std::datetime_of_statement());
      };
      CREATE PROPERTY disabled_at: std::datetime;
      CREATE PROPERTY display_name: std::str;
      CREATE PROPERTY email: std::str {
          CREATE CONSTRAINT std::exclusive;
      };
      CREATE REQUIRED PROPERTY handle: std::str {
          CREATE CONSTRAINT std::exclusive;
          CREATE CONSTRAINT std::min_len_value(2);
      };
      CREATE REQUIRED PROPERTY is_superadmin: std::bool {
          SET default := false;
      };
      CREATE ACCESS POLICY people_directory
          ALLOW SELECT USING (EXISTS (GLOBAL default::current_person_id));
      CREATE ACCESS POLICY self_edits
          ALLOW UPDATE USING ((GLOBAL default::current_person_id ?= .id));
  };
  CREATE GLOBAL default::current_person := (SELECT
      default::Person
  FILTER
      (.id = GLOBAL default::current_person_id)
  );
  ALTER TYPE default::Person {
      CREATE ACCESS POLICY superadmin_manages
          ALLOW UPDATE, DELETE, INSERT USING (((GLOBAL default::current_person).is_superadmin ?? false));
  };
  CREATE TYPE default::ConsentGrant {
      CREATE ACCESS POLICY superadmin_revokes
          ALLOW UPDATE USING (((GLOBAL default::current_person).is_superadmin ?? false));
      CREATE REQUIRED LINK grantee: default::Person;
      CREATE REQUIRED LINK owner: default::Person;
      CREATE REQUIRED PROPERTY data_class: std::str;
      CREATE PROPERTY expires_at: std::datetime;
      CREATE REQUIRED PROPERTY mode: default::GrantMode;
      CREATE PROPERTY revoked_at: std::datetime;
      CREATE ACCESS POLICY grantee_reads
          ALLOW SELECT USING ((GLOBAL default::current_person_id ?= .grantee.id));
      CREATE ACCESS POLICY owner_all
          ALLOW ALL USING ((GLOBAL default::current_person_id ?= .owner.id));
      CREATE INDEX ON ((.owner, .grantee, .data_class));
      CREATE LINK supersedes: default::ConsentGrant;
      CREATE REQUIRED PROPERTY created_at: std::datetime {
          SET default := (std::datetime_of_statement());
      };
      CREATE PROPERTY max_disclosure: default::Disclosure;
      CREATE PROPERTY revocation_reason: std::str;
  };
  CREATE TYPE default::TierAccess {
      CREATE ACCESS POLICY superadmin_writes
          ALLOW UPDATE, DELETE, INSERT USING (((GLOBAL default::current_person).is_superadmin ?? false));
      CREATE ACCESS POLICY anyone_reads
          ALLOW SELECT USING (EXISTS (GLOBAL default::current_person_id));
      CREATE REQUIRED PROPERTY data_class: std::str;
      CREATE REQUIRED PROPERTY tier: default::Tier;
      CREATE CONSTRAINT std::exclusive ON ((.tier, .data_class));
  };
  CREATE TYPE default::Ask {
      CREATE REQUIRED LINK asker: default::Person;
      CREATE ACCESS POLICY asker_creates
          ALLOW INSERT USING ((GLOBAL default::current_person_id ?= .asker.id));
      CREATE ACCESS POLICY asker_reads
          ALLOW SELECT USING ((GLOBAL default::current_person_id ?= .asker.id));
      CREATE REQUIRED LINK responder: default::Person;
      CREATE ACCESS POLICY responder_all
          ALLOW ALL USING ((GLOBAL default::current_person_id ?= .responder.id));
      CREATE REQUIRED PROPERTY status: default::AskStatus {
          SET default := (default::AskStatus.pending);
      };
      CREATE INDEX ON ((.asker, .status));
      CREATE INDEX ON ((.responder, .status));
      CREATE LINK consent_basis: default::ConsentGrant;
      CREATE PROPERTY answer: std::json;
      CREATE PROPERTY backing_count: std::int32;
      CREATE REQUIRED PROPERTY created_at: std::datetime {
          SET default := (std::datetime_of_statement());
      };
      CREATE REQUIRED PROPERTY data_class: std::str;
      CREATE PROPERTY decided_at: std::datetime;
      CREATE PROPERTY disclosure_ceiling: default::Disclosure;
      CREATE PROPERTY expires_at: std::datetime;
      CREATE REQUIRED PROPERTY query_type: std::str;
      CREATE REQUIRED PROPERTY question: std::str;
  };
  CREATE ABSTRACT TYPE default::Owned {
      CREATE REQUIRED LINK owner: default::Person;
      CREATE REQUIRED PROPERTY created_at: std::datetime {
          SET default := (std::datetime_of_statement());
      };
      CREATE REQUIRED PROPERTY data_class: std::str;
      CREATE REQUIRED PROPERTY sensitive: std::bool {
          SET default := false;
      };
      CREATE PROPERTY updated_at: std::datetime;
      CREATE ACCESS POLICY auto_grant_reads
          ALLOW SELECT USING (EXISTS ((SELECT
              default::ConsentGrant
          FILTER
              ((((((.owner = __subject__.owner) AND (.grantee.id = GLOBAL default::current_person_id)) AND (.data_class = __subject__.data_class)) AND (.mode = default::GrantMode.auto)) AND NOT (EXISTS (.revoked_at))) AND ((.expires_at > std::datetime_of_statement()) ?? true))
          )));
      CREATE ACCESS POLICY blocks
          DENY SELECT USING (EXISTS ((SELECT
              default::ConsentGrant
          FILTER
              (((((.owner = __subject__.owner) AND (.grantee.id = GLOBAL default::current_person_id)) AND (.mode = default::GrantMode.block)) AND NOT (EXISTS (.revoked_at))) AND ((.data_class = __subject__.data_class) OR (.data_class = '*')))
          )));
      CREATE ACCESS POLICY owner_all
          ALLOW ALL USING ((GLOBAL default::current_person_id ?= .owner.id));
      CREATE INDEX ON ((.owner, .data_class));
  };
  CREATE TYPE default::Place {
      CREATE ACCESS POLICY signed_in_reads
          ALLOW SELECT USING (EXISTS (GLOBAL default::current_person_id));
      CREATE ACCESS POLICY signed_in_writes
          ALLOW UPDATE, INSERT USING (EXISTS (GLOBAL default::current_person_id));
      CREATE PROPERTY provider: std::str;
      CREATE PROPERTY provider_id: std::str;
      CREATE CONSTRAINT std::exclusive ON ((.provider, .provider_id));
      CREATE PROPERTY city: std::str;
      CREATE PROPERTY country: std::str;
      CREATE INDEX ON ((.city, .country));
      CREATE REQUIRED PROPERTY created_at: std::datetime {
          SET default := (std::datetime_of_statement());
      };
      CREATE REQUIRED PROPERTY lat: std::float64;
      CREATE REQUIRED PROPERTY lng: std::float64;
      CREATE REQUIRED PROPERTY name: std::str;
      CREATE PROPERTY region: std::str;
  };
  CREATE TYPE default::Encounter EXTENDING default::Owned {
      ALTER PROPERTY data_class {
          SET default := 'encounter';
          SET OWNED;
          SET REQUIRED;
          SET TYPE std::str;
      };
      CREATE REQUIRED LINK place: default::Place;
      CREATE REQUIRED LINK with_person: default::Person;
      CREATE REQUIRED PROPERTY day: std::cal::local_date;
      CREATE CONSTRAINT std::exclusive ON ((.owner, .with_person, .day, .place));
      CREATE REQUIRED PROPERTY first_seen: std::datetime;
      CREATE REQUIRED PROPERTY last_seen: std::datetime;
  };
  CREATE TYPE default::JobRecord EXTENDING default::Owned {
      ALTER PROPERTY data_class {
          SET default := 'job';
          SET OWNED;
          SET REQUIRED;
          SET TYPE std::str;
      };
      CREATE REQUIRED PROPERTY state: default::JobState;
      CREATE INDEX ON ((.owner, .state));
      CREATE LINK subject: default::Owned;
      CREATE PROPERTY attempt: std::int16 {
          SET default := 0;
      };
      CREATE PROPERTY completed_at: std::datetime;
      CREATE PROPERTY error: std::str;
      CREATE REQUIRED PROPERTY name: std::str;
      CREATE PROPERTY pgboss_id: std::uuid;
      CREATE PROPERTY started_at: std::datetime;
  };
  CREATE TYPE default::MemoryItem EXTENDING default::Owned {
      ALTER PROPERTY data_class {
          SET default := 'memory';
          SET OWNED;
          SET REQUIRED;
          SET TYPE std::str;
      };
      CREATE REQUIRED PROPERTY source: std::str;
      CREATE REQUIRED PROPERTY source_id: std::str;
      CREATE CONSTRAINT std::exclusive ON ((.owner, .source, .source_id));
      CREATE REQUIRED PROPERTY occurred_at: std::datetime;
      CREATE INDEX ON ((.owner, .occurred_at));
      CREATE PROPERTY embedding: default::Embedding;
      CREATE INDEX ext::pgvector::hnsw_cosine(m := 16, ef_construction := 128) ON (.embedding);
      CREATE LINK place: default::Place;
      CREATE PROPERTY body: std::str;
      CREATE PROPERTY embedded_at: std::datetime;
      CREATE PROPERTY embedding_model: std::str;
      CREATE REQUIRED PROPERTY kind: std::str;
      CREATE PROPERTY title: std::str;
  };
  CREATE TYPE default::Position EXTENDING default::Owned {
      ALTER PROPERTY data_class {
          SET default := 'location';
          SET OWNED;
          SET REQUIRED;
          SET TYPE std::str;
      };
      ALTER PROPERTY sensitive {
          SET default := true;
          SET OWNED;
          SET REQUIRED;
          SET TYPE std::bool;
      };
      CREATE REQUIRED PROPERTY at: std::datetime;
      CREATE INDEX ON ((.owner, .at));
      CREATE LINK place: default::Place;
      CREATE PROPERTY accuracy_m: std::float32;
      CREATE PROPERTY device_id: std::str;
      CREATE REQUIRED PROPERTY lat: std::float64;
      CREATE REQUIRED PROPERTY lng: std::float64;
      CREATE PROPERTY source: std::str;
      CREATE PROPERTY speed_mps: std::float32;
  };
  CREATE TYPE default::Presence EXTENDING default::Owned {
      ALTER PROPERTY data_class {
          SET default := 'presence';
          SET OWNED;
          SET REQUIRED;
          SET TYPE std::str;
      };
      CREATE REQUIRED LINK place: default::Place;
      CREATE REQUIRED PROPERTY day: std::cal::local_date;
      CREATE CONSTRAINT std::exclusive ON ((.owner, .day, .place));
      CREATE INDEX ON ((.owner, .day));
      CREATE REQUIRED PROPERTY first_seen: std::datetime;
      CREATE REQUIRED PROPERTY last_seen: std::datetime;
      CREATE REQUIRED PROPERTY sample_count: std::int32 {
          SET default := 1;
      };
  };
  CREATE TYPE default::Relationship {
      CREATE REQUIRED LINK other: default::Person;
      CREATE ACCESS POLICY other_reads
          ALLOW SELECT USING ((GLOBAL default::current_person_id ?= .other.id));
      CREATE REQUIRED LINK owner: default::Person;
      CREATE ACCESS POLICY owner_all
          ALLOW ALL USING ((GLOBAL default::current_person_id ?= .owner.id));
      CREATE CONSTRAINT std::exclusive ON ((.owner, .other));
      CREATE REQUIRED PROPERTY tier: default::Tier;
      CREATE REQUIRED PROPERTY created_at: std::datetime {
          SET default := (std::datetime_of_statement());
      };
  };
  ALTER TYPE default::Owned {
      CREATE ACCESS POLICY tier_default_reads
          ALLOW SELECT USING ((NOT (.sensitive) AND EXISTS ((SELECT
              default::TierAccess
          FILTER
              ((.data_class = __subject__.data_class) AND (.tier <= ((SELECT
                  default::Relationship
              FILTER
                  ((.owner = __subject__.owner) AND (.other.id = GLOBAL default::current_person_id))
              )).tier))
          ))));
  };
};
