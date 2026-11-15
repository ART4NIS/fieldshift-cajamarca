// Builds data/selectable_area.geojson: the land at or above 2,500 m, excluding lakes. This is the area
// where map clicks are accepted (see js/ui.js). Two modes:
//   default         one feature per available pilot, limited to RADIUS_KM around it;
//   --whole-sierra  one feature for all of Peru's sierra, clipped to data/peru_boundary.geojson.
//
// Method: sample elevation on a regular lat/lon grid (Open-Meteo elevation API, Copernicus DEM 90 m,
// max 100 coordinates per request), blank every cell outside the circle or inside a lake
// (data/water_mask.geojson) with a sentinel below the threshold, then contour at the threshold with
// marching squares (d3-contour, devDependency used only here; the browser never loads it).
//
// Usage: node scripts/build_selectable_area.mjs [--radius-km=100] [--spacing=0.05] [--threshold=2500]
//        node scripts/build_selectable_area.mjs --whole-sierra [--spacing=0.05]
//
// Elevations are cached in .cache/elev_points.json (gitignored). --whole-sierra never calls Open-Meteo:
// fill the cache first with `python scripts/build_dem_grid.py` (Copernicus DEM tiles, no quota).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { contours } from "d3-contour";
import { distanceKm, isOnWater, inSelectableArea } from "../js/api.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v === undefined ? true : Number(v)]),
);
const WHOLE_SIERRA = args["whole-sierra"] === true;
const RADIUS_KM = args["radius-km"] ?? 100;
const SPACING = args.spacing ?? 0.05; // degrees (~5.5 km); 0.025 needs ~4x the API quota
const THRESHOLD_M = args.threshold ?? 2500;
const SENTINEL = -500; // outside the circle: far below the threshold, the contour hugs the last real cell
// Lake cells sit just under the threshold, so the contour reaches the lake node instead of cutting a
// full cell short of the shore (shore towns like Puno would fall outside). The area may therefore
// overlap a lake by up to one cell; clicks on the lake itself are still rejected via water_mask.geojson.
const LAKE_VALUE = THRESHOLD_M - 1;
const BATCH = 100; // Open-Meteo hard limit per request
// Open-Meteo free tier counts every coordinate: 600 per minute, 5,000 per hour, 10,000 per day.
// 100-coordinate requests spaced 75 s apart stay under the per-hour limit (4,800 coordinates/hour).
// A run that hits the daily limit stops; rerun it the next day and the cache resumes where it left off.
const THROTTLE_MS = 75000;
const SIMPLIFY_DEG = 0.004; // ~450 m
const MIN_PART_CELLS = 1.5; // drop islands/holes smaller than this many grid cells
const KM_PER_DEG = 111.195;
const CACHE_DIR = new URL("../.cache/", import.meta.url);
const OUT = new URL("../data/selectable_area.geojson", import.meta.url);

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf-8"));
const pilots = readJson("../data/pilots_index.json").pilotos.filter((p) => p.disponible !== false);
const water = readJson("../data/water_mask.geojson");
const peru = WHOLE_SIERRA ? readJson("../data/peru_boundary.geojson") : null;

