import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildPowerUrl,
  buildElevationUrl,
  climateFromPower,
  checkAltitude,
  fetchClimate,
  fetchElevation,
  nearestPilot,
  distanceKm,
} from "../js/api.js";

const load = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf-8"));
const pilot = load("../data/pilots/cajamarca.json");
const fixture = load("./fixtures/cajamarca_clima.json").clima;

/** Synthetic POWER block: constant values for the given years, plus the YYYY13 annual key. */
function synthPower(years, { t2m = 10, tmin = 2, rain = 1 } = {}) {
  const p = { T2M: {}, T2M_MIN: {}, PRECTOTCORR: {} };
  for (const y of years) {
    for (let m = 1; m <= 13; m++) {
      const k = `${y}${String(m).padStart(2, "0")}`;
      p.T2M[k] = t2m;
      p.T2M_MIN[k] = tmin;
      p.PRECTOTCORR[k] = rain;
    }
  }
  return p;
}

test("buildPowerUrl matches the Python request", () => {
  const url = new URL(buildPowerUrl(-7.16, -78.51));
  assert.equal(url.origin + url.pathname, "https://power.larc.nasa.gov/api/temporal/monthly/point");
  const q = url.searchParams;
  assert.equal(q.get("parameters"), "T2M,T2M_MIN,PRECTOTCORR");
  assert.equal(q.get("community"), "AG");
  assert.equal(q.get("latitude"), "-7.16");
  assert.equal(q.get("longitude"), "-78.51");
  assert.equal(q.get("start"), "1991");
  assert.equal(q.get("end"), "2024");
  assert.equal(q.get("format"), "JSON");
});

test("transform drops YYYY13 and -999 fills", () => {
  const p = synthPower([2001, 2002]);
  p.T2M["200201"] = -999;
  p.T2M["200113"] = 999; // annual key must be ignored
  const clima = climateFromPower(p);
  assert.equal(clima.length, 12);
  assert.equal(clima[0].tmed, 10);
  assert.equal(clima[0].lluvia_mm, 31); // only 2001: 1 mm/day * 31
});

test("transform uses leap-year February length", () => {
  const feb = (years) => climateFromPower(synthPower(years))[1];
  assert.equal(feb([2001]).lluvia_mm, 28);
  assert.equal(feb([2000]).lluvia_mm, 29);
  assert.equal(feb([2000, 2001]).lluvia_mm, 28.5);
  assert.ok(feb([2000, 2001]).lluvia_cv > 0);
});

test("transform applies the bias correction", () => {
  const bias = {
    monthly: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1, tmin_bias: -2, tmax_bias: -1, lluvia_factor: 2, pct_years_frost_2: 12.5,
    })),
  };
  const jan = climateFromPower(synthPower([2001]), bias)[0];
  assert.equal(jan.tmed, 8.5);
  assert.equal(jan.tmin_abs, 0);
  assert.equal(jan.lluvia_mm, 62);
  assert.equal(jan.prob_helada, 0.125);
  const raw = climateFromPower(synthPower([2001]), null)[0];
  assert.deepEqual([raw.tmed, raw.tmin_abs, raw.lluvia_mm, raw.prob_helada], [10, 2, 31, 0]);
});

test("without a pilot, frost probability comes from POWER T2M_MIN instead of 0", () => {
  const p = synthPower([2001, 2002, 2003, 2004], { tmin: 5 });
  p.T2M_MIN["200107"] = 1.5; // below 2 C
  p.T2M_MIN["200307"] = -0.5; // below 2 C
  p.T2M_MIN["200407"] = 2; // exactly 2 C is not frost
  const julio = climateFromPower(p, null)[6];
  assert.equal(julio.prob_helada, 0.5);
  assert.equal(climateFromPower(p, null)[0].prob_helada, 0);
});

test("pilot frost statistics win over the POWER estimate", () => {
  const p = synthPower([2001], { tmin: -3 });
  const bias = { monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, pct_years_frost_2: 10 })) };
  assert.equal(climateFromPower(p, bias)[0].prob_helada, 0.1);
});

