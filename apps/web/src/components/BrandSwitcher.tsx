"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Plus, Check, Building2, ExternalLink } from "lucide-react";
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
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSelectBrand(brandId: string) {
    if (brandId === currentBrandId) {
      setOpen(false);
      return;
    }
    setLoading(true);
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
    } finally {
      setLoading(false);
      setOpen(false);
    }
  }

  const activeName = currentBrandName || brands.find((b) => b.id === currentBrandId)?.name || "Select Client";
  const activeDomain = currentBrandDomain || brands.find((b) => b.id === currentBrandId)?.domain || "Domain grounding";

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        className="w-full text-left p-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex items-center justify-between group focus:outline-none focus:ring-1 focus:ring-sky-500"
      >
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-sky-600/20 border border-sky-500/30 flex items-center justify-center font-bold text-sky-400 text-xs shrink-0">
            {activeName.charAt(0)}
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
        <ChevronDown
          className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ml-2 ${
            open ? "rotate-180 text-sky-400" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-1.5 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="px-2 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800/80 mb-1">
            Tracked Clients & Brands
          </div>

          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {brands.map((b) => {
              const isSelected = b.id === currentBrandId;
              return (
                <button
                  key={b.id}
                  onClick={() => handleSelectBrand(b.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between transition ${
                    isSelected
                      ? "bg-sky-600/20 text-white font-medium border border-sky-500/30"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <div className="min-w-0 truncate">
                    <div className="font-semibold truncate">{b.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono truncate">
                      {b.domain}
                    </div>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-sky-400 shrink-0 ml-2" />}
                </button>
              );
            })}
          </div>

          <div className="border-t border-slate-800/80 pt-1 mt-1">
            <Link
              href="/setup"
              onClick={() => setOpen(false)}
              className="w-full text-left px-2.5 py-2 rounded-lg text-xs text-sky-400 hover:bg-sky-950/40 hover:text-sky-300 flex items-center space-x-2 font-medium transition"
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
