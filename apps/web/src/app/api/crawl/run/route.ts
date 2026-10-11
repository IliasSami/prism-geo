import { NextResponse } from "next/server";
import { CrawlerOrchestrator } from "@prismgeo/crawler";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // Run an asynchronous crawl batch for default brand (ilias-sami)
    CrawlerOrchestrator.executeBatch({
      brandId: "brand-ilias-sami",
      sampleSize: 3, // quick interactive batch
      concurrency: 2,
    }).catch((err) => {
      console.error("[API Crawl Run Error]", err);
    });

    return NextResponse.redirect(new URL("/?crawling=true", request.url));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
