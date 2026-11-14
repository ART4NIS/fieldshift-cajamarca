/**
 * FieldShift rules engine.
 *
 * Transparent, rule-based scoring (no ML). Pure functions only: no DOM, no fetch.
 *
 * Input contract — monthly climate (12 items, produced by api.js):
 *   { mes, tmed, tmin_abs, lluvia_mm, lluvia_cv, prob_helada }
 *   tmed        mean air temperature (C), bias-corrected when available
 *   tmin_abs    mean of the monthly absolute minimum (C)
 *   lluvia_mm   mean monthly precipitation (mm/month), times lluvia_factor when available
 *   lluvia_cv   inter-annual coefficient of variation of precipitation
 *   prob_helada fraction (0-1) of years with at least one day below the frost threshold
 *
 * Output contract — one result per rotation (consumed by charts.js / ui.js):
 *   { rotacion, nombre, total, criterios: { agua, suelo, erosion, forraje, clima },
 *     confianza, avisos, cultivos: [...] }
 */

export const CRITERIOS = ["agua", "suelo", "erosion", "forraje", "clima"];

export const PARAMS = Object.freeze({
  // Water: crop demand per campaign (mm) that maps to a score of 0.
  aguaMaxAnualMm: 600,
  // Soil: total N fixed per 4-year cycle that maps to the maximum N contribution.
  nitrogenoRefKgHa: 200,
  pesoNitrogeno: 0.6,
  pesoCobertura: 0.4,
  // Ground cover outside the crop cycle (stubble) and during a fallow year.
  coberturaRastrojo: 0.15,
  coberturaDescanso: 0.4,
  // Erosion: slope (%) at which the slope factor reaches 1; default when unknown.
  pendienteRefPct: 30,
  pendientePorDefectoPct: 18,
  // Monthly climate penalties (points, out of 100).
  penalidadHeladaMax: 60,
  penalidadAguaMax: 40,
  penalidadTempPorGrado: 8,
  penalidadTempMax: 40,
  // Months with frost probability at or above this value raise a warning.
  umbralAvisoHelada: 0.3,
  // Risk calendar thresholds.
  lluviaSecaMm: 60,
  tempCalorC: 24,
});

const TOLERANCIA_SEQUIA = { baja: 1, media: 0.7, alta: 0.4 };
const INGRESOS = { alto: 1, medio: 0.6, bajo: 0.3 };
const DESCANSO = "descanso";
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x) => Math.round(x);

/** Months (1-12) occupied by a crop sown in `mesSiembra` for `duracion` months. */
export function mesesCiclo(mesSiembra, duracion) {
  return Array.from({ length: duracion }, (_, i) => ((mesSiembra - 1 + i) % 12) + 1);
}

/** Frost sensitivity factor: 1 for sensitive crops (damage at -1 C), 0.2 for very tolerant ones. */
export function sensibilidadHelada(tempDanoHelada) {
  return clamp((tempDanoHelada + 6) / 5, 0.2, 1);
}

/**
 * Step 2: climate score (0-100) of one crop in one month.
 * Returns the score and the individual penalties so the UI can explain it.
 */
export function puntajeMes(clima, cultivo) {
  const helada = PARAMS.penalidadHeladaMax * clima.prob_helada * sensibilidadHelada(cultivo.temp_dano_helada);

  const demanda = cultivo.agua_mm_ciclo / cultivo.duracion_meses;
  // Conservative effective rain: discount part of the inter-annual variability.
  const lluviaEfectiva = Math.max(0, clima.lluvia_mm * (1 - 0.5 * Math.min(clima.lluvia_cv, 1)));
  const deficit = demanda > 0 ? clamp((demanda - lluviaEfectiva) / demanda, 0, 1) : 0;
  const agua = PARAMS.penalidadAguaMax * deficit * (TOLERANCIA_SEQUIA[cultivo.tolerancia_sequia] ?? 1);

  const fuera = clima.tmed < cultivo.temp_opt_min
    ? cultivo.temp_opt_min - clima.tmed
    : Math.max(0, clima.tmed - cultivo.temp_opt_max);
  const temperatura = Math.min(PARAMS.penalidadTempMax, PARAMS.penalidadTempPorGrado * fuera);

  return {
    puntaje: clamp(100 - helada - agua - temperatura, 0, 100),
    penalidades: { helada, agua, temperatura },
  };
}

/** Climate score of a crop over its whole cycle plus the months with high frost risk. */
export function evaluarCultivo(climaPorMes, cultivo, mesSiembra) {
  const meses = mesesCiclo(mesSiembra, cultivo.duracion_meses);
  const porMes = meses.map((m) => ({ mes: m, ...puntajeMes(climaPorMes[m], cultivo) }));
  const mesesHelada = meses.filter((m) => climaPorMes[m].prob_helada >= PARAMS.umbralAvisoHelada);
  return {
    id: cultivo.id,
    nombre: cultivo.nombre,
    temp_dano_helada: cultivo.temp_dano_helada,
    heladas: mesesHelada.map((m) => ({ mes: m, prob: climaPorMes[m].prob_helada })),
    mes_siembra: mesSiembra,
    meses,
    puntaje: mean(porMes.map((x) => x.puntaje)),
    por_mes: porMes,
    meses_helada: mesesHelada,
  };
}

