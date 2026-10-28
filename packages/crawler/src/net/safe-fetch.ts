import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIpLiteral, isPrivateAddress } from "@prismgeo/core";

/**
 * Guarded download of pages that AI answers cite (reverse-RAG). URLs come from engine answers, so
 * they are untrusted input: without a guard an answer containing http://169.254.169.254/... or
 * http://127.0.0.1:3333/... would make this server fetch internal resources (SSRF).
 *
 * Every hop (the URL and each redirect, at most `maxRedirects`) is checked:
 *   - scheme http or https only, port 80/443 only;
 *   - the host is resolved and EVERY resolved address must be public (no loopback, RFC 1918,
 *     link-local/metadata, CGNAT, ULA, IPv4-mapped/NAT64 forms of those, multicast, reserved);
 *   - the connection is made to the address that was checked (the resolver result is pinned in
 *     the socket's lookup), so a DNS answer cannot change between the check and the connect.
 * The body is streamed and cut at `maxBytes`; the whole exchange is bounded by `timeoutMs`.
 * Cited-page fetches go out directly, not through the crawler proxy setting.
 */

export class BlockedUrlError extends Error {}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowedPorts?: number[];
  headers?: Record<string, string>;
  /** Resolver, for tests. Defaults to dns.promises.lookup(host, { all: true }). */
  resolve?: (host: string) => Promise<LookupAddress[]>;
  /** Address policy, for tests. Defaults to isPrivateAddress. */
  isBlockedAddress?: (address: string) => boolean;
}

export interface SafeFetchResult {
  status: number;
  contentType: string;
  body: string;
  finalUrl: string;
  /** The body was cut at maxBytes. */
  truncated: boolean;
}

const DEFAULTS = {
  timeoutMs: 12_000,
  maxBytes: 3_000_000,
  maxRedirects: 3,
  allowedPorts: [80, 443],
};

const defaultResolve = (host: string) => dnsLookup(host, { all: true, verbatim: true });

/** Validates one URL and returns the addresses it may be fetched from. Throws BlockedUrlError. */
export async function assertPublicUrl(raw: string | URL, options: SafeFetchOptions = {}): Promise<{ url: URL; addresses: LookupAddress[] }> {
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(raw) : raw;
  } catch {
    throw new BlockedUrlError(`Not a URL: ${String(raw).slice(0, 200)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedUrlError(`Blocked scheme ${url.protocol}`);
  if (url.username || url.password) throw new BlockedUrlError("Blocked URL with credentials");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!(options.allowedPorts ?? DEFAULTS.allowedPorts).includes(port)) throw new BlockedUrlError(`Blocked port ${port}`);
  const blocked = options.isBlockedAddress ?? isPrivateAddress;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new BlockedUrlError("Blocked URL without a host");
  let addresses: LookupAddress[];
  if (isIpLiteral(host)) {
    addresses = [{ address: host, family: host.includes(":") ? 6 : 4 }];
  } else {
    if (/^localhost$|\.localhost$/i.test(host)) throw new BlockedUrlError(`Blocked host ${host}`);
    try {
      addresses = await (options.resolve ?? defaultResolve)(host);
    } catch (err) {
      throw new Error(`Could not resolve ${host}: ${(err as Error).message}`);
    }
  }
  if (addresses.length === 0) throw new Error(`Could not resolve ${host}`);
  const bad = addresses.find((a) => blocked(a.address));
  if (bad) throw new BlockedUrlError(`Blocked private or internal address ${bad.address} for ${host}`);
  return { url, addresses };
}

function requestOnce(url: URL, addresses: LookupAddress[], options: SafeFetchOptions, signal: AbortSignal) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean }>((resolve, reject) => {
    const pinned = addresses[0];
    const lib = url.protocol === "https:" ? https : http;
    const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
    const req = lib.request(
      url,
      {
        method: "GET",
        signal,
        headers: { "accept-encoding": "identity", ...(options.headers || {}) },
        // Connect to the address that was validated, whatever the resolver would say now
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...args: any[]) => void) => {
          if (opts && opts.all) cb(null, [{ address: pinned.address, family: pinned.family }]);
          else cb(null, pinned.address, pinned.family);
        }) as any,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, headers: res.headers, body: Buffer.alloc(0), truncated: false });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          if (truncated) return;
          const room = maxBytes - size;
          if (chunk.length >= room) {
            chunks.push(chunk.subarray(0, Math.max(0, room)));
            size = maxBytes;
            truncated = true;
            res.destroy();
            resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated: true });
            return;
          }
          chunks.push(chunk);
          size += chunk.length;
        });
        res.on("end", () => {
          if (!truncated) resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated: false });
        });
        res.on("error", (err) => {
          if (!truncated) reject(err);
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * GETs a public web page with the SSRF guard described above. Redirects are followed manually
 * (each target re-validated). Throws BlockedUrlError for blocked targets and Error for network
 * failures, timeouts and too many redirects.
 */
export async function fetchPublicPage(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timed out")), options.timeoutMs ?? DEFAULTS.timeoutMs);
  try {
    let current = rawUrl;
    for (let hop = 0; ; hop++) {
      const { url, addresses } = await assertPublicUrl(current, options);
      const res = await requestOnce(url, addresses, options, controller.signal);
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        if (hop >= (options.maxRedirects ?? DEFAULTS.maxRedirects)) throw new Error(`Too many redirects (> ${options.maxRedirects ?? DEFAULTS.maxRedirects})`);
        current = new URL(String(res.headers.location), url).toString();
        continue;
      }
      return {
        status: res.status,
        contentType: String(res.headers["content-type"] || ""),
        body: res.body.toString("utf8"),
        finalUrl: url.toString(),
        truncated: res.truncated,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}
