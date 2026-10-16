import { randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { auditLogs, organizationMemberships, organizations, regions, roles, stores, users } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { formatCnpj } from "@/lib/documents";
import { auditFiltersSchema, listAuditLogs } from "@/server/audit/service";
import { loadTenantContext, type TenantContext } from "@/server/authz/context";
import { getOrganizationProfile, updateOrganizationProfile, type OrganizationProfileInput } from "@/server/organizations/service";
import {
  changeOrganizationPlan,
  listOrganizations,
  listPlans,
  platformFiltersSchema,
  setOrganizationStatus,
} from "@/server/platform/service";
import {
  addMemberFixture,
  contextFor,
  createOrganizationFixture,
  createRegionFixture,
  createStoreFixture,
  randomCnpj,
  uniqueEmail,
  uniqueSuffix,
} from "./fixtures";

const profileInput = (values: Partial<OrganizationProfileInput> = {}): OrganizationProfileInput => ({
  name: `Empresa ${uniqueSuffix()}`,
  timezone: "America/Sao_Paulo",
  ...values,
});

async function organizationRow(organizationId: string) {
  const [row] = await withScope({ organizationId }, (tx) =>
    tx
      .select({ name: organizations.name, document: organizations.document, planKey: organizations.planKey, status: organizations.status })
      .from(organizations)
      .where(eq(organizations.id, organizationId)),
  );
  return row;
}

async function organizationAudit(organizationId: string, action: string) {
  return withScope({ organizationId }, (tx) =>
    tx
      .select({ actorUserId: auditLogs.actorUserId, changes: auditLogs.changes, entityType: auditLogs.entityType })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.action, action)))
      .orderBy(asc(auditLogs.createdAt)),
  );
}

async function setPlan(organizationId: string, planKey: string) {
  await withScope({ organizationId }, (tx) => tx.update(organizations).set({ planKey }).where(eq(organizations.id, organizationId)));
}

async function createPlatformAdmin(values: { status?: "active" | "disabled" } = {}) {
  const id = randomUUID();
  await getDb()
    .insert(users)
    .values({ id, email: uniqueEmail("platform"), name: "Admin da Plataforma", passwordHash: "unused", isPlatformAdmin: true, status: values.status ?? "active" });
  return id;
}

// auditFiltersSchema needs the `page` key present (Zod 4 + bare transform), as the page passes it.
const auditFilters = (entityType: string) => auditFiltersSchema.parse({ entityType, page: undefined });

const platformFilters = (values: Record<string, unknown> = {}) => platformFiltersSchema.parse(values);

function sessionOf(context: TenantContext, organizationId: string) {
  return { id: `test-${randomUUID()}`, activeOrganizationId: organizationId, activeStoreId: null, expiresAt: new Date(Date.now() + 3_600_000), user: context.user };
}

