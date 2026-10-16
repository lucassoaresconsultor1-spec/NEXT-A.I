"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_SECTIONS } from "./nav";

/** `allowed` comes from the server (permission check); hiding links is not the access control. */
export function SidebarNav({ allowed, onNavigate }: { allowed: string[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const allowedSet = new Set(allowed);
  return (
    <nav aria-label="Módulos" className="space-y-6">
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter((item) => allowedSet.has(item.href));
        if (items.length === 0) return null;
        return (
          <div key={section.label} className="space-y-1">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-ink/60">{section.label}</p>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-full px-3 py-2 text-sm",
                        active
                          ? "bg-accent font-medium text-sidebar"
                          : "text-sidebar-ink hover:bg-sidebar-hover hover:text-white",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
