import { NextResponse } from "next/server";
import { route } from "../../_lib/http";
import { getCaptureToken, rotateCaptureToken } from "../../_lib/capture-auth";

export const dynamic = "force-dynamic";

/** The capture extension token, for Settings. Same-origin only (see middleware). */
export const GET = route("capture token", async () => NextResponse.json({ token: getCaptureToken() }));

/** A new token; installed extensions must be given the new one. */
export const POST = route("capture token rotate", async () => NextResponse.json({ token: rotateCaptureToken() }));
