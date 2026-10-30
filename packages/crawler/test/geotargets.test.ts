import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

process.env.PRISMGEO_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "prismgeo-geo-")), "test.db");
const { findGeotarget, loadGeotargets, parseCsv, parseGeotargets, searchGeotargets, unzipSingle } = await import("../src/geo/geotargets");

const CSV = [
  '"Criteria ID","Name","Canonical Name","Parent ID","Country Code","Target Type","Status"',
  '"2840","United States","United States","","US","Country","Active"',
  '"21137","Illinois","Illinois,United States","2840","US","State","Active"',
  '"1016367","Chicago","Chicago,Illinois,United States","21137","US","City","Active"',
  '"1016368","Chicago Heights","Chicago Heights,Illinois,United States","21137","US","City","Active"',
  '"9061234","60601","60601,Illinois,United States","21137","US","Postal Code","Active"',
  '"1012345","O\'Hare Airport","O\'Hare Airport,Illinois,United States","21137","US","Airport","Active"',
  '"1099999","Old Town","Old Town,Illinois,United States","21137","US","City","Removal Planned"',
  '"1000001","Dhaka","Dhaka,Dhaka Division,Bangladesh","","BD","City","Active"',
  '"1006886","Toronto","Toronto,Toronto,Ontario,Canada","","CA","City","Active"',
  '"9000001","Toronto","Toronto,Toronto,Ontario,Canada","","CA","Municipality","Active"',
  '"1001","Quote ""Town""","Quote ""Town"",Ontario,Canada","","CA","City","Active"',
].join("\r\n");

/** A one-file zip archive, deflated, as Google publishes it. */
function zipOf(name: string, content: string): Buffer {
  const data = Buffer.from(content);
  const comp = zlib.deflateRawSync(data);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, comp, central, nameBuf, eocd]);
}

test("CSV fields with quotes and commas are read whole", () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\n'), [["a", "b,c", 'd "e"'], ["1", "2", "3"]]);
});

test("only active places in the listed countries, of searchable types, are kept", () => {
  const rows = parseGeotargets(CSV);
  const names = rows.map((r) => r.canonicalName);
  assert.ok(names.includes("Chicago,Illinois,United States"));
  assert.ok(names.includes("60601,Illinois,United States"), "postal codes are kept");
  assert.ok(!names.some((n) => n.startsWith("O'Hare")), "airports are not places buyers search from");
  assert.ok(!names.includes("Old Town,Illinois,United States"), "inactive places are dropped");
  assert.ok(!names.some((n) => n.endsWith("Bangladesh")), "countries outside the list are dropped");
  assert.ok(names.includes('Quote "Town",Ontario,Canada'));
});

test("search ranks exact and prefix matches, cities first, one entry per place", () => {
  const rows = parseGeotargets(CSV);
  assert.deepEqual(searchGeotargets(rows, "us", "chicago").map((t) => t.canonicalName), ["Chicago,Illinois,United States", "Chicago Heights,Illinois,United States"]);
  assert.deepEqual(searchGeotargets(rows, "us", "6060").map((t) => t.type), ["Postal Code"]);
  assert.equal(searchGeotargets(rows, "ca", "toronto").length, 1);
  assert.deepEqual(searchGeotargets(rows, "us", "c"), [], "at least two characters");
  assert.equal(findGeotarget(rows, "chicago,illinois,united states")?.id, 1016367);
});

test("the list is downloaded once from Google's page and kept locally", async () => {
  let calls = 0;
  const fake = (async (url: string) => {
    calls++;
    if (url.endsWith("/geotargets")) return new Response('<a href="/static/google-ads/api/data/geo/geotargets-2026-01-01.csv.zip">old</a><a href="/static/google-ads/api/data/geo/geotargets-2026-10-06.csv.zip">new</a>');
    assert.match(url, /geotargets-2026-10-06\.csv\.zip$/, "the newest list is used");
    return new Response(zipOf("geotargets.csv", CSV));
  }) as unknown as typeof fetch;
  assert.equal(unzipSingle(zipOf("x.csv", "hello")).toString(), "hello");
  const rows = await loadGeotargets(fake);
  assert.ok(rows.some((r) => r.canonicalName === "Chicago,Illinois,United States"));
  await loadGeotargets(fake);
  assert.equal(calls, 2, "the second load reads the local copy");
});
