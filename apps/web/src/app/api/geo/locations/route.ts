import { NextResponse } from "next/server";
import { SEARCH_COUNTRIES } from "@prismgeo/core";
import { geotargetsInfo, loadGeotargets, searchGeotargets } from "@prismgeo/crawler";
import { jsonError, route } from "../../_lib/http";

export const dynamic = "force-dynamic";

/**
 * Places in a search country as Google names them (cities, states, postal codes), for the search
 * location picker: GET ?country=us&q=chica. The first call downloads Google's list (about 4 MB).
 */
export const GET = route("geo/locations GET", async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const country = (params.get("country") || "").toLowerCase();
  const q = (params.get("q") || "").slice(0, 80);
  if (!SEARCH_COUNTRIES.some((c) => c.code === country)) return jsonError("Choose one of the listed countries", 400);
  try {
    const places = searchGeotargets(await loadGeotargets(), country, q).map((t) => ({ name: t.name, canonicalName: t.canonicalName, type: t.type }));
    return NextResponse.json({ places, source: geotargetsInfo() });
  } catch (err) {
    return jsonError(`Google's location list could not be downloaded: ${(err as Error).message}`, 502);
  }
});
