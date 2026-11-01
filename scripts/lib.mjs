// Shared helpers for PrismGEO's setup and launcher scripts (plain Node, no dependencies, any OS).
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MIN_NODE = [22, 13];
export const PNPM_VERSION = "10.34.9";
const isWindows = process.platform === "win32";

export const say = (msg = "") => console.log(msg);
export const step = (msg) => console.log(`\n▸ ${msg}`);
export function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

/** Stops with a clear message on a Node.js too old for node:sqlite. */
export function checkNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    fail(`PrismGEO needs Node.js ${MIN_NODE.join(".")} or later (it uses the built-in node:sqlite); this is ${process.versions.node}. Install the LTS from https://nodejs.org and run this again.`);
  }
}

/** Loads the repository's .env (if any) into process.env; variables already set win. */
export function loadEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

/** Runs a command in the repository, inheriting the terminal; returns its exit code. */
export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: isWindows, env: process.env, ...opts });
  if (res.error) return 127;
  return res.status ?? 1;
}

/** "pnpm" when installed, else the pinned version through npx (no global install, no corepack). */
export function pnpmCommand() {
  const probe = spawnSync("pnpm", ["--version"], { stdio: "ignore", shell: isWindows });
  return probe.status === 0 ? ["pnpm"] : ["npx", "--yes", `pnpm@${PNPM_VERSION}`];
}

export function pnpm(args, opts) {
  const [cmd, ...pre] = pnpmCommand();
  return run(cmd, [...pre, ...args], opts);
}

/** Whether Playwright's Chromium (or CHROMIUM_PATH) is installed. */
export function browserInstalled() {
  if (process.env.CHROMIUM_PATH) return fs.existsSync(process.env.CHROMIUM_PATH);
  const probe = spawnSync(process.execPath, ["-e", "process.stdout.write(require('playwright').chromium.executablePath())"], {
    cwd: path.join(ROOT, "packages", "crawler"),
    encoding: "utf8",
  });
  return probe.status === 0 && Boolean(probe.stdout) && fs.existsSync(probe.stdout.trim());
}

/** Downloads Chromium (on Linux with the system libraries it needs). */
export function installBrowser() {
  const args = ["--filter", "@prismgeo/crawler", "exec", "playwright", "install"];
  if (process.platform === "linux") args.push("--with-deps");
  return pnpm([...args, "chromium"]);
}

export const isBuilt = () => fs.existsSync(path.join(ROOT, "apps", "web", ".next", "BUILD_ID"));

/** The first free port from `start` on `host` (the next ones when it is taken). */
export async function freePort(start, host) {
  for (let port = start; port < start + 20; port++) {
    const free = await new Promise((resolve) => {
      const srv = net.createServer().once("error", () => resolve(false));
      srv.listen(port, host, () => srv.close(() => resolve(true)));
    });
    if (free) return port;
  }
  return start;
}
