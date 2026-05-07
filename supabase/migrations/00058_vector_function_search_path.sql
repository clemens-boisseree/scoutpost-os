-- 00058_vector_function_search_path.sql
-- After moving pgvector into the `extensions` schema, SECURITY DEFINER
-- functions that perform vector distance comparisons must include
-- `extensions` in their execution search_path. Otherwise operators such as
-- `<=>` are invisible at runtime even when both operands are vector values.

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.prosrc LIKE '%<=>%'
        OR EXISTS (
          SELECT 1
          FROM unnest(p.proargtypes) AS arg_type_oid
          JOIN pg_type t ON t.oid = arg_type_oid
          WHERE t.typname = 'vector'
        )
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public, extensions, pg_temp',
      fn.schema_name,
      fn.function_name,
      fn.arguments
    );
  END LOOP;
END $$;
