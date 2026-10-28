import { NextResponse, type NextRequest } from "next/server";

/**
 * Request protection for a dashboard that has no login.
 *
 * 1. Host allowlist (every page and API route): a site using DNS rebinding can make its own
 *    domain resolve to 127.0.0.1, so its requests arrive with Origin and Host both set to the
 *    attacker's domain and would pass an Origin-equals-Host check. Only answering to known host
 *    names stops it from reading client data, exports or the connector token. Extra names (a
 *    reverse proxy, a LAN name) come from PRISMGEO_URL and PRISMGEO_ALLOWED_HOSTS.
 * 2. Same-origin JSON for mutating API calls: a text/plain body skips the CORS preflight, so
 *    without this any page the user visits could change API keys, the proxy, or start crawls.
 *
 * /api/mcp is exempt from both: it is authenticated by its bearer token and may be reached
 * through a tunnel under another host name.
 */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"];

function allowedHosts(): Set<string> {
  const hosts = new Set(LOCAL_HOSTS);
  const extra = [process.env.PRISMGEO_URL, ...(process.env.PRISMGEO_ALLOWED_HOSTS || "").split(",")];
  for (const entry of extra) {
    const value = entry?.trim();
    if (!value) continue;
    try {
      hosts.add(new URL(value.includes("://") ? value : `http://${value}`).hostname.toLowerCase());
    } catch {}
  }
  return hosts;
}

/** Host name without the port; IPv6 literals keep their brackets, as URL.hostname does. */
function hostname(hostHeader: string): string {
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function middleware(request: NextRequest) {
  const { method, nextUrl, headers } = request;
  if (nextUrl.pathname.startsWith("/api/mcp")) return NextResponse.next();

  // A rebound page is same-origin to itself, so it can also set X-Forwarded-Host: check both
  const forwarded = headers.get("x-forwarded-host");
  const host = forwarded || headers.get("host") || nextUrl.host;
  const allowed = allowedHosts();
  for (const name of [headers.get("host") || nextUrl.host, forwarded].filter(Boolean) as string[]) {
    if (!allowed.has(hostname(name))) {
      return new NextResponse(
        `Host "${hostname(name)}" is not allowed. Add it to PRISMGEO_ALLOWED_HOSTS to serve PrismGEO under this name.`,
        { status: 421, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
  }

  if (!nextUrl.pathname.startsWith("/api/") || method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return NextResponse.next();
  }

  const origin = headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {}
    if (originHost !== host) {
      return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
    }
  }
  const type = headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Requests must be sent as application/json" }, { status: 415 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
