import { cn } from "@/lib/utils";

// Exact geometry of brand/next-ai/svg/logo-horizontal(-negative).svg (concept 01B). Do not redraw.
const NEXT_WORD = "M5 50 V10 L32 50 V10 M70 10 H46 V50 H70 M46 30 H66 M82 10 L110 50 M110 10 L82 50 M120 10 H148 M134 10 V50";
const DEEP = "#062F28";
const LIME = "#9FE870";

/** `onDark` uses the negative version (lime icon, white "NEXT") for the forest-green sidebar. */
export function Logo({ onDark = false, className }: { onDark?: boolean; className?: string }) {
  const iconFill = onDark ? LIME : DEEP;
  const stem = onDark ? DEEP : "#FFFFFF";
  const arrow = onDark ? DEEP : LIME;
  return (
    <svg viewBox="0 0 400 120" role="img" aria-label="NEXT A.I" className={cn("h-8 w-auto", className)}>
      <rect width="120" height="120" rx="28" fill={iconFill} />
      <rect x="30" y="30" width="15" height="60" fill={stem} />
      <polygon points="30,30 45,30 90,90 75,90" fill={stem} />
      <rect x="75" y="46" width="15" height="44" fill={arrow} />
      <polygon points="64,48 82.5,26 101,48" fill={arrow} />
      <g transform="translate(146 30)">
        <path d={NEXT_WORD} fill="none" stroke={onDark ? "#FFFFFF" : DEEP} strokeWidth="9" strokeLinejoin="miter" />
        <rect x="160" y="6" width="80" height="48" rx="24" fill={LIME} />
        <path d="M175 45 L187 15 L199 45 M180 34 H194 M222 15 V45" fill="none" stroke={DEEP} strokeWidth="6" strokeLinejoin="miter" />
        <circle cx="210" cy="42.5" r="3.5" fill={DEEP} />
      </g>
    </svg>
  );
}
