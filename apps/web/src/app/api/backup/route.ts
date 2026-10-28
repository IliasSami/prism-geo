import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { getRawDb, getDbPath } from "@prismgeo/db";
import { jsonError, route } from "../_lib/http";

export const dynamic = "force-dynamic";

/**
 * Downloads a consistent copy of the whole database (every client, plus the saved API keys and
 * the Claude connector token: treat the file like a password).
 *
 * The snapshot is made with VACUUM INTO next to the database (data/backups/), so it does not fill
 * the system temp folder, and streamed to the browser without loading it into memory, whatever
 * its size. The snapshot file is removed as soon as it is open for streaming.
 */
export const GET = route("backup", async () => {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) return jsonError("There is no database yet", 404);

  const dir = path.join(path.dirname(dbPath), "backups");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshot = path.join(dir, `download-${stamp}-${crypto.randomBytes(4).toString("hex")}.db`);

  // An atomic, self-contained copy that includes WAL contents; no plain file copy fallback,
  // because copying a live WAL database can produce a corrupt file
  getRawDb().exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  fs.chmodSync(snapshot, 0o600);

  const { size } = fs.statSync(snapshot);
  const fd = fs.openSync(snapshot, "r");
  let removed = false;
  try {
    fs.unlinkSync(snapshot); // POSIX: the open descriptor keeps the data readable
    removed = true;
  } catch {}
  const stream = fs.createReadStream("", { fd });
  stream.on("close", () => {
    if (!removed) fs.rm(snapshot, { force: true }, () => {});
  });

  const filename = `prismgeo-backup-${new Date().toISOString().slice(0, 10)}.db`;
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(size),
      "Cache-Control": "no-store",
      "X-PrismGEO-Contains-Secrets": "api-keys, mcp-connector-token, proxy-credentials",
    },
  });
});
