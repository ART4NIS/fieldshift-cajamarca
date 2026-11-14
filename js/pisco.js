// Live PISCO bias correction for an arbitrary point, in the browser.
// Reference implementation: scripts/build_climate_bias.py (the Python wins on any difference).
// Pure math (parsing, bias, frost, rain factor) is separated from thin, injectable fetching.

const POWER_DAILY_URL = "https://power.larc.nasa.gov/api/temporal/daily/point";
const POWER_MONTHLY_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point";
const PISCO_BASE = "https://iridl.ldeo.columbia.edu/SOURCES/.SENAMHI/.HSR/.PISCO";
const POWER_FILL = -999;
export const MIN_RAIN_FOR_FACTOR_MM = 1.0;
export const RAIN_FACTOR_LIMITS = [0.25, 4.0];
export const FROST_THRESHOLD_C = 0.0;
export const AGRO_FROST_THRESHOLD_C = 2.0;
export const DEFAULT_START = 1991;
export const DEFAULT_END = 2016;
// Total time allowed for the whole live computation before falling back to the nearest pilot.
export const LIVE_TIMEOUT_MS = 60000;
const CACHE_PREFIX = "fieldshift-bias-v1:";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const round = (x, digits) => Number(x.toFixed(digits));
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad2 = (n) => String(n).padStart(2, "0");

// ---- URLs ----------------------------------------------------------------
export function buildPiscoTempUrl(variable, lat, lon, start = DEFAULT_START, end = DEFAULT_END) {
  return (
    `${PISCO_BASE}/.Temp/.v1p1/.${variable}/.stable/.daily/X/${lon}/VALUE/Y/${lat}/VALUE/` +
    `T/(1%20Jan%20${start})/(31%20Dec%20${end})/RANGEEDGES/T/exch/table:/text/text/:table/.tsv`
  );
}

export function buildPiscoRainUrl(lat, lon, start = DEFAULT_START, end = DEFAULT_END) {
  return (
    `${PISCO_BASE}/.Prec/.v2p1/.stable/.monthly/.Prec/X/${lon}/VALUE/Y/${lat}/VALUE/` +
    `T/(Jan%20${start})/(Dec%20${end})/RANGEEDGES/T/exch/table:/text/text/:table/.tsv`
  );
}

export function buildPowerDailyUrl(lat, lon, start = DEFAULT_START, end = DEFAULT_END) {
  const q = new URLSearchParams({
    parameters: "T2M_MIN,T2M_MAX",
    community: "AG",
    latitude: String(lat),
    longitude: String(lon),
    start: `${start}0101`,
    end: `${end}1231`,
    format: "JSON",
  });
  return `${POWER_DAILY_URL}?${q}`;
}

export function buildPowerMonthlyRainUrl(lat, lon, start = DEFAULT_START, end = DEFAULT_END) {
  const q = new URLSearchParams({
    parameters: "PRECTOTCORR",
    community: "AG",
    latitude: String(lat),
    longitude: String(lon),
    start: String(start),
    end: String(end),
    format: "JSON",
  });
  return `${POWER_MONTHLY_URL}?${q}`;
}

// ---- pure parsing ----------------------------------------------------------
function tsvRows(text, what) {
  if (text.trimStart().startsWith("<")) throw new Error(`PISCO returned HTML instead of data for ${what}`);
  // First two lines are the column header and the units header.
  return text.split(/\r?\n/).slice(2).filter((l) => l.trim()).map((l) => l.split("\t"));
}

function monthIndex(abbr) {
  const i = MONTHS.indexOf(abbr);
  if (i < 0) throw new Error(`Unknown month "${abbr}"`);
  return i + 1;
}

/** PISCO daily TSV ("d Mon yyyy<TAB>value") -> { YYYYMMDD: value }. */
export function parsePiscoDailyTsv(text) {
  const out = {};
  for (const [rawDate, rawValue] of tsvRows(text, "daily temperature")) {
    const [d, mon, y] = rawDate.trim().split(/\s+/);
    out[`${y}${pad2(monthIndex(mon))}${pad2(Number(d))}`] = Number(rawValue);
  }
  return out;
}

