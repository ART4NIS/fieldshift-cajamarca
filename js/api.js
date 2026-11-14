// NASA POWER client: builds the 12-month climate contract used by js/scoring.js.
// Reference implementation: scripts/build_climate_fixture.py (the Python wins on any difference).

const POWER_MONTHLY_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point";
const POWER_FILL = -999;
const DATA_BASE = new URL("../data/", import.meta.url);

export function buildPowerUrl(lat, lon, start = 1991, end = 2024) {
  const query = new URLSearchParams({
    parameters: "T2M,T2M_MIN,PRECTOTCORR",
    community: "AG",
    latitude: String(lat),
    longitude: String(lon),
    start: String(start),
    end: String(end),
    format: "JSON",
  });
  return `${POWER_MONTHLY_URL}?${query}`;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const pstdev = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const round = (x, digits) => Number(x.toFixed(digits));
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Pure transform: POWER `properties.parameter` object -> 12 monthly records.
 * `climateBias` is `climate_bias` from the pilot JSON; null means no correction.
 */
export function climateFromPower(power, climateBias = null) {
  const biasByMonth = new Map((climateBias?.monthly ?? []).map((row) => [row.month, row]));
  const out = [];
  for (let month = 1; month <= 12; month++) {
    // Same filter as Python: T2M keys of this month, skipping the -999 fill. YYYY13 never matches.
    const keys = Object.keys(power.T2M).filter(
      (k) => Number(k.slice(4)) === month && power.T2M[k] !== POWER_FILL,
    );
    if (keys.length === 0) throw new Error(`No POWER data for month ${month}`);
    const b = biasByMonth.get(month) ?? {};
    const tminBias = b.tmin_bias ?? 0;
    const tmaxBias = b.tmax_bias ?? 0;
    const factor = b.lluvia_factor ?? 1;
    const rain = keys.map((k) => power.PRECTOTCORR[k] * daysInMonth(Number(k.slice(0, 4)), month) * factor);
    const rainMean = mean(rain);
    out.push({
      mes: month,
      tmed: round(mean(keys.map((k) => power.T2M[k])) + (tminBias + tmaxBias) / 2, 2),
      tmin_abs: round(mean(keys.map((k) => power.T2M_MIN[k])) + tminBias, 2),
      lluvia_mm: round(rainMean, 1),
      lluvia_cv: rainMean > 0 ? round(pstdev(rain) / rainMean, 3) : 0,
      prob_helada: round((b.pct_years_frost_2 ?? 0) / 100, 3),
    });
  }
  return out;
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

const ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";

export function buildElevationUrl(lat, lon) {
  return `${ELEVATION_URL}?${new URLSearchParams({ latitude: lat, longitude: lon })}`;
}

/**
 * Point elevation (m) from Open-Meteo (Copernicus DEM, 90 m), or null on any failure.
 * Much finer than POWER's ~50 km cell, which averages valleys and slopes together.
 */
export async function fetchElevation(lat, lon, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const body = await getJson(buildElevationUrl(lat, lon), fetchImpl);
    const value = body?.elevation?.[0];
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Fetch POWER (cache fallback) and return
 * { clima, elevation, elevationSource, corregido, fuente }.
 * Elevation prefers Open-Meteo and falls back to the POWER grid cell.
 * Without a pilot (or a pilot without climate_bias) the climate is uncorrected.
 */
export async function fetchClimate(lat, lon, { pilotId, fetchImpl = globalThis.fetch } = {}) {
  let climateBias = null;
  if (pilotId) {
    try {
      const pilot = await getJson(new URL(`pilots/${pilotId}.json`, DATA_BASE).href, fetchImpl);
      climateBias = pilot.climate_bias ?? null;
    } catch {
      climateBias = null;
    }
  }

  const elevationPromise = fetchElevation(lat, lon, { fetchImpl });

  let body;
  let fuente;
  try {
    body = await getJson(buildPowerUrl(lat, lon), fetchImpl);
    fuente = "NASA POWER (en línea)";
  } catch (liveError) {
    if (!pilotId) throw liveError;
    body = await getJson(new URL(`power_cache/${pilotId}.json`, DATA_BASE).href, fetchImpl);
    fuente = "NASA POWER (copia guardada)";
  }

  const power = body.properties?.parameter ?? body;
  const corregido = Boolean(climateBias);
  const pointElevation = await elevationPromise;
  const cellElevation = body.geometry?.coordinates?.[2] ?? null;
  return {
    clima: climateFromPower(power, climateBias),
    elevation: pointElevation ?? cellElevation,
    elevationSource: pointElevation !== null ? "Copernicus DEM 90 m (Open-Meteo)" : "NASA POWER (celda ~50 km)",
    corregido,
    fuente: corregido ? `${fuente}, corregido con datos locales (SENAMHI PISCO)` : fuente,
  };
}

export function checkAltitude(elevationM, min = 2500) {
  if (!Number.isFinite(elevationM)) {
    return { ok: false, mensaje: "No pudimos confirmar la altitud de este punto." };
  }
  if (elevationM < min) {
    return {
      ok: false,
      mensaje: `Este punto está a ${Math.round(elevationM)} m. La herramienta es para zonas sobre ${min} m; los resultados no serían confiables aquí.`,
    };
  }
  return { ok: true, mensaje: `Altitud: ${Math.round(elevationM)} m.` };
}
