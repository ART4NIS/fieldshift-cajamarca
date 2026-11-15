// View model of one rotation card ("ficha"): plain-language summary, years, criteria, evidence.
// Pure functions only (no DOM, no fetch) so the screen and the PDF export share the same content.
import { zoneGreennessDetail } from "./api.js";

const MESES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Farmer-facing wording of the five criteria. `fuerte` / `debil` are comparisons with the other rotations. */
export const CRITERIO_INFO = {
  agua: { label: "Water savings", corto: "Water", fuerte: "it needs less water", debil: "it needs more water" },
  suelo: {
    label: "Soil care", corto: "Soil",
    fuerte: "it leaves the soil more fertile", debil: "it contributes less to soil fertility",
  },
  erosion: {
    label: "Soil protected from rainfall", corto: "Erosion",
    fuerte: "it keeps soil covered and protected from rainfall", debil: "it leaves soil uncovered for longer",
  },
  forraje: {
    label: "Feed for livestock", corto: "Forage",
    fuerte: "it provides more livestock feed", debil: "it provides less livestock feed",
  },
  clima: {
    label: "Climate resilience", corto: "Climate",
    fuerte: "its crops better tolerate frost and low rainfall",
    debil: "its crops are more affected by frost or low rainfall",
  },
};

const CONFIANZA = {
  Alto: {
    clase: "alto",
    texto: "High confidence",
    explicacion: "Climate data are adjusted with local data, and satellite data on soil, vegetation and terrain are available.",
  },
  Medio: {
    clase: "medio",
    texto: "Medium confidence",
    explicacion: "Climate data are adjusted with local SENAMHI data. Satellite vegetation and soil moisture data are still missing.",
  },
  Bajo: {
    clase: "bajo",
    texto: "Low confidence",
    explicacion: "Climate data come only from NASA POWER, without local correction: frost may be underestimated.",
  },
};

/** Color class (alto = green, medio = yellow, bajo = red), label and reason for a confidence level. */
export function nivelConfianzaInfo(confianza) {
  return CONFIANZA[confianza] ?? CONFIANZA.Bajo;
}

/** One word for a 0-100 criterion score. */
export function palabraValor(valor) {
  if (valor >= 75) return "Very good";
  if (valor >= 55) return "Good";
  if (valor >= 40) return "Fair";
  return "Low";
}

const promedio = (xs) => xs.reduce((x, y) => x + y, 0) / xs.length;

/**
 * Two or three short sentences a non-technical reader can act on.
 * `posicion` is the rank (0 = best); `mejorTotal` is the best rotation's score;
 * `otros` are the criteria of the other rotations, so strengths and weaknesses are relative to them
 * (an absolute reading would call a low-water rotation "thirsty" just because every rotation scores low on water).
 */
export function resumenSimple(result, pesos = {}, posicion = 0, mejorTotal = result.total, otros = []) {
  const frases = [];
  const dif = mejorTotal - result.total;
  if (posicion === 0) {
    frases.push("This rotation best matches the priorities you selected.");
  } else if (dif <= 0) {
    frases.push("It matches your priorities as well as the first option.");
  } else {
    frases.push(`It scores ${dif} ${dif === 1 ? "point" : "points"} below the best option for your priorities.`);
  }
  if (otros.length) {
    const ventajas = Object.entries(result.criterios)
      .map(([id, valor]) => [id, valor - promedio(otros.map((o) => o[id] ?? 0))])
      .sort((a, b) => b[1] - a[1]);
    const [mejor, peor] = [ventajas[0], ventajas.at(-1)];
    if (mejor[1] >= 5) frases.push(`Compared with the other two, it stands out because ${CRITERIO_INFO[mejor[0]].fuerte}.`);
    if (peor[1] <= -5) frases.push(`Its weakness compared with the others: ${CRITERIO_INFO[peor[0]].debil}.`);
  }
  const descuidado = Object.entries(result.criterios).find(([id, valor]) => (pesos[id] ?? 0) >= 4 && valor < 45);
  if (descuidado) {
    frases.push(`Please note: you marked "${CRITERIO_INFO[descuidado[0]].label.toLowerCase()}" as very important, but it scores low here.`);
  }
  return frases;
}

/** Short tags describing what a crop brings to the rotation. */
export function rasgosCultivo(cultivo) {
  const rasgos = [];
  if (cultivo.fija_n_kg_ha > 0) rasgos.push("Enriches the soil");
  if (cultivo.forraje >= 1) rasgos.push("Provides livestock feed");
  else if (cultivo.forraje > 0) rasgos.push("Residues provide livestock feed");
  if (cultivo.tolerancia_sequia === "alta") rasgos.push("Drought tolerant");
  if (cultivo.temp_dano_helada <= -4) rasgos.push("Frost tolerant");
  else if (cultivo.temp_dano_helada >= -1) rasgos.push("Frost sensitive");
  if (cultivo.ingresos === "alto") rasgos.push("Higher income potential");
  return rasgos;
}

function aniosRotacion(rotacion, cultivosPorId) {
  return rotacion.anios.map((a, i) => {
    const cultivo = cultivosPorId[a.cultivo];
    if (!cultivo) {
      return { anio: i + 1, id: "descanso", nombre: "Fallow", descanso: true, detalle: "The land rests", rasgos: [] };
    }
    const siembra = a.mes_siembra ?? cultivo.meses_siembra[0];
    return {
      anio: i + 1,
      id: cultivo.id,
      nombre: cultivo.nombre,
      descanso: false,
      detalle: `Sow in ${MESES[siembra - 1]} · ${cultivo.duracion_meses} months`,
      rasgos: rasgosCultivo(cultivo),
    };
  });
}

