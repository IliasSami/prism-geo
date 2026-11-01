import { getSettings } from "@prismgeo/db";

/**
 * Optional outbound proxy from Settings → Crawler (e.g. http://user:pass@host:port). Routing
 * browser engines through a residential or office IP is the self-hosted answer to IP-level
 * rate limits such as Google's "unusual traffic" page. Kept in its own module so profiles.ts can
 * use it without importing browser-session.ts (which imports profiles.ts).
 */
export function getProxyConfig(): { server: string; username?: string; password?: string } | undefined {
  const raw = (getSettings<{ proxyUrl?: string }>("crawler_settings", {}).proxyUrl || process.env.PRISMGEO_PROXY_URL || "").trim();
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return {
      server: `${u.protocol}//${u.host}`,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    console.warn("[Crawler] Ignoring invalid proxy URL in settings");
    return undefined;
  }
}
