// Fingerprint of a database for backup restore checks (m41): what must survive a
// dump and restore unchanged. Pure comparison; collected by tools/backup/fingerprint.ts.

export interface DbFingerprint {
  migrations: number;
  tables: Record<string, { rows: number; rls: boolean; forceRls: boolean; policies: number }>;
}

/** Differences between the source and the restored database (empty = restore verified). */
export function compareFingerprints(source: DbFingerprint, restored: DbFingerprint): string[] {
  const problems: string[] = [];
  if (source.migrations !== restored.migrations) problems.push(`migrações: ${source.migrations} na origem, ${restored.migrations} na restauração`);
  for (const [name, table] of Object.entries(source.tables)) {
    const copy = restored.tables[name];
    if (!copy) {
      problems.push(`tabela ausente: ${name}`);
      continue;
    }
    if (copy.rows !== table.rows) problems.push(`${name}: ${table.rows} linhas na origem, ${copy.rows} na restauração`);
    if (copy.rls !== table.rls || copy.forceRls !== table.forceRls) problems.push(`${name}: RLS diferente da origem`);
    if (copy.policies !== table.policies) problems.push(`${name}: ${table.policies} políticas na origem, ${copy.policies} na restauração`);
  }
  for (const name of Object.keys(restored.tables)) if (!source.tables[name]) problems.push(`tabela a mais na restauração: ${name}`);
  return problems;
}
