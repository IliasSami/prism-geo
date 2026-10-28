import { NextResponse } from "next/server";
import { parseBody, route } from "../../_lib/http";
import { resolveBrand } from "../../_lib/brand";
import { crawlStartSchema, startCrawl } from "../../_lib/crawl";

export const dynamic = "force-dynamic";

/**
 * Starts an audit: { brandId?, engines?, sampleSize?, promptLimit? }. Without engines, the engines
 * enabled in Settings run; without sampleSize, the saved default is used. Unknown engines and
 * out-of-range numbers are refused with 400; 409 while an audit runs for the same client.
 */
export const POST = route("crawl/start", async (request: Request) => {
  const parsed = await parseBody(request, crawlStartSchema);
  if (!parsed.ok) return parsed.response;
  const resolved = resolveBrand(request, parsed.data.brandId);
  if (!resolved.ok) return resolved.response;
  const result = startCrawl(resolved.brand, parsed.data);
  return NextResponse.json(result.body, { status: result.ok ? 200 : result.status });
});
