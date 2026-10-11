"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  PieChart,
  MessageSquare,
  Quote,
  Lightbulb,
  Settings,
  Compass,
  ShieldCheck,
  Menu,
  X,
  User,
  Database,
} from "lucide-react";
import { BrandSwitcher } from "./BrandSwitcher";

const navigation = [
  { name: "Overview", href: "/", icon: Activity },
  { name: "Share of Voice (CSoV)", href: "/sov", icon: PieChart },
  { name: "Citations & Sources", href: "/citations", icon: Quote },
  { name: "Responses & Fan-Out", href: "/responses", icon: MessageSquare },
  { name: "Prompts & Scenarios", href: "/prompts", icon: Compass },
  { name: "Opportunities", href: "/opportunities", icon: Lightbulb },
  { name: "Settings & Engine Hub", href: "/settings", icon: Settings },
];

export function Navigation({
  brandId = "brand-outcraft-ai",
  brandName = "Outcraft AI",
  brandDomain = "outcraft.ai",
}: {
  brandId?: string;
  brandName?: string;
  brandDomain?: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile Top Header */}
      <div className="md:hidden bg-slate-950 text-white border-b border-slate-800 px-4 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center space-x-2.5">
          <div className="w-7 h-7 rounded-lg bg-sky-600 flex items-center justify-center font-black text-white text-xs shadow-md">
            P
          </div>
          <div>
            <span className="font-bold text-sm tracking-tight text-white block">
              PrismGEO
            </span>
            <span className="text-[10px] text-sky-400 font-mono block">
              {brandDomain}
            </span>
          </div>
        </div>

        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
          aria-label="Toggle Navigation"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileOpen && (
        <div className="md:hidden bg-slate-950 text-slate-200 border-b border-slate-800 p-4 space-y-3 z-40 fixed inset-x-0 top-[53px] shadow-2xl max-h-[85vh] overflow-y-auto">
          {/* Brand Switcher inside Mobile Drawer */}
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1.5">
              Current Client / Brand
            </div>
            <BrandSwitcher
              currentBrandId={brandId}
              currentBrandName={brandName}
              currentBrandDomain={brandDomain}
            />
          </div>

          <div className="border-t border-slate-800/80 pt-2 space-y-1">
            {navigation.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center px-3 py-2.5 text-xs font-medium rounded-lg transition-colors ${
                    isActive
                      ? "bg-sky-600 text-white shadow-sm"
                      : "text-slate-300 hover:text-white hover:bg-slate-900"
                  }`}
                >
                  <item.icon
                    className={`mr-3 h-4 w-4 ${
                      isActive ? "text-white" : "text-slate-400"
                    }`}
                  />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Desktop Left Sidebar */}
      <aside className="hidden md:flex w-64 bg-slate-950 text-slate-200 border-r border-slate-800 flex-col shrink-0 h-screen sticky top-0">
        {/* App Logo & Header */}
        <div className="p-4 border-b border-slate-800/90 flex items-center justify-between">
          <Link href="/" className="flex items-center space-x-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center font-black text-white shadow-md shadow-sky-500/20 group-hover:scale-105 transition-transform">
              P
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight text-white block">
                PrismGEO
              </span>
              <span className="text-[10px] text-sky-400 font-mono tracking-wider block">
                Enterprise AI Observability
              </span>
            </div>
          </Link>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 font-mono">
            v2.0
          </span>
        </div>

        {/* Brand Switcher (Elmo-Style Multi-Tenant Client Picker) */}
        <div className="p-3 border-b border-slate-800/80 bg-slate-900/40">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 px-0.5">
            Active Workspace
          </div>
          <BrandSwitcher
            currentBrandId={brandId}
            currentBrandName={brandName}
            currentBrandDomain={brandDomain}
          />
        </div>

        {/* Consolidated 7 Navigation Items */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center px-3 py-2 text-xs font-medium rounded-lg transition-colors group ${
                  isActive
                    ? "bg-sky-600 text-white shadow-sm"
                    : "text-slate-300 hover:text-white hover:bg-slate-900"
                }`}
              >
                <item.icon
                  className={`mr-3 h-4 w-4 transition-colors ${
                    isActive
                      ? "text-white"
                      : "text-slate-400 group-hover:text-sky-400"
                  }`}
                />
                <span className="truncate">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* User Account / Session Pill (Elmo Style) */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-900/30">
          <div className="flex items-center space-x-2.5 px-1 py-1">
            <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 text-xs shrink-0">
              <User className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0 truncate">
              <span className="block text-xs font-medium text-slate-200 truncate">
                Agency Lead
              </span>
              <span className="block text-[10px] text-slate-500 font-mono truncate">
                admin@agency.local
              </span>
            </div>
          </div>
        </div>

        {/* System & Telemetry Bar */}
        <div className="p-2.5 border-t border-slate-800/80 text-[10px] text-slate-500 flex items-center justify-between font-mono bg-slate-950">
          <span className="flex items-center text-emerald-400">
            <ShieldCheck className="w-3 h-3 mr-1" />
            Zero-Cost Stealth
          </span>
          <span className="flex items-center text-slate-400">
            <Database className="w-3 h-3 mr-1 text-sky-400" />
            SQLite WAL
          </span>
        </div>
      </aside>
    </>
  );
}
