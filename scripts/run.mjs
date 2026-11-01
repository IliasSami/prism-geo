#!/usr/bin/env node
// Starts the dashboard: `pnpm start` (built app) or `pnpm dev` (development). Loads the root .env,
// checks Node.js, builds or installs the browser when missing, and moves to the next free port
// when the chosen one is taken.
import { checkNode, loadEnv, say, fail, pnpm, isBuilt, browserInstalled, installBrowser, freePort } from "./lib.mjs";

const mode = process.argv[2] === "dev" ? "dev" : "start";
checkNode();
loadEnv();
// node:sqlite prints an "experimental" warning at every start that reads like an error
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, "--disable-warning=ExperimentalWarning"].filter(Boolean).join(" ");

if (!browserInstalled()) {
  say("The crawler's browser is not installed yet; installing it once (about 570 MB)…");
  if (installBrowser() !== 0) say("Chromium could not be installed; the dashboard starts anyway, but browser engines will report a setup error. Run `pnpm browsers` later.");
}
if (mode === "start" && !isBuilt()) {
  say("No build found; building the dashboard once…");
  if (pnpm(["--filter", "@prismgeo/web", "build"]) !== 0) fail("The build failed (see the messages above).");
}

const host = process.env.PRISMGEO_HOST || "127.0.0.1";
const wanted = Number(process.env.PRISMGEO_PORT) || 3333;
const port = await freePort(wanted, host);
if (port !== wanted) say(`Port ${wanted} is in use; starting on ${port} instead.`);
process.env.PRISMGEO_PORT = String(port);
process.env.PRISMGEO_HOST = host;
say(`PrismGEO: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
process.exit(pnpm(["--filter", "@prismgeo/web", mode]));
