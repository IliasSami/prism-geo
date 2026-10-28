"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "@/components/ui";

/**
 * Right-side sheet. Traps focus while open, closes on Escape or backdrop click, and returns
 * focus to the element that opened it.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const focusables = [
        ...panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'),
      ].filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-zinc-900/30 animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-pop"
        style={{ animation: "drawer-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both" }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id="drawer-title" className="text-md font-semibold text-zinc-900">
              {title}
            </h2>
            {subtitle && <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-zinc-500">{subtitle}</div>}
          </div>
          <IconButton aria-label="Close" onClick={onClose} data-autofocus>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-zinc-100 px-5 py-3">{footer}</div>}
      </div>
      <style>{`@keyframes drawer-in { from { transform: translateX(24px); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>
    </div>
  );
}

export interface HighlightGroup {
  terms: string[];
  isBrand: boolean;
}

const escapeRegex = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits text into plain and <mark>ed parts for your brand and tracked competitors. */
export function Highlighted({ text, groups }: { text: string; groups: HighlightGroup[] }) {
  const entries = groups
    .flatMap((g) => g.terms.map((t) => ({ term: t.trim(), isBrand: g.isBrand })))
    .filter((e) => e.term.length >= 3)
    .sort((a, b) => b.term.length - a.term.length);
  if (entries.length === 0) return <>{text}</>;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${entries.map((e) => escapeRegex(e.term)).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const brandTerms = new Set(entries.filter((e) => e.isBrand).map((e) => e.term.toLowerCase()));
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    const isBrand = brandTerms.has(m[0].toLowerCase());
    parts.push(
      <mark key={i} className={isBrand ? "rounded bg-accent-100 px-0.5 text-accent-700" : "rounded bg-amber-100 px-0.5 text-amber-900"}>
        {m[0]}
      </mark>
    );
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
