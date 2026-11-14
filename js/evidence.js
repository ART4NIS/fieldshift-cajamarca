// Documentary evidence stays separate from live climate and rule-engine results.
function paragraph(parent, text) {
  const p = document.createElement("p");
  p.textContent = text;
  parent.append(p);
}

function section(parent, title, entries) {
  const heading = document.createElement("h4");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const text of entries) {
    const li = document.createElement("li");
    li.textContent = text;
    list.append(li);
  }
  parent.append(heading, list);
}

export function renderEvidence(data, result, context) {
  const details = document.createElement("details");
  details.className = "evidence";
  const summary = document.createElement("summary");
  summary.textContent = "Ver ficha de evidencia";
  details.append(summary);
  const card = data?.fichas?.find((f) => f.rotacion === result.rotacion);
  if (!card) {
    paragraph(details, "No se pudo cargar la ficha de evidencia. Intente recargar la página.");
    return details;
  }
  paragraph(details, card.secuencia);
  section(details, "¿Por qué considerarla?", [card.por_que]);
  section(details, "Datos usados en este resultado", [
    `Fuente climática: ${context.fuente}. Período consultado: 1991–2024.`,
    context.corregido
      ? `Corrección con SENAMHI PISCO: período de referencia ${context.periodoCorreccion ?? "no informado"}. Es una grilla climática, no una medición directa de esta parcela.`
      : "Sin corrección local: NASA POWER puede subestimar el riesgo de heladas en la sierra.",
    `Confianza del motor: ${result.confianza}. El puntaje ${result.total}/100 combina sus prioridades; no es una probabilidad de cosecha.`,
    "La consulta de clima no incorpora MODIS NDVI, SMAP ni pendiente SRTM al resultado. Se usa una pendiente estimada de 18 %.",
    "El clima histórico orienta la comparación; no es un pronóstico de la próxima campaña.",
  ]);
  const sources = new Map(data.fuentes.map((s) => [s.id, s]));
  section(details, "Beneficios posibles y su respaldo", card.beneficios.map((b) =>
    `${b.texto} [${b.fuentes.map((id) => sources.get(id)?.institucion ?? id).join("; ")}]`));
  section(details, "Límites de esta propuesta", card.limites);
  section(details, "Información que falta", data._meta.vacios_comunes);
  section(details, "Antes de sembrar, revise con un técnico", card.revisar);
  paragraph(details, data._meta.nota_comun);
  const title = document.createElement("h4");
  title.textContent = "Fuentes agronómicas consultadas";
  details.append(title);
  for (const id of card.fuentes) {
    const source = sources.get(id);
    if (!source) continue;
    const p = document.createElement("p");
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `${source.institucion}: ${source.titulo}`;
    p.append(link);
    details.append(p);
    paragraph(details, `${source.seccion}. ${source.alcance} Consultado: ${source.consultado}.`);
  }
  return details;
}
