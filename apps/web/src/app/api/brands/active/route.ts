import { NextResponse } from "next/server";
import { z } from "zod";
import { setActiveBrand } from "@prismgeo/db";
import { jsonError, parseBody, route } from "../../_lib/http";
import { findBrand, setActiveBrandCookie } from "../../_lib/brand";
import { idSchema } from "../../_lib/validate";

export const dynamic = "force-dynamic";

const schema = z.object({ brandId: idSchema("brandId") });

/**
 * Selects a client for this browser (cookie). It also becomes the server-wide default used by
 * the MCP connector, the CLI and browsers that have not chosen a client yet.
 */
export const POST = route("brands/active", async (request: Request) => {
  const parsed = await parseBody(request, schema);
  if (!parsed.ok) return parsed.response;
  const brand = findBrand(parsed.data.brandId);
  if (!brand) return jsonError("That client does not exist (it may have been deleted)", 404);
  setActiveBrand(brand.id);
  const response = NextResponse.json({ success: true, activeBrand: brand });
  setActiveBrandCookie(response, brand.id, request);
  return response;
});
