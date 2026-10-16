// Permission catalog: the single source of truth for what can be granted.
// New modules add their keys here in the same change that implements them.

export const PERMISSION_GROUPS = [
  {
    key: "organization",
    label: "Empresa",
    permissions: [
      { key: "organization.settings.read", label: "Ver dados da empresa e do plano" },
      { key: "organization.settings.manage", label: "Editar dados da empresa" },
    ],
  },
  {
    key: "structure",
    label: "Estrutura",
    permissions: [
      { key: "stores.read", label: "Ver lojas do escopo" },
      { key: "stores.manage", label: "Cadastrar e editar lojas" },
      { key: "regions.read", label: "Ver regiões" },
      { key: "regions.manage", label: "Cadastrar e editar regiões" },
      { key: "departments.read", label: "Ver departamentos" },
      { key: "departments.manage", label: "Cadastrar e editar departamentos" },
    ],
  },
  {
    key: "people",
    label: "Pessoas e acesso",
    permissions: [
      { key: "members.read", label: "Ver equipe do escopo" },
      { key: "members.manage", label: "Adicionar e editar membros de nível inferior" },
      { key: "roles.read", label: "Ver perfis de acesso" },
      { key: "roles.manage", label: "Criar e editar perfis personalizados" },
    ],
  },
  {
    key: "governance",
    label: "Governança",
    permissions: [{ key: "audit.read", label: "Ver trilha de auditoria" }],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]["permissions"][number]["key"];

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map((permission) => permission.key),
);

const permissionSet: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return permissionSet.has(value);
}

export function permissionLabel(key: Permission) {
  for (const group of PERMISSION_GROUPS) {
    const found = group.permissions.find((permission) => permission.key === key);
    if (found) return found.label;
  }
  return key;
}
