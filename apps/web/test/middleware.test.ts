import { before, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// The allowlist is computed when the module loads, so the environment is set first
process.env.PRISMGEO_ALLOWED_HOSTS = "geo.northwindvoice.ai, mac-mini.local";
process.env.PRISMGEO_URL = "http://0.0.0.0:3333";
type Middleware = typeof import("../src/middleware");
let middleware: Middleware["middleware"];
let buildAllowedHosts: Middleware["buildAllowedHosts"];
let config: Middleware["config"];
before(async () => {
  ({ middleware, buildAllowedHosts, config } = await import("../src/middleware"));
});

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  const headers = { host: "localhost:3333", ...(init.headers || {}) };
  return new NextRequest(`http://${headers.host}${path}`, { method: init.method || "GET", headers });
}

/** NextResponse.next() carries this header; a blocked request does not. */
const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";

test("local hosts and configured names are allowed", () => {
  assert.ok(passed(middleware(request("/"))));
  assert.ok(passed(middleware(request("/settings", { headers: { host: "127.0.0.1:3333" } }))));
  assert.ok(passed(middleware(request("/", { headers: { host: "[::1]:3333" } }))));
  assert.ok(passed(middleware(request("/", { headers: { host: "geo.northwindvoice.ai" } }))));
  assert.ok(passed(middleware(request("/", { headers: { host: "mac-mini.local:3333" } }))));
});

test("a foreign Host gets 421", () => {
  assert.equal(middleware(request("/", { headers: { host: "evil.example" } })).status, 421);
  assert.equal(middleware(request("/api/settings", { headers: { host: "evil.example:3333" } })).status, 421);
});

test("a foreign X-Forwarded-Host gets 421 even with a local Host", () => {
  const res = middleware(request("/api/export", { headers: { "x-forwarded-host": "evil.example" } }));
  assert.equal(res.status, 421);
});

test("0.0.0.0 is not an allowed host, even when PRISMGEO_URL uses it", () => {
  assert.ok(!buildAllowedHosts().has("0.0.0.0"));
  assert.equal(middleware(request("/api/connector", { headers: { host: "0.0.0.0:3333" } })).status, 421);
});

test("the image optimizer path is covered by the matcher", () => {
  const pattern = new RegExp(`^${config.matcher[0]}$`);
  assert.ok(pattern.test("/_next/image"));
  assert.ok(pattern.test("/api/settings"));
  assert.ok(!pattern.test("/_next/static/chunks/main.js"));
  assert.equal(middleware(request("/_next/image?url=%2Ffavicon.ico&w=64&q=75", { headers: { host: "evil.example" } })).status, 421);
});

test("a text/plain POST gets 415", () => {
  const res = middleware(
    request("/api/settings", { method: "POST", headers: { "content-type": "text/plain", origin: "http://localhost:3333" } }),
  );
  assert.equal(res.status, 415);
});

test("a foreign Origin gets 403", () => {
  const res = middleware(
    request("/api/prompts", { method: "POST", headers: { "content-type": "application/json", origin: "http://evil.example" } }),
  );
  assert.equal(res.status, 403);
});

test("a same-origin JSON POST passes", () => {
  const res = middleware(
    request("/api/prompts", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3333" } }),
  );
  assert.ok(passed(res));
});

test("/api/mcp is exempt, /api/mcpx and /api/mcp-admin are not", () => {
  assert.ok(passed(middleware(request("/api/mcp", { method: "POST", headers: { host: "tunnel.example" } }))));
  assert.ok(passed(middleware(request("/api/mcp/", { method: "POST", headers: { host: "tunnel.example" } }))));
  assert.equal(middleware(request("/api/mcpx", { headers: { host: "evil.example" } })).status, 421);
  assert.equal(middleware(request("/api/mcp-admin", { headers: { host: "evil.example" } })).status, 421);
});
