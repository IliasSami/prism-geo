"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Target, Quote, MessageSquareText, ListChecks, Cpu, Settings, Menu, X, BookOpen } from "lucide-react";
import { BrandSwitcher } from "./BrandSwitcher";

/**
 * Five decision pages plus setup. Old URLs (/sov, /competitors, /fan-out, /brand) redirect, see next.config.
 */
const navigationGroups = [
  {
    title: "Insights",
    items: [
      { label: "Overview", href: "/", icon: LayoutDashboard },
      { label: "Competitors", href: "/visibility", icon: Users },
      { label: "Gaps", href: "/opportunities", icon: Target },
      { label: "Sources", href: "/citations", icon: Quote },
      { label: "Answers", href: "/responses", icon: MessageSquareText },
    ],
  },
  {
    title: "Setup",
    items: [
      { label: "Prompts", href: "/prompts", icon: ListChecks },
      { label: "Engines", href: "/engines", icon: Cpu },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="space-y-5">
      {navigationGroups.map((group) => (
        <div key={group.title}>
          <div className="px-2.5 pb-1.5 text-xs font-medium text-zinc-400">{group.title}</div>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    className={`group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-base transition duration-150 ${
                      isActive ? "bg-white font-medium text-zinc-900 shadow-card ring-1 ring-zinc-200" : "text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900"
                    }`}
                  >
                    <item.icon className={`h-4 w-4 shrink-0 transition-colors ${isActive ? "text-accent-600" : "text-zinc-400 group-hover:text-zinc-600"}`} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex min-h-9 items-center gap-2.5 rounded-lg">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-accent-700 text-sm font-bold text-white shadow-sm">P</span>
      <span className="text-md font-semibold tracking-tight text-zinc-900">PrismGEO</span>
    </Link>
  );
}

export function Navigation({
  brandId = "",
  brandName,
  brandDomain,
  mobileActions,
}: {
  brandId?: string;
  brandName?: string;
  brandDomain?: string;
  /** Rendered in the mobile top bar (e.g. the Run audit button). */
  mobileActions?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes the drawer; body scroll is locked while it is open
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  const footer = (
    <div className="flex items-center justify-between px-2.5 text-xs text-zinc-400">
      <span>Self-hosted · MIT</span>
      <a href="https://github.com/IliasSami/prism-geo" target="_blank" rel="noreferrer" className="tap-target inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-zinc-200/60 hover:text-zinc-700" aria-label="PrismGEO documentation on GitHub">
        <BookOpen className="h-4 w-4" />
      </a>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-zinc-200 bg-white/90 px-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMobileOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
          >
            <Menu className="h-5 w-5" />
          </button>
          <Logo />
        </div>
        {mobileActions}
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-zinc-900/30 backdrop-blur-[2px] animate-fade-in" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-4 bg-zinc-50 p-3 shadow-pop animate-fade-up">
            <div className="flex items-center justify-between">
              <Logo />
              <button ref={closeRef} onClick={() => setMobileOpen(false)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-200/60" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <BrandSwitcher currentBrandId={brandId} currentBrandName={brandName} currentBrandDomain={brandDomain} />
            <nav className="flex-1 overflow-y-auto" aria-label="Main">
              <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </nav>
            {footer}
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-4 border-r border-zinc-200 bg-zinc-50 p-3 md:flex">
        <div className="px-1 pt-1">
          <Logo />
        </div>
        <BrandSwitcher currentBrandId={brandId} currentBrandName={brandName} currentBrandDomain={brandDomain} />
        <nav className="flex-1 overflow-y-auto" aria-label="Main">
          <NavLinks pathname={pathname} />
        </nav>
        {footer}
      </aside>
    </>
  );
}
