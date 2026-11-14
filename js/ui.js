// Thin UI wiring: DOM events -> pure modules (api.js, scoring.js) -> render.
import { fetchClimate, checkAltitude } from "./api.js";
import { evaluarRotaciones, calendarioRiesgos, CRITERIOS } from "./scoring.js";
import { renderRiskCalendar, renderRadar } from "./charts.js";

const LAT_MAX = -6;
const LAT_MIN = -16;
const FALLBACK_PILOTS = [{ id: "cajamarca", nombre: "Cajamarca", lat: -7.16, lon: -78.51 }];

const SLIDER_LABELS = {
  agua: ["Ahorrar agua", "Cultivos que necesitan menos lluvia o riego"],
  suelo: ["Cuidar el suelo", "Mantener la tierra fértil entre campañas"],
  erosion: ["Evitar que se lave la tierra", "Proteger las laderas de la erosión"],
  forraje: ["Pasto para animales", "Tener alimento para el ganado"],
  clima: ["Evitar heladas y sequía", "Menor riesgo por el clima"],
};

const $ = (id) => document.getElementById(id);
const state = {
  parcela: null, // { lat, lon, pilotId }
  clima: null,
  corregido: false,
  pesos: Object.fromEntries(CRITERIOS.map((c) => [c, 3])),
  cultivos: [],
  rotaciones: [],
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

function selectPoint(lat, lon, pilotId = null) {
  if (lat > LAT_MAX || lat < LAT_MIN) {
    $("map-msg").textContent = "Este punto está fuera de la zona andina del Perú que cubre la herramienta (latitud entre -6 y -16).";
    $("to-prioridades").disabled = true;
    state.parcela = null;
    return;
  }
  $("map-msg").textContent = "";
  state.parcela = { lat, lon, pilotId };
  state.clima = null;
  if (marker) marker.setLatLng([lat, lon]);
  else marker = L.marker([lat, lon]).addTo(map);
  $("coords").textContent = `Latitud ${lat.toFixed(4)}, longitud ${lon.toFixed(4)}`;
  $("to-prioridades").disabled = false;
}

async function initMap() {
  map = L.map("map").setView([-7.16, -78.51], 8);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  map.on("click", (e) => selectPoint(e.latlng.lat, e.latlng.lng));

  const pilots = await loadPilots();
  for (const p of pilots) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = p.nombre ?? p.id;
    btn.addEventListener("click", () => {
      map.setView([p.lat, p.lon], 10);
      selectPoint(p.lat, p.lon, p.id);
    });
    $("pilots").append(btn);
  }
}

// ---- climate + scoring -------------------------------------------------
async function ensureClimate() {
  if (state.clima) return true;
  $("status").textContent = "Cargando el clima de su parcela...";
  try {
    const { lat, lon, pilotId } = state.parcela;
    const res = await fetchClimate(lat, lon, { pilotId });
    state.clima = res.clima;
    state.corregido = res.corregido;
    const alt = checkAltitude(res.elevation);
    $("status").textContent = alt.ok ? "" : `${alt.mensaje} (Fuente: ${res.elevationSource})`;
    return true;
  } catch {
    $("status").textContent = "No pudimos obtener el clima de este punto. Intente de nuevo o elija un punto piloto.";
    return false;
  }
}

function currentResults() {
  const contexto = { corregido: state.corregido, pendiente_pct: null };
  return evaluarRotaciones(state.clima, state.cultivos, state.rotaciones, state.pesos, contexto);
}

function renderResults() {
  const box = $("results");
  if (!state.clima) {
    box.textContent = "Primero elija una parcela en el mapa.";
    return;
  }
  const results = currentResults();
  box.replaceChildren(...results.map(resultCard));
  renderRiskCalendar($("chart-risk"), calendarioRiesgos(state.clima));
  renderRadar($("chart-radar"), results);
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
  return el;
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
    const [c, r] = await Promise.all([loadJson("data/cultivos.json"), loadJson("data/rotaciones.json")]);
    state.cultivos = c.cultivos;
    state.rotaciones = r.rotaciones;
  } catch {
    $("map-msg").textContent = "No pudimos cargar los datos de la herramienta. Recargue la página.";
  }
  await initMap();
}

main();
