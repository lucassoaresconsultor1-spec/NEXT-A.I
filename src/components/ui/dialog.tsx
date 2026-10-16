"use client";

import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import type { ReactNode } from "react";

/** Accessible modal (focus trap, Esc, labelled title) built on Radix Dialog. */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <RadixDialog.Content
          className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-card)] bg-surface p-6 shadow-xl"
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <RadixDialog.Title className="text-base font-semibold text-ink">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="text-sm text-ink-muted">{description}</RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close className="rounded-md p-1 text-ink-muted hover:bg-canvas hover:text-ink" aria-label="Fechar">
              <X className="size-4" aria-hidden />
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const DialogClose = RadixDialog.Close;
