// Thin UI wiring: DOM events -> pure modules (api.js, scoring.js) -> render.
import {
  fetchClimate,
  checkAltitude,
  nearestPilot,
  circleRing,
  isOnWater,
  inSelectableArea,
  fetchSlope,
  fallbackAssessment,
  PILOT_SNAP_KM,
  SELECT_RADIUS_KM,
} from "./api.js";
import { getLocalBias, LIVE_TIMEOUT_MS } from "./pisco.js";
import {
  evaluarRotaciones,
  calendarioRiesgos,
  CRITERIOS,
  AVISO_SIN_CORRECCION,
  AVISO_DATOS_ESTIMADOS,
} from "./scoring.js";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
import { renderRiskCalendar, renderRadar } from "./charts.js";

import { renderEvidence } from "./evidence.js";

const LAT_MAX = -6;
const LAT_MIN = -16;
// Zoom at which a 100 km pilot zone fills most of a phone-width map.
const ZONE_ZOOM = 8;
const FALLBACK_PILOTS =[{ id: "cajamarca", nombre: "Cajamarca", lat: -7.16, lon: -78.51 }];

const SLIDER_LABELS = {
  agua: ["Ahorrar agua", "Cultivos que necesitan menos lluvia o riego"],
  suelo: ["Cuidar el suelo", "Mantener la tierra fértil entre campañas"],
  erosion: ["Evitar que se lave la tierra", "Proteger las laderas de la erosión"],
  forraje: ["Pasto para animales", "Tener alimento para el ganado"],
  clima: ["Evitar heladas y sequía", "Menor riesgo por el clima"],
};

const $ = (id) => document.getElementById(id);
const state = {
  parcela: null, // { lat, lon, pilotId, km, mode: "pilot" | "live" | "fallback" }
  aviso: null,
  loading: null,
  water: null,
  area: null, // data/selectable_area.geojson; null -> fall back to 100 km circles
  pendiente: null, // { pendiente_pct, fuente } or null
  clima: null,
  corregido: false,
  fuente: "No informada",
  periodoCorreccion: null,
  fichas: null,
  pesos: Object.fromEntries(CRITERIOS.map((c) => [c, 3])),
  cultivos: [],
  rotaciones: [],
  pilots: [],
};

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// ---- steps -------------------------------------------------------------
function showStep(name) {
  document.querySelectorAll(".step").forEach((s) => { s.hidden = s.id !== `step-${name}`; });
  document.querySelectorAll(".steps button").forEach((b) => {
    if (b.dataset.step === name) b.setAttribute("aria-current", "step");
    else b.removeAttribute("aria-current");
  });
  if (name === "mapa") map?.invalidateSize();
  if (name === "resultados") renderResults();
}

// ---- map ---------------------------------------------------------------
let map = null;
let marker = null;

async function loadPilots() {
  try {
    const idx = await loadJson("data/pilots_index.json");
    const list = Array.isArray(idx) ? idx : idx.pilotos ?? idx.pilots;
    return list?.length ? list : FALLBACK_PILOTS;
  } catch {
    return FALLBACK_PILOTS;
  }
}

function coordsText() {
  const { lat, lon, pilotId, km, mode } = state.parcela;
  const name = state.pilots.find((p) => p.id === pilotId)?.nombre ?? pilotId;
  const base = `Latitud ${lat.toFixed(4)}, longitud ${lon.toFixed(4)}. `;
  if (mode === "pilot") return `${base}Se usan los datos locales del punto piloto ${name}.`;
  if (mode === "fallback") return `${base}Se usa la corrección del punto piloto ${name}, a ${Math.round(km)} km.`;
  return `${base}Se usará una corrección local calculada para este punto.`;
}

