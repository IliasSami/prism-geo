#!/usr/bin/env -S npx tsx
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPrismMcpServer } from "./server";

// Local connector entry point for Claude Desktop (and any stdio MCP client). Set
// PRISMGEO_DB_PATH to the workspace database; stdout is reserved for the protocol.
const server = createPrismMcpServer();
await server.connect(new StdioServerTransport());
console.error("[prismgeo-mcp] ready on stdio");
