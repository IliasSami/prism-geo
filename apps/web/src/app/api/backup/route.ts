import { NextResponse } from "next/server";
import { getRawDb, getDbPath } from "@prismgeo/db";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  let tempBackupPath: string | null = null;
  try {
    const sqlite = getRawDb();
    const dbPath = getDbPath();

    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ error: "Database file not found" }, { status: 404 });
    }

    // Flush WAL log checkpoint safely
    try {
      sqlite.exec("PRAGMA wal_checkpoint(PASSIVE);");
    } catch {}

    const randomSuffix = crypto.randomBytes(4).toString("hex");
    tempBackupPath = path.join(os.tmpdir(), `prismgeo-backup-${Date.now()}-${randomSuffix}.db`);

    // VACUUM INTO produces an atomic, consistent, standalone snapshot without WAL race conditions
    try {
      const escapedPath = tempBackupPath.replace(/'/g, "''");
      sqlite.exec(`VACUUM INTO '${escapedPath}'`);
    } catch {
      // Fallback if VACUUM INTO fails: checkpoint TRUNCATE and copy
      sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      fs.copyFileSync(dbPath, tempBackupPath);
    }

    const stat = fs.statSync(tempBackupPath);
    const MAX_BUFFER_SIZE = 150 * 1024 * 1024; // 150MB limit for in-memory buffer
    if (stat.size > MAX_BUFFER_SIZE) {
      return NextResponse.json(
        { error: "Database backup exceeds maximum download buffer limit (150MB). Please copy the database file from server disk directly." },
        { status: 413 }
      );
    }

    const fileBuffer = fs.readFileSync(tempBackupPath);
    const filename = `prismgeo-backup-${new Date().toISOString().slice(0, 10)}.db`;

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": stat.size.toString(),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  } finally {
    if (tempBackupPath && fs.existsSync(tempBackupPath)) {
      try {
        fs.unlinkSync(tempBackupPath);
      } catch {}
    }
  }
}
