"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Plus, Check, Loader2 } from "lucide-react";
import Link from "next/link";

interface BrandItem {
  id: string;
  name: string;
  domain: string;
  slug: string;
}

export function BrandSwitcher({
  currentBrandId,
  currentBrandName,
  currentBrandDomain,
  onNavigate,
}: {
  currentBrandId?: string;
  currentBrandName?: string;
  currentBrandDomain?: string;
  /** Called when a link inside the switcher navigates (closes the mobile menu). */
  onNavigate?: () => void;
}) {
  const [brands, setBrands] = useState<BrandItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Reload on every open so clients added or deleted elsewhere (Settings, setup) show up
  useEffect(() => {
    fetch("/api/brands", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.brands) {
          setBrands(data.brands);
        }
      })
      .catch(() => {});
  }, [open]);

  // Click & Touch outside listener + Escape listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && open) {
        // Close only the switcher, not the menu around it
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Keyboard navigation inside dropdown list
  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlightedIndex(0);
      } else {
        const nextIndex = e.key === "ArrowDown"
          ? (highlightedIndex + 1) % brands.length
          : (highlightedIndex - 1 + brands.length) % brands.length;
        setHighlightedIndex(nextIndex);
        optionRefs.current[nextIndex]?.focus();
      }
    } else if (e.key === "Enter" || e.key === " ") {
      if (!open) {
        e.preventDefault();
        setOpen(true);
      }
    }
  }

  function handleListKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = (index + 1) % brands.length;
      setHighlightedIndex(nextIndex);
      optionRefs.current[nextIndex]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = (index - 1 + brands.length) % brands.length;
      setHighlightedIndex(prevIndex);
      optionRefs.current[prevIndex]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.nativeEvent.stopImmediatePropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  async function handleSelectBrand(brandId: string) {
    if (brandId === currentBrandId) {
      setOpen(false);
      return;
    }
    setLoading(true);
    setSwitchingId(brandId);
    try {
      const res = await fetch("/api/brands/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      setLoading(false);
      setSwitchingId(null);
    } catch {
      setLoading(false);
      setSwitchingId(null);
    } finally {
      setOpen(false);
    }
  }

  const activeName = currentBrandName || brands.find((b) => b.id === currentBrandId)?.name || "Select a client";
  const activeDomain = currentBrandDomain || brands.find((b) => b.id === currentBrandId)?.domain || "";

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        onKeyDown={handleTriggerKeyDown}
        disabled={loading}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Client: ${activeName}. Switch client`}
        className="group flex h-12 w-full items-center justify-between gap-2 rounded-lg border border-zinc-300 bg-white px-2.5 text-left shadow-sm transition duration-150 hover:border-zinc-300 disabled:opacity-70"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-50 text-sm font-semibold text-accent-700 ring-1 ring-inset ring-accent-200">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : activeName.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-zinc-900">{activeName}</span>
            {activeDomain && <span className="block truncate text-xs text-zinc-500">{activeDomain}</span>}
          </span>
        </span>
        <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Clients"
          className="absolute left-0 right-0 top-full z-50 mt-1.5 origin-top rounded-xl border border-zinc-200 bg-white p-1 shadow-pop animate-scale-in"
        >
          <div className="max-h-64 overflow-y-auto" tabIndex={-1}>
            {brands.map((b, idx) => {
              const isSelected = b.id === currentBrandId;
              const isSwitchingThis = switchingId === b.id;
              return (
                <button
                  key={b.id}
                  ref={(el) => {
                    optionRefs.current[idx] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={loading}
                  onClick={() => handleSelectBrand(b.id)}
                  onKeyDown={(e) => handleListKeyDown(e, idx)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition duration-150 ${
                    isSelected ? "bg-zinc-100" : "hover:bg-zinc-50"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-900">{b.name}</span>
                    <span className="block truncate text-xs text-zinc-500">{b.domain}</span>
                  </span>
                  {isSwitchingThis ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />
                  ) : isSelected ? (
                    <Check className="h-4 w-4 shrink-0 text-accent-600" />
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="mt-1 border-t border-zinc-100 pt-1">
            <Link
              href="/setup"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-accent-700 transition hover:bg-accent-50"
            >
              <Plus className="h-4 w-4" />
              Add a client
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
