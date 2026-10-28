CREATE MIGRATION m1hkmuqc542xo4zqhk24rhcvnjaje6ikk6qdilc3lpkzdmy2v4rjaa
    ONTO m1wgyxjbmwqvw55ipeyx2eqzd663mgmsypz5pjzky3vtbsk6jqelua
{
  CREATE SCALAR TYPE default::EdgeKind EXTENDING enum<part_of, supports, pursues, practices, prefers, dislikes, located_at, knows, related>;
  CREATE SCALAR TYPE default::EdgeStatus EXTENDING enum<proposed, verified, rejected>;
  CREATE SCALAR TYPE default::EntityKind EXTENDING enum<person, organization, place, object, concept, event>;
  CREATE SCALAR TYPE default::PursuitStatus EXTENDING enum<active, paused, done, dropped>;
  CREATE TYPE default::Edge EXTENDING default::Owned {
      ALTER PROPERTY data_class {
          SET default := 'graph';
          SET OWNED;
          SET REQUIRED;
          SET TYPE std::str;
      };
      CREATE REQUIRED PROPERTY kind: default::EdgeKind;
      CREATE REQUIRED PROPERTY status: default::EdgeStatus {
          SET default := (default::EdgeStatus.proposed);
      };
      CREATE INDEX ON ((.owner, .status));
      CREATE PROPERTY evidence: std::str;
  };
  CREATE ABSTRACT TYPE default::Thing EXTENDING default::Owned {
      CREATE LINK parent: default::Thing {
          ON TARGET DELETE ALLOW;
      };
      CREATE MULTI LINK parts := (.<parent[IS default::Thing]);
      CREATE REQUIRED PROPERTY name: std::str;
      CREATE PROPERTY summary: std::str;
      CREATE INDEX ON ((.owner, .name));
  };
  ALTER TYPE default::Edge {
      CREATE REQUIRED LINK source: default::Thing {
          ON TARGET DELETE DELETE SOURCE;
      };
      CREATE REQUIRED LINK target: default::Thing {
          ON TARGET DELETE DELETE SOURCE;
      };
      CREATE CONSTRAINT std::exclusive ON ((.owner, .source, .target, .kind));
  };
  CREATE TYPE default::Entity EXTENDING default::Thing {
      ALTER PROPERTY data_class {
          SET default := 'entity';
          SET OWNED;
          SET REQUIRED;
          SET TYPE std::str;
      };
      CREATE REQUIRED PROPERTY kind: default::EntityKind {
          SET default := (default::EntityKind.concept);
      };
      CREATE CONSTRAINT std::exclusive ON ((.owner, .kind, .name));
  };
  CREATE TYPE default::Goal EXTENDING default::Thing {
      ALTER PROPERTY data_class {
          SET default := 'goal';
          SET OWNED;
          SET REQUIRED;
          SET TYPE std::str;
      };
      CREATE CONSTRAINT std::exclusive ON ((.owner, .name));
      CREATE REQUIRED PROPERTY status: default::PursuitStatus {
          SET default := (default::PursuitStatus.active);
      };
      CREATE PROPERTY target_on: std::cal::local_date;
      CREATE PROPERTY why: std::str;
  };
  CREATE TYPE default::Habit EXTENDING default::Thing {
      ALTER PROPERTY data_class {
          SET default := 'habit';
          SET OWNED;
          SET REQUIRED;
          SET TYPE std::str;
      };
      CREATE CONSTRAINT std::exclusive ON ((.owner, .name));
      CREATE REQUIRED PROPERTY active: std::bool {
          SET default := true;
      };
      CREATE PROPERTY cadence: std::str;
      CREATE PROPERTY cue: std::str;
      CREATE PROPERTY routine: std::str;
  };
  ALTER TYPE default::MemoryItem {
      CREATE MULTI LINK about: default::Thing;
  };
  CREATE TYPE default::Project EXTENDING default::Thing {
      ALTER PROPERTY data_class {
          SET default := 'project';
          SET OWNED;
          SET REQUIRED;
          SET TYPE std::str;
      };
      CREATE CONSTRAINT std::exclusive ON ((.owner, .name));
      CREATE PROPERTY outcome: std::str;
      CREATE PROPERTY started_on: std::cal::local_date;
      CREATE REQUIRED PROPERTY status: default::PursuitStatus {
          SET default := (default::PursuitStatus.active);
      };
      CREATE PROPERTY target_on: std::cal::local_date;
  };
};
