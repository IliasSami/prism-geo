import { hostKey } from "../url/canonical";

/**
 * Entity confusion: an answer that cites or names a domain that looks like the brand's own but
 * is not it (brand northwindvoice.ai, answer about northwindvoiceai.com or northwind-voice.io).
 * Such answers usually describe a different company under the brand's name.
 */

const DOMAIN_IN_TEXT = /(?<![\w@.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?![\w-])/gi;
const FILE_LIKE = /\.(png|jpe?g|gif|svg|webp|pdf|js|css|html?|php|aspx?|json|xml|txt|md|csv|zip)$/i;

/** Domains written in a text ("see northwindvoiceai.com", URLs included), lower-cased, without www. */
export function domainsInText(text: string): string[] {
  const out = new Set<string>();
  for (const m of (text || "").matchAll(DOMAIN_IN_TEXT)) {
    const d = hostKey(m[1]);
    if (!FILE_LIKE.test(d) && /[a-z]/.test(d.split(".").pop() || "")) out.add(d);
  }
  return [...out];
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Lookalike domains of the brand in an answer's text and citations: domains that contain the
 * brand's domain stem (ignoring dashes and dots) but are neither the brand domain nor one of its
 * subdomains. Returns [] when the brand stem is too short to compare safely (< 4 characters).
 */
export function lookalikeDomains(text: string, citationDomains: string[], brandDomain: string): string[] {
  const brand = hostKey(brandDomain);
  if (!brand.includes(".")) return [];
  const labels = brand.split(".");
  const stem = compact(labels[0]);
  if (stem.length < 4) return [];
  const candidates = new Set([...domainsInText(text), ...citationDomains.map(hostKey)]);
  return [...candidates]
    .filter((d) => d && d !== brand && !d.endsWith(`.${brand}`) && compact(d).includes(stem))
    .sort();
}
