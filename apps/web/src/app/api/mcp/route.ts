import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createPrismMcpServer, getConnectorToken } from "@prismgeo/mcp";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

/** Constant-time check of the connector token, sent as a Bearer header or ?token= (claude.ai URLs). */
function authorized(request: Request): boolean {
  const expected = Buffer.from(getConnectorToken());
  const header = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const given = Buffer.from(header || new URL(request.url).searchParams.get("token") || "");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/**
 * PrismGEO's MCP endpoint (Streamable HTTP, stateless) for Claude Code and claude.ai custom
 * connectors. Each request gets its own server instance, so no session state is kept here.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ jsonrpc: "2.0", error: { code: -32001, message: "Missing or invalid PrismGEO connector token" }, id: null }, { status: 401 });
  }
  const server = createPrismMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

// Stateless mode has no server-initiated stream or session to delete
const notAllowed = () =>
  Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, { status: 405, headers: { allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