/** PISCO monthly TSV ("Mon yyyy<TAB>value") -> { YYYYMM: mm }. */
export function parsePiscoMonthlyTsv(text) {
  const out = {};
  for (const [rawDate, rawValue] of tsvRows(text, "precipitation")) {
    const [mon, y] = rawDate.trim().split(/\s+/);
    out[`${y}${pad2(monthIndex(mon))}`] = Number(rawValue);
  }
  return out;
}

/** POWER daily `properties.parameter` -> { tmin, tmax } without fill values. */
export function parsePowerDaily(params) {
  const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== POWER_FILL));
  return { tmin: clean(params.T2M_MIN), tmax: clean(params.T2M_MAX) };
}

/** POWER monthly PRECTOTCORR (mm/day) -> { YYYYMM: mm/month }; YYYY13 annual keys are dropped. */
export function parsePowerMonthlyRain(series) {
  const out = {};
  for (const [key, perDay] of Object.entries(series)) {
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(4));
    if (month === 13 || perDay === POWER_FILL) continue;
    out[key] = perDay * daysInMonth(year, month);
  }
  return out;
}

// ---- pure computation ------------------------------------------------------
/** Temperature and frost block for one calendar month (same fields as the Python monthly_block). */
export function monthlyBlock(month, pisco, power) {
  const mm = pad2(month);
  const days = Object.keys(pisco.tmin)
    .filter((k) => k.slice(4, 6) === mm && k in power.tmin)
    .sort();
  if (!days.length) throw new Error(`No overlapping days for month ${mm}`);
  const byYear = new Map();
  for (const d of days) {
    const y = d.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(d);
  }
  const tmaxDays = days.filter((k) => k in pisco.tmax && k in power.tmax);
  const m = (series, keys) => mean(keys.map((k) => series[k]));
  const yearsWithMin = (limit) =>
    [...byYear.values()].filter((ds) => ds.some((d) => pisco.tmin[d] < limit)).length;
  const daysBelow = (limit) => days.filter((d) => pisco.tmin[d] < limit).length;
  return {
    month,
    n_days: days.length,
    tmin_pisco_mean: round(m(pisco.tmin, days), 2),
    tmin_power_mean: round(m(power.tmin, days), 2),
    tmin_bias: round(m(pisco.tmin, days) - m(power.tmin, days), 2),
    tmax_pisco_mean: round(m(pisco.tmax, tmaxDays), 2),
    tmax_power_mean: round(m(power.tmax, tmaxDays), 2),
    tmax_bias: round(m(pisco.tmax, tmaxDays) - m(power.tmax, tmaxDays), 2),
    tmin_pisco_abs_min: round(Math.min(...days.map((d) => pisco.tmin[d])), 2),
    pct_days_below_0: round((100 * daysBelow(FROST_THRESHOLD_C)) / days.length, 2),
    pct_days_below_2: round((100 * daysBelow(AGRO_FROST_THRESHOLD_C)) / days.length, 2),
    pct_years_frost_0: round((100 * yearsWithMin(FROST_THRESHOLD_C)) / byYear.size, 1),
    pct_years_frost_2: round((100 * yearsWithMin(AGRO_FROST_THRESHOLD_C)) / byYear.size, 1),
  };
}

/** Precipitation block for one calendar month (same fields as the Python rain_block). */
export function rainBlock(month, piscoRain, powerRain) {
  const keys = Object.keys(piscoRain).filter((k) => Number(k.slice(4)) === month && k in powerRain);
  const piscoMean = mean(keys.map((k) => piscoRain[k]));
  const powerMean = mean(keys.map((k) => powerRain[k]));
  const factor = powerMean < MIN_RAIN_FOR_FACTOR_MM
    ? 1.0
    : Math.min(Math.max(piscoMean / powerMean, RAIN_FACTOR_LIMITS[0]), RAIN_FACTOR_LIMITS[1]);
  return {
    lluvia_pisco_mm: round(piscoMean, 1),
    lluvia_power_mm: round(powerMean, 1),
    lluvia_factor: round(factor, 3),
  };
}

