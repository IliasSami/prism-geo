#!/usr/bin/env node
// Runs PrismGEO in the background, started at login and restarted if it stops, so the autopilot
// and the rolling schedule keep working for days:
//   pnpm service:install     (macOS launchd agent, Linux systemd user service, Windows logon task)
//   pnpm service:uninstall
//   pnpm service:status
// The service runs `pnpm start` (the built dashboard) in this folder, with the folder's .env.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, checkNode, say, fail, isBuilt, pnpm } from "./lib.mjs";

const action = process.argv[2] || "status";
const LABEL = "com.prismgeo.server";
const logDir = path.join(ROOT, "data", "logs");
const sh = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
const node = process.execPath;
const runner = path.join(ROOT, "scripts", "run.mjs");

function ensureBuilt() {
  if (isBuilt()) return;
  say("Building the dashboard first…");
  if (pnpm(["--filter", "@prismgeo/web", "build"]) !== 0) fail("The build failed (see the messages above).");
}

// ---------------------------------------------------------------- macOS (launchd)
const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function macInstall() {
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(runner)}</string><string>start</string></array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path.dirname(node))}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${xml(path.join(logDir, "service.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logDir, "service.log"))}</string>
</dict>
</plist>
`;
  sh("launchctl", ["unload", plistPath]);
  fs.writeFileSync(plistPath, plist);
  const r = sh("launchctl", ["load", "-w", plistPath]);
  if (r.status !== 0) fail(`launchctl could not load the service: ${r.stderr || r.stdout}`);
}
function macUninstall() {
  if (fs.existsSync(plistPath)) {
    sh("launchctl", ["unload", "-w", plistPath]);
    fs.rmSync(plistPath);
  }
}
const macStatus = () => sh("launchctl", ["list", LABEL]).status === 0;

// ---------------------------------------------------------------- Linux (systemd --user)
const unitPath = path.join(os.homedir(), ".config", "systemd", "user", "prismgeo.service");
function linuxInstall() {
  fs.mkdirSync(path.dirname(unitPath), { recursive: true });
  fs.writeFileSync(
    unitPath,
    `[Unit]
Description=PrismGEO dashboard, autopilot and schedule
After=network-online.target

[Service]
WorkingDirectory=${ROOT}
ExecStart=${node} ${runner} start
Restart=always
RestartSec=30
Environment=PATH=${path.dirname(node)}:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
`
  );
  for (const args of [["--user", "daemon-reload"], ["--user", "enable", "--now", "prismgeo.service"]]) {
    const r = sh("systemctl", args);
    if (r.status !== 0) fail(`systemctl ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
  say("Tip: `loginctl enable-linger $USER` keeps it running when you are logged out.");
}
function linuxUninstall() {
  sh("systemctl", ["--user", "disable", "--now", "prismgeo.service"]);
  if (fs.existsSync(unitPath)) fs.rmSync(unitPath);
  sh("systemctl", ["--user", "daemon-reload"]);
}
const linuxStatus = () => sh("systemctl", ["--user", "is-active", "prismgeo.service"]).stdout.trim() === "active";

// ---------------------------------------------------------------- Windows (Task Scheduler)
const TASK = "PrismGEO";
function winInstall() {
  const cmd = `"${node}" "${runner}" start`;
  const r = sh("schtasks", ["/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED", "/TN", TASK, "/TR", cmd]);
  if (r.status !== 0) fail(`schtasks could not create the task: ${r.stderr || r.stdout}`);
  sh("schtasks", ["/Run", "/TN", TASK]);
}
const winUninstall = () => sh("schtasks", ["/Delete", "/F", "/TN", TASK]);
const winStatus = () => sh("schtasks", ["/Query", "/TN", TASK]).status === 0;

// ----------------------------------------------------------------
const platform = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
const impl = {
  mac: { install: macInstall, uninstall: macUninstall, status: macStatus },
  linux: { install: linuxInstall, uninstall: linuxUninstall, status: linuxStatus },
  win: { install: winInstall, uninstall: winUninstall, status: winStatus },
}[platform];

checkNode();
if (action === "install") {
  ensureBuilt();
  impl.install();
  say(`✔ PrismGEO runs in the background now and starts at login. Logs: ${path.join(logDir, "service.log")}. Remove it with: pnpm service:uninstall`);
} else if (action === "uninstall") {
  impl.uninstall();
  say("✔ The background service is removed. Start PrismGEO yourself with: pnpm start");
} else {
  say(impl.status() ? "PrismGEO's background service is installed and running." : "PrismGEO's background service is not installed (pnpm service:install).");
}
