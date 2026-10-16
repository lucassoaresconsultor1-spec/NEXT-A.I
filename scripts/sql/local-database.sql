-- Local development/test only. Run as a PostgreSQL superuser:
--   psql -v db=varejo -v owner_password=... -v app_password=... -f scripts/sql/local-database.sql
-- Creates two roles: one that owns the schema and runs migrations, and one,
-- without SUPERUSER/BYPASSRLS, that the application uses so row-level
-- security applies to every query.
SELECT 'CREATE ROLE varejo_owner LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'varejo_owner') \gexec
SELECT 'CREATE ROLE varejo_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'varejo_app') \gexec
ALTER ROLE varejo_owner PASSWORD :'owner_password';
ALTER ROLE varejo_app PASSWORD :'app_password';

SELECT format('CREATE DATABASE %I OWNER varejo_owner', :'db')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db') \gexec

\connect :db
ALTER SCHEMA public OWNER TO varejo_owner;
GRANT USAGE ON SCHEMA public TO varejo_app;
-- Tables created later by migrations (as varejo_owner) are granted automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE varejo_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO varejo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE varejo_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO varejo_app;