/** Monthly ground cover (index 1-12) for one rotation year. */
function coberturaAnual(cultivo, mesSiembra) {
  const cobertura = Array(13).fill(PARAMS.coberturaRastrojo);
  if (!cultivo) return cobertura.fill(PARAMS.coberturaDescanso);
  for (const m of mesesCiclo(mesSiembra, cultivo.duracion_meses)) cobertura[m] = cultivo.cobertura_suelo;
  return cobertura;
}

/** Step 3: the five criteria (0-100, higher is always better) for one rotation. */
export function evaluarRotacion(climaPorMes, cultivosPorId, rotacion, contexto = {}) {
  const anios = rotacion.anios.map((anio) => {
    if (anio.cultivo === DESCANSO) return { descanso: true, cobertura: coberturaAnual(null) };
    const cultivo = cultivosPorId[anio.cultivo];
    if (!cultivo) throw new Error(`Unknown crop "${anio.cultivo}" in rotation ${rotacion.id}`);
    const mesSiembra = anio.mes_siembra ?? cultivo.meses_siembra[0];
    return {
      cultivo,
      evaluacion: evaluarCultivo(climaPorMes, cultivo, mesSiembra),
      cobertura: coberturaAnual(cultivo, mesSiembra),
    };
  });
  const sembrados = anios.filter((a) => !a.descanso);

  // Water demand per sown campaign: a fallow year produces nothing, so it does not count as saving water.
  const aguaPorCampana = mean(sembrados.map((a) => a.cultivo.agua_mm_ciclo));
  const agua = sembrados.length ? 100 * clamp(1 - aguaPorCampana / PARAMS.aguaMaxAnualMm, 0, 1) : 0;

  const nitrogeno = sembrados.reduce((s, a) => s + a.cultivo.fija_n_kg_ha, 0);
  const coberturaMedia = mean(anios.flatMap((a) => a.cobertura.slice(1)));
  const suelo = 100 * (
    PARAMS.pesoNitrogeno * clamp(nitrogeno / PARAMS.nitrogenoRefKgHa, 0, 1) +
    PARAMS.pesoCobertura * coberturaMedia
  );

  // Erosion happens when it rains: weight ground cover by monthly rainfall.
  const lluviaTotal = mean([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => climaPorMes[m].lluvia_mm)) * 12;
  const coberturaLluvia = mean(anios.map((a) => {
    if (lluviaTotal <= 0) return mean(a.cobertura.slice(1));
    let s = 0;
    for (let m = 1; m <= 12; m++) s += a.cobertura[m] * climaPorMes[m].lluvia_mm;
    return s / lluviaTotal;
  }));
  const pendiente = contexto.pendiente_pct ?? PARAMS.pendientePorDefectoPct;
  const factorPendiente = clamp(pendiente / PARAMS.pendienteRefPct, 0.3, 1);
  const erosion = 100 * (1 - (1 - coberturaLluvia) * factorPendiente);

  const forraje = 100 * mean(anios.map((a) => (a.descanso
    ? 0.5 * 0.2 // fallow land still offers some grazing
    : 0.5 * a.cultivo.forraje + 0.5 * (INGRESOS[a.cultivo.ingresos] ?? 0))));

  const clima = sembrados.length ? mean(sembrados.map((a) => a.evaluacion.puntaje)) : 0;

  return {
    criterios: { agua, suelo, erosion, forraje, clima },
    cultivos: sembrados.map((a) => a.evaluacion),
    usa_estimados: sembrados.some((a) => a.cultivo.estimado),
  };
}

/** Step 4: weighted total. Weights are 0-5; if all are 0, criteria count equally. */
export function puntajeTotal(criterios, pesos = {}) {
  const sumaPesos = CRITERIOS.reduce((s, c) => s + Math.max(0, pesos[c] ?? 0), 0);
  if (sumaPesos === 0) return mean(CRITERIOS.map((c) => criterios[c]));
  return CRITERIOS.reduce((s, c) => s + criterios[c] * Math.max(0, pesos[c] ?? 0), 0) / sumaPesos;
}

/**
 * Step 5: confidence level.
 *   Alto  — pilot site with NDVI, soil moisture and terrain data.
 *   Medio — climate corrected with local data (PISCO).
 *   Bajo  — uncorrected NASA POWER only.
 */
export function nivelConfianza(contexto = {}) {
  const sat = contexto.satelital ?? {};
  if (contexto.corregido && sat.ndvi && sat.humedad_suelo && sat.terreno) return "Alto";
  if (contexto.corregido) return "Medio";
  return "Bajo";
}

// Same for every rotation, so the UI shows it once as a banner instead of per card.
export const AVISO_SIN_CORRECCION =
  "Temperaturas sin corrección local: NASA POWER suele subestimar las heladas en la sierra.";

// Same for every rotation, so the UI shows it once in the "before sowing" box.
export const AVISO_DATOS_ESTIMADOS =
  "Los datos de los cultivos son estimaciones de literatura y deben validarse con un agrónomo local.";

