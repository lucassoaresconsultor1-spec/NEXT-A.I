import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { auditLogs, organizationMemberships, organizations, regions, stores } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { createRegion, deleteRegion, listRegions, updateRegion } from "@/server/regions/service";
import { addMemberFixture, createOrganizationFixture, createRegionFixture, createStoreFixture } from "./fixtures";

describe("database row-level security", () => {
  it("hides every tenant row when no organization is set", async () => {
    const { organizationId } = await createOrganizationFixture();
    await createStoreFixture(organizationId);
    const db = getDb();
    // A query outside withScope behaves as "no tenant": zero rows, not all rows.
    const visible = await db.select({ id: stores.id }).from(stores);
    expect(visible).toHaveLength(0);
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    expect(orgs).toHaveLength(0);
  });

  it("never returns rows of another organization, even without an explicit filter", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const storeOfB = await createStoreFixture(b.organizationId);
    const rows = await withScope({ organizationId: a.organizationId }, (tx) =>
      tx.select({ id: stores.id, organizationId: stores.organizationId }).from(stores),
    );
    expect(rows.every((row) => row.organizationId === a.organizationId)).toBe(true);
    expect(rows.map((row) => row.id)).not.toContain(storeOfB);
  });

  it("rejects inserting or moving rows into another organization", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    await expect(
      withScope({ organizationId: a.organizationId }, (tx) =>
        tx.insert(regions).values({ organizationId: b.organizationId, name: "Invasora" }),
      ),
    ).rejects.toThrow();
    const regionOfA = await createRegionFixture(a.organizationId);
    const moved = await withScope({ organizationId: a.organizationId }, (tx) =>
      tx
        .update(regions)
        .set({ organizationId: b.organizationId })
        .where(eq(regions.id, regionOfA))
        .then(
          () => "updated",
          () => "rejected",
        ),
    );
    expect(moved).toBe("rejected");
  });

  it("blocks cross-tenant references through composite foreign keys", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const regionOfB = await createRegionFixture(b.organizationId);
    await expect(createStoreFixture(a.organizationId, { regionId: regionOfB })).rejects.toThrow();
  });

  it("keeps audit logs append-only", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    await createRegion(owner, { name: `Auditada ${randomUUID().slice(0, 6)}` });
    await withScope({ organizationId }, async (tx) => {
      const updated = await tx.update(auditLogs).set({ action: "tampered" }).where(eq(auditLogs.organizationId, organizationId)).returning();
      expect(updated).toHaveLength(0);
      const deleted = await tx.delete(auditLogs).where(eq(auditLogs.organizationId, organizationId)).returning();
      expect(deleted).toHaveLength(0);
    });
  });

  it("lets a user read only their own memberships of other organizations", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const mine = await withScope({ userId: a.ownerId }, (tx) =>
      tx.select({ organizationId: organizationMemberships.organizationId }).from(organizationMemberships),
    );
    expect(mine.map((row) => row.organizationId)).toEqual([a.organizationId]);
    const leaked = await withScope({ userId: a.ownerId }, (tx) =>
      tx
        .select({ id: organizationMemberships.id })
        .from(organizationMemberships)
        .where(eq(organizationMemberships.organizationId, b.organizationId)),
    );
    expect(leaked).toHaveLength(0);
  });

  it("does not leak tenant settings between pooled transactions", async () => {
    const a = await createOrganizationFixture();
    await withScope({ organizationId: a.organizationId }, async () => undefined);
    const db = getDb();
    const [row] = await db.execute<{ org: string | null }>(sql`select current_setting('app.organization_id', true) as org`).then((r) => r.rows);
    expect(row.org === null || row.org === "").toBe(true);
  });
});

describe("regions service authorization", () => {
  it("cannot read, change or delete a region of another organization by id", async () => {
    const a = await createOrganizationFixture();
    const b = await createOrganizationFixture();
    const regionOfB = await createRegionFixture(b.organizationId, "Região B");
    expect((await listRegions(a.owner)).map((region) => region.id)).not.toContain(regionOfB);
    await expect(updateRegion(a.owner, regionOfB, { name: "Sequestrada" })).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteRegion(a.owner, regionOfB)).rejects.toMatchObject({ code: "not_found" });
    const [still] = await withScope({ organizationId: b.organizationId }, (tx) =>
      tx.select({ name: regions.name }).from(regions).where(eq(regions.id, regionOfB)),
    );
    expect(still.name).toBe("Região B");
  });

  it("enforces permissions in the service, not only in the interface", async () => {
    const { organizationId } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const seller = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeId] });
    await expect(listRegions(seller.context)).rejects.toMatchObject({ code: "forbidden" });
    await expect(createRegion(seller.context, { name: "Proibida" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("limits a regional manager to regions that contain stores in scope", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const north = await createRegionFixture(organizationId, "Norte");
    const south = await createRegionFixture(organizationId, "Sul");
    await createStoreFixture(organizationId, { regionId: north });
    await createStoreFixture(organizationId, { regionId: south });
    const manager = await addMemberFixture(organizationId, { roleKey: "regional_manager", regionIds: [north] });
    const visible = await listRegions(manager.context);
    expect(visible.map((region) => region.name)).toEqual(["Norte"]);
    expect((await listRegions(owner)).length).toBe(2);
    await expect(createRegion(manager.context, { name: "Nova" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects duplicate names case-insensitively and records an audit entry", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const created = await createRegion(owner, { name: "Centro-Oeste" });
    await expect(createRegion(owner, { name: "centro-oeste" })).rejects.toMatchObject({ code: "conflict" });
    const trail = await withScope({ organizationId }, (tx) =>
      tx
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityId, created.id))),
    );
    expect(trail.map((entry) => entry.action)).toEqual(["region.created"]);
  });
});
