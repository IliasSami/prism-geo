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
}: {
  currentBrandId?: string;
  currentBrandName?: string;
  currentBrandDomain?: string;
}) {
  const [brands, setBrands] = useState<BrandItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    fetch("/api/brands")
      .then((res) => res.json())
      .then((data) => {
        if (data.brands) {
          setBrands(data.brands);
        }
      })
      .catch(() => {});
  }, []);

  // Click & Touch outside listener + Escape listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && open) {
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
      }
    } catch (e) {
      console.error(e);
      setLoading(false);
      setSwitchingId(null);
    } finally {
      setOpen(false);
    }
  }

  const activeName = currentBrandName || brands.find((b) => b.id === currentBrandId)?.name || "Select Client";
  const activeDomain = currentBrandDomain || brands.find((b) => b.id === currentBrandId)?.domain || "Domain grounding";

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        onKeyDown={handleTriggerKeyDown}
        disabled={loading}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Active Client Brand Switcher"
        className="w-full text-left p-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex items-center justify-between group focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-75"
      >
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-sky-600/20 border border-sky-500/30 flex items-center justify-center font-bold text-sky-400 text-xs shrink-0">
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
            ) : (
              activeName.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0 truncate">
            <span className="block text-xs font-semibold text-white tracking-tight truncate group-hover:text-sky-300 transition">
              {activeName}
            </span>
            <span className="block text-[11px] text-slate-400 font-mono truncate">
              {activeDomain}
            </span>
          </div>
        </div>

        {loading ? (
          <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0 ml-2" />
        ) : (
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ml-2 ${
              open ? "rotate-180 text-sky-400" : ""
            }`}
          />
        )}
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Tracked Clients & Brands"
          className="absolute left-0 right-0 top-full mt-1.5 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-1.5 z-50 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <div className="px-2 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800/80 mb-1 flex items-center justify-between">
            <span>Tracked Clients & Brands</span>
            <span className="text-[9px] font-mono text-slate-500">{brands.length} active</span>
          </div>

          <div className="max-h-56 overflow-y-auto space-y-0.5" tabIndex={-1}>
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
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between transition focus:outline-none focus:ring-1 focus:ring-sky-500 ${
                    isSelected
                      ? "bg-sky-600/20 text-white font-medium border border-sky-500/30"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <div className="min-w-0 truncate">
                    <div className="font-semibold truncate flex items-center space-x-1.5">
                      <span>{b.name}</span>
                      {isSelected && (
                        <span className="text-[9px] font-mono text-sky-400 bg-sky-950 px-1 py-0.2 rounded border border-sky-800">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono truncate">
                      {b.domain}
                    </div>
                  </div>
                  {isSwitchingThis ? (
                    <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0 ml-2" />
                  ) : isSelected ? (
                    <Check className="w-3.5 h-3.5 text-sky-400 shrink-0 ml-2" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="border-t border-slate-800/80 pt-1 mt-1">
            <Link
              href="/setup"
              onClick={() => setOpen(false)}
              className="w-full text-left px-2.5 py-2 rounded-lg text-xs text-sky-400 hover:bg-sky-950/40 hover:text-sky-300 flex items-center space-x-2 font-medium transition focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Onboard New Brand</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
