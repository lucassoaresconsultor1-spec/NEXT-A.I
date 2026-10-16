"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";
import { Button, type ButtonVariant } from "./button";

const controlClasses =
  "block w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-muted " +
  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:bg-canvas aria-[invalid=true]:border-critical";

interface FieldProps {
  label: string;
  error?: string[];
  hint?: string;
  required?: boolean;
  className?: string;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
}

/** Label, hint and error wired to the control through ids for screen readers. */
export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error?.length ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {required ? <span className="text-critical" aria-hidden> *</span> : null}
      </label>
      {children({ id, "aria-invalid": errorId ? true : undefined, "aria-describedby": describedBy })}
      {hint ? <p id={hintId} className="text-xs text-ink-muted">{hint}</p> : null}
      {errorId ? <p id={errorId} className="text-xs font-medium text-critical">{error?.[0]}</p> : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(controlClasses, "h-10", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(controlClasses, "h-10 pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(controlClasses, "min-h-20 py-2", className)} {...props} />;
}

export function Checkbox({ className, label, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("flex items-start gap-2 text-sm text-ink", className)}>
      <input type="checkbox" className="mt-0.5 size-4 rounded border-line-strong accent-brand" {...props} />
      <span>{label}</span>
    </label>
  );
}

/** Disabled while the parent form submits, preventing duplicate submissions. */
export function SubmitButton({
  children,
  pendingLabel = "Salvando…",
  variant = "primary",
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
