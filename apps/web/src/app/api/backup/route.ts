import { NextResponse } from "next/server";
import { getRawDb, getDbPath } from "@prismgeo/db";
import fs from "node:fs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sqlite = getRawDb();
    // Flush WAL log into main DB file
    sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE);");

    const dbPath = getDbPath();
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ error: "Database file not found" }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const filename = `prismgeo-backup-${new Date().toISOString().slice(0, 10)}.db`;

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