function selectPoint(lat, lon, pilotId = null) {
  if (state.loading) {
    $("map-msg").textContent = "Espere un momento: todavía estamos calculando el clima del punto anterior.";
    return;
  }
  if (lat > LAT_MAX || lat < LAT_MIN) {
    $("map-msg").textContent = "Este punto está fuera de la zona andina del Perú que cubre la herramienta (latitud entre -6 y -16).";
    $("to-prioridades").disabled = true;
    state.parcela = null;
    return;
  }
  if (isOnWater(lat, lon, state.water)) {
    $("map-msg").textContent = "Ese punto está sobre un lago. Toque un punto en tierra firme.";
    return;
  }
  // Selectable area: sierra land (>= 2,500 m) near a pilot. Within 10 km the pilot's own correction is used;
  // farther out the correction is computed live for the exact point (see ensureClimate).
  // Without the area file, fall back to plain 100 km circles. Pilot chips (pilotId) always work.
  if (!pilotId && state.area && !inSelectableArea(lat, lon, state.area)) {
    $("map-msg").textContent =
      "Este punto está fuera del área con datos (sierra sobre 2 500 m cerca de las zonas piloto). Elija un punto dentro del área verde.";
    return;
  }
  const near = nearestPilot(lat, lon, state.pilots, state.area ? Infinity : SELECT_RADIUS_KM);
  if (!near && !pilotId) {
    $("map-msg").textContent = "Todavía no tenemos datos para esta zona. Elija un punto dentro del área verde.";
    return;
  }
  const chosen = pilotId ? state.pilots.find((p) => p.id === pilotId) : near;
  const km = pilotId ? 0 : near.km;
  $("map-msg").textContent = "";
  state.parcela = { lat, lon, pilotId: chosen.id, km, mode: km <= PILOT_SNAP_KM ? "pilot" : "live" };
  state.clima = null;
  state.pendiente = null;
  state.aviso = null;
  if (marker) marker.setLatLng([lat, lon]);
  else marker = L.marker([lat, lon]).addTo(map);
  $("coords").textContent = coordsText();
  $("to-prioridades").disabled = false;
}

async function initMap() {
  map = L.map("map").setView([-7.16, -78.51], 8);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  map.on("click", (e) => selectPoint(e.latlng.lat, e.latlng.lng));
  try {
    state.water = await loadJson("data/water_mask.geojson");
  } catch {
    state.water = null; // without the mask, lake clicks are simply not rejected
  }

  try {
    state.area = await loadJson("data/selectable_area.geojson");
  } catch {
    state.area = null; // drawPilotZones/selectPoint fall back to 100 km circles
  }

  const pilots = (await loadPilots()).filter((p) => p.disponible !== false);
  state.pilots = pilots;
  drawPilotZones(pilots);
  for (const p of pilots) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = p.nombre ?? p.id;
    btn.addEventListener("click", () => {
      map.setView([p.lat, p.lon], ZONE_ZOOM);
      selectPoint(p.lat, p.lon, p.id);
    });
    $("pilots").append(btn);
  }
}

/**
 * Green shapes where data is available (real selectable area, or 100 km circles if the area file is
 * missing); gray mask (with holes) elsewhere.
 */
function drawPilotZones(pilots) {
  const toLatLng = ([lon, lat]) => [lat, lon];
  // Each zone = list of polygons, each polygon = [outer ring, ...holes], in [lat, lon].
  const zones = state.area
    ? state.area.features.map((f) =>
        (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)
          .map((poly) => poly.map((ring) => ring.map(toLatLng))))
    : pilots.map((p) => [[circleRing(p.lat, p.lon, SELECT_RADIUS_KM)]]);
  const rings = zones.flat(2); // every ring, outer and inner: even-odd fill makes them holes in the mask
  const world = [[-89, -179], [-89, 179], [89, 179], [89, -179]];
  L.polygon([world, ...rings], {
    stroke: false,
    fillColor: "#6b6b6b",
    fillOpacity: 0.45,
    interactive: false,
  }).addTo(map);
  for (const zone of zones) {
    L.polygon(zone, {
      color: "#2f6b3f",
      weight: 2,
      fillColor: "#3f9a55",
      fillOpacity: 0.15,
      interactive: false,
    }).addTo(map);
  }
  // At country zoom a zone is a few pixels wide: show a fixed-size dot that zooms into the zone.
  const dots = pilots.map((p) =>
    L.circleMarker([p.lat, p.lon], {
      radius: 9,
      color: "#ffffff",
      weight: 2,
      fillColor: "#2f6b3f",
      fillOpacity: 1,
    })
      .bindTooltip(p.nombre ?? p.id, { direction: "top" })
      .on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        map.setView([p.lat, p.lon], ZONE_ZOOM);
      }),
  );
  const toggleDots = () => {
    const show = map.getZoom() < ZONE_ZOOM - 1;
    for (const dot of dots) {
      if (show) dot.addTo(map);
      else dot.remove();
    }
  };
  map.on("zoomend", toggleDots);
  const bounds = L.latLngBounds(rings.flat());
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [12, 12] });
  toggleDots();
}

// ---- climate + scoring -------------------------------------------------
function setBusy(busy) {
  for (const id of ["to-prioridades", "to-resultados"]) $(id).disabled = busy;
}

/** Climate for the chosen point; one request at a time (concurrent callers share the same promise). */
function ensureClimate() {
  if (state.clima) return Promise.resolve(true);
  if (!state.loading) {
    setBusy(true);
    state.loading = loadClimate().finally(() => {
      state.loading = null;
      setBusy(false);
      if (!state.parcela) $("to-prioridades").disabled = true;
    });
  }
  return state.loading;
}