// Farmer-facing frost frequency: a word plus a fixed, rounded "1 in N years" per band.
// Natural frequencies are easier to read than percentages; the exact % goes to the technical detail.
const ESCALA_HELADA = [
  { min: 0.9, texto: "todos los años" },
  { min: 0.5, texto: "la mayoría de los años" },
  { min: 0.25, texto: "frecuente (1 de cada 3 años)" },
  { min: 0.1, texto: "algunos años (1 de cada 5)" },
  { min: 0, texto: "rara (menos de 1 año de cada 10)" },
];

/** Plain-language frost frequency for a probability 0-1. */
export function frecuenciaHelada(prob) {
  return ESCALA_HELADA.find((e) => prob >= e.min)?.texto ?? ESCALA_HELADA.at(-1).texto;
}

/** Plain-language cold tolerance from the crop damage temperature (C). */
export function toleranciaFrio(tempDanoHelada) {
  if (tempDanoHelada >= -1) return "Es muy sensible al frío.";
  if (tempDanoHelada >= -3) return "Aguanta heladas suaves.";
  return "Aguanta bien las heladas.";
}

const unirEs = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);

/** "Papa: en julio y agosto, helada la mayoría de los años; en noviembre, helada frecuente (...). Es muy sensible al frío." */
export function avisoHeladaCultivo(nombre, heladas, tempDanoHelada) {
  const grupos = new Map();
  for (const { mes, prob } of heladas) {
    const texto = frecuenciaHelada(prob);
    grupos.set(texto, [...(grupos.get(texto) ?? []), MESES[mes - 1]]);
  }
  const partes = [...grupos].map(([texto, meses]) => `en ${unirEs(meses)}, helada ${texto}`);
  return `${nombre}: ${partes.join("; ")}. ${toleranciaFrio(tempDanoHelada)}`;
}

function avisosRotacion(evaluacion, contexto) {
  const avisos = [];
  const vistos = new Set();
  for (const c of evaluacion.cultivos) {
    // A crop repeated in the rotation would produce the same warning twice.
    if (!c.heladas.length || vistos.has(c.id)) continue;
    vistos.add(c.id);
    avisos.push(avisoHeladaCultivo(c.nombre, c.heladas, c.temp_dano_helada));
  }
  if (!contexto.corregido) {
    avisos.push(AVISO_SIN_CORRECCION);
  }
  if (contexto.pendiente_pct == null) {
    avisos.push(`Pendiente del terreno no disponible: se usó un valor medio de ${PARAMS.pendientePorDefectoPct} %.`);
  }
  if (evaluacion.usa_estimados) {
    avisos.push(AVISO_DATOS_ESTIMADOS);
  }
  return avisos;
}

function indexarClima(clima) {
  if (!Array.isArray(clima) || clima.length !== 12) {
    throw new Error("Climate input must be an array of 12 monthly records");
  }
  const porMes = {};
  for (const r of clima) porMes[r.mes] = r;
  for (let m = 1; m <= 12; m++) if (!porMes[m]) throw new Error(`Missing climate for month ${m}`);
  return porMes;
}

/**
 * Main entry point: evaluate all rotations and return them sorted by total score.
 *
 * @param {Array} clima       12 monthly records (input contract)
 * @param {Array} cultivos    crops from cultivos.json
 * @param {Array} rotaciones  rotations from rotaciones.json
 * @param {Object} pesos      { agua, suelo, erosion, forraje, clima } each 0-5
 * @param {Object} contexto   { corregido, pendiente_pct, satelital: { ndvi, humedad_suelo, terreno } }
 */
export function evaluarRotaciones(clima, cultivos, rotaciones, pesos = {}, contexto = {}) {
  const climaPorMes = indexarClima(clima);
  const cultivosPorId = Object.fromEntries(cultivos.map((c) => [c.id, c]));
  const confianza = nivelConfianza(contexto);

  return rotaciones
    .map((rotacion) => {
      const ev = evaluarRotacion(climaPorMes, cultivosPorId, rotacion, contexto);
      const criterios = Object.fromEntries(CRITERIOS.map((c) => [c, round(ev.criterios[c])]));
      return {
        rotacion: rotacion.id,
        nombre: rotacion.nombre,
        total: round(puntajeTotal(ev.criterios, pesos)),
        criterios,
        confianza,
        avisos: avisosRotacion(ev, contexto),
        cultivos: ev.cultivos,
      };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * Risk calendar for the chart: per month, frost / drought / heat risk (0-100).
 */
export function calendarioRiesgos(clima) {
  const climaPorMes = indexarClima(clima);
  return Array.from({ length: 12 }, (_, i) => {
    const c = climaPorMes[i + 1];
    return {
      mes: i + 1,
      helada: round(100 * c.prob_helada),
      sequia: round(100 * clamp((PARAMS.lluviaSecaMm - c.lluvia_mm) / PARAMS.lluviaSecaMm, 0, 1)),
      calor: round(100 * clamp((c.tmed - PARAMS.tempCalorC) / 6, 0, 1)),
    };
  });
}
