import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGoogleSearchUrl, decodeUule, encodeUuleV1, encodeUuleV2 } from "../src/geo/uule";

test("uule v1 matches the published reference values", () => {
  // valentin.app / uule_grabber
  assert.equal(encodeUuleV1("United States"), "w+CAIQICINVW5pdGVkIFN0YXRlcw");
  // tomca32/uule-converter
  assert.equal(encodeUuleV1("Queens County,New York,United States"), "w+CAIQICIkUXVlZW5zIENvdW50eSxOZXcgWW9yayxVbml0ZWQgU3RhdGVz");
});

test("uule v1 encodes names of 64 bytes or more with a varint length, and round-trips", () => {
  const long = "Saint-Jean-sur-Richelieu Regional County Municipality,Quebec,Canada";
  assert.ok(Buffer.byteLength(long) >= 64);
  const u = encodeUuleV1(long);
  assert.deepEqual(decodeUule(u), { version: "v1", canonicalName: long });
  // A non-ASCII name survives
  assert.deepEqual(decodeUule(encodeUuleV1("Zürich,Zurich,Switzerland")), { version: "v1", canonicalName: "Zürich,Zurich,Switzerland" });
});

test("uule v2 matches tomca32/uule-converter byte for byte, and SerpApi's value decodes", () => {
  assert.equal(
    encodeUuleV2({ latitude: 37.421, longitude: -12.2084, timestampMicros: 1591521249034000, provenance: 6 }),
    "a+cm9sZToxCnByb2R1Y2VyOjEyCnByb3ZlbmFuY2U6Ngp0aW1lc3RhbXA6MTU5MTUyMTI0OTAzNDAwMApsYXRsbmd7CmxhdGl0dWRlX2U3OjM3NDIxMDAwMApsb25naXR1ZGVfZTc6LTEyMjA4NDAwMAp9CnJhZGl1czotMQ"
  );
  const serpapi =
    "a+cm9sZToxCnByb2R1Y2VyOjEyCnByb3ZlbmFuY2U6MAp0aW1lc3RhbXA6MTY4MDg3NzkwNjIzNjczNgpsYXRsbmd7CmxhdGl0dWRlX2U3OjMwMjY2NjY2MApsb25naXR1ZGVfZTc6LTk3NzMzMzAwMAp9CnJhZGl1czotMQo";
  assert.deepEqual(decodeUule(serpapi), { version: "v2", latitude: 30.266666, longitude: -97.7333, radius: -1, timestampMicros: 1680877906236736 });
  assert.throws(() => encodeUuleV2({ latitude: 95, longitude: 0 }));
});

test("the search address carries q, gl, hl and an intact uule", () => {
  const { url, uule } = buildGoogleSearchUrl("best shopify apps", { canonicalName: "Chicago,Illinois,United States", country: "US", language: "en" });
  const p = new URL(url).searchParams;
  assert.equal(p.get("q"), "best shopify apps");
  assert.equal(p.get("gl"), "us");
  assert.equal(p.get("hl"), "en");
  assert.equal(p.get("uule"), uule, "the w+ prefix and Base64 survive URL encoding");
  assert.deepEqual(decodeUule(p.get("uule")!), { version: "v1", canonicalName: "Chicago,Illinois,United States" });
  assert.equal(decodeUule("not-a-uule"), null);
  const aiMode = buildGoogleSearchUrl("q", { canonicalName: "United States", country: "us", language: "en" }, { udm: "50" });
  assert.equal(new URL(aiMode.url).searchParams.get("udm"), "50");
});
