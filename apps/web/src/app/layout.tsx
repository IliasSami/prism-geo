import type { Metadata } from "next";
import "./globals.css";
import { Navigation } from "@/components/Navigation";
import { CrawlModal } from "@/components/CrawlModal";
import { getActiveBrand } from "@prismgeo/db";
import Link from "next/link";
import { PlusCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "PrismGEO | Generative Engine Observability & AI Visibility",
  description: "Open-Source, Local-First AI Search Visibility Suite for Modern Agencies",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const brand = getActiveBrand();

  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased flex flex-col md:flex-row">
        {/* Navigation (Responsive Mobile Drawer + Desktop Sidebar) */}
        <Navigation
          brandId={brand?.id}
          brandName={brand?.name}
          brandDomain={brand?.domain}
        />

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* Top Bar (Enterprise Header with Breadcrumbs & Action Bar) */}
          <header className="h-14 border-b border-slate-200 bg-white/90 backdrop-blur px-4 md:px-6 flex items-center justify-between shrink-0 sticky top-0 z-20">
            <div className="flex items-center space-x-2 md:space-x-3 overflow-hidden text-xs">
              <span className="font-semibold text-slate-500 uppercase tracking-wider truncate">
                PrismGEO
              </span>
              <span className="text-slate-300">/</span>
              <span className="font-bold text-slate-800 truncate">
                {brand?.name || "Client Workspace"}
              </span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <span className="font-mono text-[11px] text-sky-700 bg-sky-50 border border-sky-200/60 px-2 py-0.5 rounded-md hidden sm:inline shrink-0">
                {brand?.domain || "unassigned"}
              </span>
            </div>

            <div className="flex items-center space-x-2 md:space-x-3 shrink-0">
              <div className="hidden lg:flex items-center space-x-1.5 text-xs text-slate-600 bg-emerald-50 border border-emerald-200/60 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="font-medium text-emerald-800 text-[11px]">5 Engines Active</span>
              </div>

              <Link
                href="/setup"
                className="hidden sm:inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition space-x-1 border border-slate-200"
              >
                <PlusCircle className="w-3.5 h-3.5 text-slate-500" />
                <span>New Client</span>
              </Link>

              {/* Interactive Monte Carlo Run Modal Trigger */}
              <CrawlModal brandId={brand?.id} brandName={brand?.name} />
            </div>
          </header>

          {/* Dynamic Page Views */}
          <div className="p-4 md:p-8 flex-1">{children}</div>
        </main>
      </body>
    </html>
  );
}
