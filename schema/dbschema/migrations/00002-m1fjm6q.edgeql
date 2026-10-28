CREATE MIGRATION m1fjm6qbvwtkeu3pxeu3skagsbusnqyfgmhvxrzsf7zmwfnieitd2q
    ONTO m1rpq3dxz4gp7xivosikwpjljy464uephk666y662wk2gvknpkiq2a
{
  CREATE GLOBAL default::service_mode -> std::bool;
  CREATE TYPE default::LocalCredential {
      CREATE ACCESS POLICY service_only
          ALLOW ALL USING ((GLOBAL default::service_mode ?? false));
      CREATE REQUIRED LINK person: default::Person {
          CREATE CONSTRAINT std::exclusive;
      };
      CREATE REQUIRED PROPERTY algorithm: std::str {
          SET default := 'pbkdf2-sha256';
      };
      CREATE REQUIRED PROPERTY created_at: std::datetime {
          SET default := (std::datetime_of_statement());
      };
      CREATE REQUIRED PROPERTY password_hash: std::str;
      CREATE PROPERTY rotated_at: std::datetime;
  };
};
