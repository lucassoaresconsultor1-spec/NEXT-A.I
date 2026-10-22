// Backup restore check (m41).
//   tsx tools/backup/fingerprint.ts collect <ENV_VAR_WITH_URL> <out.json>
//   tsx tools/backup/fingerprint.ts compare <source.json> <restored.json>
// "collect" needs a role with BYPASSRLS (the backup role): under FORCE ROW LEVEL
// SECURITY any other role would count zero tenant rows, so it refuses to run.
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { compareFingerprints, type DbFingerprint } from "../../src/lib/db-fingerprint";

async function collect(url: string): Promise<DbFingerprint> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const role = await client.query<{ bypass: boolean; superuser: boolean }>("select rolbypassrls as bypass, rolsuper as superuser from pg_roles where rolname = current_user");
    if (!role.rows[0]?.bypass && !role.rows[0]?.superuser) throw new Error("O papel desta conexão não tem BYPASSRLS: as contagens das tabelas com RLS sairiam erradas.");
    const tables = await client.query<{ name: string; rls: boolean; force: boolean; policies: string }>(
      `select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force,
         (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)::text as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
    );
    const fingerprint: DbFingerprint = { migrations: 0, tables: {} };
    for (const table of tables.rows) {
      const rows = await client.query<{ count: string }>(`select count(*)::text as count from public.${client.escapeIdentifier(table.name)}`);
      fingerprint.tables[table.name] = { rows: Number(rows.rows[0].count), rls: table.rls, forceRls: table.force, policies: Number(table.policies) };
    }
    const migrations = await client.query<{ count: string }>("select count(*)::text as count from drizzle.__drizzle_migrations").catch(() => ({ rows: [{ count: "0" }] }));
    fingerprint.migrations = Number(migrations.rows[0].count);
    return fingerprint;
  } finally {
    await client.end();
  }
}

async function main() {
  const [command, first, second] = process.argv.slice(2);
  if (command === "collect" && first && second) {
    const url = process.env[first];
    if (!url) throw new Error(`Variável ${first} não definida.`);
    writeFileSync(second, JSON.stringify(await collect(url), null, 2));
    return;
  }
  if (command === "compare" && first && second) {
    const problems = compareFingerprints(JSON.parse(readFileSync(first, "utf8")), JSON.parse(readFileSync(second, "utf8")));
    if (problems.length) {
      process.stderr.write(`Restauração DIVERGENTE:\n- ${problems.join("\n- ")}\n`);
      process.exit(1);
    }
    process.stdout.write("Restauração verificada: mesmas tabelas, linhas, RLS, políticas e migrações.\n");
    return;
  }
  throw new Error("Uso: fingerprint.ts collect <VAR> <saida.json> | compare <origem.json> <restaurado.json>");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
