"use client";

import { Menu, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { Logo } from "@/components/brand/logo";
import { SidebarNav } from "./sidebar-nav";

export function MobileNav({ allowed, organizationName }: { allowed: string[]; organizationName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="rounded-md p-2 text-ink-soft hover:bg-canvas lg:hidden" aria-label="Abrir menu">
        <Menu className="size-5" aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 lg:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-y-auto bg-sidebar p-4 lg:hidden"
        >
          <div className="mb-3 flex items-center justify-between">
            <Logo onDark />
            <Dialog.Close className="rounded-md p-1 text-sidebar-ink hover:bg-sidebar-hover" aria-label="Fechar menu">
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Title className="mb-6 truncate text-sm font-semibold text-white">{organizationName}</Dialog.Title>
          <SidebarNav allowed={allowed} onNavigate={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
