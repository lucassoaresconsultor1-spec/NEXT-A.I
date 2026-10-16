import { Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { MobileNav } from "./mobile-nav";
import { SidebarNav } from "./sidebar-nav";
import { StoreSwitcher } from "./store-switcher";
import { UserMenu } from "./user-menu";

export interface ShellProps {
  organizationName: string;
  planName: string;
  allowedNav: string[];
  stores: { id: string; code: string; name: string }[];
  activeStoreId: string | null;
  user: { name: string; email: string; roleName: string; isPlatformAdmin: boolean };
  children: ReactNode;
}

export function AppShell({ organizationName, planName, allowedNav, stores, activeStoreId, user, children }: ShellProps) {
  return (
    <div className="flex min-h-screen">
      <a href="#conteudo" className="sr-only z-50 rounded bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Pular para o conteúdo
      </a>
      <aside className="hidden w-64 shrink-0 flex-col bg-sidebar lg:flex">
        <div className="border-b border-white/10 px-5 py-5">
          <Link href="/painel" className="block">
            <Logo onDark className="h-9" />
            <span className="mt-3 block truncate text-sm font-semibold text-white">{organizationName}</span>
          </Link>
          <span className="mt-1 inline-block rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-sidebar-ink">Plano {planName}</span>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <SidebarNav allowed={allowedNav} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur sm:px-6">
          <MobileNav allowed={allowedNav} organizationName={organizationName} />
          <p className="truncate text-sm font-semibold text-ink lg:hidden">{organizationName}</p>
          <form action="/busca" role="search" className="relative hidden max-w-sm flex-1 sm:block">
            <label htmlFor="global-search" className="sr-only">
              Buscar lojas, regiões, departamentos e pessoas
            </label>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <input
              id="global-search"
              name="q"
              type="search"
              minLength={2}
              placeholder="Buscar lojas, regiões, pessoas…"
              className="h-9 w-full rounded-md border border-line-strong bg-canvas pr-3 pl-9 text-sm placeholder:text-ink-muted focus:border-brand focus:bg-surface focus:outline-none"
            />
          </form>
          <div className="ml-auto flex items-center gap-2">
            <StoreSwitcher stores={stores} activeStoreId={activeStoreId} />
            <UserMenu {...user} />
          </div>
        </header>
        <main id="conteudo" className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
