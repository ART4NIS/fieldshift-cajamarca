// Thin UI wiring: DOM events -> pure modules (api.js, scoring.js) -> render.
import {
  fetchClimate,
  checkAltitude,
  nearestPilot,
  circleRing,
  isOnWater,
  inSelectableArea,
  fetchSlope,
  fetchSrtmSlope,
  zoneSlope,
  zoneSteepNote,
  zoneGreennessNote,
  SRTM_FUENTE,
  fallbackAssessment,
  searchPlaces,
  SEARCH_MIN_INTERVAL_MS,
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

import { renderRiskCalendar, renderRadar } from "./charts.js";
import { construirFicha } from "./ficha.js";
import { renderRotationList, markSelected, renderRotationDetail } from "./results.js";
import { CATEGORIAS, filtrarGlosario, agruparPorCategoria } from "./glossary.js";
import { exportarPdf } from "./pdf.js";
import { icon, CRITERIO_ICON } from "./icons.js";

const LAT_MAX = -6;
const LAT_MIN = -16;
// Zoom at which a 100 km pilot zone fills most of a phone-width map.
const ZONE_ZOOM = 8;
const FALLBACK_PILOTS =[{ id: "cajamarca", nombre: "Cajamarca", lat: -7.16, lon: -78.51 }];

const SLIDER_LABELS = {
  agua: ["Save water", "Crops that need less rain or irrigation"],
  suelo: ["Care for the soil", "Keep the soil fertile between growing seasons"],
  erosion: ["Prevent soil loss", "Protect slopes from erosion"],
  forraje: ["Feed for livestock", "Provide feed for livestock"],
  clima: ["Reduce frost and drought risk", "Lower climate risk"],
};

const $ = (id) => document.getElementById(id);
const state = {
  parcela: null, // { lat, lon, pilotId, km, mode: "pilot" | "live" | "fallback" }
  aviso: null,
  loading: null,
  water: null,
  area: null, // data/selectable_area.geojson; null -> fall back to 100 km circles
  searchBounds: null, // { south, west, north, east } of the green area, limits place search
  pendiente: null, // { pendiente_pct, fuente } or null
  clima: null,
  corregido: false,
  fuente: "Not reported",
  periodoCorreccion: null,
  fichas: null,
  srtm: null, // data/srtm/index.json: NASA SRTM 30 m grids around the pilots
  srtmGrids: new Map(),
  terrain: null, // SRTM statistics of the chosen pilot zone (data/pilots/<id>.json "terrain")
  ndvi: null, // MODIS NDVI climatology of the chosen pilot zone (data/pilots/<id>.json "ndvi")
  images: null, // data/imagenes_cultivos.json -> { cropId: { url, alt, autor, licencia, pagina } }
  selected: null, // id of the rotation shown in the detail column
  glosario: [],
  glosarioFiltro: { texto: "", categoria: null },
  // All 0 by default: the farmer raises what matters; all 0 means every criterion counts equally.
  pesos: Object.fromEntries(CRITERIOS.map((c) => [c, 0])),
  cultivos: [],
  rotaciones: [],
  pilots: [],
};

// Same version as this module (set by `npm run bump`), so data files are never older than the code reading them.
const ASSET_VERSION = new URL(import.meta.url).searchParams.get("v");

async function loadJson(path) {
  const res = await fetch(ASSET_VERSION ? `${path}?v=${ASSET_VERSION}` : path);
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
  // The home step is a full-screen map with a floating panel; the other steps are normal reading pages.
  document.body.classList.toggle("home", name === "inicio");
  window.scrollTo(0, 0);
  if (name === "inicio") map?.invalidateSize();
  if (name === "resultados") renderResults();
}

/** Home shows one step at a time: "place" (choose the plot) or "priorities" (weights and results button). */
function setStage(stage) {
  const home = $("step-inicio");
  if (home.dataset.stage === stage) return;
  home.dataset.stage = stage;
  if (stage === "priorities") {
    $("place-summary").textContent = coordsText();
    $("priorities-title").focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
  $("step-inicio").querySelector(".panel").scrollTop = 0;
  map?.invalidateSize(); // on phones the map is hidden in step 2
}

// ---- map ---------------------------------------------------------------
let map = null;
let marker = null;

/** Width in px of the map hidden under the floating panel (0 on phones, where the panel is not over the map). */
function panelCover() {
  const panel = document.querySelector(".panel");
  if (!panel || getComputedStyle(panel).position !== "absolute") return 0;
  return panel.offsetWidth + 12;
}

/** Centers a point in the visible part of the map, i.e. left of the floating panel. */
function focusOn(lat, lon, zoom) {
  map.setView([lat, lon], zoom, { animate: false });
  const shift = panelCover() / 2;
  if (shift) map.panBy([shift, 0], { animate: false });
}

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
  const base = `Latitude ${lat.toFixed(4)}, longitude ${lon.toFixed(4)}. `;
  if (mode === "pilot") return `${base}Using local data from the ${name} pilot site.`;
  if (mode === "fallback") return `${base}Using the correction from the ${name} pilot site, ${Math.round(km)} km away.`;
  return `${base}A local correction will be calculated for this point.`;
}

function selectPoint(lat, lon, pilotId = null) {
  // A new point (map click in step 2 on wide screens) goes back to step 1, where its messages are shown.
  setStage("place");
  if (state.loading) {
    $("map-msg").textContent = "Please wait: we are still calculating the climate for the previous point.";
    return;
  }
  if (lat > LAT_MAX || lat < LAT_MIN) {
    $("map-msg").textContent = "This point is outside the Peruvian Andean area covered by the tool (latitude between -6 and -16).";
    $("to-prioridades").disabled = true;
    $("cta-hint").hidden = false;
    state.parcela = null;
    return;
  }
  if (isOnWater(lat, lon, state.water)) {
    $("map-msg").textContent = "That point is on a lake. Tap a point on land.";
    return;
  }
  // Selectable area: Peru's sierra land (>= 2,500 m). Within 10 km of a pilot its own correction is used;
  // farther out the correction is computed live for the exact point (see ensureClimate).
  // Without the area file, fall back to plain 100 km circles. Pilot chips (pilotId) always work.
  if (!pilotId && state.area && !inSelectableArea(lat, lon, state.area)) {
    $("map-msg").textContent =
      "This point is outside the data coverage area (Peruvian highlands above 2,500 m). Choose a point within the green zone.";
    return;
  }
  const near = nearestPilot(lat, lon, state.pilots, state.area ? Infinity : SELECT_RADIUS_KM);
  if (!near && !pilotId) {
    $("map-msg").textContent = "We do not yet have data for this area. Choose a point within the green zone.";
    return;
  }
  const chosen = pilotId ? state.pilots.find((p) => p.id === pilotId) : near;
  const km = pilotId ? 0 : near.km;
  $("map-msg").textContent = "";
  state.parcela = { lat, lon, pilotId: chosen.id, km, mode: km <= PILOT_SNAP_KM ? "pilot" : "live" };
  state.clima = null;
  state.pendiente = null;
  state.aviso = null;
  state.selected = null;
  if (marker) marker.setLatLng([lat, lon]);
  else {
    const pin = L.divIcon({ className: "sow-pin", html: "<span></span>", iconSize: [30, 30], iconAnchor: [15, 30] });
    marker = L.marker([lat, lon], { icon: pin, keyboard: false }).addTo(map);
  }
  $("coords").textContent = coordsText();
  $("coords").classList.add("is-set");
  setStatus("");
  $("to-prioridades").disabled = false;
  $("cta-hint").hidden = true;
}

async function initMap() {
  map = L.map("map", { zoomControl: false }).setView([-7.16, -78.51], 8);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.control.scale({ position: "bottomright", imperial: false }).addTo(map);
  // Place names sit above the gray "no data" mask so they stay readable; they never take clicks.
  map.createPane("labels");
  map.getPane("labels").style.zIndex = 450;
  map.getPane("labels").style.pointerEvents = "none";
  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      // Esri imagery in rural Peru stops at zoom 17; deeper tiles are a
      // "Map data not yet available" placeholder, so upscale level 17 instead.
      maxNativeZoom: 17,
      maxZoom: 19,
      attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics and the GIS user community",
    },
  ).addTo(map);
  const labels = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, pane: "labels", attribution: "Labels &copy; Esri" },
  ).addTo(map);
  const blueMarble = L.tileLayer(
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
    { maxNativeZoom: 8, maxZoom: 19, attribution: "Imagery: NASA Blue Marble (GIBS)" },
  );
  const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  });
  L.control
    .layers(
      { "Satellite": satellite, "NASA Blue Marble": blueMarble, "Street map": streets },
      { "Place labels": labels },
      { position: "bottomright" },
    )
    .addTo(map);
  map.on("click", (e) => selectPoint(e.latlng.lat, e.latlng.lng));
  $("search").addEventListener("submit", onSearch);
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
      focusOn(p.lat, p.lon, ZONE_ZOOM);
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
    fillColor: "#000000",
    fillOpacity: 0.5,
    interactive: false,
  }).addTo(map);
  // Bright outline: must read clearly over satellite imagery (dark greens and browns).
  for (const zone of zones) {
    L.polygon(zone, {
      color: "#5ef08f",
      weight: 2.5,
      fillColor: "#5ef08f",
      fillOpacity: 0.08,
      interactive: false,
    }).addTo(map);
  }
  // At country zoom a zone is a few pixels wide: show a fixed-size dot that zooms into the zone.
  const dots = pilots.map((p) =>
    L.circleMarker([p.lat, p.lon], {
      radius: 9,
      color: "#ffffff",
      weight: 2,
      fillColor: "#1e8e3e",
      fillOpacity: 1,
    })
      .bindTooltip(p.nombre ?? p.id, { direction: "top" })
      .on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        focusOn(p.lat, p.lon, ZONE_ZOOM);
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
  if (bounds.isValid()) {
    map.fitBounds(bounds, { paddingTopLeft: [12, 12], paddingBottomRight: [12 + panelCover(), 12] });
    state.searchBounds = {
      south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast(),
    };
  }
  toggleDots();
}

