"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/components/ui";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

/**
 * Accessible tab list (WAI-ARIA tabs pattern): roving tabindex, arrow keys / Home / End move
 * between tabs, and each tab controls the panel with id `panel-<id>`.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  label: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusTab = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div role="tablist" aria-label={label} className="flex min-w-max gap-1 border-b border-zinc-200">
        {tabs.map((tab, i) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={`tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") (e.preventDefault(), focusTab(i + 1));
                else if (e.key === "ArrowLeft") (e.preventDefault(), focusTab(i - 1));
                else if (e.key === "Home") (e.preventDefault(), focusTab(0));
                else if (e.key === "End") (e.preventDefault(), focusTab(tabs.length - 1));
              }}
              className={cn(
                "-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-base font-medium transition duration-150",
                selected ? "border-accent-600 text-zinc-900" : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TabPanel({ id, active, children }: { id: string; active: string; children: ReactNode }) {
  if (id !== active) return null;
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0} className="space-y-6 pt-6 focus:outline-none stagger">
      {children}
    </div>
  );
}
