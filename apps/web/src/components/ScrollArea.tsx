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
      {/* A reserved caption line, not an overlay: an overlay always hid some column header */}
      {hint && state.scrollable && (
        <div aria-hidden className="flex justify-end px-3 pb-1 pt-2">
          <span className={`text-xs font-medium text-zinc-500 transition-opacity duration-150 ${state.atEnd ? "opacity-0" : "opacity-100"}`}>Scroll for more →</span>
        </div>
      )}
      <div
        ref={ref}
        className={`overflow-x-auto ${state.scrollable ? "fade-right" : ""} ${className || ""}`}
        data-end={state.atEnd ? "true" : "false"}
        {...(state.scrollable && region ? { role: "region", "aria-label": `${label} (scrolls sideways)`, tabIndex: 0 } : {})}
      >
        {children}
      </div>
    </div>
  );
}
