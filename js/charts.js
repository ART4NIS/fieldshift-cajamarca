// Chart.js 4.x wrappers. Chart is loaded as a global from the CDN script tag.
// Colors come from the CSS custom properties of the active theme, read each time a chart is drawn.

const charts = new WeakMap();

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** "#rrggbb" -> "rgba(r, g, b, alpha)" */
function withAlpha(hex, alpha) {
  const n = hex.replace("#", "");
  if (n.length !== 6) return hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function draw(canvas, config) {
  const { defaults } = globalThis.Chart;
  defaults.color = cssVar("--muted", "#9aa8c0");
  defaults.borderColor = cssVar("--line", "#2b3a57");
  defaults.font.family = "Figtree, system-ui, sans-serif";
  defaults.font.size = 12;
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) defaults.animation = false;
  charts.get(canvas)?.destroy();
  const chart = new globalThis.Chart(canvas, config);
  charts.set(canvas, chart);
  return chart;
}

const MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * data: output of calendarioRiesgos(clima) -> [{ mes, helada, sequia, calor }].
 * mesesEnCampo: months (1-12) with a crop in the field; the other months are drawn faded.
 */
export function renderRiskCalendar(canvas, data, mesesEnCampo = null) {
  const enCampo = mesesEnCampo?.length ? new Set(mesesEnCampo) : null;
  const serie = (label, key, color) => ({
    label,
    data: data.map((d) => d[key]),
    backgroundColor: data.map((d) => withAlpha(color, !enCampo || enCampo.has(d.mes) ? 1 : 0.28)),
    borderRadius: 4,
  });
  return draw(canvas, {
    type: "bar",
    data: {
      labels: data.map((d) => MESES[d.mes - 1]),
      datasets: [
        serie("Frost", "helada", cssVar("--chart-frost", "#7db9ff")),
        serie("Low rainfall", "sequia", cssVar("--chart-dry", "#f2c94c")),
        serie("Heat", "calor", cssVar("--chart-heat", "#ff7b72")),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { usePointStyle: true, pointStyle: "rectRounded" } } },
      scales: {
        x: { grid: { display: false } },
        y: { min: 0, max: 100, ticks: { stepSize: 25 }, title: { display: true, text: "Risk indicator (0 to 100)" } },
      },
    },
  });
}

const RADAR_LABELS = { agua: "Water", suelo: "Soil", erosion: "Erosion", forraje: "Forage", clima: "Climate" };

/** results: output of evaluarRotaciones(...). The rotation `selectedId` is highlighted; the rest are faint. */
export function renderRadar(canvas, results, selectedId = null) {
  const criterios = results.length ? Object.keys(results[0].criterios) : [];
  const accent = cssVar("--accent", "#7db9ff");
  const faint = cssVar("--muted", "#9aa8c0");
  return draw(canvas, {
    type: "radar",
    data: {
      labels: criterios.map((c) => RADAR_LABELS[c] ?? c),
      datasets: results.map((r) => {
        const on = selectedId == null || r.rotacion === selectedId;
        return {
          label: r.nombre,
          data: criterios.map((c) => r.criterios[c]),
          borderColor: on ? accent : withAlpha(faint, 0.55),
          backgroundColor: on ? withAlpha(accent, 0.22) : "transparent",
          borderWidth: on ? 2.5 : 1.2,
          borderDash: on ? [] : [4, 4],
          pointRadius: on ? 3 : 0,
          pointBackgroundColor: accent,
          order: on ? 0 : 1,
        };
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { usePointStyle: true, pointStyle: "line" } } },
      scales: {
        r: {
          min: 0,
          max: 100,
          // Tick labels default to a white backdrop, which shows as boxes on dark cards.
          ticks: { stepSize: 25, backdropColor: "transparent" },
          pointLabels: { font: { size: 12.5, weight: 600 }, color: cssVar("--fg", "#e9eef7") },
        },
      },
    },
  });
}
