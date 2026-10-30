import { NextResponse } from "next/server";
import { getCalibration, requestCalibration } from "@prismgeo/crawler";
import { brandFromRequest } from "../../../_lib/brand";
import { jsonError, readJsonObject, route } from "../../../_lib/http";

export const dynamic = "force-dynamic";

/** The last calibration of Google's location signal (uule), with its agreement figures. */
export const GET = route("engines/location/calibrate GET", async () => NextResponse.json({ calibration: getCalibration() }));

/**
 * Starts a calibration for the search location on the client's questions, in the background
 * (about 10 minutes, paced like an audit), or queues it until it can run; poll GET for progress.
 */
export const POST = route("engines/location/calibrate POST", async (request: Request) => {
  // { brandId } (from the MCP connector), else the client selected in the app
  const body = await readJsonObject(request);
  const brandId = typeof body?.brandId === "string" && /^[\w-]{1,80}$/.test(body.brandId) ? body.brandId : brandFromRequest(request)?.id;
  if (!brandId) return jsonError("Add a client with questions first", 400);
  // Runs now when it can; otherwise it waits (no reference route yet, or Google resting) and starts by itself
  const calibration = requestCalibration(brandId);
  return NextResponse.json({ calibration }, { status: 202 });
});
