import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { stores } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { dbScope, storeScopeCondition, type TenantContext } from "@/server/authz/context";

/** Stores the member can act on, for selectors (header store switcher, forms). */
export async function listStoreOptions(context: TenantContext, options: { includeInactive?: boolean } = {}) {
  return withScope(dbScope(context), (tx) =>
    tx
      .select({ id: stores.id, code: stores.code, name: stores.name, status: stores.status, regionId: stores.regionId })
      .from(stores)
      .where(
        and(
          eq(stores.organizationId, context.organization.id),
          storeScopeCondition(context.storeScope, stores.id),
          options.includeInactive ? undefined : eq(stores.status, "active"),
        ),
      )
      .orderBy(asc(stores.name))
      .limit(1000),
  );
}
