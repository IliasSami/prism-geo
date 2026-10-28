"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { IconButton } from "@/components/ui";

export type { HighlightGroup } from "./Markdown";

/**
 * Right-side sheet (full screen on phones), rendered into document.body so no animated or
 * transformed ancestor can become its containing block. Locks page scroll, scrolls its own body,
 * traps focus, closes on Escape or backdrop click, and returns focus to the element that opened it.
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
  const [mounted, setMounted] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus());

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const focusables = [
        ...panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'),
      ].filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!panel.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
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
      const el = opener.current as HTMLElement | null;
      if (el && document.contains(el)) el.focus?.();
    };
  }, [open]);

  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex justify-end">
      <div className="absolute inset-0 bg-zinc-900/30 backdrop-blur-[2px] animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className="relative flex h-[100dvh] w-full max-w-2xl flex-col bg-white shadow-pop animate-sheet-in sm:animate-drawer-in"
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
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4" tabIndex={0} role="region" aria-label="Answer details">
          {children}
        </div>
        {footer && <div className="border-t border-zinc-100 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
