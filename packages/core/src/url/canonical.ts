/**
 * One URL normaliser for everything that stores, compares or fetches a cited URL.
 *
 * - Redirect wrappers (Google `/url?q=`, Bing `/ck/a?u=a1…`) are unwrapped.
 * - Only http(s) URLs are kept; the scheme becomes https, the host is lower-cased, default ports
 *   are dropped, the fragment is removed and trailing slashes are trimmed (root stays "/").
 * - Tracking parameters (utm_*, gclid, fbclid, msclkid, srsltid, mc_*, hsa_*, _hs*, _gl, igshid,
 *   ref, ref_src, source) are removed; other query parameters keep their order.
 * - `www.` is kept in the URL (some sites only answer on www) but `hostKey()` strips it, so
 *   hosts are always compared without it.
 */

const TRACKING_PARAM = /^(utm_.*|mc_.*|hsa_.*|_hs.*|_gl|gclid|gclsrc|dclid|fbclid|msclkid|srsltid|igshid|yclid|ref|ref_src|source)$/i;

function unwrapRedirect(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname === "/url") {
      return u.searchParams.get("q") || u.searchParams.get("url") || raw;
    }
    if (/(^|\.)bing\.com$/.test(host) && u.pathname.startsWith("/ck/a")) {
      const enc = u.searchParams.get("u");
      if (enc && enc.startsWith("a1")) {
        const b64 = enc.slice(2).replace(/-/g, "+").replace(/_/g, "/");
        const decoded = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("utf8");
        if (/^https?:\/\//i.test(decoded)) return decoded;
      }
    }
  } catch {
    // not a URL: handled by the caller
  }
  return raw;
}

/** Canonical form of a cited URL, or null when it is not a usable http(s) URL. */
export function canonicalUrl(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  // Sentence punctuation glued to a URL in prose; a ")" is only kept when it closes a "(" in the URL
  for (;;) {
    const last = s.slice(-1);
    if (/[.,;:!?'">\]]/.test(last)) s = s.slice(0, -1);
    else if (last === ")" && (s.match(/\(/g) || []).length < (s.match(/\)/g) || []).length) s = s.slice(0, -1);
    else break;
  }
  s = unwrapRedirect(s);
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;
  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase().replace(/\.$/, "");
  if (u.port === "80" || u.port === "443") u.port = "";
  u.hash = "";
  u.username = "";
  u.password = "";
  for (const key of [...new Set(u.searchParams.keys())]) if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  let out = u.toString();
  if (u.pathname === "/" && !u.search) out = out.replace(/\/$/, "");
  return out;
}

/** Host for comparisons: lower-case, no `www.`, no port, no trailing dot. */
export function hostKey(hostOrUrl: string): string {
  let h = (hostOrUrl || "").trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(h)) {
    try {
      h = new URL(h).hostname;
    } catch {
      h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    }
  }
  h = h.split(/[/?#]/)[0];
  if (h.startsWith("[")) return h.replace(/^\[|\].*$/g, "");
  return h.replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "");
}

/** Same rule everywhere: `domain` is `target` or one of its subdomains. */
export function domainMatches(domain: string, target: string): boolean {
  const d = hostKey(domain);
  const t = hostKey(target);
  return t !== "" && (d === t || d.endsWith(`.${t}`));
}

// ---------------------------------------------------------------- private / internal addresses

function parseIPv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

function parseIPv6(s: string): number[] | null {
  let str = s.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  if (!str.includes(":")) return null;
  // Embedded dotted IPv4 tail (::ffff:127.0.0.1)
  const v4tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(str);
  if (v4tail) {
    const v4 = parseIPv4(v4tail[1]);
    if (!v4) return null;
    str = str.slice(0, -v4tail[1].length) + `${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = str.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function isPrivateV4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

/**
 * True for an IP literal that is not a public unicast address: loopback, RFC 1918, link-local
 * (incl. 169.254.169.254 metadata), CGNAT, ULA (fc00::/7), IPv4-mapped/NAT64 forms of those,
 * documentation, multicast and reserved ranges. Returns false for anything that is not an IP.
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseIPv4(ip.trim());
  if (v4) return isPrivateV4(v4);
  const g = parseIPv6(ip.trim());
  if (!g) return false;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  const embedded = [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255];
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPrivateV4(embedded); // mapped / compatible
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateV4(embedded); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

/** True when the string is an IPv4 or IPv6 literal (brackets allowed). */
export function isIpLiteral(host: string): boolean {
  return parseIPv4(host.trim()) !== null || parseIPv6(host.trim()) !== null;
}

/**
 * Hosts that can never be a public web page: private/loopback IP literals, `localhost`, and
 * internal-only suffixes. Used to keep such URLs out of stored citations.
 */
export function isInternalHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return true;
  if (isIpLiteral(h)) return isPrivateAddress(h);
  return h === "localhost" || /\.(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/.test(h) || !h.includes(".");
}
