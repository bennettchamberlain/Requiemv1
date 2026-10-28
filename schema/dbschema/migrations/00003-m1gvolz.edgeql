CREATE MIGRATION m1gvolzo5ooyehptpac6bdzsstryv24s66b4objtyatygxacmm6lsq
    ONTO m1fjm6qbvwtkeu3pxeu3skagsbusnqyfgmhvxrzsf7zmwfnieitd2q
{
  ALTER TYPE default::Person {
      CREATE ACCESS POLICY service_reads
          ALLOW SELECT USING ((GLOBAL default::service_mode ?? false));
  };
};
