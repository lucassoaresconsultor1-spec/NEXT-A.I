import { describe, expect, it } from "vitest";
import { compareFingerprints, type DbFingerprint } from "./db-fingerprint";

const base: DbFingerprint = {
  migrations: 54,
  tables: { sales: { rows: 10, rls: true, forceRls: true, policies: 1 }, users: { rows: 3, rls: false, forceRls: false, policies: 0 } },
};

describe("compareFingerprints", () => {
  it("accepts an identical restore and reports every difference otherwise", () => {
    expect(compareFingerprints(base, structuredClone(base))).toEqual([]);
    const broken: DbFingerprint = { migrations: 53, tables: { sales: { rows: 9, rls: true, forceRls: false, policies: 0 }, extra: { rows: 0, rls: false, forceRls: false, policies: 0 } } };
    expect(compareFingerprints(base, broken)).toEqual([
      "migrações: 54 na origem, 53 na restauração",
      "sales: 10 linhas na origem, 9 na restauração",
      "sales: RLS diferente da origem",
      "sales: 1 políticas na origem, 0 na restauração",
      "tabela ausente: users",
      "tabela a mais na restauração: extra",
    ]);
  });
});