test("nearestPilot snaps clicks within 10 km to a pilot", () => {
  const pilots = [
    { id: "cajamarca", lat: -7.16, lon: -78.51 },
    { id: "puno", lat: -15.84, lon: -70.02 },
  ];
  assert.equal(nearestPilot(-7.2, -78.5, pilots)?.id, "cajamarca"); // ~4.6 km
  assert.equal(nearestPilot(-7.4, -78.51, pilots), null); // ~26.5 km
  assert.equal(nearestPilot(-7.2, -78.5, []), null);
  assert.ok(Math.abs(distanceKm(-7.16, -78.51, -7.2, -78.5) - 4.6) < 0.2);
});

test("fetchClimate falls back to the cache when POWER fails", async () => {
  const body = {
    geometry: { coordinates: [-78.51, -7.16, 2750] },
    properties: { parameter: synthPower([2001, 2002]) },
  };
  const fetchImpl = async (url) => {
    if (String(url).includes("power.larc")) throw new Error("offline");
    if (String(url).includes("power_cache")) return { ok: true, json: async () => body };
    return { ok: true, json: async () => pilot };
  };
  const res = await fetchClimate(-7.16, -78.51, { pilotId: "cajamarca", fetchImpl });
  assert.equal(res.clima.length, 12);
  assert.equal(res.elevation, 2750);
  assert.match(res.elevationSource, /POWER/);
  assert.equal(res.corregido, true);
  assert.match(res.fuente, /copia guardada/);
});

test("fetchClimate prefers Open-Meteo elevation over the POWER cell", async () => {
  const body = {
    geometry: { coordinates: [-77.04, -12.05, 1195] },
    properties: { parameter: synthPower([2001, 2002]) },
  };
  const fetchImpl = async (url) => {
    if (String(url).includes("open-meteo")) return { ok: true, json: async () => ({ elevation: [148] }) };
    return { ok: true, json: async () => body };
  };
  const res = await fetchClimate(-12.05, -77.04, { fetchImpl });
  assert.equal(res.elevation, 148);
  assert.match(res.elevationSource, /Open-Meteo/);
  assert.equal(checkAltitude(res.elevation).ok, false);
});

test("fetchElevation returns null on failure or non-numeric data", async () => {
  assert.equal(await fetchElevation(0, 0, { fetchImpl: async () => { throw new Error("offline"); } }), null);
  assert.equal(await fetchElevation(0, 0, { fetchImpl: async () => ({ ok: false, status: 429 }) }), null);
  assert.equal(await fetchElevation(0, 0, { fetchImpl: async () => ({ ok: true, json: async () => ({ elevation: [NaN] }) }) }), null);
});

test("buildElevationUrl targets Open-Meteo with lat/lon", () => {
  const url = new URL(buildElevationUrl(-7.16, -78.51));
  assert.equal(url.hostname, "api.open-meteo.com");
  assert.equal(url.searchParams.get("latitude"), "-7.16");
  assert.equal(url.searchParams.get("longitude"), "-78.51");
});

test("checkAltitude warns below 2500 m", () => {
  assert.equal(checkAltitude(150).ok, false);
  assert.match(checkAltitude(150).mensaje, /150 m/);
  assert.equal(checkAltitude(2750).ok, true);
  assert.equal(checkAltitude(null).ok, false);
});

// Opt-in (needs network): POWER_LIVE=1 npm test
test("live POWER reproduces the cajamarca fixture", { skip: !process.env.POWER_LIVE }, async () => {
  // Node fetch cannot read file: URLs, so serve local data files from disk.
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.startsWith("file:")) {
      return { ok: true, json: async () => JSON.parse(readFileSync(fileURLToPath(u), "utf-8")) };
    }
    return fetch(u);
  };
  const res = await fetchClimate(pilot.lat, pilot.lon, { pilotId: "cajamarca", fetchImpl });
  assert.equal(res.corregido, true);
  for (const [i, row] of fixture.entries()) {
    for (const key of Object.keys(row)) {
      assert.ok(Math.abs(res.clima[i][key] - row[key]) <= 0.05, `month ${row.mes} ${key}`);
    }
  }
});
