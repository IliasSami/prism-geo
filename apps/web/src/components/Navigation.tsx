"use client";

import { useState, useEffect, useRef } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Target, Link2, MessageSquareText, ListChecks, Cpu, Settings, Menu, X, BookOpen, ChevronDown } from "lucide-react";
import { BrandSwitcher } from "./BrandSwitcher";
import { LogoMark } from "./brand/Logo";

/**
 * Five decision pages plus setup. Labels are the page titles. Old URLs (/sov, /competitors,
 * /fan-out, /brand) redirect, see next.config.
 */
export const navigationGroups = [
  {
    title: "Insights",
    items: [
      { label: "Overview", href: "/", icon: LayoutDashboard },
      { label: "Competitors", href: "/visibility", icon: Users },
      { label: "Gaps", href: "/opportunities", icon: Target },
      { label: "Sources", href: "/citations", icon: Link2 },
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

/** A thin bar at the top of the window while the clicked page loads. */
function PendingBar() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span className="pointer-events-none fixed inset-x-0 top-0 z-[150] h-0.5 overflow-hidden bg-accent-100" role="progressbar" aria-label="Loading page">
      <span className="block h-full w-2/5 bg-accent-600 animate-nav-progress" />
    </span>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="space-y-5">
      {navigationGroups.map((group) => (
        <div key={group.title}>
          <div className="px-2.5 pb-1.5 text-xs font-medium text-zinc-500">{group.title}</div>
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
                    <item.icon className={`h-4 w-4 shrink-0 transition-colors ${isActive ? "text-accent-600" : "text-zinc-500 group-hover:text-zinc-700"}`} aria-hidden />
                    {item.label}
                    <PendingBar />
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
    <Link href="/" className="flex min-h-9 items-center gap-2 rounded-lg text-zinc-900" aria-label="PrismGEO home">
      <LogoMark className="h-7 w-7" />
      <span className="text-md font-semibold tracking-tight">
        Prism<span className="text-zinc-500">GEO</span>
      </span>
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
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  // Any navigation closes the menu (including "Add a client" from the switcher)
  useEffect(() => setMobileOpen(false), [pathname]);

  // While open: body scroll locked, focus trapped inside, Escape closes; focus returns on close
  useEffect(() => {
    if (!mobileOpen) {
      if (wasOpen.current) openerRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setMobileOpen(false);
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])")].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  const openMenu = (e: React.MouseEvent<HTMLElement>) => {
    openerRef.current = e.currentTarget;
    setMobileOpen(true);
  };

  const footer = (
    <div className="flex items-center justify-between px-2.5 text-xs text-zinc-500">
      <span>Self-hosted · MIT</span>
      <a
        href="https://github.com/IliasSami/prism-geo"
        target="_blank"
        rel="noreferrer"
        className="tap-target inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-zinc-200/60 hover:text-zinc-700"
        aria-label="PrismGEO documentation on GitHub"
      >
        <BookOpen className="h-4 w-4" aria-hidden />
      </a>
    </div>
  );

  return (
    <>
      {/* Mobile top bar: menu, the client being viewed, and Run */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-zinc-200 bg-white/95 px-2 backdrop-blur md:hidden">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={openMenu}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <Link href="/" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-900" aria-label="PrismGEO home">
            <LogoMark className="h-6 w-6" />
          </Link>
          {brandName ? (
            <button
              type="button"
              onClick={openMenu}
              className="flex min-w-0 items-center gap-1 rounded-lg px-1.5 text-left hover:bg-zinc-100"
              aria-label={`Client: ${brandName}. Open menu to switch client`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold leading-tight text-zinc-900">{brandName}</span>
                {brandDomain && <span className="block truncate text-xs leading-tight text-zinc-500">{brandDomain}</span>}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
            </button>
          ) : (
            <span className="text-md font-semibold tracking-tight text-zinc-900">
              Prism<span className="text-zinc-500">GEO</span>
            </span>
          )}
        </div>
        {mobileActions}
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-zinc-900/30 backdrop-blur-[2px] animate-fade-in" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div ref={panelRef} className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto bg-zinc-50 p-3 shadow-pop animate-drawer-in">
            <div className="flex items-center justify-between">
              <Logo />
              <button
                ref={closeRef}
                type="button"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-200/60"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <BrandSwitcher currentBrandId={brandId} currentBrandName={brandName} currentBrandDomain={brandDomain} onNavigate={() => setMobileOpen(false)} />
            <nav className="flex-1" aria-label="Main">
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
