import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { greennessExtremes, zoneGreennessNote, zoneGreennessDetail } from "../js/api.js";

const root = new URL("../", import.meta.url);
const pilot = (id) => JSON.parse(readFileSync(new URL(`data/pilots/${id}.json`, root), "utf-8"));

test("pilots with the NDVI grid have a full year of monthly means", () => {
  for (const id of ["cajamarca", "cusco", "huancayo", "puno"]) {
    const { ndvi } = pilot(id);
    assert.equal(ndvi.mensual.length, 12, id);
    for (const m of ndvi.mensual) assert.ok(m.media > 0 && m.media < 1, `${id} month ${m.mes}: ${m.media}`);
  }
});

test("Cusco is greenest in the rainy season and least green in the dry season", () => {
  const { alto, bajo } = greennessExtremes(pilot("cusco").ndvi);
  assert.ok([2, 3, 4].includes(alto.mes), `peak in month ${alto.mes}`);
  assert.ok([7, 8, 9].includes(bajo.mes), `low in month ${bajo.mes}`);
});

test("greenness note names the pilot and the months in plain words", () => {
  const ndvi = { mensual: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, media: i === 2 ? 0.7 : i === 7 ? 0.2 : 0.5 })) };
  assert.equal(
    zoneGreennessNote(ndvi, "Cusco"),
    "Around the Cusco pilot site, satellite images (NASA MODIS) show that fields and pasture are greenest in March and least green in August.",
  );
  assert.match(zoneGreennessDetail({ ...ndvi, n_puntos: 22, periodo: "2015-2024" }), /22 pasture and cropland points.*highest 0\.70 in March, lowest 0\.20 in August/);
});

test("no NDVI or an incomplete year gives no note", () => {
  assert.equal(zoneGreennessNote(null, "Cusco"), null);
  assert.equal(zoneGreennessNote({ mensual: [{ mes: 1, media: 0.5 }] }, "Cusco"), null);
  assert.equal(zoneGreennessDetail(undefined), null);
  assert.equal(pilot("abancay").ndvi, undefined);
});
