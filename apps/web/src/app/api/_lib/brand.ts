import type { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getActiveBrand, getAllBrands, type BrandRecord } from "@prismgeo/db";
import { jsonError, type ErrorBody } from "./http";

/**
 * Which client (brand) a request is about.
 *
 * The active client used to be one server-wide setting, so a teammate switching clients changed
 * what everyone else was editing. Now each browser remembers its own choice in the
 * prism_active_brand cookie, and requests resolve the brand in this order:
 *   1. an explicit brandId in the body or query (always wins; 404 if it does not exist),
 *   2. the browser's cookie, when it names a client that still exists,
 *   3. the server-wide active client (also the default for the MCP connector and the CLI).
 */
export const ACTIVE_BRAND_COOKIE = "prism_active_brand";
const MAX_AGE = 60 * 60 * 24 * 365;

export function findBrand(idOrSlug: string): BrandRecord | undefined {
  return getAllBrands().find((b) => b.id === idOrSlug || b.slug === idOrSlug);
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** The brand chosen by cookie, else the server-wide active brand. */
export function defaultBrandFor(cookieValue: string | undefined): BrandRecord | undefined {
  const fromCookie = cookieValue ? findBrand(cookieValue) : undefined;
  return fromCookie ?? getActiveBrand();
}

/** The brand remembered by this request's browser (cookie), else the server-wide active brand. */
export function brandFromRequest(request: Request): BrandRecord | undefined {
  return defaultBrandFor(readCookie(request.headers.get("cookie"), ACTIVE_BRAND_COOKIE));
}

type Resolved = { ok: true; brand: BrandRecord } | { ok: false; response: NextResponse<ErrorBody> };

/**
 * Resolves the brand a request acts on. `explicit` is the brandId from the body or query; when
 * it is given it must name an existing client. Mutating routes must call this and use the
 * returned brand, so a write never lands on a client that does not exist.
 */
export function resolveBrand(request: Request, explicit?: string | null): Resolved {
  if (explicit !== undefined && explicit !== null && explicit !== "") {
    const brand = findBrand(explicit);
    return brand ? { ok: true, brand } : { ok: false, response: jsonError("That client does not exist (it may have been deleted). Reload the page.", 404) };
  }
  const brand = brandFromRequest(request);
  return brand ? { ok: true, brand } : { ok: false, response: jsonError("No client yet. Create one in Setup first.", 400) };
}

/**
 * Remembers the client for this browser. `secure` follows the request's scheme, so the cookie
 * also works on plain-HTTP hosts (localhost, a LAN name) and is HTTPS-only behind TLS.
 */
export function setActiveBrandCookie(response: NextResponse, brandId: string, request: Request): void {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const secure = (forwardedProto || new URL(request.url).protocol.replace(":", "")) === "https";
  response.cookies.set(ACTIVE_BRAND_COOKIE, brandId, { path: "/", sameSite: "lax", httpOnly: true, secure, maxAge: MAX_AGE });
}

/**
 * For server components and pages: the client this browser has selected (cookie), falling back
 * to the server-wide active client. Pages should call this instead of getActiveBrand() from
 * @prismgeo/db so each browser keeps its own client.
 *
 *   const brand = await activeBrandFromCookies();
 */
export async function activeBrandFromCookies(): Promise<BrandRecord | undefined> {
  const store = await cookies();
  return defaultBrandFor(store.get(ACTIVE_BRAND_COOKIE)?.value);
}
