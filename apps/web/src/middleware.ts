import { NextResponse, type NextRequest } from "next/server";

/**
 * Request protection for a dashboard that has no login.
 *
 * 1. Host allowlist (every page, API route and /_next/image): a site using DNS rebinding can make
 *    its own domain resolve to 127.0.0.1, so its requests arrive with Origin and Host both set to
 *    the attacker's domain and would pass an Origin-equals-Host check. Only answering to known
 *    host names stops it from reading client data, exports or the connector token. Extra names
 *    (a reverse proxy, a LAN name) come from PRISMGEO_URL and PRISMGEO_ALLOWED_HOSTS.
 * 2. Same-origin only for every API call (Sec-Fetch-Site and Origin): GETs too, since a GET can
 *    start a backup or return the connector token.
 * 3. JSON for mutating API calls: a text/plain body skips the CORS preflight, so without this any
 *    page the user visits could change API keys, the proxy, or start crawls.
 *
 * /api/mcp (exactly, or below it) is exempt from both: it is authenticated by its bearer token
 * and may be reached through a tunnel under another host name.
 *
 * 0.0.0.0 is deliberately not allowed: some browsers let public pages send requests to
 * http://0.0.0.0:port, which would reach a dashboard bound to all interfaces.
 */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** Host name without the port; IPv6 literals keep their brackets, as URL.hostname does. */
function hostname(hostHeader: string): string {
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function buildAllowedHosts(env: Record<string, string | undefined> = process.env): Set<string> {
  const hosts = new Set(LOCAL_HOSTS);
  const extra = [env.PRISMGEO_URL, ...(env.PRISMGEO_ALLOWED_HOSTS || "").split(",")];
  for (const entry of extra) {
    const value = entry?.trim();
    if (!value) continue;
    let name = "";
    try {
      name = value.includes("://") ? new URL(value).hostname.toLowerCase() : hostname(value);
    } catch {}
    if (name && name !== "0.0.0.0") hosts.add(name);
  }
  return hosts;
}

// Computed once: the environment does not change while the server runs
const ALLOWED_HOSTS = buildAllowedHosts();

export function isMcpPath(pathname: string): boolean {
  return pathname === "/api/mcp" || pathname.startsWith("/api/mcp/");
}

/** The routes the capture extension calls with its bearer token. */
export function isCaptureTokenPath(pathname: string): boolean {
  return pathname === "/api/capture" || pathname === "/api/capture/context";
}

/**
 * Whether a request comes from the dashboard itself (or a typed URL, or a tool like curl).
 * Browsers send Sec-Fetch-Site on every request; Origin is checked too for older browsers.
 */
export function sameOrigin(fetchSite: string | null, origin: string | null, host: string): boolean {
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {}
    if (originHost !== host) return false;
  }
  return true;
}

export function middleware(request: NextRequest) {
  const { method, nextUrl, headers } = request;
  if (isMcpPath(nextUrl.pathname)) return NextResponse.next();

  // A rebound page is same-origin to itself, so it can also set X-Forwarded-Host: check both
  const forwarded = headers.get("x-forwarded-host");
  const host = forwarded || headers.get("host") || nextUrl.host;
  for (const name of [headers.get("host") || nextUrl.host, forwarded].filter(Boolean) as string[]) {
    if (!ALLOWED_HOSTS.has(hostname(name))) {
      return new NextResponse(
        `Host "${hostname(name)}" is not allowed. Add it to PRISMGEO_ALLOWED_HOSTS to serve PrismGEO under this name.`,
        { status: 421, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
  }

  if (!nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  const readOnly = method === "GET" || method === "HEAD" || method === "OPTIONS";

  // The capture extension calls from its own origin and authenticates with its capture token
  // (checked in the route). Token management (/api/capture/token) stays same-origin only.
  if (isCaptureTokenPath(nextUrl.pathname) && /^Bearer\s+\S/i.test(headers.get("authorization") || "")) {
    const type = headers.get("content-type") || "";
    if (!readOnly && !type.toLowerCase().startsWith("application/json")) {
      return NextResponse.json({ error: "Requests must be sent as application/json" }, { status: 415 });
    }
    return NextResponse.next();
  }

  // Every method: a GET can start a backup or read the connector and capture tokens, so another
  // site (or a site on a sibling subdomain) may not call the API at all
  if (!sameOrigin(headers.get("sec-fetch-site"), headers.get("origin"), host)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  if (readOnly) return NextResponse.next();

  const type = headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Requests must be sent as application/json" }, { status: 415 });
  }
  return NextResponse.next();
}

// /_next/image is matched too, so the image optimizer (disabled in next.config) never answers a foreign Host
export const config = { matcher: ["/((?!_next/static|favicon.ico).*)"] };