/** Exact figures for the local technician (shown collapsed). */
function detalleTecnico(result, contexto) {
  const items = [];
  if (contexto.pendiente) {
    items.push(
      `Slope: ${Math.round(contexto.pendiente.pendiente_pct)} % (${contexto.pendiente.fuente}; ` +
      "may underestimate slope on very steep hillsides or terraces).",
    );
  }
  const vistos = new Set();
  for (const c of result.cultivos ?? []) {
    for (const { mes, prob } of c.heladas ?? []) {
      const clave = `${c.id}-${mes}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      items.push(
        `${c.nombre}, ${MESES[mes - 1]}: ${Math.round(prob * 100)} % of years with a minimum below 2 °C; ` +
        `damage threshold: ${c.temp_dano_helada} °C.`,
      );
    }
  }
  items.push(`Scores by criterion (0–100): ${Object.entries(result.criterios)
    .map(([id, v]) => `${CRITERIO_INFO[id]?.corto ?? id} ${v}`).join(", ")}.`);
  const verdor = zoneGreennessDetail(contexto.ndvi);
  if (verdor) items.push(verdor);
  items.push(`Climate source: ${contexto.fuente ?? "NASA POWER"}.`);
  return items;
}

function datosUsados(result, contexto) {
  const satelite = contexto.ndvi
    ? "MODIS NDVI around the pilot site is shown for context only and does not change the score; SMAP soil moisture is not used."
    : "The result does not use MODIS NDVI or SMAP.";
  return [
    `Climate data source: ${contexto.fuente ?? "NASA POWER"}. Period queried: 1991–2024.`,
    contexto.corregido
      ? `SENAMHI PISCO correction: reference period ${contexto.periodoCorreccion ?? "not reported"}. This is a climate grid, not a direct measurement of this plot.`
      : "Without local correction, NASA POWER may underestimate frost risk in the highlands.",
    `The ${result.total} % indicates how well this rotation matches your priorities; it is not a probability of harvest success.`,
    contexto.pendiente
      ? `Terrain slope at your point: ${Math.round(contexto.pendiente.pendiente_pct)} % (${contexto.pendiente.fuente}). ${satelite}`
      : `We could not calculate slope at your point; an estimated slope of 18 % is used. ${satelite}`,
    "Historical climate informs the comparison; it is not a forecast for the next growing season.",
  ];
}

/**
 * Everything one card shows, in display order.
 *
 * @param {Object} args
 * @param {Object} args.result      one item of evaluarRotaciones()
 * @param {Object} args.rotacion    its entry in rotaciones.json
 * @param {Array}  args.cultivos    crops from cultivos.json
 * @param {Object} [args.doc]       fichas.json (documentary evidence); may be null if it failed to load
 * @param {Object} [args.pesos]     user priorities 0-5
 * @param {number} [args.posicion]  rank, 0 = best
 * @param {number} [args.mejorTotal] best score among the rotations
 * @param {Array}  [args.otros]     criteria of the other rotations, for the plain-language comparison
 * @param {Object} [args.contexto]  { fuente, corregido, periodoCorreccion, pendiente }
 * @param {Array}  [args.avisos]    warnings specific to this rotation (shared ones are shown once elsewhere)
 */
export function construirFicha({
  result, rotacion, cultivos, doc = null, pesos = {}, posicion = 0, mejorTotal = result.total, otros = [],
  contexto = {}, avisos = [],
}) {
  const cultivosPorId = Object.fromEntries(cultivos.map((c) => [c.id, c]));
  const anios = aniosRotacion(rotacion, cultivosPorId);
  const evidencia = doc?.fichas?.find((f) => f.rotacion === result.rotacion) ?? null;
  const fuentesPorId = new Map((doc?.fuentes ?? []).map((s) => [s.id, s]));
  return {
    id: result.rotacion,
    nombre: result.nombre,
    posicion,
    porcentaje: result.total,
    confianza: nivelConfianzaInfo(result.confianza),
    resumen: resumenSimple(result, pesos, posicion, mejorTotal, otros),
    descripcion: rotacion.resumen ?? "",
    secuencia: anios.map((a) => a.nombre).join(" → "),
    anios,
    criterios: Object.entries(result.criterios).map(([id, valor]) => ({
      id,
      label: CRITERIO_INFO[id]?.label ?? id,
      valor,
      palabra: palabraValor(valor),
      importante: (pesos[id] ?? 0) >= 4,
    })),
    mesesEnCampo: [...new Set((result.cultivos ?? []).flatMap((c) => c.meses ?? []))].sort((a, b) => a - b),
    avisos,
    porQue: evidencia?.por_que ?? null,
    beneficios: (evidencia?.beneficios ?? []).map((b) => ({
      texto: b.texto,
      instituciones: b.fuentes.map((id) => fuentesPorId.get(id)?.institucion ?? id),
    })),
    limites: evidencia?.limites ?? [],
    faltantes: doc?._meta?.vacios_comunes ?? [],
    revisar: evidencia?.revisar ?? [],
    nota: doc?._meta?.nota_comun ?? null,
    datosUsados: datosUsados(result, contexto),
    detalleTecnico: detalleTecnico(result, contexto),
    fuentes: (evidencia?.fuentes ?? []).map((id) => fuentesPorId.get(id)).filter(Boolean),
    evidenciaDisponible: Boolean(evidencia),
  };
}