async function loadClimate() {
  const p = state.parcela;
  const pilotName = state.pilots.find((x) => x.id === p.pilotId)?.nombre ?? p.pilotId;
  let options = { pilotId: p.pilotId };
  state.aviso = null;
  state.pendiente = null;
  // Slope runs in parallel with the climate request (fetchSlope never rejects: null on failure).
  const slopePromise = fetchSlope(p.lat, p.lon);
  if (p.mode === "live") {
    $("status").textContent = "Calculando la corrección local para su punto (puede tardar hasta un minuto la primera vez)...";
    try {
      const { bias } = await getLocalBias(p.lat, p.lon, { timeoutMs: LIVE_TIMEOUT_MS });
      options = { climateBias: bias, fuenteCorreccion: "con corrección local calculada para este punto (SENAMHI PISCO)" };
    } catch {
      const fa = fallbackAssessment(p.km, pilotName);
      p.mode = "fallback";
      state.aviso = fa.aviso;
      options = { pilotId: p.pilotId, corregido: fa.corregido };
      $("coords").textContent = coordsText();
    }
  } else {
    $("status").textContent = "Cargando el clima de su parcela...";
  }
  try {
    const res = await fetchClimate(p.lat, p.lon, options);
    state.clima = res.clima;
    state.corregido = res.corregido;
    state.fuente = res.fuente;
    state.periodoCorreccion = res.periodoCorreccion;
    state.pendiente = await slopePromise;
    const alt = checkAltitude(res.elevation);
    const status = alt.ok ? "" : `${alt.mensaje} (Fuente: ${res.elevationSource})`;
    $("status").textContent = [state.aviso, status].filter(Boolean).join(" ");
    return true;
  } catch {
    $("status").textContent = "No pudimos obtener el clima de este punto. Intente de nuevo o elija otro punto.";
    return false;
  }
}

function currentResults() {
  const contexto = { corregido: state.corregido, pendiente_pct: state.pendiente?.pendiente_pct ?? null };
  return evaluarRotaciones(state.clima, state.cultivos, state.rotaciones, state.pesos, contexto);
}

function renderResults() {
  const box = $("results");
  if (!state.clima) {
    box.textContent = "Primero elija una parcela en el mapa.";
    return;
  }
  const results = currentResults();
  // Warnings shared by every rotation are shown once (banner / "before sowing" box), not on each card.
  // Crop warnings ("Papa: ...") stay on their card even when every rotation has that crop.
  const cropNames = new Set(results.flatMap((r) => (r.cultivos ?? []).map((c) => c.nombre)));
  const isCropWarning = (a) => [...cropNames].some((n) => a.startsWith(`${n}:`));
  const shared = results.length
    ? results[0].avisos.filter((a) => !isCropWarning(a) && results.every((r) => r.avisos.includes(a)))
    : [];
  // The banner is for climate with no local correction at all. A distant pilot correction (fallback)
  // is still a correction: its own warning with the distance goes in the "before sowing" box instead.
  $("frost-banner").hidden = state.corregido || state.parcela?.mode === "fallback";
  const slopeNote = $("slope-note");
  const slopeText = state.pendiente ? slopeSentence(state.pendiente.pendiente_pct) : "";
  slopeNote.textContent = slopeText;
  slopeNote.hidden = !slopeText;
  $("estimated-note").hidden = !shared.includes(AVISO_DATOS_ESTIMADOS);
  const notes = [
    ...(state.aviso ? [state.aviso] : []),
    ...shared.filter((a) => a !== AVISO_SIN_CORRECCION && a !== AVISO_DATOS_ESTIMADOS),
  ];
  $("common-notes").replaceChildren(...notes.map((a) => Object.assign(document.createElement("li"), { textContent: a })));
  $("before-sowing").hidden = false;
  box.replaceChildren(
    ...results.map((r) => resultCard({
      ...r,
      avisos: r.avisos.filter((a) => !shared.includes(a) && a !== AVISO_SIN_CORRECCION && a !== AVISO_DATOS_ESTIMADOS),
    })),
  );
  renderRiskCalendar($("chart-risk"), calendarioRiesgos(state.clima));
  renderRadar($("chart-radar"), results);
}

/** Plain-language class: < 8 % gentle, 8-20 % moderate, > 20 % steep. */
function slopeClass(pct) {
  if (pct < 8) return "suave";
  if (pct <= 20) return "moderada";
  return "fuerte";
}

function slopeSentence(pct) {
  return `Pendiente estimada del terreno en su punto: ${Math.round(pct)} % (${slopeClass(pct)}).`;
}

