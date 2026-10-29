import crypto from "node:crypto";
import { getSettings, setSettings } from "@prismgeo/db";
import { jsonError } from "./http";

/**
 * Token for the PrismGEO capture extension. Separate from the Claude connector token: it can only
 * read the question list and save captured answers, never drive the workspace. Created on first
 * use; rotating it signs every installed extension out.
 */
const KEY = "capture_extension_token";

export function getCaptureToken(): string {
  const existing = getSettings<string>(KEY, "");
  if (existing) return existing;
  return rotateCaptureToken();
}

export function rotateCaptureToken(): string {
  const token = `pgc_${crypto.randomBytes(24).toString("base64url")}`;
  setSettings(KEY, token);
  return token;
}

/** null when the request carries the current token; otherwise the 401 to return. */
export function requireCaptureToken(request: Request) {
  const given = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "");
  const expected = Buffer.from(getCaptureToken());
  if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return null;
  return jsonError("The capture token is missing or out of date. Copy it again from PrismGEO → Settings → Engines & access.", 401);
}
