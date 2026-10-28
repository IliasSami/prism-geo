import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { isPrivateAddress } from "@prismgeo/core";
import { assertPublicUrl, fetchPublicPage, BlockedUrlError, type SafeFetchOptions } from "../src/net/safe-fetch";

let server: http.Server;
let port = 0;
let hits: string[] = [];

before(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url || "");
    if (req.url === "/page") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<p>hello from a public page</p>");
    } else if (req.url === "/to-public") {
      res.writeHead(302, { location: `http://public.test:${port}/page` });
      res.end();
    } else if (req.url === "/to-private") {
      res.writeHead(302, { location: `http://internal.test:${port}/secret` });
      res.end();
    } else if (req.url === "/to-metadata") {
      res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    } else if (req.url === "/loop") {
      res.writeHead(302, { location: "/loop" });
      res.end();
    } else if (req.url === "/huge") {
      res.writeHead(200, { "content-type": "text/html" });
      const chunk = "x".repeat(64 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < 8 * 1024 * 1024) {
          sent += chunk.length;
          if (!res.write(chunk)) return void res.once("drain", pump);
        }
        res.end();
      };
      res.on("close", () => (sent = Number.MAX_SAFE_INTEGER));
      pump();
    } else {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("internal secret");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

after(() => server.close());

/**
 * Test policy: the local server stands in for a public host. "public.test" resolves to 127.0.0.1,
 * which this policy treats as public; every other private range is blocked as in production, and
 * "internal.test" resolves to 10.0.0.5. Ports are restricted to the server's port.
 */
const opts = (): SafeFetchOptions => ({
  allowedPorts: [port],
  resolve: async (host) => (host === "public.test" ? [{ address: "127.0.0.1", family: 4 }] : host === "internal.test" ? [{ address: "10.0.0.5", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]),
  isBlockedAddress: (ip) => ip !== "127.0.0.1" && isPrivateAddress(ip),
  timeoutMs: 5000,
});

test("production policy blocks private, loopback, metadata and odd ports/schemes", async () => {
  for (const url of [
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/admin",
    "http://192.168.1.1/",
    "http://100.64.0.1/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://localhost/",
    "http://example.com:8080/",
    "ftp://example.com/",
    "file:///etc/passwd",
    "http://user:pass@example.com/",
  ]) {
    await assert.rejects(() => assertPublicUrl(url), BlockedUrlError, url);
  }
  // a public-looking name that resolves to a private address is blocked too (DNS check)
  await assert.rejects(() => assertPublicUrl("https://rebind.example/", { resolve: async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.1.1.1", family: 4 }] }), BlockedUrlError);
  const ok = await assertPublicUrl("https://example.com/x", { resolve: async () => [{ address: "93.184.216.34", family: 4 }] });
  assert.equal(ok.addresses[0].address, "93.184.216.34");
});

test("a public page is fetched; redirects are followed and re-validated", async () => {
  hits = [];
  const r = await fetchPublicPage(`http://public.test:${port}/to-public`, opts());
  assert.equal(r.status, 200);
  assert.match(r.body, /hello from a public page/);
  assert.equal(r.finalUrl, `http://public.test:${port}/page`);
  assert.deepEqual(hits, ["/to-public", "/page"]);
});

test("a redirect to a private address is refused before any request is sent there", async () => {
  hits = [];
  await assert.rejects(() => fetchPublicPage(`http://public.test:${port}/to-private`, opts()), BlockedUrlError);
  await assert.rejects(() => fetchPublicPage(`http://public.test:${port}/to-metadata`, opts()), BlockedUrlError);
  assert.deepEqual(hits, ["/to-private", "/to-metadata"]);
});

test("redirect loops stop after 3 hops", async () => {
  await assert.rejects(() => fetchPublicPage(`http://public.test:${port}/loop`, opts()), /Too many redirects/);
});

test("the body is cut at the size cap", async () => {
  const r = await fetchPublicPage(`http://public.test:${port}/huge`, { ...opts(), maxBytes: 3_000_000 });
  assert.equal(r.truncated, true);
  assert.equal(Buffer.byteLength(r.body), 3_000_000);
});

test("the connection goes to the validated address, not to whatever the name resolves to later", async () => {
  // public.test is pinned to 127.0.0.1 by the resolver; the HTTP request must reach our server
  hits = [];
  const r = await fetchPublicPage(`http://public.test:${port}/page`, opts());
  assert.equal(r.status, 200);
  assert.deepEqual(hits, ["/page"]);
});
