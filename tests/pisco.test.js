import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parsePiscoDailyTsv,
  parsePiscoMonthlyTsv,
  parsePowerMonthlyRain,
  monthlyBlock,
  rainBlock,
  computeClimateBias,
  fetchLiveBias,
  biasCacheKey,
  loadCachedBias,
  saveCachedBias,
  getLocalBias,
} from "../js/pisco.js";
import { pointInPolygon, isOnWater, fallbackAssessment, SELECT_RADIUS_KM } from "../js/api.js";

const DAILY_TSV = "T\tvalue\nunitless\tCelsius_scale\n1 Jan 2000\t1.5\n2 Jan 2000\t3\n1 Jan 2001\t4\n";

test("parsePiscoDailyTsv skips the two header lines and keys by YYYYMMDD", () => {
  assert.deepEqual(parsePiscoDailyTsv(DAILY_TSV), { 20000101: 1.5, 20000102: 3, 20010101: 4 });
  assert.throws(() => parsePiscoDailyTsv("<html></html>"), /HTML/);
});

test("parsePiscoMonthlyTsv keys by YYYYMM", () => {
  assert.deepEqual(parsePiscoMonthlyTsv("T\tv\nunitless\tmm\nJan 2000\t120.5\nDec 2001\t80\n"), { 200001: 120.5, 200112: 80 });
});

test("parsePowerMonthlyRain converts mm/day to mm/month and drops annual and fill values", () => {
  const out = parsePowerMonthlyRain({ 200002: 1, 200013: 9, 200003: -999 });
  assert.deepEqual(out, { 200002: 29 }); // 2000 is a leap year
});

test("monthlyBlock computes biases and frost shares like the Python", () => {
  const pisco = { tmin: { 20000101: 1.5, 20000102: 3, 20010101: 4 }, tmax: { 20000101: 20, 20000102: 22, 20010101: 24 } };
  const power = { tmin: { 20000101: 3, 20000102: 3, 20010101: 5 }, tmax: { 20000101: 15, 20000102: 15, 20010101: 15 } };
  const b = monthlyBlock(1, pisco, power);
  assert.equal(b.n_days, 3);
  assert.equal(b.tmin_bias, -0.83); // mean(2.8333) - mean(3.6667)
  assert.equal(b.tmax_bias, 7);
  assert.equal(b.tmin_pisco_abs_min, 1.5);
  assert.equal(b.pct_days_below_0, 0);
  assert.equal(b.pct_days_below_2, 33.33);
  assert.equal(b.pct_years_frost_2, 50); // 1 of 2 years has a day below 2 C
  assert.throws(() => monthlyBlock(2, pisco, power), /No overlapping days/);
});

test("rainBlock keeps POWER for dry months and clamps the factor", () => {
  const dry = rainBlock(7, { 200007: 5 }, { 200007: 0.5 });
  assert.equal(dry.lluvia_factor, 1);
  const wet = rainBlock(1, { 200001: 400, 200101: 400 }, { 200001: 50, 200101: 50 });
  assert.equal(wet.lluvia_factor, 4); // 8 clamped to 4
  assert.equal(rainBlock(1, { 200001: 150 }, { 200001: 100 }).lluvia_factor, 1.5);
});

function syntheticSeries() {
  const tmin = {};
  const tmax = {};
  for (let m = 1; m <= 12; m++) {
    for (const y of [2000, 2001]) {
      const key = `${y}${String(m).padStart(2, "0")}15`;
      tmin[key] = m;
      tmax[key] = m + 10;
    }
  }
  return { tmin, tmax };
}

test("computeClimateBias returns the pilot-file shape with 12 months", () => {
  const p = syntheticSeries();
  const rain = Object.fromEntries(["2000", "2001"].flatMap((y) => Array.from({ length: 12 }, (_, i) => [`${y}${String(i + 1).padStart(2, "0")}`, 100])));
  const bias = computeClimateBias(
    { pisco: p, power: { tmin: p.tmin, tmax: p.tmax }, piscoRain: rain, powerRain: rain },
    { start: 2000, end: 2001 },
  );
  assert.equal(bias.period, "2000-2001");
  assert.equal(bias.monthly.length, 12);
  for (const key of ["tmin_bias", "tmax_bias", "lluvia_factor", "pct_years_frost_2", "pct_years_frost_0"]) {
    assert.ok(key in bias.monthly[0], key);
  }
  assert.equal(bias.monthly[0].lluvia_factor, 1);
  assert.equal(bias.monthly[0].pct_years_frost_2, 100); // January Tmin 1 < 2
  assert.equal(bias.monthly[5].pct_years_frost_2, 0);
});

