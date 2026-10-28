/**
 * Deterministic shuffles. Each engine walks the prompts of a batch in its own order, seeded by
 * `${batchId}:${engine}`, so an engine that gets blocked part-way loses a random subset of the
 * prompts rather than always the tail of the list, and a batch can be replayed exactly.
 */

/** 32-bit FNV-1a hash of a string. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG: uniform floats in [0, 1) from a 32-bit seed. */
export function seededRandom(seed: string | number): () => number {
  let a = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle of a copy of `items`, deterministic for a given seed. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const rnd = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
