import { NextResponse } from "next/server";
import { calibrateLocation, getCalibration } from "@prismgeo/crawler";
import { brandFromRequest } from "../../../_lib/brand";
import { jsonError, readJsonObject, route } from "../../../_lib/http";

export const dynamic = "force-dynamic";

/** The last calibration of Google's location signal (uule), with its agreement figures. */
export const GET = route("engines/location/calibrate GET", async () => NextResponse.json({ calibration: getCalibration() }));

/**
 * Starts a calibration for the search location on the active client's questions. It runs in the
 * background (about 10 minutes, paced like an audit); poll GET for progress.
 */
export const POST = route("engines/location/calibrate POST", async (request: Request) => {
  // { brandId } (from the MCP connector), else the client selected in the app
  const body = await readJsonObject(request);
  const brandId = typeof body?.brandId === "string" && /^[\w-]{1,80}$/.test(body.brandId) ? body.brandId : brandFromRequest(request)?.id;
  if (!brandId) return jsonError("Add a client with questions first", 400);
  if (getCalibration()?.status === "running") return jsonError("A calibration is already running", 409);
  const started = calibrateLocation(brandId);
  // Errors before the first search (no reference route, no questions) are returned directly
  const early = await Promise.race([started.then(() => null, (e: Error) => e), new Promise<null>((r) => setTimeout(() => r(null), 300))]);
  if (early) return jsonError(early.message, 400);
  started.catch(() => null);
  return NextResponse.json({ started: true, calibration: getCalibration() }, { status: 202 });
});
