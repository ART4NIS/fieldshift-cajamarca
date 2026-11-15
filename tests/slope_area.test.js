import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { slopeFromStencil, fetchSlope, inSelectableArea, isOnWater } from "../js/api.js";

const load = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf-8"));

test("slopeFromStencil: flat terrain is 0 %", () => {
  assert.equal(slopeFromStencil(Array(9).fill(3000), 90), 0);
});

test("slopeFromStencil: east-west plane rising 9 m per 90 m is 10 %", () => {
  const z = [3000, 3009, 3018, 3000, 3009, 3018, 3000, 3009, 3018];
  assert.ok(Math.abs(slopeFromStencil(z, 90) - 10) < 1e-9);
});

test("slopeFromStencil: 3-4-5 plane gives 5 % and direction does not matter", () => {
  // 3 m east and 4 m north per 100 m -> hypot(0.03, 0.04) = 5 %. Rows run north to south.
  const at = (r, c) => 3000 + 3 * c + 4 * (1 - r);
  const z = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => at(r, c)));
  assert.ok(Math.abs(slopeFromStencil(z, 100) - 5) < 1e-9);
  assert.ok(Math.abs(slopeFromStencil([...z].reverse(), 100) - 5) < 1e-9);
});

const okFetch = (elevation, seen = []) => async (url) => {
  seen.push(url);
  return { ok: true, json: async () => ({ elevation }) };
};

test("fetchSlope: one request, 9 coordinates, returns percent and source", async () => {
  const seen = [];
  const z = [3000, 3009, 3018, 3000, 3009, 3018, 3000, 3009, 3018];
  const res = await fetchSlope(-7.16, -78.51, { fetchImpl: okFetch(z, seen) });
  assert.equal(seen.length, 1);
  const lats = new URL(seen[0]).searchParams.get("latitude").split(",");
  assert.equal(lats.length, 9);
  assert.ok(Number(lats[0]) > Number(lats[8]), "first row is north");
  assert.ok(Math.abs(res.pendiente_pct - 10) < 0.1);
  assert.match(res.fuente, /Copernicus/);
});

test("fetchSlope: HTTP error, network error and bad payload give null", async () => {
  assert.equal(await fetchSlope(-7, -78, { fetchImpl: async () => ({ ok: false, status: 429 }) }), null);
  assert.equal(await fetchSlope(-7, -78, { fetchImpl: async () => { throw new Error("offline"); } }), null);
  assert.equal(await fetchSlope(-7, -78, { fetchImpl: okFetch([1, 2, 3]) }), null);
  assert.equal(await fetchSlope(-7, -78, { fetchImpl: okFetch([1, 2, 3, 4, 5, 6, 7, 8, null]) }), null);
});

test("inSelectableArea: respects holes and null", () => {
  const area = {
    features: [{
      geometry: {
        type: "MultiPolygon",
        coordinates: [[
          [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
          [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
        ]],
      },
    }],
  };
  assert.equal(inSelectableArea(2, 2, area), true);
  assert.equal(inSelectableArea(5, 5, area), false); // hole
  assert.equal(inSelectableArea(20, 20, area), false);
  assert.equal(inSelectableArea(2, 2, null), false);
});

test("generated selectable area: sierra cities in, lowlands, lakes and far points out", () => {
  const area = load("../data/selectable_area.geojson");
  const water = load("../data/water_mask.geojson");
  assert.equal(area.properties.threshold_m, 2500);
  assert.equal(area.features.length, 4);
  const inside = { Cusco: [-13.52, -71.97], Huancayo: [-12.07, -75.21], Puno: [-15.84, -70.02], Cajamarca: [-7.16, -78.51] };
  for (const [name, [lat, lon]] of Object.entries(inside)) {
    assert.equal(inSelectableArea(lat, lon, area), true, `${name} should be inside`);
  }
  const outside = {
    Lima: [-12.05, -77.04],
    "Lago Titicaca": [-15.8, -69.6],
    "150 km from any pilot": [-10.0, -76.0],
    "Urubamba valley (Machu Picchu)": [-13.16, -72.55],
  };
  for (const [name, [lat, lon]] of Object.entries(outside)) {
    assert.equal(inSelectableArea(lat, lon, area), false, `${name} should be outside`);
  }
  assert.equal(isOnWater(-15.8, -69.6, water), true);
});