describe("organization profile (Configurações)", () => {
  it("returns profile, plan and usage of the active organization only", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    await createStoreFixture(a.organizationId);
    const profile = await getOrganizationProfile(a.owner);
    expect(profile).toMatchObject({ id: a.organizationId, timezone: "America/Sao_Paulo", usage: { stores: 1, members: 1 } });
    expect(profile?.plan).toMatchObject({ key: "essencial", maxStores: 1 });
    expect(profile?.plan.features).toContain("pos");
    expect(profile?.id).not.toBe(b.organizationId);
  });

  it("updates business fields and records a field diff in the audit trail", async () => {
    const { organizationId, owner, ownerId } = await createOrganizationFixture();
    const before = await organizationRow(organizationId);
    const cnpj = randomCnpj();
    const input = profileInput({ name: "Rede Atualizada", legalName: "Rede Atualizada Ltda", document: formatCnpj(cnpj), timezone: "America/Manaus" });
    await expect(updateOrganizationProfile(owner, input)).resolves.toEqual({ changed: true });
    expect(await organizationRow(organizationId)).toMatchObject({ name: "Rede Atualizada", document: cnpj });
    const trail = await organizationAudit(organizationId, "organization.updated");
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ actorUserId: ownerId, entityType: "organization" });
    expect(trail[0].changes).toEqual({
      name: { from: before.name, to: "Rede Atualizada" },
      legalName: { from: null, to: "Rede Atualizada Ltda" },
      document: { from: null, to: cnpj },
      timezone: { from: "America/Sao_Paulo", to: "America/Manaus" },
    });
    // Same values again: nothing to write, no extra audit entry.
    await expect(updateOrganizationProfile(owner, { ...input, document: cnpj })).resolves.toEqual({ changed: false });
    expect(await organizationAudit(organizationId, "organization.updated")).toHaveLength(1);
  });

  it("never changes plan_key or status, even when extra fields are sent", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    await setPlan(organizationId, "rede");
    const sneaky = { ...profileInput(), planKey: "essencial", status: "suspended" } as unknown as OrganizationProfileInput;
    await updateOrganizationProfile(owner, sneaky);
    expect(await organizationRow(organizationId)).toMatchObject({ planKey: "rede", status: "active" });
  });

  it("rejects a CNPJ already used by another organization as a field conflict", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const cnpj = randomCnpj();
    await updateOrganizationProfile(a.owner, profileInput({ document: cnpj }));
    await expect(updateOrganizationProfile(b.owner, profileInput({ document: formatCnpj(cnpj) }))).rejects.toMatchObject({
      code: "conflict",
      fieldErrors: { document: expect.any(Array) },
    });
    expect((await organizationRow(b.organizationId)).document).toBeNull();
  });

  it("validates input inside the service", async () => {
    const { owner } = await createOrganizationFixture();
    await expect(updateOrganizationProfile(owner, profileInput({ name: "A" }))).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { name: expect.any(Array) },
    });
    await expect(updateOrganizationProfile(owner, profileInput({ document: "11.111.111/1111-11" }))).rejects.toMatchObject({
      fieldErrors: { document: expect.any(Array) },
    });
    await expect(
      updateOrganizationProfile(owner, profileInput({ timezone: "Europe/Lisbon" as OrganizationProfileInput["timezone"] })),
    ).rejects.toMatchObject({ fieldErrors: { timezone: expect.any(Array) } });
  });

  it("enforces permissions and organization-wide access in the service", async () => {
    const { organizationId } = await createOrganizationFixture();
    const regionId = await createRegionFixture(organizationId);
    const storeId = await createStoreFixture(organizationId, { regionId });
    const storeManager = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeId] });
    await expect(getOrganizationProfile(storeManager.context)).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateOrganizationProfile(storeManager.context, profileInput())).rejects.toMatchObject({ code: "forbidden" });

    const regional = await addMemberFixture(organizationId, { roleKey: "regional_manager", regionIds: [regionId] });
    const seen = await getOrganizationProfile(regional.context);
    expect(seen?.id).toBe(organizationId);
    expect(seen?.usage).toBeNull();
    await expect(updateOrganizationProfile(regional.context, profileInput())).rejects.toMatchObject({ code: "forbidden" });

    // Every permission, but only some stores: still not organization-wide.
    const scopedAdmin = await addMemberFixture(organizationId, { roleKey: "admin", storeAccess: "stores", storeIds: [storeId] });
    await expect(updateOrganizationProfile(scopedAdmin.context, profileInput())).rejects.toMatchObject({ code: "forbidden" });
    expect(await organizationAudit(organizationId, "organization.updated")).toHaveLength(0);
  });

  it("shows organization events in the audit list only to organization-wide members", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    await updateOrganizationProfile(owner, profileInput({ name: "Empresa Auditada" }));
    const filters = auditFilters("organization");
    const visible = await listAuditLogs(owner, filters);
    expect(visible.rows.map((row) => row.action)).toContain("organization.updated");
    const scopedAdmin = await addMemberFixture(organizationId, { roleKey: "admin", storeAccess: "stores", storeIds: [storeId] });
    expect((await listAuditLogs(scopedAdmin.context, filters)).total).toBe(0);
  });
});

