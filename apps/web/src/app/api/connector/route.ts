import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { getDbPath } from "@prismgeo/db";
import { getConnectorToken } from "@prismgeo/mcp";
import { route } from "../_lib/http";

export const dynamic = "force-dynamic";

/** The workspace root (where node_modules/tsx lives), found from the server's working directory. */
function workspaceRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

/** Ready-to-paste setup for connecting Claude (Desktop, Code, claude.ai) to this workspace. */
export const GET = route("connector", async (request: Request) => {
  const dbPath = getDbPath();
  // Not derived from dbPath: PRISMGEO_DB_PATH may point anywhere
  const root = workspaceRoot();
  // Absolute node + tsx paths: Claude Desktop launches connectors without the shell's PATH
  const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const stdioEntry = path.join(root, "packages", "mcp", "src", "stdio.ts");
  const origin = new URL(request.url).origin.replace("0.0.0.0", "localhost");
  const token = getConnectorToken();
  // Prefer a stable node symlink over the versioned binary, which moves on every upgrade
  const node = ["/opt/homebrew/bin/node", "/usr/local/bin/node"].find((p) => fs.existsSync(p)) || process.execPath;

  return NextResponse.json({
    ready: fs.existsSync(tsx) && fs.existsSync(stdioEntry),
    claudeDesktop: {
      configPath: "~/Library/Application Support/Claude/claude_desktop_config.json",
      config: {
        mcpServers: {
          prismgeo: {
            command: node,
            args: [tsx, stdioEntry],
            env: { PRISMGEO_DB_PATH: dbPath, PRISMGEO_URL: origin },
          },
        },
      },
    },
    claudeCode: `claude mcp add --transport http prismgeo ${origin}/api/mcp --header "Authorization: Bearer ${token}"`,
    httpUrl: `${origin}/api/mcp`,
    token,
  });
});
