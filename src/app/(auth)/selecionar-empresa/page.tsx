import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, EmptyState, Notice } from "@/components/ui/feedback";
import { signOutAction, switchOrganizationAction } from "@/app/session-actions";
import { listUserOrganizations } from "@/server/auth/service";
import { getCurrentSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Selecionar empresa" };

export default async function SelectOrganizationPage({ searchParams }: PageProps<"/selecionar-empresa">) {
  const session = await getCurrentSession();
  if (!session) redirect("/entrar");
  if (session.user.mustChangePassword) redirect("/alterar-senha");
  const organizations = await listUserOrganizations(session.user.id);
  const { indisponivel } = await searchParams;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-ink">Selecione a empresa</h1>
        <p className="text-sm text-ink-muted">Você tem acesso às empresas abaixo.</p>
      </div>
      {indisponivel ? (
        <Notice tone="warning" title="Acesso indisponível">
          A empresa selecionada está suspensa ou seu acesso a ela foi alterado.
        </Notice>
      ) : null}
      {organizations.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhuma empresa vinculada"
          description="Peça a um administrador da empresa para adicionar seu e-mail à equipe."
        />
      ) : (
        <ul className="space-y-2">
          {organizations.map((organization) => (
            <li key={organization.id}>
              <form action={switchOrganizationAction}>
                <input type="hidden" name="organizationId" value={organization.id} />
                <button
                  type="submit"
                  disabled={organization.status !== "active"}
                  className="flex w-full items-center justify-between rounded-md border border-line px-4 py-3 text-left text-sm hover:border-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="font-medium text-ink">{organization.name}</span>
                  {organization.status === "active" ? (
                    session.activeOrganizationId === organization.id ? <Badge tone="brand">Atual</Badge> : null
                  ) : (
                    <Badge tone="attention">Suspensa</Badge>
                  )}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between text-sm">
        {session.user.isPlatformAdmin ? (
          <Link href="/plataforma" className="font-medium text-brand hover:underline">
            Administração da plataforma
          </Link>
        ) : (
          <span />
        )}
        <form action={signOutAction}>
          <button type="submit" className="font-medium text-ink-soft hover:text-ink">
            Sair
          </button>
        </form>
      </div>
    </div>
  );
}