describe("platform administration", () => {
  it("rejects a non-admin actor in every service function", async () => {
    const { organizationId, ownerId } = await createOrganizationFixture();
    const disabledAdmin = await createPlatformAdmin({ status: "disabled" });
    for (const actorId of [ownerId, disabledAdmin, randomUUID(), "not-a-uuid"]) {
      await expect(listOrganizations(actorId, platformFilters())).rejects.toMatchObject({ code: "forbidden" });
      await expect(listPlans(actorId)).rejects.toMatchObject({ code: "forbidden" });
      await expect(changeOrganizationPlan(actorId, organizationId, "rede")).rejects.toMatchObject({ code: "forbidden" });
      await expect(changeOrganizationPlan(actorId, "not-a-uuid", "rede")).rejects.toMatchObject({ code: "forbidden" });
      await expect(setOrganizationStatus(actorId, organizationId, "suspended")).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(await organizationRow(organizationId)).toMatchObject({ planKey: "essencial", status: "active" });
    expect(await organizationAudit(organizationId, "organization.plan_changed")).toHaveLength(0);
  });

  it("lists organizations with name/CNPJ search, status filter and no tenant data", async () => {
    const adminId = await createPlatformAdmin();
    const tag = uniqueSuffix();
    const { organizationId, owner } = await createOrganizationFixture(`Plataforma ${tag} Alfa`);
    const cnpj = randomCnpj();
    await updateOrganizationProfile(owner, profileInput({ name: `Plataforma ${tag} Alfa`, document: cnpj }));

    const byName = await listOrganizations(adminId, platformFilters({ q: tag }));
    expect(byName.total).toBe(1);
    expect(byName.rows[0]).toEqual({
      id: organizationId,
      name: `Plataforma ${tag} Alfa`,
      document: cnpj,
      planKey: "essencial",
      planName: "Essencial",
      status: "active",
      createdAt: expect.any(Date),
    });
    expect((await listOrganizations(adminId, platformFilters({ q: formatCnpj(cnpj) }))).rows.map((row) => row.id)).toEqual([organizationId]);
    expect((await listOrganizations(adminId, platformFilters({ q: tag, status: "suspended" }))).total).toBe(0);
    // LIKE wildcards are matched literally.
    expect((await listOrganizations(adminId, platformFilters({ q: "%" }))).rows.map((row) => row.id)).not.toContain(organizationId);
  });

  it("lists active plans from the smallest to the largest tier", async () => {
    const adminId = await createPlatformAdmin();
    const keys = (await listPlans(adminId)).map((plan) => plan.key).filter((key) => ["essencial", "profissional", "inteligencia", "rede"].includes(key));
    expect(keys).toEqual(["essencial", "profissional", "inteligencia", "rede"]);
  });

  it("changes the plan and writes the audit entry inside the target organization", async () => {
    const adminId = await createPlatformAdmin();
    const { organizationId, owner } = await createOrganizationFixture();
    await expect(changeOrganizationPlan(adminId, organizationId, "rede")).resolves.toEqual({ planName: "Rede", warnings: [] });
    expect((await organizationRow(organizationId)).planKey).toBe("rede");
    const trail = await organizationAudit(organizationId, "organization.plan_changed");
    expect(trail).toEqual([{ actorUserId: adminId, entityType: "organization", changes: { plan: { from: "essencial", to: "rede" } } }]);
    const listed = await listAuditLogs(owner, auditFilters("organization"));
    expect(listed.rows.find((row) => row.action === "organization.plan_changed")?.actorName).toBe("Admin da Plataforma");

    await expect(changeOrganizationPlan(adminId, organizationId, "rede")).rejects.toMatchObject({ code: "invalid" });
    await expect(changeOrganizationPlan(adminId, organizationId, "inexistente")).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: { planKey: expect.any(Array) },
    });
    await expect(changeOrganizationPlan(adminId, randomUUID(), "essencial")).rejects.toMatchObject({ code: "not_found" });
    await expect(changeOrganizationPlan(adminId, "not-a-uuid", "essencial")).rejects.toMatchObject({ code: "not_found" });
    expect(await organizationAudit(organizationId, "organization.plan_changed")).toHaveLength(1);
  });

  it("allows a downgrade below current usage and returns a warning", async () => {
    const adminId = await createPlatformAdmin();
    const { organizationId } = await createOrganizationFixture();
    await setPlan(organizationId, "rede");
    await createStoreFixture(organizationId);
    await createStoreFixture(organizationId);
    const result = await changeOrganizationPlan(adminId, organizationId, "essencial");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("2 loja(s)");
    expect((await organizationRow(organizationId)).planKey).toBe("essencial");
    const [active] = await withScope({ organizationId }, (tx) =>
      tx.select({ value: count() }).from(stores).where(and(eq(stores.organizationId, organizationId), eq(stores.status, "active"))),
    );
    expect(active.value).toBe(2);
  });

  it("suspends an organization, blocking its members at once, and reactivates it", async () => {
    const adminId = await createPlatformAdmin();
    const { organizationId, ownerId, owner } = await createOrganizationFixture();
    await setOrganizationStatus(adminId, organizationId, "suspended");
    expect(await loadTenantContext(sessionOf(owner, organizationId), organizationId)).toBeNull();
    await expect(contextFor(ownerId, organizationId)).rejects.toThrow("fixture membership not active");
    await expect(setOrganizationStatus(adminId, organizationId, "suspended")).rejects.toMatchObject({ code: "invalid" });

    await setOrganizationStatus(adminId, organizationId, "active");
    expect(await loadTenantContext(sessionOf(owner, organizationId), organizationId)).not.toBeNull();
    await expect(contextFor(ownerId, organizationId)).resolves.toMatchObject({ organization: { id: organizationId } });
    const trail = await organizationAudit(organizationId, "organization.status_changed");
    expect(trail.map((entry) => entry.changes)).toEqual([
      { status: { from: "active", to: "suspended" } },
      { status: { from: "suspended", to: "active" } },
    ]);
    expect(trail.every((entry) => entry.actorUserId === adminId)).toBe(true);
  });

  it("cannot read tenant tables in the platform scope", async () => {
    const adminId = await createPlatformAdmin();
    const { organizationId } = await createOrganizationFixture();
    await createStoreFixture(organizationId, { regionId: await createRegionFixture(organizationId) });
    await withScope({ userId: adminId, platform: true }, async (tx) => {
      expect(await tx.select({ id: stores.id }).from(stores)).toHaveLength(0);
      expect(await tx.select({ id: regions.id }).from(regions)).toHaveLength(0);
      expect(await tx.select({ id: roles.id }).from(roles)).toHaveLength(0);
      expect(await tx.select({ id: organizationMemberships.id }).from(organizationMemberships)).toHaveLength(0);
      expect(await tx.select({ id: auditLogs.id }).from(auditLogs)).toHaveLength(0);
      const visible = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId));
      expect(visible).toHaveLength(1);
    });
  });
});