// ---- place search (Nominatim) ------------------------------------------
let lastSearchAt = 0;

function renderSearchResults(places) {
  const list = $("search-results");
  list.replaceChildren();
  // Places inside the green area first; the rest stay listed so the farmer understands why they fail.
  const ranked = places
    .map((p) => ({ ...p, inside: !state.area || inSelectableArea(p.lat, p.lon, state.area) }))
    .sort((a, b) => b.inside - a.inside);
  for (const p of ranked) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = p.nombre;
    const detail = document.createElement("small");
    detail.textContent = [p.detalle, p.inside ? "" : "outside the data coverage area"].filter(Boolean).join(" — ");
    btn.append(detail);
    if (!p.inside) btn.classList.add("outside");
    btn.addEventListener("click", () => {
      list.replaceChildren();
      $("search-msg").textContent = "";
      focusOn(p.lat, p.lon, 13);
      selectPoint(p.lat, p.lon);
    });
    const li = document.createElement("li");
    li.append(btn);
    list.append(li);
  }
}

async function onSearch(event) {
  event.preventDefault();
  const query = $("search-q").value.trim();
  if (!query) return;
  const button = $("search").querySelector("button[type=submit]");
  button.disabled = true;
  $("search-msg").textContent = "Searching…";
  $("search-results").replaceChildren();
  try {
    const wait = lastSearchAt + SEARCH_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSearchAt = Date.now();
    const places = await searchPlaces(query, { bounds: state.searchBounds });
    $("search-msg").textContent = places.length
      ? "Choose a place. You can then move the point by tapping the map."
      : "We could not find that place in the coverage area. Try the district name or tap the map.";
    renderSearchResults(places);
  } catch {
    $("search-msg").textContent = "Search is unavailable. Check your connection or tap the map.";
  } finally {
    button.disabled = false;
  }
}

