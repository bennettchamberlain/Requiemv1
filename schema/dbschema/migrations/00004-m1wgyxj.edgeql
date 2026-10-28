CREATE MIGRATION m1wgyxjbmwqvw55ipeyx2eqzd663mgmsypz5pjzky3vtbsk6jqelua
    ONTO m1gvolzo5ooyehptpac6bdzsstryv24s66b4objtyatygxacmm6lsq
{
  CREATE TYPE default::ApiKey {
      CREATE REQUIRED LINK person: default::Person;
      CREATE ACCESS POLICY owner_creates
          ALLOW INSERT USING ((GLOBAL default::current_person_id ?= .person.id));
      CREATE ACCESS POLICY owner_manages
          ALLOW SELECT, UPDATE, DELETE USING ((GLOBAL default::current_person_id ?= .person.id));
      CREATE ACCESS POLICY service_all
          ALLOW ALL USING ((GLOBAL default::service_mode ?? false));
      CREATE INDEX ON (.person);
      CREATE REQUIRED PROPERTY created_at: std::datetime {
          SET default := (std::datetime_of_statement());
      };
      CREATE REQUIRED PROPERTY label: std::str;
      CREATE PROPERTY last_used_at: std::datetime;
      CREATE REQUIRED PROPERTY prefix: std::str;
      CREATE PROPERTY revoked_at: std::datetime;
      CREATE REQUIRED PROPERTY scopes: array<std::str> {
          SET default := (['memory', 'chat']);
      };
      CREATE REQUIRED PROPERTY token_hash: std::str {
          CREATE CONSTRAINT std::exclusive;
      };
  };
  CREATE TYPE default::ChatMessage EXTENDING default::Owned {
      ALTER PROPERTY data_class {
          SET default := 'chat';
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
      CREATE REQUIRED PROPERTY seq: std::int32;
      CREATE REQUIRED PROPERTY content: std::str;
      CREATE PROPERTY model: std::str;
      CREATE REQUIRED PROPERTY role: std::str;
      CREATE PROPERTY tool_calls: std::json;
  };
  CREATE TYPE default::ChatSession EXTENDING default::Owned {
      ALTER PROPERTY data_class {
          SET default := 'chat';
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
      CREATE PROPERTY last_message_at: std::datetime;
      CREATE INDEX ON ((.owner, .last_message_at));
      CREATE REQUIRED PROPERTY agent_session_key: std::str {
          SET default := (<std::str>std::uuid_generate_v4());
      };
      CREATE PROPERTY title: std::str;
  };
  ALTER TYPE default::ChatMessage {
      CREATE REQUIRED LINK session: default::ChatSession {
          ON TARGET DELETE DELETE SOURCE;
      };
      CREATE CONSTRAINT std::exclusive ON ((.session, .seq));
      CREATE INDEX ON ((.session, .seq));
  };
  ALTER TYPE default::ChatSession {
      CREATE MULTI LINK messages := (.<session[IS default::ChatMessage]);
  };
};
