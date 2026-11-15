import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  slopeFromStencilXY, srtmAreaAt, srtmSlopeAt, fetchSrtmSlope, zoneSlope, zoneSteepNote, SRTM_FUENTE,
} from "../js/api.js";

const root = new URL("../", import.meta.url);
const index = JSON.parse(readFileSync(new URL("data/srtm/index.json", root), "utf-8"));
const grid = (id) => {
  const buf = readFileSync(new URL(`data/srtm/${id}.bin`, root));
  return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
};
const pilots = JSON.parse(readFileSync(new URL("data/pilots_index.json", root), "utf-8"));
const pilotList = Array.isArray(pilots) ? pilots : pilots.pilotos ?? pilots.pilots;

// Horn slope at each pilot center computed with numpy straight from the AppEEARS GeoTIFFs
// (same pixel, same cell sizes), to check the browser code against an independent implementation.
const NUMPY_REFERENCE = JSON.parse(readFileSync(new URL("tests/fixtures/srtm_reference.json", root), "utf-8"));

test("Horn slope of a plane rising 10 m every 100 m east is 10 %", () => {
  const z = [0, 10, 20, 0, 10, 20, 0, 10, 20];
  assert.ok(Math.abs(slopeFromStencilXY(z, 100, 100) - 10) < 1e-9);
});

test("unequal cell sizes are used for each axis", () => {
  // 10 m per 50 m cell east = 20 %; flat north-south.
  const z = [0, 10, 20, 0, 10, 20, 0, 10, 20];
  assert.ok(Math.abs(slopeFromStencilXY(z, 50, 100) - 20) < 1e-9);
});

test("every pilot with SRTM data has its center in its own SRTM area", () => {
  // Pilots added later have no SRTM grid yet; the app falls back to Copernicus 90 m for them.
  const withSrtm = pilotList.filter((p) => p.id in index.areas);
  assert.ok(withSrtm.length >= 4);
  for (const p of withSrtm) {
    const hit = srtmAreaAt(p.lat, p.lon, index);
    assert.ok(hit, `no SRTM area for ${p.id}`);
    assert.equal(hit[0], p.id);
  }
});

test("points outside the areas, or on their outer pixel ring, get no SRTM slope", () => {
  assert.equal(srtmAreaAt(-12.5, -76.5, index), null);
  const m = index.areas.cajamarca;
  const edge = m.west + m.res_deg * 0.5; // first column: no 3x3 neighbourhood
  assert.equal(srtmSlopeAt(-7.16, edge, grid("cajamarca"), m), null);
});

test("browser slope at each pilot center matches numpy on the original GeoTIFF", () => {
  for (const [id, ref] of Object.entries(NUMPY_REFERENCE)) {
    const m = index.areas[id];
    const pct = srtmSlopeAt(ref.lat, ref.lon, grid(id), m);
    assert.ok(Math.abs(pct - ref.slope_pct) < 0.01, `${id}: js ${pct} vs numpy ${ref.slope_pct}`);
  }
});

test("a nodata pixel in the stencil gives no slope", () => {
  const m = index.areas.cusco;
  const g = Int16Array.from(grid("cusco"));
  const col = Math.floor((-71.97 - m.west) / m.res_deg);
  const row = Math.floor((m.north - -13.52) / m.res_deg);
  g[row * m.width + col + 1] = m.nodata;
  assert.equal(srtmSlopeAt(-13.52, -71.97, g, m), null);
});

test("grids are fetched once and reused", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    const buf = readFileSync(new URL(url, root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
  };
  const cache = new Map();
  const a = await fetchSrtmSlope(-7.16, -78.51, { index, fetchImpl, cache });
  const b = await fetchSrtmSlope(-7.161, -78.511, { index, fetchImpl, cache });
  assert.equal(calls, 1);
  assert.equal(a.fuente, SRTM_FUENTE);
  assert.ok(Number.isFinite(b.pendiente_pct));
  assert.equal(await fetchSrtmSlope(-12.5, -76.5, { index, fetchImpl, cache }), null);
});

test("a failed grid download falls back to null instead of throwing", async () => {
  const r = await fetchSrtmSlope(-7.16, -78.51, { index, fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(r, null);
});

test("zone slope and steep-land note come from the pilot SRTM statistics", () => {
  const { terrain } = JSON.parse(readFileSync(new URL("data/pilots/cusco.json", root), "utf-8"));
  const z = zoneSlope(terrain);
  assert.equal(z.pendiente_pct, terrain.pendiente_pct.mediana);
  assert.equal(z.zona, true);
  assert.match(zoneSteepNote(terrain, "Cusco"), /Cusco pilot site, a substantial share of the terrain \(\d+ %\) consists of steep slopes/);
  assert.equal(zoneSlope(null), null);
  assert.equal(zoneSteepNote({}, "Cusco"), null);
});
