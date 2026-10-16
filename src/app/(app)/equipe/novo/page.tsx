import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Card, CardBody, PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { getMemberFormOptions } from "@/server/members/service";
import { MemberForm } from "../member-form";

export const metadata: Metadata = { title: "Adicionar membro" };

export default async function NewMemberPage() {
  const context = await requireTenantContext();
  if (!can(context, "members.manage")) return <AccessDenied />;
  const options = await getMemberFormOptions(context);
  const withoutStores = !options.organizationWide && options.stores.length === 0;

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Equipe", href: "/equipe" }, { label: "Adicionar membro" }]} />
      <PageHeader
        title="Adicionar membro"
        description="Convide uma pessoa pelo e-mail, escolha o perfil e as lojas que ela poderá acompanhar."
      />
      <Card>
        <CardBody>
          {options.roles.length === 0 ? (
            <Notice tone="warning" title="Nenhum perfil disponível para atribuir">
              Você só pode atribuir perfis de nível inferior ao seu. Peça a um administrador da empresa para adicionar esta pessoa.
            </Notice>
          ) : withoutStores ? (
            <Notice tone="warning" title="Nenhuma loja no seu escopo">
              Para adicionar pessoas, você precisa ter acesso a ao menos uma loja.
            </Notice>
          ) : (
            <MemberForm
              roles={options.roles.map((role) => ({ id: role.id, name: role.name }))}
              scope={{ organizationWide: options.organizationWide, regions: options.regions, stores: options.stores }}
            />
          )}
          {options.roles.length === 0 || withoutStores ? (
            <div className="mt-4">
              <LinkButton href="/equipe" variant="secondary">
                Voltar à equipe
              </LinkButton>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </>
  );
}
