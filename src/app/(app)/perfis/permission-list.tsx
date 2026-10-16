import { PERMISSION_GROUPS } from "@/server/authz/permissions";
import { GrantMark } from "./role-badges";

/** Read-only view of one role's permissions, grouped like the catalog. */
export function PermissionList({ permissions }: { permissions: readonly string[] }) {
  const granted = new Set(permissions);
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {PERMISSION_GROUPS.map((group) => (
        <section key={group.key} aria-labelledby={`grupo-${group.key}`} className="space-y-2">
          <h3 id={`grupo-${group.key}`} className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {group.label}
          </h3>
          <ul className="space-y-1.5">
            {group.permissions.map((permission) => {
              const has = granted.has(permission.key);
              return (
                <li key={permission.key} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5">
                    <GrantMark granted={has} />
                  </span>
                  <span className={has ? "text-ink" : "text-ink-muted"}>{permission.label}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
