import type { Metadata, Viewport } from "next";
import "./globals.css";
import Link from "next/link";
import { Navigation } from "@/components/Navigation";
import { CrawlModal } from "@/components/CrawlModal";
import { getActiveBrand, getRawDb } from "@prismgeo/db";
import { getEngineHealth } from "@/lib/engine-health";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PrismGEO · AI search visibility",
  description: "Self-hosted tracking of how ChatGPT, Gemini, Perplexity and Google AI Overviews mention and cite your brand.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fafafa" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = getActiveBrand();
  const activePromptCount = brand
    ? Number((getRawDb().prepare("SELECT COUNT(*) AS n FROM prompts WHERE brand_id = ? AND active = 1").get(brand.id) as { n: number }).n)
    : 0;

  // Engine health from the latest audits; the header shows what is really working, not what is switched on
  const health = getEngineHealth(brand?.id);
  const enabled = health.filter((h) => h.enabled && h.status !== "not_set_up");
  const working = enabled.filter((h) => h.status === "working").length;
  const troubled = enabled.filter((h) => h.status === "blocked" || h.status === "degraded").length;
  const engineOptions = health.map(({ engine, enabled, status, route, apiFallback, remedy }) => ({ engine, enabled, status, route, apiFallback, remedy }));

  const audit = (compact: boolean) => (
    <CrawlModal brandId={brand?.id} brandName={brand?.name} totalPrompts={activePromptCount} engines={engineOptions} compact={compact} />
  );

  return (
    <html lang="en">
      <body className="min-h-screen md:flex">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow-pop">
          Skip to content
        </a>
        <Navigation brandId={brand?.id} brandName={brand?.name} brandDomain={brand?.domain} mobileActions={brand ? audit(true) : null} />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 hidden h-14 shrink-0 items-center justify-between gap-4 border-b border-zinc-200 bg-zinc-50/80 px-6 backdrop-blur md:flex">
            <div className="min-w-0 text-sm text-zinc-500">
              {brand ? (
                <>
                  <span className="font-medium text-zinc-900">{brand.name}</span>
                  <span className="mx-2 text-zinc-300">/</span>
                  <span>{activePromptCount} active questions</span>
                </>
              ) : (
                "No client yet"
              )}
            </div>
            {brand && (
              <div className="flex items-center gap-2">
                <Link
                  href="/engines"
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 shadow-sm transition hover:border-zinc-300"
                  title="Engine status from the latest audit"
                >
                  <span className={`h-2 w-2 rounded-full ${troubled ? "bg-amber-500" : working ? "bg-emerald-500" : "bg-zinc-300"}`} />
                  <span className="tabular">
                    {/* Before any audit there is nothing to report; "0 working" would read as all broken */}
                    {!working && !troubled ? "Engines not tested yet" : `${working} working${troubled ? ` · ${troubled} blocked` : ""}`}
                  </span>
                </Link>
                {audit(false)}
              </div>
            )}
          </header>

          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8 animate-fade-up">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
