import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { canManageRoles, roleFormOptions } from "@/server/roles/service";
import { RoleForm } from "../role-form";

export const metadata: Metadata = { title: "Novo perfil" };

export default async function NewRolePage() {
  const context = await requireTenantContext();
  if (!can(context, "roles.read") || !can(context, "roles.manage")) return <AccessDenied />;
  if (!context.storeScope.all) {
    return <AccessDenied detail="Gerenciar perfis exige acesso a todas as lojas da empresa. Fale com um administrador." />;
  }
  if (!canManageRoles(context)) {
    return <AccessDenied detail="Seu nível não permite criar perfis, pois eles precisam ficar abaixo do nível do seu perfil." />;
  }

  return (
    <>
      <Breadcrumbs
        items={[{ label: "Painel", href: "/painel" }, { label: "Perfis de acesso", href: "/perfis" }, { label: "Novo perfil" }]}
      />
      <PageHeader
        title="Novo perfil"
        description="Escolha um nível abaixo do seu e as permissões que os membros com este perfil terão. Você só concede permissões que o seu perfil possui."
      />
      <RoleForm options={roleFormOptions(context)} cancelHref="/perfis" />
    </>
  );
}
