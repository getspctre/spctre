-- Creates the spctre_app role for RLS enforcement.
-- Mounted into the Postgres container as an init script.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spctre_app') THEN
    CREATE ROLE spctre_app LOGIN PASSWORD 'spctre_app_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
GRANT CONNECT ON DATABASE spctre TO spctre_app;
