import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchUrl, parseSearchResults, searchPlaces } from "../js/api.js";

test("search URL is limited to Peru and to the selectable area box", () => {
  const url = new URL(buildSearchUrl("  Baños del Inca ", { south: -16, west: -79, north: -6, east: -69 }));
  assert.equal(url.hostname, "nominatim.openstreetmap.org");
  assert.equal(url.searchParams.get("q"), "Baños del Inca");
  assert.equal(url.searchParams.get("countrycodes"), "pe");
  assert.equal(url.searchParams.get("viewbox"), "-79,-6,-69,-16");
  assert.equal(url.searchParams.get("bounded"), "1");
});

test("search URL without bounds does not restrict to a box", () => {
  const url = new URL(buildSearchUrl("Cusco"));
  assert.equal(url.searchParams.get("viewbox"), null);
  assert.equal(url.searchParams.get("bounded"), null);
});

test("results keep name, a short detail and numeric coordinates", () => {
  const places = parseSearchResults([
    { name: "Baños del Inca", display_name: "Baños del Inca, Los Baños del Inca, Cajamarca, 06003, Perú", lat: "-7.1637", lon: "-78.4647" },
    { name: "", display_name: "Sin coordenadas, Perú", lat: "x", lon: "y" },
  ]);
  assert.deepEqual(places, [
    { nombre: "Baños del Inca", detalle: "Los Baños del Inca, Cajamarca", lat: -7.1637, lon: -78.4647 },
  ]);
});

test("a repeat of the same place a few km away is dropped, a namesake far away is kept", () => {
  const places = parseSearchResults([
    { name: "Baños del Inca", display_name: "Baños del Inca, Cajamarca, Perú", lat: "-7.1638", lon: "-78.4648" },
    { name: "Baños del Inca", display_name: "Baños del Inca, Avenida Manco Capac, Cajamarca, Perú", lat: "-7.1650", lon: "-78.4660" },
    { name: "Baños del Inca", display_name: "Baños del Inca, Huaytará, Huancavelica, Perú", lat: "-13.60", lon: "-75.35" },
  ]);
  assert.deepEqual(places.map((p) => p.detalle), ["Cajamarca", "Huaytará, Huancavelica"]);
});

test("results that read the same are shown once", () => {
  const places = parseSearchResults([
    { name: "Arequipa", display_name: "Arequipa, Perú", lat: "-16.40", lon: "-71.54" },
    { name: "Arequipa", display_name: "Arequipa, Perú", lat: "-15.80", lon: "-72.40" },
  ]);
  assert.equal(places.length, 1);
  assert.equal(places[0].lat, -16.4);
});

test("unexpected bodies give no results", () => {
  assert.deepEqual(parseSearchResults({ error: "x" }), []);
});

test("empty query does not call the service and HTTP errors are raised", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: false, status: 429, json: async () => [] }; };
  assert.deepEqual(await searchPlaces("   ", { fetchImpl }), []);
  assert.equal(calls, 0);
  await assert.rejects(searchPlaces("Puno", { fetchImpl }), /HTTP 429/);
});
