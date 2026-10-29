import { NextResponse } from "next/server";
import { z } from "zod";
import { reanalyzeBrand } from "@prismgeo/crawler";
import { jsonError, parseBody, route } from "../_lib/http";
import { resolveBrand } from "../_lib/brand";
import { brandIdSchema } from "../_lib/validate";

export const dynamic = "force-dynamic";

/**
 * Re-checks every stored answer of a client with the current competitor list, aliases and
 * detection rules: { brandId? }. Answers themselves are never changed.
 */
export const POST = route("reanalyze", async (request: Request) => {
  const parsed = await parseBody(request, z.object({ brandId: brandIdSchema }));
  if (!parsed.ok) return parsed.response;
  const resolved = resolveBrand(request, parsed.data.brandId);
  if (!resolved.ok) return resolved.response;
  try {
    return NextResponse.json({ success: true, ...reanalyzeBrand(resolved.brand.id) });
  } catch (err) {
    const message = (err as Error).message;
    if (/audit is running/.test(message)) return jsonError(message, 409);
    throw err;
  }
});
