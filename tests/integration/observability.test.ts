import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { aiUsageRecords, opsEvents, users } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { runAction } from "@/server/actions";
import { observabilitySummary } from "@/server/platform/observability";
import { createOrganizationFixture, uniqueEmail } from "./fixtures";

const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

describe("observability", () => {
  it("counts slow transactions and unexpected errors by organization, readable only by the platform", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const adminId = randomUUID();
    await getDb().insert(users).values({ id: adminId, email: uniqueEmail("platform"), name: "Admin", passwordHash: "unused", isPlatformAdmin: true, status: "active" });

    // A slow transaction of the organization is recorded with its duration.
    await withScope({ organizationId }, (tx) => tx.execute(sql`select pg_sleep(1.05)`));
    // An unexpected error in an action is recorded (no request here, so no organization).
    const action = `teste-${randomUUID().slice(0, 8)}`;
    expect(await runAction(async () => Promise.reject(new Error("boom")), "ok", action)).toMatchObject({ status: "error" });
    await withScope({ organizationId }, (tx) =>
      tx.insert(aiUsageRecords).values({ organizationId, userId: owner.user.id, feature: "assistant", provider: "teste", model: "m", inputTokens: 100, outputTokens: 20, costMicros: 500, durationMs: 10, status: "ok" }),
    );
    await settle();

    // Tenants cannot read operational events, not even their own.
    expect(await withScope({ organizationId }, (tx) => tx.select().from(opsEvents))).toEqual([]);
    await expect(observabilitySummary(owner.user.id, { from: "2000-01-01", to: "2999-12-31" })).rejects.toMatchObject({ code: "forbidden" });

    const today = new Date().toISOString().slice(0, 10);
    const summary = await observabilitySummary(adminId, { from: today, to: today });
    const row = summary.organizations.find((entry) => entry.organizationId === organizationId);
    expect(row).toMatchObject({ slowTransactions: 1, ai: { calls: 1, tokens: 120, costMicros: 500, errors: 0 } });
    expect(row!.maxDurationMs).toBeGreaterThanOrEqual(1000);
    expect(summary.withoutOrganization.errors).toBeGreaterThanOrEqual(1);
    const named = await withScope({ platform: true }, (tx) => tx.select({ name: opsEvents.name }).from(opsEvents).where(sql`${opsEvents.name} = ${action}`));
    expect(named).toHaveLength(1);
  });
});
