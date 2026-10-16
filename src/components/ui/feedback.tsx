import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const NOTICE_STYLES = {
  success: { icon: CheckCircle2, className: "border-positive/30 bg-positive-soft text-positive" },
  error: { icon: XCircle, className: "border-critical/30 bg-critical-soft text-critical" },
  warning: { icon: AlertTriangle, className: "border-attention/30 bg-attention-soft text-attention" },
  info: { icon: Info, className: "border-brand/25 bg-brand-soft text-brand-strong" },
} as const;

export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: keyof typeof NOTICE_STYLES;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: toneClass } = NOTICE_STYLES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-md border px-4 py-3 text-sm", toneClass, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-ink-soft">{children}</div> : null}
      </div>
    </div>
  );
}

const BADGE_TONES = {
  neutral: "bg-canvas text-ink-soft border-line",
  positive: "bg-positive-soft text-positive border-positive/20",
  critical: "bg-critical-soft text-critical border-critical/20",
  attention: "bg-attention-soft text-attention border-attention/20",
  brand: "bg-brand-soft text-brand-strong border-brand/20",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof BADGE_TONES; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", BADGE_TONES[tone])}>
      {children}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="font-semibold text-ink">{title}</p>
        {description ? <p className="max-w-md text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
