import { isGenericHost } from "../text/mentions";
import { domainMatches } from "./canonical";

const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * A competitor's website as typed or pasted, reduced to what PrismGEO stores. Same host rule as
 * the app's domain fields ("https://www.Example.com:443/pricing" -> "example.com"), except that a
 * marketplace or review host keeps the listing path ("apps.shopify.com/hoop-voice"), because the
 * listing is the only part of that host that is the competitor's. A bare marketplace host and the
 * brand's own domain (or one of its subdomains) are refused.
 */
export function normalizeCompetitorDomain(input: string, brandDomain?: string | null): { ok: true; domain: string } | { ok: false; error: string } {
  const value = (input || "").trim().toLowerCase();
  const invalid = { ok: false as const, error: `"${input}" is not a domain like example.com` };
  if (!value || /\s/.test(value)) return invalid;
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `http://${value}`);
  } catch {
    return invalid;
  }
  const host = url.hostname.replace(/^www\./, "").replace(/\.$/, "");
  if (!HOSTNAME.test(host)) return invalid;
  if (brandDomain && domainMatches(host, brandDomain)) return { ok: false, error: `${host} is the brand's own site, not a competitor` };
  if (!isGenericHost(host)) return { ok: true, domain: host };
  const path = url.pathname.replace(/\/+$/, "");
  if (!path) return { ok: false, error: `${host} is a marketplace or review site: use the competitor's listing URL there (e.g. ${host}/their-page)` };
  return { ok: true, domain: `${host}${path}` };
}
