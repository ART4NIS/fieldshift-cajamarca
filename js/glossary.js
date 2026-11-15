// Glossary search and grouping. Pure functions: no DOM.

/** Display order of the categories; each term in glosario.json names one in its `categoria` field. */
export const CATEGORIAS = [
  { id: "clima", nombre: "Clima y riesgos" },
  { id: "suelo", nombre: "Suelo y cultivos" },
  { id: "resultados", nombre: "Cómo leer los resultados" },
  { id: "datos", nombre: "Datos y fuentes" },
  { id: "mapa", nombre: "Mapa y ubicación" },
];

const OTROS = { id: "otros", nombre: "Otros términos" };

/** Lowercase without accents, so "sequia" finds "Sequía". */
export function normalizar(texto) {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Terms matching the search text (in the term or its definition) and, when given, the category id. */
export function filtrarGlosario(terminos, { texto = "", categoria = null } = {}) {
  const q = normalizar(texto);
  return terminos.filter((t) =>
    (!categoria || (t.categoria ?? OTROS.id) === categoria) &&
    (!q || normalizar(t.termino).includes(q) || normalizar(t.definicion).includes(q)));
}

/** [{ categoria: { id, nombre }, terminos: [...] }] in CATEGORIAS order; empty groups are dropped. */
export function agruparPorCategoria(terminos) {
  const conocidas = new Set(CATEGORIAS.map((c) => c.id));
  return [...CATEGORIAS, OTROS]
    .map((categoria) => ({
      categoria,
      terminos: terminos.filter((t) =>
        (conocidas.has(t.categoria) ? t.categoria : OTROS.id) === categoria.id),
    }))
    .filter((g) => g.terminos.length);
}
