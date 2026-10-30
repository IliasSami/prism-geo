import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { getDbPath } from "@prismgeo/db";
import { SEARCH_COUNTRIES } from "@prismgeo/core";

/**
 * Google's geotargets list: the canonical location names Google Search (uule), DataForSEO and
 * SerpApi accept ("Chicago,Illinois,United States"). Downloaded once from Google into
 * `<data dir>/geo/` (it is Google's data, so it is never committed), keeping only active places in
 * the countries PrismGEO searches from.
 */

const INDEX_URL = "https://developers.google.com/google-ads/api/data/geotargets";
const ZIP_LINK = /\/static\/google-ads\/api\/data\/geo\/geotargets-(\d{4}-\d{2}-\d{2})\.csv\.zip/g;

/** Place types worth searching from (no airports, universities or TV regions). */
const KEPT_TYPES = new Set([
  "Country",
  "State",
  "Province",
  "Region",
  "Territory",
  "Union Territory",
  "Prefecture",
  "Autonomous Community",
  "Department",
  "County",
  "City",
  "Municipality",
  "Borough",
  "Postal Code",
]);

export interface GeoTarget {
  id: number;
  name: string;
  canonicalName: string;
  type: string;
  /** Lower-case ISO country code. */
  country: string;
}

interface GeoFile {
  source: string;
  version: string;
  downloadedAt: string;
  rows: Array<[number, string, string, string, string]>;
}

const geoDir = () => path.join(path.dirname(getDbPath()), "geo");
const geoFile = () => path.join(geoDir(), "geotargets.json");

/** The single file inside a zip archive (stored or deflated). */
export function unzipSingle(zip: Buffer): Buffer {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip archive");
  const cd = zip.readUInt32LE(eocd + 16);
  if (zip.readUInt32LE(cd) !== 0x02014b50) throw new Error("Zip central directory not found");
  const method = zip.readUInt16LE(cd + 10);
  const compressed = zip.readUInt32LE(cd + 20);
  const local = zip.readUInt32LE(cd + 42);
  if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error("Zip entry not found");
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const data = zip.subarray(start, start + compressed);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return zlib.inflateRawSync(data);
  throw new Error(`Unsupported zip compression (${method})`);
}

/** Splits CSV text into rows of fields (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

/** Active places in the listed countries, from Google's geotargets CSV. */
export function parseGeotargets(csv: string): GeoTarget[] {
  const [header, ...rows] = parseCsv(csv);
  const col = (name: string) => header.findIndex((h) => h.trim() === name);
  const [iId, iName, iCanon, iCc, iType, iStatus] = ["Criteria ID", "Name", "Canonical Name", "Country Code", "Target Type", "Status"].map(col);
  if ([iId, iName, iCanon, iCc, iType].some((i) => i < 0)) throw new Error("Unexpected geotargets format");
  const countries = new Set(SEARCH_COUNTRIES.map((c) => c.code));
  const out: GeoTarget[] = [];
  for (const r of rows) {
    const country = (r[iCc] || "").toLowerCase();
    if (!countries.has(country) || !KEPT_TYPES.has(r[iType]) || (iStatus >= 0 && r[iStatus] !== "Active")) continue;
    out.push({ id: Number(r[iId]), name: r[iName], canonicalName: r[iCanon], type: r[iType], country });
  }
  return out;
}

let loaded: Promise<GeoTarget[]> | null = null;

async function download(fetchImpl: typeof fetch): Promise<GeoTarget[]> {
  const page = await (await fetchImpl(INDEX_URL, { signal: AbortSignal.timeout(20000) })).text();
  const links = [...page.matchAll(ZIP_LINK)].sort((a, b) => b[1].localeCompare(a[1]));
  if (!links.length) throw new Error("Google's geotargets download link was not found");
  const url = new URL(links[0][0], INDEX_URL).toString();
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Google's geotargets download failed (${res.status})`);
  const targets = parseGeotargets(unzipSingle(Buffer.from(await res.arrayBuffer())).toString("utf8"));
  const file: GeoFile = {
    source: url,
    version: links[0][1],
    downloadedAt: new Date().toISOString(),
    rows: targets.map((t) => [t.id, t.name, t.canonicalName, t.type, t.country]),
  };
  fs.mkdirSync(geoDir(), { recursive: true });
  const tmp = `${geoFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file));
  fs.renameSync(tmp, geoFile());
  return targets;
}

/** The location list, from the local copy or downloaded once from Google. */
export function loadGeotargets(fetchImpl: typeof fetch = fetch): Promise<GeoTarget[]> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const file = JSON.parse(fs.readFileSync(geoFile(), "utf8")) as GeoFile;
        return file.rows.map(([id, name, canonicalName, type, country]) => ({ id, name, canonicalName, type, country }));
      } catch {
        return download(fetchImpl);
      }
    })().catch((err) => {
      loaded = null; // a failed download is retried next time
      throw err;
    });
  }
  return loaded;
}

/** Where the list came from, when it has been downloaded. */
export function geotargetsInfo(): { version: string; downloadedAt: string; places: number } | null {
  try {
    const f = JSON.parse(fs.readFileSync(geoFile(), "utf8")) as GeoFile;
    return { version: f.version, downloadedAt: f.downloadedAt, places: f.rows.length };
  } catch {
    return null;
  }
}

const TYPE_RANK: Record<string, number> = { City: 0, State: 1, Province: 1, Region: 1, Territory: 1, "Union Territory": 1, Prefecture: 1, "Autonomous Community": 1, Emirate: 1, Department: 2, County: 2, Municipality: 2, Borough: 3, "Postal Code": 4, Country: 5 };

/** Places in a country whose name or postal code starts with (then contains) the text. */
export function searchGeotargets(targets: GeoTarget[], country: string, query: string, limit = 12): GeoTarget[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const inCountry = targets.filter((t) => t.country === country.toLowerCase());
  const score = (t: GeoTarget) => {
    const name = t.name.toLowerCase();
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (t.canonicalName.toLowerCase().startsWith(q)) return 2;
    if (name.includes(q)) return 3;
    return -1;
  };
  return inCountry
    .map((t) => ({ t, s: score(t) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || (TYPE_RANK[a.t.type] ?? 9) - (TYPE_RANK[b.t.type] ?? 9) || a.t.canonicalName.length - b.t.canonicalName.length)
    // One entry per canonical name (Google lists some places as both a city and a municipality)
    .filter((x, i, all) => all.findIndex((y) => y.t.canonicalName === x.t.canonicalName) === i)
    .slice(0, limit)
    .map((x) => x.t);
}

/** The place with exactly this canonical name, or null (used to validate a saved place). */
export function findGeotarget(targets: GeoTarget[], canonicalName: string): GeoTarget | null {
  const n = canonicalName.trim().toLowerCase();
  return targets.find((t) => t.canonicalName.toLowerCase() === n) ?? null;
}
