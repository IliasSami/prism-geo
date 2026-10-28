"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Sideways scroller for wide tables. While columns are hidden on the right it fades that edge and
 * shows a "Scroll for more" hint; when it can scroll it is a focusable, labelled region so
 * keyboard users can scroll it with the arrow keys.
 */
export function ScrollArea({
  children,
  label = "Table",
  className,
  hint = true,
  region = true,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  /** Show the "Scroll for more" chip (tables); tab strips only fade. */
  hint?: boolean;
  /** Make it a focusable region (not needed when its children are focusable, e.g. tabs). */
  region?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ scrollable: boolean; atEnd: boolean }>({ scrollable: false, atEnd: true });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const scrollable = el.scrollWidth - el.clientWidth > 4;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      setState((s) => (s.scrollable === scrollable && s.atEnd === atEnd ? s : { scrollable, atEnd }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, []);

  return (
    <div className="relative">
      <div
        ref={ref}
        className={`overflow-x-auto ${state.scrollable ? "fade-right" : ""} ${className || ""}`}
        data-end={state.atEnd ? "true" : "false"}
        {...(state.scrollable && region ? { role: "region", "aria-label": `${label} (scrolls sideways)`, tabIndex: 0 } : {})}
      >
        {children}
      </div>
      {hint && state.scrollable && !state.atEnd && (
        <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-white/95 px-1.5 py-0.5 text-xs font-medium text-zinc-600 shadow-sm ring-1 ring-zinc-200">
          Scroll for more →
        </span>
      )}
    </div>
  );
}
