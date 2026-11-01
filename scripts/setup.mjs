#!/usr/bin/env node
// One-command setup: `pnpm setup` (or `node scripts/setup.mjs`). Safe to run again at any time.
import fs from "node:fs";
import path from "node:path";
import { ROOT, checkNode, step, say, fail, pnpm, pnpmCommand, installBrowser, browserInstalled, loadEnv } from "./lib.mjs";

checkNode();
say("PrismGEO setup");

step("Installing dependencies");
if (pnpm(["install", "--frozen-lockfile"]) !== 0 && pnpm(["install"]) !== 0) fail("Installing the dependencies failed (see the messages above).");

step("Downloading the crawler's browser (Chromium, about 570 MB the first time)");
if (browserInstalled()) say("Already installed.");
else if (installBrowser() !== 0) {
  fail(
    process.platform === "linux"
      ? "Chromium could not be installed. On Linux it needs system libraries: run `sudo pnpm --filter @prismgeo/crawler exec playwright install --with-deps chromium`, then `pnpm setup` again."
      : "Chromium could not be installed (see the messages above). Check your connection and run `pnpm setup` again."
  );
}

step("Creating .env");
const env = path.join(ROOT, ".env");
if (fs.existsSync(env)) say(".env already exists; left unchanged.");
else {
  fs.copyFileSync(path.join(ROOT, ".env.example"), env);
  say("Created .env from .env.example (optional settings: port, host, database path).");
}
loadEnv();

step("Building the dashboard");
if (pnpm(["--filter", "@prismgeo/web", "build"]) !== 0) fail("The build failed (see the messages above).");

const port = process.env.PRISMGEO_PORT || "3333";
// The MCP command must print nothing but the protocol on stdout: pnpm --silent hides its banner
const [cmd, ...pre] = pnpmCommand();
const mcpArgs = [...pre, "--silent", "--dir", ROOT, "mcp"];
const mcp = JSON.stringify({ mcpServers: { prismgeo: { command: cmd, args: mcpArgs } } }, null, 2);
const run = [cmd, ...pre].join(" ");
say(`
✔ PrismGEO is ready.

  Start it:      ${run} start
  Then open:     http://localhost:${port}   (the setup wizard opens on first visit)

  Use it from Claude (MCP):
    Claude Code:     claude mcp add prismgeo -- ${run} --silent --dir "${ROOT}" mcp
    Claude Desktop:  add this to claude_desktop_config.json
${mcp.replace(/^/gm, "      ")}
`);
