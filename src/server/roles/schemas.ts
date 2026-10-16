import { z } from "zod";
import { optionalText, requiredText } from "@/server/forms";

// Pure rules for custom roles: shared by the Server Actions (early field
// errors) and by the service (defense in depth for any other caller).

/** System owner is 100; custom roles always stay below it. */
export const MAX_CUSTOM_ROLE_RANK = 99;
export const CUSTOM_ROLE_KEY_PREFIX = "custom_";
// roles.key is varchar(48): prefix (7) + slug (32) + "_" + suffix digits.
const SLUG_MAX = 32;

const rankRangeMessage = `Use um nível inteiro de 1 a ${MAX_CUSTOM_ROLE_RANK}.`;

const rankField = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce
    .number({ error: "Informe o nível do perfil." })
    .int({ error: rankRangeMessage })
    .min(1, { error: rankRangeMessage })
    .max(MAX_CUSTOM_ROLE_RANK, { error: rankRangeMessage }),
);

export const roleInputSchema = z.object({
  name: requiredText("o nome do perfil", 80, 2),
  description: optionalText(240),
  rank: rankField,
  // "At least one" is checked by the service on the final set: on edits, permissions
  // the actor lacks are kept even though their (disabled) checkboxes are not submitted.
  permissions: z
    .array(z.string().max(64, { error: "Permissão inválida." }), { error: "Selecione as permissões." })
    .max(200, { error: "Permissões inválidas." }),
});
export type RoleInput = z.infer<typeof roleInputSchema>;

export const ROLE_FORM_FIELDS = ["name", "description", "rank"] as const;

/** Key derived from the name: ASCII, lowercase, underscores, always prefixed. */
export function roleKeyBase(name: string) {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/_+$/, "");
  return `${CUSTOM_ROLE_KEY_PREFIX}${slug || "perfil"}`;
}

/** First free key: the base itself, then base_2, base_3… */
export function nextAvailableKey(base: string, taken: ReadonlySet<string>) {
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

/** Highest rank the actor may assign to a custom role (0 = none). */
export function maxAssignableRank(actor: { rank: number; isOwner: boolean }) {
  return actor.isOwner ? MAX_CUSTOM_ROLE_RANK : Math.min(MAX_CUSTOM_ROLE_RANK, actor.rank - 1);
}

/** Null when the rank is acceptable; otherwise the pt-BR field message. */
export function rankError(rank: number, actor: { rank: number; isOwner: boolean }) {
  if (!Number.isInteger(rank) || rank < 1 || rank > MAX_CUSTOM_ROLE_RANK) return rankRangeMessage;
  const max = maxAssignableRank(actor);
  if (rank > max) {
    return max < 1
      ? "Seu nível não permite criar ou alterar perfis."
      : `Use um nível menor que o do seu perfil (${actor.rank}): de 1 a ${max}.`;
  }
  return null;
}

/**
 * Next permission set of a role. The actor only controls permissions they hold:
 * the ones they lack keep the role's current state (never granted, never revoked).
 * `granted` lists requested permissions the actor lacks and the role did not have.
 */
export function resolveRolePermissions<P extends string>(
  requested: readonly P[],
  held: ReadonlySet<string>,
  current: readonly P[] = [],
) {
  const currentSet = new Set<string>(current);
  const requestedSet = new Set<string>(requested);
  const granted = [...requestedSet].filter((permission) => !held.has(permission) && !currentSet.has(permission)) as P[];
  const next = new Set<P>();
  for (const permission of requested) if (held.has(permission)) next.add(permission);
  for (const permission of current) if (!held.has(permission)) next.add(permission);
  return { next: [...next], granted };
}

export function diffPermissions(before: readonly string[], after: readonly string[]) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((permission) => !beforeSet.has(permission)),
    removed: before.filter((permission) => !afterSet.has(permission)),
  };
}
