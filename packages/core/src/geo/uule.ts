/**
 * Google's `uule` parameter: the location a search is asked "as if" from.
 *
 * - v1 (`w+`): a canonical location name from Google's geotargets list ("Chicago,Illinois,United
 *   States"). Base64 of a small protobuf: field 1 = 2 (role), field 2 = 32 (producer), field 4 =
 *   the name. The name length is a varint, so names of 64 bytes or more are encoded correctly.
 * - v2 (`a+`): coordinates. Base64 of a line-based text record (role, producer, provenance,
 *   timestamp, latlng in 1e-7 degrees, radius).
 *
 * uule sets the location signal of a Google search; it does not change the connection the
 * search comes from. Results checked against uule_grabber, serpapi/uule_converter and
 * tomca32/uule-converter (see the tests).
 */

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64").replace(/=+$/, "");
const fromBase64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4), "base64");

function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
}

/** uule v1 for a Google canonical location name. */
export function encodeUuleV1(canonicalName: string): string {
  const name = Buffer.from(canonicalName.trim(), "utf8");
  if (!name.length) throw new Error("A location name is required");
  return `w+${toBase64(Uint8Array.from([0x08, 0x02, 0x10, 0x20, 0x22, ...varint(name.length), ...name]))}`;
}

export interface UuleV2Input {
  latitude: number;
  longitude: number;
  /** Microseconds since the epoch; defaults to now. */
  timestampMicros?: number;
  /** Radius in metres, -1 = unspecified (Google's default). */
  radius?: number;
  provenance?: number;
}

/** uule v2 for coordinates. */
export function encodeUuleV2({ latitude, longitude, timestampMicros, radius = -1, provenance = 0 }: UuleV2Input): string {
  if (!(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) throw new Error("Latitude must be within ±90 and longitude within ±180");
  const ts = timestampMicros ?? Date.now() * 1000;
  const text = [
    "role:1",
    "producer:12",
    `provenance:${provenance}`,
    `timestamp:${ts}`,
    "latlng{",
    `latitude_e7:${Math.round(latitude * 1e7)}`,
    `longitude_e7:${Math.round(longitude * 1e7)}`,
    "}",
    `radius:${radius}`,
  ].join("\n");
  return `a+${toBase64(Buffer.from(text, "utf8"))}`;
}

export type DecodedUule =
  | { version: "v1"; canonicalName: string }
  | { version: "v2"; latitude: number; longitude: number; radius: number | null; timestampMicros: number | null };

/** Reads a uule back (to verify what a stored search was asked as); null when it is not one. */
export function decodeUule(uule: string): DecodedUule | null {
  const value = decodeURIComponent(uule.trim()).replace(/ /g, "+");
  if (value.startsWith("w+")) {
    const b = fromBase64(value.slice(2));
    if (b[0] !== 0x08 || b[2] !== 0x10 || b[4] !== 0x22) return null;
    let len = 0;
    let shift = 0;
    let i = 5;
    for (; i < b.length; i++) {
      len |= (b[i] & 0x7f) << shift;
      shift += 7;
      if (!(b[i] & 0x80)) break;
    }
    const name = b.subarray(i + 1, i + 1 + len);
    return name.length === len ? { version: "v1", canonicalName: name.toString("utf8") } : null;
  }
  if (value.startsWith("a+")) {
    const text = fromBase64(value.slice(2)).toString("utf8");
    const num = (key: string) => {
      const m = new RegExp(`^${key}:(-?\\d+)$`, "m").exec(text);
      return m ? Number(m[1]) : null;
    };
    const lat = num("latitude_e7");
    const lng = num("longitude_e7");
    if (lat === null || lng === null) return null;
    return { version: "v2", latitude: lat / 1e7, longitude: lng / 1e7, radius: num("radius"), timestampMicros: num("timestamp") };
  }
  return null;
}

export interface GoogleSearchLocation {
  /** Canonical name (uule v1) or coordinates (uule v2). */
  canonicalName?: string;
  coordinates?: { latitude: number; longitude: number };
  /** Country code for `gl` ("us"). */
  country: string;
  /** Interface language for `hl` ("en"). */
  language: string;
}

/**
 * A Google search address asked as from a location: `q`, `uule`, `gl` (country) and `hl`
 * (language). URLSearchParams percent-encodes the `+` and `/` of the Base64 value.
 */
export function buildGoogleSearchUrl(query: string, location: GoogleSearchLocation, extra: Record<string, string> = {}): { url: string; uule: string | null } {
  const uule = location.canonicalName ? encodeUuleV1(location.canonicalName) : location.coordinates ? encodeUuleV2(location.coordinates) : null;
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  url.searchParams.set("hl", location.language.slice(0, 2).toLowerCase());
  url.searchParams.set("gl", location.country.toLowerCase());
  if (uule) url.searchParams.set("uule", uule);
  return { url: url.toString(), uule };
}
