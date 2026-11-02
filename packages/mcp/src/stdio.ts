#!/usr/bin/env -S npx tsx
import { createPrismMcpServer } from "./server";
import { JsonRpcStdioTransport } from "./stdio-transport";

// Local connector entry point for Claude Desktop (and any stdio MCP client). Set
// PRISMGEO_DB_PATH to the workspace database; stdout is reserved for the protocol. The transport
// answers a line that is not JSON with a JSON-RPC parse error instead of ignoring it.
const server = createPrismMcpServer();
await server.connect(new JsonRpcStdioTransport());
console.error("[prismgeo-mcp] ready on stdio");
