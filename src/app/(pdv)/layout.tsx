import { AccessDenied } from "@/components/shell/access-denied";
import { LinkButton } from "@/components/ui/button";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { findOpenSessionForOperator } from "@/server/cash/session-queries";
import { listStoreOptions } from "@/server/stores/options";

export default async function PdvLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const context = await requireTenantContext();
  if (!can(context, "sales.create")) return <AccessDenied />;
  const stores = await listStoreOptions(context);
  const store = stores.find((item) => item.id === context.activeStoreId) ?? stores[0];
  const session = store ? await findOpenSessionForOperator(context, store.id) : null;
  return <div className="min-h-screen bg-canvas text-ink">
    <header className="flex items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3 sm:px-8">
      <div><p className="font-display text-lg font-semibold">PDV</p><p className="text-xs text-ink-muted">{store?.name ?? context.organization.name} · {context.user.name}{session ? " · Caixa aberto" : " · Sem caixa aberto"}</p></div>
      <LinkButton href="/painel" variant="secondary">Sair do PDV</LinkButton>
    </header>
    <main id="conteudo" className="mx-auto max-w-7xl p-3 sm:p-6">{children}</main>
  </div>;
}
