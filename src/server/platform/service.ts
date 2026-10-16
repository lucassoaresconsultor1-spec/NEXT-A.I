import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, eq, ilike, or, type SQL } from "drizzle-orm";
import { notFound as notFoundPage, redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { organizations, planFeatures, plans, users } from "@/db/schema";
import { withScope, type Tx } from "@/db/tenant";
import { normalizeCnpj } from "@/lib/documents";
import { logger } from "@/lib/logger";
import { diffFields, recordAudit } from "@/server/audit/record";
import { hashPassword } from "@/server/auth/password";
import { getCurrentSession } from "@/server/auth/session";
import { conflict, forbidden, invalid, isUniqueViolation, notFound } from "@/server/errors";
import { emailField, fieldErrorsOf, optionalCnpj, passwordField, requiredText } from "@/server/forms";
import { provisionOrganization } from "@/server/organizations/provisioning";
import { likePattern, pageResult, pageWindow, parsePage } from "@/server/pagination";
import { countUsage } from "@/server/plans/entitlements";

// Platform administration: organizations and the plan catalog only. Every
// transaction runs with `platform: true`, which RLS honours on `organizations`
// (plans are global); tenant tables (stores, members, roles, audit...) have no
// platform policy, so they stay unreadable here. Every function re-checks
// users.is_platform_admin in the database instead of trusting the caller.

export const ORGANIZATION_STATUSES = ["active", "suspended"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

const emptyToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const platformFiltersSchema = z.object({
  q: z.preprocess(emptyToUndefined, z.string().trim().max(120).optional()).catch(undefined),
  status: z.enum(ORGANIZATION_STATUSES).optional().catch(undefined),
  // `.optional()` first: Zod 4 rejects a missing key for a bare transformed z.unknown().
  page: z.unknown().optional().transform(parsePage),
});
export type PlatformFilters = z.infer<typeof platformFiltersSchema>;

const uuidSchema = z.uuid();
const planKeySchema = z.string().trim().min(1).max(32);
const statusSchema = z.enum(ORGANIZATION_STATUSES);

export const newOrganizationSchema = z.object({
  organizationName: requiredText("o nome da empresa", 120, 2),
  organizationDocument: optionalCnpj,
  planKey: z.string({ error: "Selecione um plano." }).trim().min(1, { error: "Selecione um plano." }).max(32),
  ownerName: requiredText("o nome do dono", 120, 2),
  ownerEmail: emailField,
  ownerPassword: passwordField,
});
export type NewOrganizationInput = z.infer<typeof newOrganizationSchema>;

/** For pages, layouts and actions: the signed-in platform administrator, or redirect / 404. */
export const requirePlatformAdmin = cache(async () => {
  const session = await getCurrentSession();
  if (!session) redirect("/entrar");
  if (session.user.mustChangePassword) redirect("/alterar-senha");
  if (!session.user.isPlatformAdmin) notFoundPage();
  return { userId: session.user.id, name: session.user.name, email: session.user.email };
});

/** Defense in depth: the flag is read again inside the transaction that does the work. */
async function assertPlatformAdmin(tx: Tx, actorId: string) {
  const [actor] = uuidSchema.safeParse(actorId).success
    ? await tx
        .select({ isPlatformAdmin: users.isPlatformAdmin, status: users.status })
        .from(users)
        .where(eq(users.id, actorId))
    : [];
  if (!actor || !actor.isPlatformAdmin || actor.status !== "active") {
    throw forbidden("Acesso restrito à administração da plataforma.");
  }
}

function platformScope(actorId: string) {
  return { userId: actorId, platform: true };
}

export async function listOrganizations(actorId: string, filters: PlatformFilters) {
  const conditions: (SQL | undefined)[] = [];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    const document = normalizeCnpj(filters.q);
    conditions.push(
      or(ilike(organizations.name, pattern), document ? ilike(organizations.document, likePattern(document)) : undefined),
    );
  }
  if (filters.status) conditions.push(eq(organizations.status, filters.status));
  const where = and(...conditions);
  const { limit, offset } = pageWindow(filters.page);
  return withScope(platformScope(actorId), async (tx) => {
    await assertPlatformAdmin(tx, actorId);
    const [total] = await tx.select({ value: count() }).from(organizations).where(where);
    const rows = await tx
      .select({
        id: organizations.id,
        name: organizations.name,
        document: organizations.document,
        planKey: organizations.planKey,
        planName: plans.name,
        status: organizations.status,
        createdAt: organizations.createdAt,
      })
      .from(organizations)
      .innerJoin(plans, eq(plans.key, organizations.planKey))
      .where(where)
      .orderBy(asc(organizations.name), asc(organizations.id))
      .limit(limit)
      .offset(offset);
    return pageResult(rows, total.value, filters.page);
  });
}

/** Active plans, from the smallest feature set to the largest. */
export async function listPlans(actorId: string) {
  return withScope(platformScope(actorId), async (tx) => {
    await assertPlatformAdmin(tx, actorId);
    const featureCount = count(planFeatures.feature);
    return tx
      .select({
        key: plans.key,
        name: plans.name,
        description: plans.description,
        maxStores: plans.maxStores,
        maxMembers: plans.maxMembers,
      })
      .from(plans)
      .leftJoin(planFeatures, eq(planFeatures.planKey, plans.key))
      .where(eq(plans.isActive, true))
      .groupBy(plans.key)
      .orderBy(asc(featureCount), asc(plans.name));
  });
}

/** A malformed id answers "not found", but only after the actor is confirmed as an administrator. */
async function parseOrganizationId(actorId: string, organizationId: string) {
  const parsed = uuidSchema.safeParse(organizationId);
  if (parsed.success) return parsed.data;
  await withScope(platformScope(actorId), (tx) => assertPlatformAdmin(tx, actorId));
  throw notFound("Empresa não encontrada.");
}

/** Writes inside the target organization: RLS accepts the audit row only there. */
function targetScope(actorId: string, organizationId: string) {
  return { organizationId, userId: actorId, platform: true };
}

async function lockOrganization(tx: Tx, organizationId: string) {
  const [current] = await tx
    .select({ id: organizations.id, planKey: organizations.planKey, status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .for("update");
  if (!current) throw notFound("Empresa não encontrada.");
  return current;
}

/**
 * Narrow exception to "the platform never reads tenant tables": countUsage
 * runs in a transaction scoped to the target organization and only the two
 * totals leave it, to warn about a downgrade below current usage.
 */
async function usageWarnings(organizationId: string, limits: { maxStores: number | null; maxMembers: number | null }) {
  let usage: { stores: number; members: number };
  try {
    usage = await withScope({ organizationId }, (tx) => countUsage(tx, organizationId));
  } catch (error) {
    // The plan change is already committed; report that usage could not be checked.
    logger.warn({ err: { name: (error as Error)?.name, code: (error as { code?: string })?.code } }, "Usage check failed");
    return ["Não foi possível conferir o uso atual da empresa em relação aos limites do novo plano."];
  }
  const warnings: string[] = [];
  if (limits.maxStores !== null && usage.stores > limits.maxStores) {
    warnings.push(
      `A empresa tem ${usage.stores} loja(s) ativa(s) e o novo plano permite até ${limits.maxStores}. As existentes continuam ativas, mas novas lojas ficam bloqueadas.`,
    );
  }
  if (limits.maxMembers !== null && usage.members > limits.maxMembers) {
    warnings.push(
      `A empresa tem ${usage.members} membro(s) ativo(s) e o novo plano permite até ${limits.maxMembers}. Os atuais mantêm o acesso, mas novos membros ficam bloqueados.`,
    );
  }
  return warnings;
}

/** Limits apply to new creations only, so a downgrade below current usage is allowed (with warnings). */
export async function changeOrganizationPlan(actorId: string, organizationId: string, planKey: string) {
  const targetId = await parseOrganizationId(actorId, organizationId);
  const key = planKeySchema.safeParse(planKey);
  const plan = await withScope(targetScope(actorId, targetId), async (tx) => {
    await assertPlatformAdmin(tx, actorId);
    const current = await lockOrganization(tx, targetId);
    const [selected] = key.success
      ? await tx
          .select({ key: plans.key, name: plans.name, maxStores: plans.maxStores, maxMembers: plans.maxMembers })
          .from(plans)
          .where(and(eq(plans.key, key.data), eq(plans.isActive, true)))
      : [];
    if (!selected) throw invalid("Plano inválido.", { planKey: ["Selecione um plano ativo."] });
    if (selected.key === current.planKey) {
      throw invalid("A empresa já está neste plano.", { planKey: ["Escolha um plano diferente do atual."] });
    }
    await tx
      .update(organizations)
      .set({ planKey: selected.key, updatedAt: new Date() })
      .where(eq(organizations.id, targetId));
    await recordAudit(tx, {
      organizationId: targetId,
      actorUserId: actorId,
      action: "organization.plan_changed",
      entityType: "organization",
      entityId: targetId,
      changes: diffFields({ plan: current.planKey }, { plan: selected.key }, ["plan"]),
    });
    return selected;
  });
  return { planName: plan.name, warnings: await usageWarnings(targetId, plan) };
}

/** Suspension blocks every member at once: loadTenantContext requires an active organization. */
export async function setOrganizationStatus(actorId: string, organizationId: string, status: OrganizationStatus) {
  const targetId = await parseOrganizationId(actorId, organizationId);
  const next = statusSchema.safeParse(status);
  if (!next.success) throw invalid("Situação inválida.");
  await withScope(targetScope(actorId, targetId), async (tx) => {
    await assertPlatformAdmin(tx, actorId);
    const current = await lockOrganization(tx, targetId);
    if (current.status === next.data) throw invalid("A empresa já está nesta situação.");
    await tx
      .update(organizations)
      .set({ status: next.data, updatedAt: new Date() })
      .where(eq(organizations.id, targetId));
    await recordAudit(tx, {
      organizationId: targetId,
      actorUserId: actorId,
      action: "organization.status_changed",
      entityType: "organization",
      entityId: targetId,
      changes: diffFields({ status: current.status }, { status: next.data }, ["status"]),
    });
  });
}

/**
 * Registers a client company and its owner (Dono) with a temporary password,
 * changed on the first sign-in. The owner is always a new account: linking an
 * existing one needs e-mail confirmation (pending), as in addMember.
 */
export async function createOrganization(actorId: string, rawInput: NewOrganizationInput) {
  const parsed = newOrganizationSchema.safeParse(rawInput);
  // Hashing is slow on purpose; do it before the transaction.
  const passwordHash = parsed.success ? await hashPassword(parsed.data.ownerPassword) : null;
  const organizationId = randomUUID();
  const ownerUserId = randomUUID();
  try {
    await withScope(targetScope(actorId, organizationId), async (tx) => {
      await assertPlatformAdmin(tx, actorId);
      if (!parsed.success || passwordHash === null) {
        throw invalid("Revise os campos destacados.", parsed.success ? undefined : fieldErrorsOf(parsed.error));
      }
      const input = parsed.data;
      await tx
        .insert(users)
        .values({ id: ownerUserId, email: input.ownerEmail, name: input.ownerName, passwordHash, mustChangePassword: true });
      await provisionOrganization(tx, {
        organizationId,
        ownerUserId,
        actorUserId: actorId,
        name: input.organizationName,
        document: input.organizationDocument,
        planKey: input.planKey,
      });
      // Set after the organization row exists (foreign key).
      await tx.update(users).set({ homeOrganizationId: organizationId }).where(eq(users.id, ownerUserId));
    });
  } catch (error) {
    if (isUniqueViolation(error, "users_email_unique")) {
      throw conflict("Este e-mail já tem cadastro. Use um e-mail novo para o dono.", { ownerEmail: ["E-mail já cadastrado."] });
    }
    if (isUniqueViolation(error, "organizations_document_unique")) {
      throw conflict("Já existe uma empresa com este CNPJ.", { organizationDocument: ["CNPJ já cadastrado."] });
    }
    throw error;
  }
  return { organizationId };
}