// ---- climate + scoring -------------------------------------------------
/** Progress and error text: under the button and, while it is open, inside the results loader. */
function setStatus(text) {
  $("status").textContent = text;
  $("loader-msg").textContent = text;
}

function setBusy(busy) {
  $("to-resultados").disabled = busy;
}

/** Climate for the chosen point; one request at a time (concurrent callers share the same promise). */
function ensureClimate() {
  if (state.clima) return Promise.resolve(true);
  if (!state.loading) {
    setBusy(true);
    state.loading = loadClimate().finally(() => {
      state.loading = null;
      setBusy(false);
      if (!state.parcela) $("to-resultados").disabled = true;
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
  state.terrain = null;
  state.ndvi = null;
  // Slope runs in parallel with the climate request (pointSlope never rejects: null on failure).
  const slopePromise = pointSlope(p);
  if (p.mode === "live") {
    setStatus("Calculating the local correction for your point (this may take up to a minute the first time)...");
    try {
      const { bias } = await getLocalBias(p.lat, p.lon, { timeoutMs: LIVE_TIMEOUT_MS });
      options = { climateBias: bias, fuenteCorreccion: "with a local correction calculated for this point (SENAMHI PISCO)" };
    } catch {
      const fa = fallbackAssessment(p.km, pilotName);
      p.mode = "fallback";
      state.aviso = fa.aviso;
      options = { pilotId: p.pilotId, corregido: fa.corregido };
      $("coords").textContent = coordsText();
    }
  } else {
    setStatus("Loading climate data for your plot...");
  }
  try {
    const res = await fetchClimate(p.lat, p.lon, options);
    state.clima = res.clima;
    state.corregido = res.corregido;
    state.fuente = res.fuente;
    state.periodoCorreccion = res.periodoCorreccion;
    state.pendiente = await slopePromise;
    const alt = checkAltitude(res.elevation);
    const status = alt.ok ? "" : `${alt.mensaje} (Source: ${res.elevationSource})`;
    setStatus([state.aviso, status].filter(Boolean).join(" "));
    return true;
  } catch {
    setStatus("We could not retrieve climate data for this point. Try again or choose another point.");
    return false;
  }
}

/** Satellite blocks of the pilot JSON: { terrain (SRTM), ndvi (MODIS) }, each null when missing. */
async function loadPilotSatellite(pilotId) {
  try {
    const pilot = await loadJson(`data/pilots/${pilotId}.json`);
    return { terrain: pilot.terrain ?? null, ndvi: pilot.ndvi ?? null };
  } catch {
    return { terrain: null, ndvi: null };
  }
}

/**
 * Slope for the chosen point, best source first:
 *   1. NASA SRTM 30 m at the point, when it falls inside a pilot's SRTM area;
 *   2. Copernicus DEM 90 m at the point (Open-Meteo);
 *   3. the median slope of the pilot zone (SRTM), only for points next to a pilot.
 * Null when none is available (the engine then uses its default).
 */
async function pointSlope(p) {
  const fetchVersioned = (path) => fetch(ASSET_VERSION ? `${path}?v=${ASSET_VERSION}` : path);
  const [srtm, sat] = await Promise.all([
    fetchSrtmSlope(p.lat, p.lon, { index: state.srtm, fetchImpl: fetchVersioned, cache: state.srtmGrids }),
    p.mode === "pilot" ? loadPilotSatellite(p.pilotId) : { terrain: null, ndvi: null },
  ]);
  const { terrain } = sat;
  state.terrain = terrain;
  state.ndvi = sat.ndvi;
  if (srtm) return srtm;
  return (await fetchSlope(p.lat, p.lon)) ?? zoneSlope(terrain);
}

/** Pilot-zone note from SRTM ("how much of the zone is steep"), only for points next to a pilot. */
function zoneNote() {
  if (!state.terrain || state.parcela?.mode !== "pilot") return null;
  const name = state.pilots.find((x) => x.id === state.parcela.pilotId)?.nombre ?? state.parcela.pilotId;
  return zoneSteepNote(state.terrain, name);
}

/** Pilot-zone note from MODIS NDVI ("when fields are greenest"), only for points next to a pilot. */
function greennessNote() {
  if (!state.ndvi || state.parcela?.mode !== "pilot") return null;
  const name = state.pilots.find((x) => x.id === state.parcela.pilotId)?.nombre ?? state.parcela.pilotId;
  return zoneGreennessNote(state.ndvi, name);
}

function currentResults() {
  const contexto = {
    corregido: state.corregido,
    pendiente_pct: state.pendiente?.pendiente_pct ?? null,
    satelital: { terreno: state.pendiente?.fuente?.startsWith(SRTM_FUENTE) ?? false },
  };
  return evaluarRotaciones(state.clima, state.cultivos, state.rotaciones, state.pesos, contexto);
}

/** View models of the three cards, best first, plus the notes shared by all of them. */
function buildFichas() {
  const results = currentResults();
  // Warnings shared by every rotation are shown once (banner / "before sowing" box), not on each card.
  // Crop warnings ("Papa: ...") stay on their card even when every rotation has that crop.
  const cropNames = new Set(results.flatMap((r) => (r.cultivos ?? []).map((c) => c.nombre)));
  const isCropWarning = (a) => [...cropNames].some((n) => a.startsWith(`${n}:`));
  const shared = results.length
    ? results[0].avisos.filter((a) => !isCropWarning(a) && results.every((r) => r.avisos.includes(a)))
    : [];
  const contexto = {
    fuente: state.fuente,
    corregido: state.corregido,
    periodoCorreccion: state.periodoCorreccion,
    pendiente: state.pendiente,
    ndvi: state.parcela?.mode === "pilot" ? state.ndvi : null,
  };
  const fichas = results.map((result, posicion) => construirFicha({
    result,
    rotacion: state.rotaciones.find((r) => r.id === result.rotacion),
    cultivos: state.cultivos,
    doc: state.fichas,
    pesos: state.pesos,
    posicion,
    mejorTotal: results[0].total,
    otros: results.filter((r) => r !== result).map((r) => r.criterios),
    contexto,
    avisos: result.avisos.filter((a) => !shared.includes(a) && a !== AVISO_SIN_CORRECCION && a !== AVISO_DATOS_ESTIMADOS),
  }));
  return { results, fichas, shared };
}

/** Notes that apply to every card: shown once in "Before planting" and once in the PDF. */
function commonNotes(shared) {
  return [
    ...(state.pendiente ? [slopeSentence(state.pendiente)] : []),
    ...(zoneNote() ? [zoneNote()] : []),
    ...(greennessNote() ? [greennessNote()] : []),
    ...(shared.includes(AVISO_DATOS_ESTIMADOS)
      ? ["Crop parameters are estimates from published studies and have not yet been validated in the field."]
      : []),
    ...(state.aviso ? [state.aviso] : []),
    ...shared.filter((a) => a !== AVISO_SIN_CORRECCION && a !== AVISO_DATOS_ESTIMADOS),
  ];
}

function placeText() {
  if (!state.parcela) return "";
  const { lat, lon, pilotId } = state.parcela;
  const name = state.pilots.find((p) => p.id === pilotId)?.nombre ?? pilotId;
  return `${name} area · latitude ${lat.toFixed(4)}, longitude ${lon.toFixed(4)}`;
}

function renderResults() {
  const ready = Boolean(state.clima);
  $("results-empty").hidden = ready;
  $("results-layout").hidden = !ready;
  $("export-all").hidden = !ready;
  $("before-sowing").hidden = !ready;
  if (!ready) {
    $("frost-banner").hidden = true;
    $("results-place").textContent = "";
    return;
  }
  const { results, fichas, shared } = buildFichas();
  if (!fichas.some((f) => f.id === state.selected)) state.selected = fichas[0]?.id ?? null;
  $("results-place").textContent = placeText();
  // The banner is for climate with no local correction at all. A distant pilot correction (fallback)
  // is still a correction: its own warning with the distance goes in the "before sowing" box instead.
  $("frost-banner").hidden = state.corregido || state.parcela?.mode === "fallback";
  const slopeNote = $("slope-note");
  const slopeText = [state.pendiente ? slopeSentence(state.pendiente) : "", zoneNote() ?? ""].filter(Boolean).join(" ");
  slopeNote.textContent = slopeText;
  slopeNote.hidden = !slopeText;
  const greenNote = $("greenness-note");
  greenNote.textContent = greennessNote() ?? "";
  greenNote.hidden = !greenNote.textContent;
  $("estimated-note").hidden = !shared.includes(AVISO_DATOS_ESTIMADOS);
  const notes = [
    ...(state.aviso ? [state.aviso] : []),
    ...shared.filter((a) => a !== AVISO_SIN_CORRECCION && a !== AVISO_DATOS_ESTIMADOS),
  ];
  $("common-notes").replaceChildren(...notes.map((a) => Object.assign(document.createElement("li"), { textContent: a })));

  renderRotationList($("rotation-list"), fichas, {
    selectedId: state.selected,
    images: state.images,
    onSelect: (id) => {
      if (id === state.selected) return;
      state.selected = id;
      markSelected($("rotation-list"), id);
      renderSelected(results, fichas, shared);
      // On a phone the detail is below the cards: bring it into view.
      if (window.matchMedia("(max-width: 979px)").matches) {
        $("rotation-detail").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
  });
  renderSelected(results, fichas, shared);
}

/** Detail column and its two charts for the selected rotation. */
function renderSelected(results, fichas, shared) {
  const selected = fichas.find((f) => f.id === state.selected);
  if (!selected) return;
  const { riskCanvas, radarCanvas } = renderRotationDetail($("rotation-detail"), selected, {
    images: state.images,
    onExport: (ficha) => downloadPdf([ficha], shared),
  });
  renderRiskCalendar(riskCanvas, calendarioRiesgos(state.clima), selected.mesesEnCampo);
  renderRadar(radarCanvas, results, state.selected);
}

let toastTimer = null;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

async function downloadPdf(fichas, shared) {
  toast("Preparing the PDF…");
  try {
    await exportarPdf(fichas, {
      lugar: placeText(),
      fecha: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      comunes: commonNotes(shared),
    });
    toast(fichas.length === 1 ? "Report downloaded." : "Reports downloaded.");
  } catch {
    toast("We could not create the PDF. Check your connection and try again.");
  }
}

/** Plain-language class: < 8 % gentle, 8-20 % moderate, > 20 % steep. */
function slopeClass(pct) {
  if (pct < 8) return "gentle";
  if (pct <= 20) return "moderate";
  return "steep";
}

/** Plain sentence for the slope, saying where it was measured. */
function slopeSentence(pendiente) {
  const pct = Math.round(pendiente.pendiente_pct);
  if (pendiente.zona) {
    return `We could not measure slope at your exact point; the typical slope in the pilot area is ${pct} % ` +
      `(${slopeClass(pct)}).`;
  }
  const origen = pendiente.fuente?.startsWith(SRTM_FUENTE)
    ? "measured using NASA SRTM (30 m)"
    : "estimated using the Copernicus terrain model (90 m)";
  return `Terrain slope at your point: ${pct} % (${slopeClass(pct)}), ${origen}.`;
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
    name.className = "slider-name";
    name.append(icon(CRITERIO_ICON[c] ?? "check", 18), titulo);
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
function renderGlossary() {
  const { texto, categoria } = state.glosarioFiltro;
  const found = filtrarGlosario(state.glosario, { texto, categoria });
  const box = $("glossary");
  $("glossary-count").textContent = texto || categoria
    ? `${found.length} ${found.length === 1 ? "term found" : "terms found"}`
    : `${found.length} terms across ${CATEGORIAS.length} topics`;
  if (!found.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    const p = document.createElement("p");
    p.textContent = "No matching term found. Try another word or remove the filter.";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "btn btn-ghost";
    reset.textContent = "View all terms";
    reset.addEventListener("click", () => {
      state.glosarioFiltro = { texto: "", categoria: null };
      $("glossary-q").value = "";
      renderGlossaryCats();
      renderGlossary();
    });
    empty.append(p, reset);
    box.replaceChildren(empty);
    return;
  }
  box.replaceChildren(...agruparPorCategoria(found).map((group, gi) => {
    const section = document.createElement("section");
    section.className = "gloss-group";
    section.style.setProperty("--i", gi);
    const head = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = group.categoria.nombre;
    const count = document.createElement("span");
    count.className = "acc-count";
    count.textContent = group.terminos.length;
    head.append(title, count);
    const dl = document.createElement("dl");
    for (const t of group.terminos) {
      const row = document.createElement("div");
      row.className = "term";
      const dt = document.createElement("dt");
      dt.textContent = t.termino;
      const dd = document.createElement("dd");
      dd.textContent = t.definicion;
      row.append(dt, dd);
      dl.append(row);
    }
    section.append(head, dl);
    return section;
  }));
}

function renderGlossaryCats() {
  const make = (id, nombre) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = nombre;
    btn.setAttribute("aria-pressed", String(state.glosarioFiltro.categoria === id));
    btn.addEventListener("click", () => {
      state.glosarioFiltro.categoria = id;
      renderGlossaryCats();
      renderGlossary();
    });
    return btn;
  };
  const used = new Set(state.glosario.map((t) => t.categoria));
  $("glossary-cats").replaceChildren(
    make(null, "All"),
    ...CATEGORIAS.filter((c) => used.has(c.id)).map((c) => make(c.id, c.nombre)),
  );
}

async function initGlossary() {
  try {
    const data = await loadJson("data/glosario.json");
    const terms = Array.isArray(data) ? data : data.terminos ?? data.glosario ?? [];
    state.glosario = terms.map((t) => ({
      termino: t.termino ?? t.term,
      definicion: t.definicion ?? t.definition,
      categoria: t.categoria ?? "otros",
    }));
    $("glossary-q").addEventListener("input", (e) => {
      state.glosarioFiltro.texto = e.target.value;
      renderGlossary();
    });
    renderGlossaryCats();
    renderGlossary();
  } catch {
    $("glossary").textContent = "We could not load the glossary. Reload the page.";
  }
}

// ---- theme ---------------------------------------------------------------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const next = theme === "dark" ? "light" : "dark";
  const btn = $("theme-toggle");
  btn.replaceChildren(icon(theme === "dark" ? "sun" : "moon", 20));
  btn.setAttribute("aria-label", `Switch to ${next} mode`);
  btn.title = `Switch to ${next} mode`;
}

function initTheme() {
  applyTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  $("theme-toggle").addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    try {
      localStorage.setItem("soworbit-theme", theme);
    } catch {
      // storage blocked: the choice simply lasts for this visit
    }
    // Charts read their colors from the theme when drawn.
    if (state.clima && !$("step-resultados").hidden) renderResults();
  });
}

// ---- loading screens -----------------------------------------------------
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SPLASH_MIN_MS = 1600;
const LOADER_MIN_MS = 1800;

/** Opening screen -> short introduction -> the tool. */
async function finishSplash(startedAt) {
  await wait(Math.max(0, SPLASH_MIN_MS - (performance.now() - startedAt)));
  $("welcome").hidden = false;
  $("splash").classList.add("is-leaving");
  await wait(450);
  $("splash").remove();
  $("start").focus();
  $("start").addEventListener("click", () => {
    $("welcome").classList.add("is-leaving");
    setTimeout(() => $("welcome").remove(), 350);
  });
}

/** Runs the climate request behind the results loader; the steps tick while it works. */
async function generateResults() {
  if (!state.parcela) {
    $("map-msg").textContent = "First choose a point on the map.";
    return;
  }
  const loader = $("results-loader");
  const steps = [...$("loader-steps").children];
  $("loader-msg").textContent = "";
  loader.hidden = false;
  const startedAt = performance.now();
  let current = 0;
  const advance = () => {
    steps.forEach((li, i) => {
      li.classList.toggle("is-done", i < current);
      li.classList.toggle("is-active", i === current);
    });
  };
  advance();
  // The last step ("comparing") stays active until the climate request has really finished.
  const timer = setInterval(() => {
    if (current < steps.length - 1) {
      current += 1;
      advance();
    }
  }, LOADER_MIN_MS / steps.length);
  const ok = await ensureClimate();
  await wait(Math.max(0, LOADER_MIN_MS - (performance.now() - startedAt)));
  clearInterval(timer);
  if (ok) {
    current = steps.length;
    advance();
    await wait(250);
    showStep("resultados");
  }
  loader.hidden = true;
}

// ---- boot --------------------------------------------------------------
async function main() {
  const startedAt = performance.now();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll("svg.orbit").forEach((svg) => svg.pauseAnimations?.());
  }
  initTheme();
  document.querySelectorAll(".steps button").forEach((b) =>
    b.addEventListener("click", () => showStep(b.dataset.step)));
  document.querySelectorAll("[data-go]").forEach((b) =>
    b.addEventListener("click", () => showStep(b.dataset.go)));
  // Climate is fetched only here, so the farmer can still move the point freely before asking for results.
  $("to-resultados").addEventListener("click", generateResults);
  $("to-prioridades").addEventListener("click", () => { if (state.parcela) setStage("priorities"); });
  $("back-to-place").addEventListener("click", () => setStage("place"));
  $("export-all").addEventListener("click", () => {
    const { fichas, shared } = buildFichas();
    downloadPdf(fichas, shared);
  });
  initSliders();
  initGlossary();
  try {
    state.fichas = await loadJson("data/fichas.json");
  } catch {
    // Results remain usable; each card explains that evidence could not load.
  }
  try {
    state.srtm = await loadJson("data/srtm/index.json");
  } catch {
    // Without SRTM grids the slope comes from Open-Meteo, as before.
  }
  try {
    state.images = (await loadJson("data/imagenes_cultivos.json")).imagenes;
  } catch {
    // Cards fall back to a drawn tile with the crop initial.
  }
  try {
    const [c, r] = await Promise.all([loadJson("data/cultivos.json"), loadJson("data/rotaciones.json")]);
    state.cultivos = c.cultivos;
    state.rotaciones = r.rotaciones;
  } catch {
    $("map-msg").textContent = "We could not load the tool data. Reload the page.";
  }
  try {
    await initMap();
  } finally {
    finishSplash(startedAt);
  }
}

main();
