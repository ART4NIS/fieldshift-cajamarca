import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATEGORIAS, normalizar, filtrarGlosario, agruparPorCategoria } from "../js/glossary.js";

const { terminos } = JSON.parse(readFileSync(new URL("../data/glosario.json", import.meta.url), "utf-8"));

test("every glossary term belongs to a known category", () => {
  const ids = new Set(CATEGORIAS.map((c) => c.id));
  for (const t of terminos) assert.ok(ids.has(t.categoria), `${t.termino}: ${t.categoria}`);
});

test("search ignores accents and capital letters", () => {
  assert.equal(normalizar("  Sequía "), "sequia");
  const found = filtrarGlosario(terminos, { texto: "DROUGHT" }).map((t) => t.termino);
  assert.ok(found.includes("Drought"));
});

test("search also looks inside the definitions", () => {
  const found = filtrarGlosario(terminos, { texto: "greenwich" }).map((t) => t.termino);
  assert.deepEqual(found, ["Longitude"]);
});

test("category filter and search text combine", () => {
  const clima = filtrarGlosario(terminos, { categoria: "clima" });
  assert.ok(clima.length > 0 && clima.every((t) => t.categoria === "clima"));
  assert.deepEqual(filtrarGlosario(terminos, { categoria: "mapa", texto: "frost" }), []);
});

test("groups follow the category order, keep every term and drop empty groups", () => {
  const grupos = agruparPorCategoria(terminos);
  assert.deepEqual(grupos.map((g) => g.categoria.id), CATEGORIAS.map((c) => c.id));
  assert.equal(grupos.reduce((n, g) => n + g.terminos.length, 0), terminos.length);
  assert.deepEqual(agruparPorCategoria(filtrarGlosario(terminos, { categoria: "datos" })).map((g) => g.categoria.id), ["datos"]);
});

test("a term without a known category is still shown", () => {
  const grupos = agruparPorCategoria([{ termino: "X", definicion: "y", categoria: "nueva" }]);
  assert.deepEqual(grupos.map((g) => g.categoria.id), ["otros"]);
});
