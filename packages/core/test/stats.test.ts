import { test } from "node:test";
import assert from "node:assert/strict";
import { wilsonInterval, clusteredRate, estimateIcc, prominenceScore, seededShuffle, seededRandom } from "../src/index";

function wilsonRef(k: number, n: number, z = 1.959963984540054): [number, number] {
  const ph = k / n;
  const z2 = z * z;
  const d = 1 + z2 / n;
  const c = (ph + z2 / (2 * n)) / d;
  const s = (z / d) * Math.sqrt((ph * (1 - ph)) / n + z2 / (4 * n * n));
  return [Math.max(0, c - s), Math.min(1, c + s)];
}

test("Wilson interval matches a reference implementation and handles edges", () => {
  for (const n of [1, 2, 5, 10, 26, 105, 220, 1000]) {
    for (let k = 0; k <= n; k += Math.max(1, Math.floor(n / 13))) {
      const [a, b] = wilsonInterval(k, n);
      const [ra, rb] = wilsonRef(k, n);
      assert.ok(Math.abs(a - ra) < 0.001 && Math.abs(b - rb) < 0.001, `${k}/${n}`);
    }
  }
  assert.deepEqual(wilsonInterval(0, 0), [0, 0]);
  assert.deepEqual(wilsonInterval(Number.NaN, 5), [0, 0]);
  assert.equal(wilsonInterval(0, 20)[0], 0);
  assert.equal(wilsonInterval(20, 20)[1], 1);
});

/** Prompt-cluster bootstrap: resample prompts with replacement; 2.5/97.5 percentiles of the prompt-mean rate. */
function clusterBootstrap(clusters: Array<{ hits: number; runs: number }>, reps = 20000, seed = "ref"): [number, number] {
  const rnd = seededRandom(seed);
  const out: number[] = [];
  for (let b = 0; b < reps; b++) {
    let sum = 0;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[Math.floor(rnd() * clusters.length)];
      sum += c.hits / c.runs;
    }
    out.push(sum / clusters.length);
  }
  out.sort((a, b) => a - b);
  return [out[Math.floor(reps * 0.025)], out[Math.floor(reps * 0.975)]];
}

test("prompt-clustered interval: wider than naive Wilson on clustered data, close to a cluster bootstrap", () => {
  // 105 questions x 2 engines; the brand is named by both engines on 4 questions (8/210 = 3.8%)
  const clusters = Array.from({ length: 105 }, (_, i) => ({ hits: i < 4 ? 2 : 0, runs: 2 }));
  const r = clusteredRate(clusters);
  const [naiveLow, naiveHigh] = wilsonInterval(8, 210);
  const [bootLow, bootHigh] = clusterBootstrap(clusters);
  assert.equal(r.questions, 105);
  assert.equal(r.answers, 210);
  assert.ok(Math.abs(r.p - 8 / 210) < 1e-9);
  assert.ok(r.icc > 0.95, `icc ${r.icc}`);
  assert.ok(Math.abs(r.nEff - 105) < 2, `nEff ${r.nEff}`);
  assert.ok(r.high - r.low > naiveHigh - naiveLow, "wider than the naive interval");
  // With ICC ~ 1 the effective sample is the 105 questions: Wilson(4, 105)
  const [refLow, refHigh] = wilsonInterval(4, 105);
  assert.ok(Math.abs(r.low - refLow) < 0.002 && Math.abs(r.high - refHigh) < 0.002, `clustered [${r.low}, ${r.high}] vs Wilson(4,105) [${refLow}, ${refHigh}]`);
  // ...and it covers the prompt-cluster bootstrap range (slightly conservative for a rare outcome)
  assert.ok(r.low <= bootLow + 0.01 && r.high >= bootHigh && r.high - bootHigh < 0.03, `clustered [${r.low}, ${r.high}] vs bootstrap [${bootLow}, ${bootHigh}]`);
});

test("prompt-clustered rate equals plain Wilson with one answer per question, and with uncorrelated repeats stays near n", () => {
  const single = Array.from({ length: 50 }, (_, i) => ({ hits: i < 10 ? 1 : 0, runs: 1 }));
  const r = clusteredRate(single);
  assert.deepEqual([r.low, r.high], wilsonInterval(10, 50));
  assert.equal(r.nEff, 50);
  // repeats that disagree within each question carry independent information
  const noisy = Array.from({ length: 40 }, () => ({ hits: 1, runs: 2 }));
  assert.equal(estimateIcc(noisy), 0);
  assert.equal(clusteredRate(noisy).nEff, 80);
  // mean of per-question shares, not pooled answers
  const uneven = [{ hits: 4, runs: 4 }, { hits: 0, runs: 1 }];
  assert.equal(clusteredRate(uneven).p, 0.5);
  assert.equal(clusteredRate([]).questions, 0);
});

test("prominence uses the list position when there is one", () => {
  assert.equal(prominenceScore(500, 1000, 1), 1);
  assert.equal(prominenceScore(500, 1000, 3), 0.5);
  assert.ok(prominenceScore(10, 1000) > prominenceScore(900, 1000));
});

test("seeded shuffle: deterministic per seed, a permutation, different per engine", () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  const a = seededShuffle(items, "batch-1:google_aio");
  assert.deepEqual(seededShuffle(items, "batch-1:google_aio"), a);
  assert.deepEqual([...a].sort((x, y) => x - y), items);
  assert.notDeepEqual(a, items);
  assert.notDeepEqual(seededShuffle(items, "batch-1:perplexity"), a);
  assert.notDeepEqual(seededShuffle(items, "batch-2:google_aio"), a);
  // the first two positions are spread over the list, not always the head
  const firstTwo = new Set<number>();
  for (let b = 0; b < 40; b++) seededShuffle(items, `b${b}:google_aio`).slice(0, 2).forEach((x) => firstTwo.add(x));
  assert.ok(firstTwo.size > 25, `${firstTwo.size} distinct prompts in the first two slots of 40 batches`);
});
