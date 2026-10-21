import { randomInt } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLogs, customers } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { findSystemRole } from "@/server/authz/system-roles";
import { createCustomer, getCustomer, listCustomers, loadActiveCustomer, setCustomerActive, updateCustomer } from "@/server/customers/service";
import { customerFiltersSchema, maskCpf } from "@/server/customers/schemas";
import { addMemberFixture, createCustomerFixture, createOrganizationFixture, uniqueSuffix } from "./fixtures";

const filters = (values: Record<string, unknown> = {}) => customerFiltersSchema.parse(values);

/** Fresh valid CPF (11 digits). */
function randomCpf(): string {
  const base = Array.from({ length: 9 }, () => randomInt(10));
  if (base.every((digit) => digit === base[0])) return randomCpf();
  const digit = (digits: number[]) => {
    const sum = digits.reduce((total, value, index) => total + value * (digits.length + 1 - index), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const first = digit(base);
  return [...base, first, digit([...base, first])].join("");
}

const formatted = (cpf: string) => `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;

async function stored(organizationId: string, id: string) {
  const [row] = await withScope({ organizationId }, (tx) =>
    tx.select().from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, id))),
  );
  return row ?? null;
}

async function trail(organizationId: string, id: string) {
  return withScope({ organizationId }, (tx) =>
    tx
      .select({ action: auditLogs.action, changes: auditLogs.changes })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityId, id)))
      .orderBy(asc(auditLogs.createdAt)),
  );
}

describe("customers service: lifecycle and audit", () => {
  it("creates, updates, deactivates and reactivates with masked personal data in the audit trail", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const cpf = randomCpf();
    const { id } = await createCustomer(owner, {
      name: "Ana Souza",
      document: formatted(cpf),
      email: "Ana@Exemplo.com",
      phone: "(21) 98765-4321",
      marketingConsent: "on",
    });
    const row = await stored(organizationId, id);
    expect(row).toMatchObject({ document: cpf, email: "ana@exemplo.com", phone: "21987654321", marketingConsent: true, isActive: true });
    expect(row?.consentAt).toBeInstanceOf(Date);

    await updateCustomer(owner, id, { name: "Ana Souza Lima", document: cpf, email: "", phone: "21987654321" });
    expect(await stored(organizationId, id)).toMatchObject({ name: "Ana Souza Lima", email: null, marketingConsent: false, consentAt: null });

    await setCustomerActive(owner, id, false);
    await setCustomerActive(owner, id, true);

    const entries = await trail(organizationId, id);
    expect(entries.map((entry) => entry.action)).toEqual(["customer.created", "customer.updated", "customer.status_changed", "customer.status_changed"]);
    expect(entries[0].changes).toEqual({
      name: "Ana Souza",
      document: maskCpf(cpf),
      email: "a***@exemplo.com",
      phone: "(21) *****-4321",
      marketingConsent: true,
    });
    expect(entries[1].changes).toEqual({
      name: { from: "Ana Souza", to: "Ana Souza Lima" },
      email: { from: "a***@exemplo.com", to: null },
      marketingConsent: { from: true, to: false },
    });
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(cpf);
    expect(serialized).not.toContain("ana@exemplo.com");
    expect(serialized).not.toContain("21987654321");
  });

  it("persists and audits changes whose masked values are identical", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const cpf = randomCpf();
    // Same six middle digits, different first three: a valid CPF with an identical mask.
    let otherCpf = randomCpf();
    while (maskCpf(otherCpf) !== maskCpf(cpf) || otherCpf === cpf) {
      const base = `${String(randomInt(1000)).padStart(3, "0")}${cpf.slice(3, 9)}`;
      const digits = base.split("").map(Number);
      const check = (values: number[]) => {
        const rest = (values.reduce((total, value, index) => total + value * (values.length + 1 - index), 0) * 10) % 11;
        return rest === 10 ? 0 : rest;
      };
      const first = check(digits);
      otherCpf = `${base}${first}${check([...digits, first])}`;
    }
    const base = { name: "Ana Souza", document: cpf, email: "ana@exemplo.com", phone: "21987654321" };
    const { id } = await createCustomer(owner, base);

    await updateCustomer(owner, id, { ...base, email: "alan@exemplo.com" });
    await updateCustomer(owner, id, { ...base, email: "alan@exemplo.com", phone: "21912344321" });
    await updateCustomer(owner, id, { ...base, email: "alan@exemplo.com", phone: "21912344321", document: otherCpf });
    expect(await stored(organizationId, id)).toMatchObject({ email: "alan@exemplo.com", phone: "21912344321", document: otherCpf });

    const updates = (await trail(organizationId, id)).filter((entry) => entry.action === "customer.updated");
    expect(updates.map((entry) => entry.changes)).toEqual([
      { email: { from: "a***@exemplo.com", to: "a***@exemplo.com" } },
      { phone: { from: "(21) *****-4321", to: "(21) *****-4321" } },
      { document: { from: maskCpf(cpf), to: maskCpf(otherCpf) } },
    ]);
    const serialized = JSON.stringify(updates);
    for (const value of [cpf, otherCpf, "alan@exemplo.com", "ana@exemplo.com", "21912344321", "21987654321"]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("refuses a repeated CPF in the same organization but allows it in another one", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const cpf = randomCpf();
    await createCustomer(a.owner, { name: "Primeiro", document: cpf });
    await expect(createCustomer(a.owner, { name: "Segundo", document: formatted(cpf) })).rejects.toMatchObject({
      code: "conflict",
      fieldErrors: { document: expect.any(Array) },
    });
    await expect(createCustomer(b.owner, { name: "Outra empresa", document: cpf })).resolves.toHaveProperty("id");
  });

  it("validates inside the service", async () => {
    const { owner } = await createOrganizationFixture();
    await expect(createCustomer(owner, { name: "Ana", document: "111.111.111-11" })).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { document: expect.any(Array) },
    });
    await expect(createCustomer(owner, { name: "A" })).rejects.toMatchObject({ code: "invalid", fieldErrors: { name: expect.any(Array) } });
  });
});

describe("customers service: CPF visibility", () => {
  it("masks the CPF without customers.documents.read and keeps it when the mask is sent back", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const cpf = randomCpf();
    const id = await createCustomerFixture(organizationId, { name: "Bruno Lima", document: cpf });
    const seller = await addMemberFixture(organizationId, { roleKey: "salesperson" });
    const manager = await addMemberFixture(organizationId, { roleKey: "store_manager" });

    expect(await getCustomer(seller.context, id)).toMatchObject({ document: maskCpf(cpf), documentMasked: true });
    expect((await listCustomers(seller.context, filters())).rows[0]).toMatchObject({ document: maskCpf(cpf), documentMasked: true });
    expect(await getCustomer(manager.context, id)).toMatchObject({ document: cpf, documentMasked: false });
    expect(await getCustomer(owner, id)).toMatchObject({ document: cpf });

    await updateCustomer(seller.context, id, { name: "Bruno Lima Neto", document: maskCpf(cpf) });
    expect(await stored(organizationId, id)).toMatchObject({ name: "Bruno Lima Neto", document: cpf });
    const entries = await trail(organizationId, id);
    expect(entries.at(-1)?.changes).toEqual({ name: { from: "Bruno Lima", to: "Bruno Lima Neto" } });

    await expect(updateCustomer(seller.context, id, { name: "Bruno", document: "" })).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { document: expect.any(Array) },
    });
    const replacement = randomCpf();
    await updateCustomer(seller.context, id, { name: "Bruno Lima Neto", document: replacement });
    expect((await stored(organizationId, id))?.document).toBe(replacement);
  });
});

describe("customers service: search and pagination", () => {
  it("finds by part of the name, exact CPF, e-mail and phone, filters by status and paginates", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const tag = uniqueSuffix();
    const cpf = randomCpf();
    const target = await createCustomerFixture(organizationId, { name: `Carla Mendes ${tag}`, document: cpf, email: `carla-${tag}@exemplo.com`, phone: "11987650000" });
    const inactive = await createCustomerFixture(organizationId, { name: `Inativo ${tag}`, isActive: false });
    for (let index = 0; index < 25; index += 1) await createCustomerFixture(organizationId, { name: `Lote ${String(index).padStart(2, "0")}` });

    const ids = async (q: string) => (await listCustomers(owner, filters({ q }))).rows.map((row) => row.id);
    expect(await ids(`carla mendes ${tag}`.toUpperCase())).toEqual([target]);
    expect(await ids(cpf)).toEqual([target]);
    expect(await ids(formatted(cpf))).toEqual([target]);
    expect(await ids(`CARLA-${tag}@exemplo.com`)).toEqual([target]);
    expect(await ids("(11) 98765-0000")).toEqual([target]);

    expect((await listCustomers(owner, filters({ status: "inactive" }))).rows.map((row) => row.id)).toEqual([inactive]);
    const first = await listCustomers(owner, filters());
    expect(first).toMatchObject({ total: 27, page: 1, pageCount: 2 });
    expect(first.rows).toHaveLength(25);
    expect((await listCustomers(owner, filters({ page: "2" }))).rows).toHaveLength(2);
    expect((await listCustomers(owner, filters({ q: "L" }))).total).toBe(27);
  });
});

describe("customers service: access and isolation", () => {
  it("enforces permissions", async () => {
    const { organizationId } = await createOrganizationFixture();
    const supervisor = await addMemberFixture(organizationId, { roleKey: "supervisor" });
    await expect(createCustomer(supervisor.context, { name: "Sem permissão" })).rejects.toMatchObject({ code: "forbidden" });
    expect(findSystemRole("finance")?.permissions).toEqual(expect.arrayContaining(["customers.read", "customers.documents.read"]));
    expect(findSystemRole("regional_manager")?.permissions).toContain("customers.read");
    expect(findSystemRole("regional_manager")?.permissions).not.toContain("customers.manage");
    expect(findSystemRole("store_manager")?.permissions).toEqual(expect.arrayContaining(["customers.read", "customers.manage", "customers.documents.read"]));
    expect(findSystemRole("supervisor")?.permissions).not.toContain("customers.manage");
    for (const key of ["salesperson", "cashier"]) {
      expect(findSystemRole(key)?.permissions).toEqual(expect.arrayContaining(["customers.read", "customers.manage"]));
      expect(findSystemRole(key)?.permissions).not.toContain("customers.documents.read");
    }
  });

  it("isolates organizations and exposes only active customers to other services", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const id = await createCustomerFixture(a.organizationId, { name: "Cliente da A" });
    const inactive = await createCustomerFixture(a.organizationId, { name: "Inativo da A", isActive: false });

    expect(await getCustomer(b.owner, id)).toBeNull();
    expect(await getCustomer(b.owner, "nao-e-uuid")).toBeNull();
    await expect(updateCustomer(b.owner, id, { name: "Invasão" })).rejects.toMatchObject({ code: "not_found" });
    await expect(setCustomerActive(b.owner, id, false)).rejects.toMatchObject({ code: "not_found" });
    expect((await listCustomers(b.owner, filters())).rows.map((row) => row.id)).not.toContain(id);
    const seenByB = await withScope({ organizationId: b.organizationId }, (tx) => tx.select({ id: customers.id }).from(customers));
    expect(seenByB.map((row) => row.id)).not.toContain(id);

    expect(await withScope({ organizationId: a.organizationId }, (tx) => loadActiveCustomer(tx, a.organizationId, id))).toEqual({ id, name: "Cliente da A" });
    expect(await withScope({ organizationId: a.organizationId }, (tx) => loadActiveCustomer(tx, a.organizationId, inactive))).toBeNull();
    expect(await withScope({ organizationId: b.organizationId }, (tx) => loadActiveCustomer(tx, b.organizationId, id))).toBeNull();
  });
});
