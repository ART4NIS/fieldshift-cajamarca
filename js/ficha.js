// View model of one rotation card ("ficha"): plain-language summary, years, criteria, evidence.
// Pure functions only (no DOM, no fetch) so the screen and the PDF export share the same content.

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Farmer-facing wording of the five criteria. `fuerte` / `debil` are comparisons with the other rotations. */
export const CRITERIO_INFO = {
  agua: { label: "Ahorro de agua", corto: "Agua", fuerte: "necesita menos agua", debil: "pide más agua" },
  suelo: {
    label: "Cuidado del suelo", corto: "Suelo",
    fuerte: "deja la tierra más fértil", debil: "aporta menos a la fertilidad de la tierra",
  },
  erosion: {
    label: "Tierra protegida de la lluvia", corto: "Erosión",
    fuerte: "mantiene la tierra más cubierta y protegida de la lluvia", debil: "deja la tierra descubierta más tiempo",
  },
  forraje: {
    label: "Pasto para animales", corto: "Forraje",
    fuerte: "da más pasto para los animales", debil: "da menos pasto para los animales",
  },
  clima: {
    label: "Aguante frente al clima", corto: "Clima",
    fuerte: "sus cultivos aguantan mejor las heladas y la falta de lluvia",
    debil: "sus cultivos sufren más con las heladas o la falta de lluvia",
  },
};

const CONFIANZA = {
  Alto: {
    clase: "alto",
    texto: "Confianza alta",
    explicacion: "El clima está corregido con datos locales y hay datos de satélite del suelo, la vegetación y el terreno.",
  },
  Medio: {
    clase: "medio",
    texto: "Confianza media",
    explicacion: "El clima está corregido con datos locales del SENAMHI. Todavía faltan datos de satélite de la vegetación y la humedad del suelo.",
  },
  Bajo: {
    clase: "bajo",
    texto: "Confianza baja",
    explicacion: "El clima viene solo de NASA POWER, sin corrección local: puede mostrar menos heladas de las que hay.",
  },
};

/** Color class (alto = green, medio = yellow, bajo = red), label and reason for a confidence level. */
export function nivelConfianzaInfo(confianza) {
  return CONFIANZA[confianza] ?? CONFIANZA.Bajo;
}

/** One word for a 0-100 criterion score. */
export function palabraValor(valor) {
  if (valor >= 75) return "Muy bueno";
  if (valor >= 55) return "Bueno";
  if (valor >= 40) return "Regular";
  return "Bajo";
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
    frases.push("Es la rotación que mejor encaja con lo que usted marcó como importante.");
  } else if (dif <= 0) {
    frases.push("Encaja igual de bien con sus prioridades que la primera opción.");
  } else {
    frases.push(`Queda ${dif} ${dif === 1 ? "punto" : "puntos"} por debajo de la mejor opción para sus prioridades.`);
  }
  if (otros.length) {
    const ventajas = Object.entries(result.criterios)
      .map(([id, valor]) => [id, valor - promedio(otros.map((o) => o[id] ?? 0))])
      .sort((a, b) => b[1] - a[1]);
    const [mejor, peor] = [ventajas[0], ventajas.at(-1)];
    if (mejor[1] >= 5) frases.push(`Frente a las otras dos, destaca porque ${CRITERIO_INFO[mejor[0]].fuerte}.`);
    if (peor[1] <= -5) frases.push(`Su punto débil frente a las otras: ${CRITERIO_INFO[peor[0]].debil}.`);
  }
  const descuidado = Object.entries(result.criterios).find(([id, valor]) => (pesos[id] ?? 0) >= 4 && valor < 45);
  if (descuidado) {
    frases.push(`Ojo: usted marcó "${CRITERIO_INFO[descuidado[0]].label.toLowerCase()}" como muy importante y aquí sale bajo.`);
  }
  return frases;
}

/** Short tags describing what a crop brings to the rotation. */
export function rasgosCultivo(cultivo) {
  const rasgos = [];
  if (cultivo.fija_n_kg_ha > 0) rasgos.push("Abona la tierra");
  if (cultivo.forraje >= 1) rasgos.push("Sirve de pasto");
  else if (cultivo.forraje > 0) rasgos.push("Sus restos sirven de pasto");
  if (cultivo.tolerancia_sequia === "alta") rasgos.push("Aguanta la sequía");
  if (cultivo.temp_dano_helada <= -4) rasgos.push("Aguanta las heladas");
  else if (cultivo.temp_dano_helada >= -1) rasgos.push("Sensible a las heladas");
  if (cultivo.ingresos === "alto") rasgos.push("Buen ingreso");
  return rasgos;
}

function aniosRotacion(rotacion, cultivosPorId) {
  return rotacion.anios.map((a, i) => {
    const cultivo = cultivosPorId[a.cultivo];
    if (!cultivo) {
      return { anio: i + 1, id: "descanso", nombre: "Descanso", descanso: true, detalle: "La tierra descansa", rasgos: [] };
    }
    const siembra = a.mes_siembra ?? cultivo.meses_siembra[0];
    return {
      anio: i + 1,
      id: cultivo.id,
      nombre: cultivo.nombre,
      descanso: false,
      detalle: `Siembra en ${MESES[siembra - 1]} · ${cultivo.duracion_meses} meses`,
      rasgos: rasgosCultivo(cultivo),
    };
  });
}

/** Exact figures for the local technician (shown collapsed). */
function detalleTecnico(result, contexto) {
  const items = [];
  if (contexto.pendiente) {
    items.push(
      `Pendiente: ${Math.round(contexto.pendiente.pendiente_pct)} % (${contexto.pendiente.fuente}; ` +
      "puede subestimar en laderas muy empinadas o andenes).",
    );
  }
  const vistos = new Set();
  for (const c of result.cultivos ?? []) {
    for (const { mes, prob } of c.heladas ?? []) {
      const clave = `${c.id}-${mes}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      items.push(
        `${c.nombre}, ${MESES[mes - 1]}: ${Math.round(prob * 100)} % de los años con mínima bajo 2 °C; ` +
        `daño desde ${c.temp_dano_helada} °C.`,
      );
    }
  }
  items.push(`Puntajes por criterio (0-100): ${Object.entries(result.criterios)
    .map(([id, v]) => `${CRITERIO_INFO[id]?.corto ?? id} ${v}`).join(", ")}.`);
  items.push(`Fuente del clima: ${contexto.fuente ?? "NASA POWER"}.`);
  return items;
}

function datosUsados(result, contexto) {
  return [
    `Fuente climática: ${contexto.fuente ?? "NASA POWER"}. Período consultado: 1991–2024.`,
    contexto.corregido
      ? `Corrección con SENAMHI PISCO: período de referencia ${contexto.periodoCorreccion ?? "no informado"}. Es una grilla climática, no una medición directa de esta parcela.`
      : "Sin corrección local: NASA POWER puede subestimar el riesgo de heladas en la sierra.",
    `El ${result.total} % indica cuánto encaja la rotación con sus prioridades; no es una probabilidad de cosecha.`,
    contexto.pendiente
      ? `Pendiente del terreno en su punto: ${Math.round(contexto.pendiente.pendiente_pct)} % (${contexto.pendiente.fuente}). El resultado todavía no incorpora MODIS NDVI ni SMAP.`
      : "No pudimos calcular la pendiente de su punto; se usa una pendiente estimada de 18 %. El resultado todavía no incorpora MODIS NDVI ni SMAP.",
    "El clima histórico orienta la comparación; no es un pronóstico de la próxima campaña.",
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
