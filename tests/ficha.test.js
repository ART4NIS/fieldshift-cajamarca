import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluarRotaciones } from "../js/scoring.js";
import { construirFicha, nivelConfianzaInfo, palabraValor, resumenSimple, rasgosCultivo } from "../js/ficha.js";
import { pdfText, nombreArchivo } from "../js/pdf.js";

const load = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf-8"));
const clima = load("./fixtures/cajamarca_clima.json").clima;
const { cultivos } = load("../data/cultivos.json");
const { rotaciones } = load("../data/rotaciones.json");
const doc = load("../data/fichas.json");
const imagenes = load("../data/imagenes_cultivos.json").imagenes;

const pesos = { agua: 3, suelo: 3, erosion: 3, forraje: 3, clima: 3 };
const results = evaluarRotaciones(clima, cultivos, rotaciones, pesos, { corregido: true, pendiente_pct: 2 });
const fichas = results.map((result, posicion) => construirFicha({
  result,
  rotacion: rotaciones.find((r) => r.id === result.rotacion),
  cultivos,
  doc,
  pesos,
  posicion,
  mejorTotal: results[0].total,
  otros: results.filter((r) => r !== result).map((r) => r.criterios),
  contexto: { fuente: "NASA POWER", corregido: true, periodoCorreccion: "1991-2016", pendiente: { pendiente_pct: 2, fuente: "DEM" } },
}));

test("confidence maps to green, yellow and red classes", () => {
  assert.equal(nivelConfianzaInfo("Alto").clase, "alto");
  assert.equal(nivelConfianzaInfo("Medio").clase, "medio");
  assert.equal(nivelConfianzaInfo("Bajo").clase, "bajo");
  assert.equal(nivelConfianzaInfo("desconocido").clase, "bajo", "unknown levels are never shown as trustworthy");
});

test("criterion scores get one plain word", () => {
  assert.deepEqual([80, 60, 45, 10].map(palabraValor), ["Very good", "Good", "Fair", "Low"]);
});

test("every card has the four years, five criteria and its evidence", () => {
  assert.equal(fichas.length, 3);
  for (const f of fichas) {
    assert.equal(f.anios.length, 4);
    assert.equal(f.criterios.length, 5);
    assert.ok(f.porcentaje >= 0 && f.porcentaje <= 100);
    assert.ok(f.evidenciaDisponible, `evidence for ${f.id}`);
    assert.ok(f.fuentes.length > 0, `sources for ${f.id}`);
    assert.ok(f.mesesEnCampo.every((m) => m >= 1 && m <= 12));
  }
});

test("a fallow year is shown as rest, not as an unknown crop", () => {
  const tradicional = fichas.find((f) => f.id === "A");
  assert.deepEqual(tradicional.anios.at(-1), {
    anio: 4, id: "descanso", nombre: "Fallow", descanso: true, detalle: "The land rests", rasgos: [],
  });
  assert.equal(tradicional.secuencia, "Potato → Maize → Wheat → Fallow");
});

test("every crop and the fallow year have a reference photo with attribution", () => {
  for (const id of [...cultivos.map((c) => c.id), "descanso"]) {
    const img = imagenes[id];
    assert.ok(img, `image for ${id}`);
    assert.match(img.url, /^https:\/\/upload\.wikimedia\.org\//);
    for (const campo of ["alt", "autor", "licencia", "pagina"]) assert.ok(img[campo], `${id}.${campo}`);
  }
});

test("the summary names the best option and compares with the other rotations", () => {
  assert.match(fichas[0].resumen[0], /best matches/);
  assert.match(fichas[1].resumen[0], /below the best option|as well as/);
  const aguaEficiente = fichas.find((f) => f.id === "C");
  assert.ok(!aguaEficiente.resumen.join(" ").includes("it needs more water"), "the low-water rotation is not called thirsty");
});

test("the summary flags a criterion the user cares about when it scores low", () => {
  const frases = resumenSimple({ total: 50, criterios: { agua: 30, suelo: 80, erosion: 70, forraje: 60, clima: 60 } }, { agua: 5 });
  assert.ok(frases.some((f) => f.includes("water savings") && f.includes("very important")));
});

test("crop tags describe what the crop brings", () => {
  const rasgos = (id) => rasgosCultivo(cultivos.find((c) => c.id === id));
  assert.ok(rasgos("haba").includes("Enriches the soil"));
  assert.ok(rasgos("tarwi").includes("Drought tolerant"));
  assert.ok(rasgos("papa").includes("Frost sensitive"));
});

test("technical detail carries exact figures and the plain card does not defer to a technician", () => {
  const f = fichas[0];
  assert.ok(f.detalleTecnico.some((t) => t.startsWith("Slope: 2 %")));
  assert.ok(f.resumen.every((t) => !t.includes("advisor")));
});

test("missing evidence file still yields a usable card", () => {
  const f = construirFicha({ result: results[0], rotacion: rotaciones.find((r) => r.id === results[0].rotacion), cultivos });
  assert.equal(f.evidenciaDisponible, false);
  assert.deepEqual(f.fuentes, []);
  assert.equal(f.anios.length, 4);
});

test("PDF text keeps Spanish accents and replaces characters outside Latin-1", () => {
  assert.equal(pdfText("Papa → Maíz – 2 °C… ≥ 5"), "Papa > Maíz - 2 °C... >= 5");
  assert.equal(nombreArchivo([{ id: "B" }]), "soworbit-rotation-b.pdf");
  assert.equal(nombreArchivo([{ id: "A" }, { id: "B" }]), "soworbit-rotations.pdf");
});
