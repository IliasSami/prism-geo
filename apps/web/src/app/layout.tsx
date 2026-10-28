import type { Metadata, Viewport } from "next";
import "./globals.css";
import Link from "next/link";
import { Navigation } from "@/components/Navigation";
import { AuditProvider, AuditTrigger } from "@/components/CrawlModal";
import { HideOn } from "@/components/HideOn";
import { getRawDb } from "@prismgeo/db";
import { activeBrandFromCookies } from "@/app/api/_lib/brand";
import { engineSummary, getEngineViews, getLatestAudit } from "@/components/insights/engine-state";
import { formatWhen } from "@/components/ui";

export const dynamic = "force-dynamic";

function siteUrl(): URL {
  try {
    return new URL(process.env.PRISMGEO_URL || "http://localhost:3333");
  } catch {
    return new URL("http://localhost:3333");
  }
}

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  applicationName: "PrismGEO",
  title: { default: "PrismGEO", template: "%s · PrismGEO" },
  description:
    "Track how AI assistants name your brand. Self-hosted tracking of how ChatGPT, Gemini, Perplexity and Google AI Overviews mention and cite you versus competitors.",
  openGraph: { siteName: "PrismGEO", type: "website", title: "PrismGEO", description: "Track how AI assistants name your brand." },
  twitter: { card: "summary_large_image", title: "PrismGEO", description: "Track how AI assistants name your brand." },
  // A private dashboard should never be indexed
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#FAFAFA" };

const DOT: Record<string, string> = { success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-red-500", neutral: "bg-zinc-400" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const brand = await activeBrandFromCookies();
  const activePromptCount = brand
    ? Number((getRawDb().prepare("SELECT COUNT(*) AS n FROM prompts WHERE brand_id = ? AND active = 1").get(brand.id) as { n: number }).n)
    : 0;

  // Engine state from the latest audits; the header shows what is really working, not what is switched on
  const views = getEngineViews(brand?.id);
  const summary = engineSummary(views);
  const latest = getLatestAudit(brand?.id);
  const engineOptions = views.map((v) => ({
    engine: v.engine,
    enabled: v.enabled,
    state: v.state,
    label: v.label,
    tone: v.tone,
    reason: v.reason,
    route: v.health.route,
    apiFallback: v.health.apiFallback,
  }));

  return (
    <html lang="en">
      <body className="min-h-screen md:flex">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow-pop">
          Skip to content
        </a>
        <AuditProvider brandId={brand?.id} brandName={brand?.name} totalPrompts={activePromptCount} engines={engineOptions}>
          <Navigation
            brandId={brand?.id}
            brandName={brand?.name}
            brandDomain={brand?.domain}
            mobileActions={
              brand ? (
                <HideOn prefix="/setup">
                  <AuditTrigger compact />
                </HideOn>
              ) : null
            }
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 hidden h-14 shrink-0 items-center justify-between gap-4 border-b border-zinc-200 bg-zinc-50/80 px-6 backdrop-blur md:flex">
              <div className="min-w-0 truncate text-sm text-zinc-500 tabular">
                {brand ? (
                  <>
                    {activePromptCount} active {activePromptCount === 1 ? "question" : "questions"}
                    {latest && <> · last audit {formatWhen(latest.at)}</>}
                  </>
                ) : (
                  "No client yet"
                )}
              </div>
              {brand && (
                <HideOn prefix="/setup">
                  <div className="flex items-center gap-2">
                    <Link
                      href="/engines"
                      className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-700 shadow-sm transition hover:border-zinc-400"
                      title={summary.title}
                      aria-label={`Engines: ${summary.text}. Open the Engines page`}
                    >
                      <span className={`h-2 w-2 rounded-full ${DOT[summary.tone] || DOT.neutral}`} aria-hidden />
                      <span className="tabular">{summary.text}</span>
                    </Link>
                    <AuditTrigger />
                  </div>
                </HideOn>
              )}
            </header>

            <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">
              {children}
            </main>
          </div>
        </AuditProvider>
      </body>
    </html>
  );
}
