import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integration tests (see docs/quality.md).`);
  return value;
}

const quoteIdent = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** Recreates the schema, applies every migration as the owner and checks the app role. */
export default async function setup() {
  const appUrl = required("TEST_DATABASE_URL");
  const ownerUrl = required("TEST_DATABASE_MIGRATION_URL");
  const appRole = quoteIdent(decodeURIComponent(new URL(appUrl).username));

  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  try {
    await owner.query("drop schema if exists drizzle cascade");
    await owner.query("drop schema if exists public cascade");
    await owner.query("create schema public");
    await owner.query(`grant usage on schema public to ${appRole}`);
    await owner.query(`alter default privileges in schema public grant select, insert, update, delete on tables to ${appRole}`);
    await migrate(drizzle({ client: owner }), { migrationsFolder: "./drizzle" });
  } finally {
    await owner.end();
  }

  const app = new Client({ connectionString: appUrl });
  await app.connect();
  try {
    const { rows } = await app.query("select rolsuper, rolbypassrls from pg_roles where rolname = current_user");
    if (rows[0]?.rolsuper || rows[0]?.rolbypassrls) {
      throw new Error("TEST_DATABASE_URL must use a role without SUPERUSER/BYPASSRLS, otherwise RLS is not exercised.");
    }
  } finally {
    await app.end();
  }
}
