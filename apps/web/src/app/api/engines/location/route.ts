import { NextResponse } from "next/server";
import { getSettings } from "@prismgeo/db";
import { connectionCountry, countryCodeFor, countryName } from "@prismgeo/crawler";
import { route } from "../../_lib/http";

export const dynamic = "force-dynamic";

/**
 * Where searches are asked from: the search location (Settings) and the country this computer's
 * browser traffic leaves from (through the proxy, if one is set). A browser here measures the
 * search location only when the two match.
 */
export const GET = route("engines/location GET", async () => {
  const settings = getSettings<{ providerLocation?: string; strictLocation?: boolean }>("engine_settings", {});
  const location = settings.providerLocation?.trim() || "United States";
  const target = countryCodeFor(location);
  const connection = await connectionCountry();
  return NextResponse.json({
    location,
    target: target?.toUpperCase() ?? null,
    connection: connection?.toUpperCase() ?? null,
    connectionName: connection ? countryName(connection) : null,
    browserInMarket: target !== null && connection === target,
    strict: settings.strictLocation !== false,
  });
});