let requests = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBatch(lats, lons) {
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(",")}&longitude=${lons.join(",")}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    requests++;
    const res = await fetch(url);
    if (res.ok) {
      const body = await res.json();
      if (!Array.isArray(body.elevation) || body.elevation.length !== lats.length) throw new Error("Bad elevation response");
      return body.elevation;
    }
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.max(Number(res.headers.get("retry-after")) * 1000 || 0, 30000);
      console.log(`  HTTP ${res.status}, retrying in ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
  throw new Error("Too many retries");
}

const round = (x, d) => Number(x.toFixed(d));

/** Grid aligned to multiples of SPACING covering a bounding box. */
function gridForBox(south, west, north, east) {
  const lon0 = Math.floor(west / SPACING) * SPACING;
  const lat1 = Math.ceil(north / SPACING) * SPACING; // north edge
  const w = Math.ceil((east - lon0) / SPACING) + 1;
  const h = Math.ceil((lat1 - south) / SPACING) + 1;
  return { lon0, lat1, w, h };
}

/** A region to contour: its grid and the test for cells that may belong to the area. */
function circleRegion(p) {
  const dLat = RADIUS_KM / KM_PER_DEG;
  const dLon = RADIUS_KM / (KM_PER_DEG * Math.cos((p.lat * Math.PI) / 180));
  return {
    id: p.id,
    properties: { pilot_id: p.id, nombre: p.nombre ?? p.id },
    grid: gridForBox(p.lat - dLat, p.lon - dLon, p.lat + dLat, p.lon + dLon),
    inside: (lat, lon) => distanceKm(lat, lon, p.lat, p.lon) <= RADIUS_KM,
  };
}

function peruRegion() {
  const ring = peru.features[0].geometry.coordinates[0];
  const lons = ring.map(([x]) => x);
  const lats = ring.map(([, y]) => y);
  return {
    id: "sierra",
    properties: { region: "sierra", nombre: "Sierra del Perú" },
    grid: gridForBox(Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)),
    inside: (lat, lon) => inSelectableArea(lat, lon, peru),
  };
}

/**
 * Elevations for every grid cell. Cache is a point map ("lat,lon" -> m) in .cache/, so a rerun, or a
 * different spacing on the same lattice, only fetches the missing points.
 */
async function loadElevations(region) {
  const g = region.grid;
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = new URL("elev_points.json", CACHE_DIR);
  const cache = existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : {};
  const total = g.w * g.h;
  const lat = (i) => round(g.lat1 - Math.floor(i / g.w) * SPACING, 4);
  const lon = (i) => round(g.lon0 + (i % g.w) * SPACING, 4);
  const key = (i) => `${lat(i)},${lon(i)}`;
  // Only cells inside the region and off the lakes can end up in the area: do not spend quota on the rest.
  const needed = (i) => region.inside(lat(i), lon(i)) && !isOnWater(lat(i), lon(i), water);
  const missing = Array.from({ length: total }, (_, i) => i).filter((i) => needed(i) && !(key(i) in cache));
  console.log(`  ${region.id}: ${total - missing.length} cached, ${missing.length} to fetch`);
  if (WHOLE_SIERRA && missing.length) {
    throw new Error(`${missing.length} points missing: run python scripts/build_dem_grid.py --spacing ${SPACING}`);
  }
  for (let k = 0; k < missing.length; k += BATCH) {
    const idx = missing.slice(k, k + BATCH);
    const part = await fetchBatch(idx.map(lat), idx.map(lon));
    idx.forEach((i, j) => { cache[key(i)] = part[j]; });
    writeFileSync(file, JSON.stringify(cache));
    await sleep(THROTTLE_MS);
  }
  return Array.from({ length: total }, (_, i) => cache[key(i)] ?? NaN);
}

// ---- geometry helpers ----------------------------------------------------
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

const ringArea = (r) => Math.abs(r.reduce((s, [x, y], i) => {
  const [x2, y2] = r[(i + 1) % r.length];
  return s + (x * y2 - x2 * y);
}, 0)) / 2;

function buildFeature(region) {
  return async () => {
    const g = region.grid;
    console.log(`${region.id}: grid ${g.w} x ${g.h} = ${g.w * g.h} cells`);
    const elev = await loadElevations(region);
    const values = new Float64Array(g.w * g.h);
    for (let i = 0; i < values.length; i++) {
      const lat = g.lat1 - Math.floor(i / g.w) * SPACING;
      const lon = g.lon0 + (i % g.w) * SPACING;
      if (!region.inside(lat, lon)) values[i] = SENTINEL;
      else if (isOnWater(lat, lon, water)) values[i] = LAKE_VALUE;
      else values[i] = Number.isFinite(elev[i]) ? elev[i] : SENTINEL;
    }
    const multi = contours().size([g.w, g.h]).thresholds([THRESHOLD_M])(values)[0];
    const minArea = MIN_PART_CELLS;
    // d3-contour puts the value at cell (x, y) at pixel center (x + 0.5, y + 0.5).
    const toGeo = ([x, y]) => [round(g.lon0 + (x - 0.5) * SPACING, 3), round(g.lat1 - (y - 0.5) * SPACING, 3)];
    const polygons = [];
    for (const poly of multi.coordinates) {
      if (ringArea(poly[0]) < minArea) continue;
      const rings = poly
        .filter((r, i) => i === 0 || ringArea(r) >= minArea)
        .map((r) => simplify(r.map(toGeo), SIMPLIFY_DEG))
        .filter((r) => r.length >= 4);
      if (rings.length) polygons.push(rings);
    }
    return {
      type: "Feature",
      properties: region.properties,
      geometry: { type: "MultiPolygon", coordinates: polygons },
    };
  };
}

const t0 = Date.now();
const features = [];
const regions = WHOLE_SIERRA ? [peruRegion()] : pilots.map(circleRegion);
for (const r of regions) features.push(await buildFeature(r)());

const out = {
  type: "FeatureCollection",
  properties: {
    description: WHOLE_SIERRA
      ? "Selectable area: land in Peru at or above the threshold; lakes are excluded only to grid resolution (the lake itself is rejected by water_mask.geojson)."
      : "Selectable area: land at or above the threshold within radius_km of each pilot; lakes are excluded only to grid resolution (the lake itself is rejected by water_mask.geojson).",
    source: WHOLE_SIERRA
      ? "Copernicus DEM GLO-90 tiles (AWS open data, 4x overview); Peru boundary from OpenStreetMap; lakes from data/water_mask.geojson"
      : "Copernicus DEM 90 m via Open-Meteo elevation API; lakes from data/water_mask.geojson",
    threshold_m: THRESHOLD_M,
    radius_km: WHOLE_SIERRA ? null : RADIUS_KM,
    grid_spacing_deg: SPACING,
    generated: new Date().toISOString().slice(0, 10),
  },
  features,
};
writeFileSync(OUT, JSON.stringify(out));
const vertices = (f) => f.geometry.coordinates.reduce((s, poly) => s + poly.reduce((a, r) => a + r.length, 0), 0);
console.log(`requests: ${requests}, time: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const f of features) console.log(`${f.properties.pilot_id ?? f.properties.region}: ${f.geometry.coordinates.length} polygons, ${vertices(f)} vertices`);
