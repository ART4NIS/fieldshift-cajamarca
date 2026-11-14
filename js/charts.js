// Chart.js 4.x wrappers. Chart is loaded as a global from the CDN script tag.

const charts = new WeakMap();

function draw(canvas, config) {
  charts.get(canvas)?.destroy();
  const chart = new globalThis.Chart(canvas, config);
  charts.set(canvas, chart);
  return chart;
}

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** data: output of calendarioRiesgos(clima) -> [{ mes, helada, sequia, calor }] */
export function renderRiskCalendar(canvas, data) {
  return draw(canvas, {
    type: "bar",
    data: {
      labels: data.map((d) => MESES[d.mes - 1]),
      datasets: [
        { label: "Helada", data: data.map((d) => d.helada), backgroundColor: "#4a78b5" },
        { label: "Sequía", data: data.map((d) => d.sequia), backgroundColor: "#c98b2b" },
        { label: "Calor", data: data.map((d) => d.calor), backgroundColor: "#c2503a" },
      ],
    },
    options: {
      responsive: true,
      scales: { y: { min: 0, max: 100, title: { display: true, text: "Riesgo (%)" } } },
    },
  });
}

const COLORS = ["#2f6b3f", "#c98b2b", "#4a78b5", "#8a4b9c"];

/** results: output of evaluarRotaciones(...) -> one radar series per rotation */
export function renderRadar(canvas, results) {
  const criterios = results.length ? Object.keys(results[0].criterios) : [];
  return draw(canvas, {
    type: "radar",
    data: {
      labels: criterios,
      datasets: results.map((r, i) => ({
        label: r.nombre,
        data: criterios.map((c) => r.criterios[c]),
        borderColor: COLORS[i % COLORS.length],
        backgroundColor: `${COLORS[i % COLORS.length]}33`,
      })),
    },
    options: { responsive: true, scales: { r: { min: 0, max: 100 } } },
  });
}