test("fetchLiveBias builds all five requests in parallel from an injected fetch", async () => {
  const p = syntheticSeries();
  const tsv = (series) =>
    "T\tv\nunitless\tC\n" +
    Object.entries(series).map(([k, v]) => `${Number(k.slice(6))} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(k.slice(4, 6)) - 1]} ${k.slice(0, 4)}\t${v}`).join("\n");
  const rainTsv = "T\tv\nunitless\tmm\n" + ["2000", "2001"].flatMap((y) => ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m) => `${m} ${y}\t90`)).join("\n");
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const body = url.includes("/.tmin/") ? tsv(p.tmin)
      : url.includes("/.tmax/") ? tsv(p.tmax)
      : url.includes("/.Prec/") ? rainTsv
      : url.includes("daily/point") ? JSON.stringify({ properties: { parameter: { T2M_MIN: p.tmin, T2M_MAX: p.tmax } } })
      : JSON.stringify({ properties: { parameter: { PRECTOTCORR: Object.fromEntries(["2000", "2001"].flatMap((y) => Array.from({ length: 12 }, (_, i) => [`${y}${String(i + 1).padStart(2, "0")}`, 3]))) } } });
    return { ok: true, status: 200, text: async () => body };
  };
  const bias = await fetchLiveBias(-13.3, -72.1, { fetchImpl, start: 2000, end: 2001 });
  assert.equal(urls.length, 5);
  assert.ok(urls.some((u) => u.includes("X/-72.1/VALUE/Y/-13.3/VALUE")));
  assert.equal(bias.monthly[0].tmin_bias, 0);
  await assert.rejects(fetchLiveBias(-13.3, -72.1, { fetchImpl: async () => ({ ok: false, status: 500 }) }), /HTTP 500/);
});

test("bias cache is keyed on a 0.05 degree grid and survives a throwing storage", () => {
  assert.equal(biasCacheKey(-13.301, -72.099), biasCacheKey(-13.3, -72.1));
  assert.notEqual(biasCacheKey(-13.3, -72.1), biasCacheKey(-13.4, -72.1));
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const bias = { monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1 })) };
  assert.equal(saveCachedBias(-13.3, -72.1, bias, storage), true);
  assert.deepEqual(loadCachedBias(-13.301, -72.1, storage), bias);
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  assert.equal(loadCachedBias(-13.3, -72.1, broken), null);
  assert.equal(saveCachedBias(-13.3, -72.1, bias, broken), false);
});

test("getLocalBias serves from cache without fetching", async () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const bias = { monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1 })) };
  saveCachedBias(-13.3, -72.1, bias, storage);
  const res = await getLocalBias(-13.3, -72.1, { storage, fetchImpl: () => { throw new Error("no network"); } });
  assert.equal(res.fromCache, true);
});

test("pointInPolygon handles holes", () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  assert.equal(pointInPolygon(2, 2, [square]), true);
  assert.equal(pointInPolygon(11, 2, [square]), false);
  assert.equal(pointInPolygon(5, 5, [square, hole]), false);
});

test("water mask flags Lake Titicaca and Lake Junin but not Puno city", () => {
  const mask = JSON.parse(readFileSync(new URL("../data/water_mask.geojson", import.meta.url), "utf8"));
  assert.equal(isOnWater(-15.8, -69.6, mask), true);
  assert.equal(isOnWater(-11.03, -76.12, mask), true);
  assert.equal(isOnWater(-15.84, -70.02, mask), false);
  assert.equal(isOnWater(-13.52, -71.97, mask), false);
  assert.equal(isOnWater(-15.8, -69.6, null), false);
});

test("fallbackAssessment keeps confidence within 25 km and warns beyond", () => {
  assert.deepEqual(fallbackAssessment(25, "Cusco"), { corregido: true, aviso: null });
  const far = fallbackAssessment(60, "Cusco");
  assert.equal(far.corregido, false);
  assert.match(far.aviso, /usamos la de Cusco, a 60 km/);
  assert.equal(SELECT_RADIUS_KM, 100);
});
