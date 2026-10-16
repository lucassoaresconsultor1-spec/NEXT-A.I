"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/form";
import { cn } from "@/lib/utils";

export interface PermissionChoiceGroup {
  key: string;
  label: string;
  /** `available` = the actor's own role holds it, so they may grant or revoke it. */
  permissions: { key: string; label: string; available: boolean }[];
}

/**
 * Grouped checkboxes submitted as `permissions`. Permissions the actor lacks
 * are disabled: they are not submitted and the service keeps their current state.
 */
export function PermissionPicker({
  groups,
  selected,
  error,
}: {
  groups: PermissionChoiceGroup[];
  selected: ReadonlySet<string>;
  error?: string[];
}) {
  const id = useId();
  const errorId = error?.length ? `${id}-error` : undefined;
  const hasLocked = groups.some((group) => group.permissions.some((permission) => !permission.available));
  return (
    <fieldset aria-describedby={errorId} className="space-y-5">
      <legend className="sr-only">Permissões do perfil</legend>
      {hasLocked ? (
        <p className="text-xs text-ink-muted">
          Permissões que o seu perfil não possui aparecem desativadas: você não pode concedê-las nem removê-las.
        </p>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        {groups.map((group) => (
          <fieldset key={group.key} className="space-y-2.5">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{group.label}</legend>
            {group.permissions.map((permission) => {
              const hintId = `${id}-${permission.key}-hint`;
              return (
                <div key={permission.key} className="space-y-0.5">
                  <Checkbox
                    name="permissions"
                    value={permission.key}
                    defaultChecked={selected.has(permission.key)}
                    disabled={!permission.available}
                    aria-describedby={permission.available ? undefined : hintId}
                    className={cn(!permission.available && "text-ink-muted")}
                    label={permission.label}
                  />
                  {permission.available ? null : (
                    <p id={hintId} className="pl-6 text-xs text-ink-muted">
                      Seu perfil não inclui esta permissão.
                    </p>
                  )}
                </div>
              );
            })}
          </fieldset>
        ))}
      </div>
      {errorId ? (
        <p id={errorId} className="text-xs font-medium text-critical">
          {error?.[0]}
        </p>
      ) : null}
    </fieldset>
  );
}
