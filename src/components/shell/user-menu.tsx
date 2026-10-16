"use client";

import { ChevronDown, KeyRound, LogOut, Repeat, ShieldEllipsis } from "lucide-react";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { signOutAction } from "@/app/session-actions";

const itemClass =
  "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-canvas";

export function UserMenu({
  name,
  email,
  roleName,
  isPlatformAdmin,
}: {
  name: string;
  email: string;
  roleName: string;
  isPlatformAdmin: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-canvas" aria-label="Menu do perfil">
        <span className="flex size-8 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white" aria-hidden>
          {initials}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block max-w-40 truncate text-sm font-medium text-ink">{name}</span>
          <span className="block max-w-40 truncate text-xs text-ink-muted">{roleName}</span>
        </span>
        <ChevronDown className="size-4 text-ink-muted" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-60 rounded-md border border-line bg-surface p-1 shadow-lg">
          <div className="px-2 py-2">
            <p className="truncate text-sm font-medium text-ink">{name}</p>
            <p className="truncate text-xs text-ink-muted">{email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item asChild className={itemClass}>
            <Link href="/alterar-senha">
              <KeyRound className="size-4" aria-hidden /> Alterar senha
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={itemClass}>
            <Link href="/selecionar-empresa">
              <Repeat className="size-4" aria-hidden /> Trocar de empresa
            </Link>
          </DropdownMenu.Item>
          {isPlatformAdmin ? (
            <DropdownMenu.Item asChild className={itemClass}>
              <Link href="/plataforma">
                <ShieldEllipsis className="size-4" aria-hidden /> Administração da plataforma
              </Link>
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <form action={signOutAction}>
            <button type="submit" className={`${itemClass} w-full text-critical`}>
              <LogOut className="size-4" aria-hidden /> Sair
            </button>
          </form>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