/** Assemble the full `climate_bias` object from already-fetched series. */
export function computeClimateBias({ pisco, power, piscoRain, powerRain }, { start = DEFAULT_START, end = DEFAULT_END, today = new Date() } = {}) {
  return {
    description:
      "Monthly corrections for NASA POWER: add tmin_bias/tmax_bias to temperatures " +
      "(bias = PISCO - POWER) and multiply precipitation by lluvia_factor " +
      "(PISCO / POWER). Frost statistics come from PISCO daily Tmin at 2 m.",
    period: `${start}-${end}`,
    generated: today.toISOString().slice(0, 10),
    confidence: "estimated",
    live: true,
    sources: {
      power: "NASA POWER daily API, community AG, T2M_MIN/T2M_MAX",
      pisco: "SENAMHI PISCOt v1.1 stable daily, via IRI/LDEO Climate Data Library",
      power_rain: "NASA POWER monthly API, community AG, PRECTOTCORR",
      pisco_rain: "SENAMHI PISCOp v2.1 stable monthly, via IRI/LDEO Climate Data Library",
    },
    monthly: Array.from({ length: 12 }, (_, i) => ({
      ...monthlyBlock(i + 1, pisco, power),
      ...rainBlock(i + 1, piscoRain, powerRain),
    })),
  };
}

// ---- thin fetching ----------------------------------------------------------
async function getText(url, fetchImpl, signal) {
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/**
 * Compute the climate_bias for a point from live PISCO + POWER data.
 * All five requests run in parallel; the whole computation is aborted after `timeoutMs`.
 */
export async function fetchLiveBias(lat, lon, { fetchImpl = globalThis.fetch, timeoutMs = LIVE_TIMEOUT_MS, start = DEFAULT_START, end = DEFAULT_END } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const { signal } = controller;
  try {
    const [tminTxt, tmaxTxt, rainTxt, powerTxt, powerRainTxt] = await Promise.all([
      getText(buildPiscoTempUrl("tmin", lat, lon, start, end), fetchImpl, signal),
      getText(buildPiscoTempUrl("tmax", lat, lon, start, end), fetchImpl, signal),
      getText(buildPiscoRainUrl(lat, lon, start, end), fetchImpl, signal),
      getText(buildPowerDailyUrl(lat, lon, start, end), fetchImpl, signal),
      getText(buildPowerMonthlyRainUrl(lat, lon, start, end), fetchImpl, signal),
    ]);
    const power = parsePowerDaily(JSON.parse(powerTxt).properties.parameter);
    const powerRain = parsePowerMonthlyRain(JSON.parse(powerRainTxt).properties.parameter.PRECTOTCORR);
    return computeClimateBias(
      {
        pisco: { tmin: parsePiscoDailyTsv(tminTxt), tmax: parsePiscoDailyTsv(tmaxTxt) },
        power,
        piscoRain: parsePiscoMonthlyTsv(rainTxt),
        powerRain,
      },
      { start, end },
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---- cache (localStorage, 0.05 degree grid) ------------------------------------
export function biasCacheKey(lat, lon) {
  const r = (x) => (Math.round(x / 0.05) * 0.05).toFixed(2);
  return `${CACHE_PREFIX}${r(lat)},${r(lon)}`;
}

export function loadCachedBias(lat, lon, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(biasCacheKey(lat, lon));
    const bias = raw ? JSON.parse(raw) : null;
    return bias?.monthly?.length === 12 ? bias : null;
  } catch {
    return null;
  }
}

export function saveCachedBias(lat, lon, bias, storage = globalThis.localStorage) {
  try {
    storage?.setItem(biasCacheKey(lat, lon), JSON.stringify(bias));
    return true;
  } catch {
    return false;
  }
}

/** Cached bias if present, otherwise computed live (and cached on success). Throws on failure. */
export async function getLocalBias(lat, lon, opts = {}) {
  const { storage = globalThis.localStorage } = opts;
  const cached = loadCachedBias(lat, lon, storage);
  if (cached) return { bias: cached, fromCache: true };
  const bias = await fetchLiveBias(lat, lon, opts);
  saveCachedBias(lat, lon, bias, storage);
  return { bias, fromCache: false };
}
