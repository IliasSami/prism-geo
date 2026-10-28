import fs from "node:fs";
import path from "node:path";
import { format } from "node:util";
import { getDbPath, ensurePrivateDir, PRIVATE_FILE_MODE } from "./client";

/**
 * Persistent server log. Console output (crawler, scheduler, API errors) is also appended to
 * data/logs/prismgeo.log so failures can be reviewed after the terminal is gone. The file rotates
 * at MAX_BYTES, keeping KEEP older files.
 */
const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 5;

export function logDir(): string {
  return path.join(path.dirname(getDbPath()), "logs");
}

export function logFile(): string {
  return path.join(logDir(), "prismgeo.log");
}

function rotate(file: string): void {
  try {
    if (fs.statSync(file).size < MAX_BYTES) return;
  } catch {
    return;
  }
  for (let i = KEEP - 1; i >= 1; i--) {
    if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
  }
  fs.renameSync(file, `${file}.1`);
  fs.rmSync(`${file}.${KEEP + 1}`, { force: true });
}

/** Tees console.log/warn/error into the log file. Idempotent across hot reloads. */
export function installFileLogging(source: string): void {
  const g = globalThis as typeof globalThis & { __prismLogging?: boolean };
  if (g.__prismLogging || process.env.PRISMGEO_LOG_FILE === "off") return;
  g.__prismLogging = true;
  ensurePrivateDir(logDir());
  const file = logFile();
  let writes = 0;
  for (const level of ["log", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try {
        if (writes++ % 200 === 0) rotate(file);
        const line = format(...args).replace(/\n/g, "\n    ");
        fs.appendFileSync(file, `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${source}] ${line}\n`, { mode: PRIVATE_FILE_MODE });
      } catch {
        // Logging must never break the app
      }
    };
  }
}

/** The last `lines` lines of the current log file (newest last). */
export function readRecentLogs(lines = 200): string[] {
  try {
    const text = fs.readFileSync(logFile(), "utf8");
    return text.trimEnd().split("\n").slice(-lines);
  } catch {
    return [];
  }
}
