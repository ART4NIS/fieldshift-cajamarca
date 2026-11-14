import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluarRotaciones, calendarioRiesgos, puntajeMes, mesesCiclo,
  nivelConfianza, puntajeTotal, CRITERIOS,
} from "../js/scoring.js";

const load = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf-8"));
const clima = load("./fixtures/cajamarca_clima.json").clima;
const { cultivos } = load("../data/cultivos.json");
const { rotaciones } = load("../data/rotaciones.json");
const cultivo = (id) => cultivos.find((c) => c.id === id);

const sinPesos = { agua: 0, suelo: 0, erosion: 0, forraje: 0, clima: 0 };
const contextoPiloto = { corregido: true, pendiente_pct: null };

test("every rotation references known crops", () => {
  const ids = new Set(cultivos.map((c) => c.id));
  for (const r of rotaciones) {
    for (const a of r.anios) assert.ok(a.cultivo === "descanso" || ids.has(a.cultivo), a.cultivo);
  }
});

test("cycle months wrap around the year", () => {
  assert.deepEqual(mesesCiclo(10, 5), [10, 11, 12, 1, 2]);
});

test("all scores stay within 0-100", () => {
  const res = evaluarRotaciones(clima, cultivos, rotaciones, { agua: 5, suelo: 3, clima: 1 }, contextoPiloto);
  assert.equal(res.length, 3);
  for (const r of res) {
    assert.ok(r.total >= 0 && r.total <= 100, `total ${r.total}`);
    for (const c of CRITERIOS) assert.ok(r.criterios[c] >= 0 && r.criterios[c] <= 100, `${c} ${r.criterios[c]}`);
  }
});

test("all weights at zero does not divide by zero", () => {
  const res = evaluarRotaciones(clima, cultivos, rotaciones, sinPesos, contextoPiloto);
  for (const r of res) assert.ok(Number.isFinite(r.total));
  assert.equal(puntajeTotal({ agua: 10, suelo: 20, erosion: 30, forraje: 40, clima: 50 }, sinPesos), 30);
});

test("results are sorted by total, best first", () => {
  const res = evaluarRotaciones(clima, cultivos, rotaciones, {}, contextoPiloto);
  for (let i = 1; i < res.length; i++) assert.ok(res[i - 1].total >= res[i].total);
});

test("with soil health prioritized, a legume rotation beats the traditional one", () => {
  const res = evaluarRotaciones(clima, cultivos, rotaciones, { ...sinPesos, suelo: 5 }, contextoPiloto);
  const total = Object.fromEntries(res.map((r) => [r.rotacion, r.total]));
  assert.ok(Math.max(total.B, total.C) > total.A, JSON.stringify(total));
});

test("with water saving prioritized, rotation C beats the traditional one", () => {
  const res = evaluarRotaciones(clima, cultivos, rotaciones, { ...sinPesos, agua: 5 }, contextoPiloto);
  const total = Object.fromEntries(res.map((r) => [r.rotacion, r.total]));
  assert.ok(total.C > total.A, JSON.stringify(total));
});

test("a frost-sensitive crop is penalized more than a tolerant one in July", () => {
  const julio = clima.find((c) => c.mes === 7);
  const papa = puntajeMes(julio, cultivo("papa")).penalidades.helada;
  const avena = puntajeMes(julio, cultivo("avena")).penalidades.helada;
  assert.ok(papa > avena, `papa ${papa} vs avena ${avena}`);
});

test("confidence levels follow the available data", () => {
  assert.equal(nivelConfianza({}), "Bajo");
  assert.equal(nivelConfianza({ corregido: true }), "Medio");
  assert.equal(
    nivelConfianza({ corregido: true, satelital: { ndvi: true, humedad_suelo: true, terreno: true } }),
    "Alto",
  );
});

test("warnings explain missing data and frost months", () => {
  const [r] = evaluarRotaciones(clima, cultivos, rotaciones, {}, {});
  assert.ok(r.avisos.some((a) => a.includes("sin corrección local")));
  assert.ok(r.avisos.some((a) => a.includes("Pendiente")));
  assert.ok(r.avisos.some((a) => a.includes("riesgo de helada")));
});

test("risk calendar marks the Cajamarca dry season and frost months", () => {
  const cal = calendarioRiesgos(clima);
  assert.equal(cal.length, 12);
  const julio = cal[6];
  assert.ok(julio.helada >= 50, `helada julio ${julio.helada}`);
  assert.ok(julio.sequia >= 80, `sequia julio ${julio.sequia}`);
  assert.ok(cal[2].sequia < julio.sequia, "March is wetter than July");
});

test("invalid climate input is rejected", () => {
  assert.throws(() => evaluarRotaciones(clima.slice(0, 11), cultivos, rotaciones), /12 monthly/);
});
