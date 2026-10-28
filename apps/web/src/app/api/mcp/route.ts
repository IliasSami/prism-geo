import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPrismMcpServer, getConnectorToken, type StartCrawlArgs } from "@prismgeo/mcp";
import crypto from "node:crypto";
import { findBrand } from "../_lib/brand";
import { startCrawl } from "../_lib/crawl";

export const dynamic = "force-dynamic";

let warnedAboutQueryToken = false;

/**
 * Constant-time check of the connector token. Clients that can send headers (Claude Code) use
 * "Authorization: Bearer <token>". claude.ai custom connectors cannot, so ?token= is still
 * accepted, with a one-time warning: a token in the URL ends up in reverse-proxy and tunnel logs.
 */
function authorized(request: Request): boolean {
  const expected = Buffer.from(getConnectorToken());
  const header = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const query = new URL(request.url).searchParams.get("token") || "";
  if (!header && query && !warnedAboutQueryToken) {
    warnedAboutQueryToken = true;
    console.warn(
      "[mcp] The connector token was sent in the URL (?token=). URLs are written to proxy and tunnel access logs; prefer the Authorization header where the client supports it.",
    );
  }
  const given = Buffer.from(header || query);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** start_crawl from this endpoint runs in this server process, not over HTTP to PRISMGEO_URL. */
function startCrawlInProcess(args: StartCrawlArgs): unknown {
  const brand = findBrand(args.brandId);
  if (!brand) throw new Error("That client does not exist");
  const result = startCrawl(brand, { engines: args.engines, sampleSize: args.sampleSize, promptLimit: args.promptLimit });
  if (!result.ok) throw new Error(result.body.error);
  return result.body;
}

/**
 * PrismGEO's MCP endpoint (Streamable HTTP, stateless) for Claude Code and claude.ai custom
 * connectors. Each request gets its own server instance, so no session state is kept here.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ jsonrpc: "2.0", error: { code: -32001, message: "Missing or invalid PrismGEO connector token" }, id: null }, { status: 401 });
  }
  const server = createPrismMcpServer({ startCrawl: startCrawlInProcess });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

// Stateless mode has no server-initiated stream or session to delete
const notAllowed = () =>
  Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, { status: 405, headers: { allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