function resultCard(r) {
  const el = document.createElement("article");
  el.className = "card";
  const head = document.createElement("header");
  const title = document.createElement("h3");
  title.textContent = `Rotación ${r.rotacion}: ${r.nombre}`;
  const total = document.createElement("span");
  total.className = "total";
  total.textContent = `${Math.round(r.total)}/100`;
  head.append(title, total);
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = `Confianza: ${r.confianza}`;
  el.append(head, badge);
  if (r.avisos.length) {
    const ul = document.createElement("ul");
    for (const a of r.avisos) {
      const li = document.createElement("li");
      li.textContent = a;
      ul.append(li);
    }
    el.append(ul);
  }
  const detail = techDetail(r.cultivos ?? []);
  if (detail) el.append(detail);
  el.append(renderEvidence(state.fichas, r, state));
  return el;
}

/** Exact frost figures for the local technician, collapsed by default. */
function techDetail(cultivos) {
  const seen = new Set();
  const items = [];
  if (state.pendiente) {
    items.push(
      `Pendiente: ${Math.round(state.pendiente.pendiente_pct)} % (Copernicus DEM 90 m vía Open-Meteo; ` +
      "puede subestimar en laderas muy empinadas o andenes).",
    );
  }
  for (const c of cultivos) {
    for (const { mes, prob } of c.heladas ?? []) {
      const key = `${c.id}-${mes}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(
        `${c.nombre}, ${MESES[mes - 1]}: ${Math.round(prob * 100)} % de los años con mínima bajo 2 °C; ` +
        `daño desde ${c.temp_dano_helada} °C.`,
      );
    }
  }
  if (!items.length) return null;
  const details = document.createElement("details");
  details.className = "tech";
  const summary = document.createElement("summary");
  summary.textContent = "Detalle para el técnico";
  const ul = document.createElement("ul");
  for (const t of [...items, `Fuente: ${state.fuente ?? "NASA POWER"}.`]) {
    ul.append(Object.assign(document.createElement("li"), { textContent: t }));
  }
  details.append(summary, ul);
  return details;
}

// ---- priorities --------------------------------------------------------
function initSliders() {
  for (const c of CRITERIOS) {
    const [titulo, ayuda] = SLIDER_LABELS[c] ?? [c, ""];
    const row = document.createElement("div");
    row.className = "slider-row";
    const label = document.createElement("label");
    label.htmlFor = `w-${c}`;
    const name = document.createElement("span");
    name.textContent = titulo;
    const val = document.createElement("output");
    val.textContent = state.pesos[c];
    label.append(name, val);
    const input = document.createElement("input");
    Object.assign(input, { type: "range", id: `w-${c}`, min: 0, max: 5, step: 1, value: state.pesos[c] });
    const hint = document.createElement("small");
    hint.textContent = ayuda;
    input.addEventListener("input", () => {
      state.pesos[c] = Number(input.value);
      val.textContent = input.value;
      if (state.clima && !$("step-resultados").hidden) renderResults();
    });
    row.append(label, input, hint);
    $("sliders").append(row);
  }
}

// ---- glossary ----------------------------------------------------------
async function initGlossary() {
  try {
    const data = await loadJson("data/glosario.json");
    const terms = Array.isArray(data) ? data : data.terminos ?? data.glosario ?? [];
    if (!terms.length) return;
    const dl = document.createElement("dl");
    for (const t of terms) {
      const dt = document.createElement("dt");
      dt.textContent = t.termino ?? t.term;
      const dd = document.createElement("dd");
      dd.textContent = t.definicion ?? t.definition;
      dl.append(dt, dd);
    }
    $("glossary").replaceChildren(dl);
  } catch {
    // keep the "Glosario en preparación" placeholder
  }
}

// ---- boot --------------------------------------------------------------
async function main() {
  document.querySelectorAll(".steps button").forEach((b) =>
    b.addEventListener("click", () => showStep(b.dataset.step)));
  $("to-prioridades").addEventListener("click", async () => {
    showStep("prioridades");
    await ensureClimate();
  });
  $("to-resultados").addEventListener("click", async () => {
    if (state.parcela && await ensureClimate()) showStep("resultados");
    else if (!state.parcela) showStep("mapa");
  });
  initSliders();
  initGlossary();
  try {
    state.fichas = await loadJson("data/fichas.json");
  } catch {
    // Results remain usable; each card explains that evidence could not load.
  }
  try {
    const [c, r] = await Promise.all([loadJson("data/cultivos.json"), loadJson("data/rotaciones.json")]);
    state.cultivos = c.cultivos;
    state.rotaciones = r.rotaciones;
  } catch {
    $("map-msg").textContent = "No pudimos cargar los datos de la herramienta. Recargue la página.";
  }
  await initMap();
}

main();
