// Builds data/water_mask.geojson: simplified polygons of large lakes inside the selectable area.
// Source: OpenStreetMap contributors (ODbL) via Nominatim: Lake Titicaca (relation 3000330) and
// Lake Junin / Chinchaycocha (way 23686218). Natural Earth 10m was tried first but it is too coarse:
// it puts Puno city (a shore town) inside Lake Titicaca, and it has no Lake Junin.
// Usage: node scripts/build_water_mask.mjs
import { writeFileSync } from "node:fs";

const OSM_URL = "https://nominatim.openstreetmap.org/lookup?osm_ids=R3000330,W23686218&format=json&polygon_geojson=1";
const TOLERANCE_DEG = 0.002; // ~220 m

function sqSegDist(p, a, b) {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx || dy) {
    const t = Math.max(0, Math.min(1, ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy)));
    x += dx * t;
    y += dy * t;
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Douglas-Peucker on an open polyline. */
function simplify(points, tol) {
  if (points.length <= 2) return points;
  let max = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = sqSegDist(points[i], points[0], points.at(-1));
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol * tol) return [points[0], points.at(-1)];
  return [...simplify(points.slice(0, idx + 1), tol).slice(0, -1), ...simplify(points.slice(idx), tol)];
}

const ring = (r) => simplify(r, TOLERANCE_DEG).map(([x, y]) => [Number(x.toFixed(4)), Number(y.toFixed(4))]);
const rings = (coords) => coords.map(ring).filter((r, i) => i === 0 || r.length >= 4);

const found = await (await fetch(OSM_URL, { headers: { "User-Agent": "fieldshift-build" } })).json();
const titicaca = found.find((x) => x.osm_id === 3000330);
const junin = found.find((x) => x.osm_id === 23686218);
if (!titicaca || !junin) throw new Error("Unexpected Nominatim result");

const features = [
  { name: "Lago Titicaca", source: "OpenStreetMap contributors (ODbL), relation 3000330", geometry: titicaca.geojson },
  { name: "Lago Junín (Chinchaycocha)", source: "OpenStreetMap contributors (ODbL), way 23686218", geometry: junin.geojson },
].map(({ name, source, geometry }) => ({
  type: "Feature",
  properties: { name, source },
  geometry: { type: "Polygon", coordinates: rings(geometry.coordinates) },
}));

const out = {
  type: "FeatureCollection",
  properties: {
    description: "Large lakes inside the selectable area; clicks on them are rejected. Simplified (~220 m).",
    sources: ["OpenStreetMap via Nominatim (ODbL)"],
    generated: new Date().toISOString().slice(0, 10),
  },
  features,
};
writeFileSync(new URL("../data/water_mask.geojson", import.meta.url), JSON.stringify(out));
console.log(features.map((f) => `${f.properties.name}: ${f.geometry.coordinates.reduce((n, r) => n + r.length, 0)} vertices`).join("\n"));
