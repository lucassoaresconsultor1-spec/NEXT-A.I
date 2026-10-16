import { Building2, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/session-actions";
import { Logo } from "@/components/brand/logo";
import { Button, LinkButton } from "@/components/ui/button";
import { requirePlatformAdmin } from "@/server/platform/service";

// Layouts do not protect pages: every page and action calls requirePlatformAdmin() again.
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const admin = await requirePlatformAdmin();
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <a href="#conteudo" className="sr-only z-50 rounded bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Pular para o conteúdo
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo className="h-7" />
            <p className="border-l border-line pl-3 text-sm font-semibold text-ink">Administração da plataforma</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden max-w-48 truncate text-sm text-ink-muted sm:inline" title={admin.email}>
              {admin.name}
            </span>
            <LinkButton href="/selecionar-empresa" variant="ghost" size="sm">
              <Building2 className="size-4" aria-hidden /> Ir para empresas
            </LinkButton>
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm">
                <LogOut className="size-4" aria-hidden /> Sair
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
