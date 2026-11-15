// Results screen: rotation cards on the left, everything about the selected one on the right.
// Renders the view models built by ficha.js; all decisions about content live there.
import { icon, CRITERIO_ICON } from "./icons.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Tiny DOM builder: h("p", { class: "x", text: "..." }, child, ...). */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Counts a number up to `to`; jumps straight to it when motion is reduced. */
function countUp(el, to, ms = 900) {
  if (reducedMotion()) {
    el.textContent = to;
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / ms);
    el.textContent = Math.round(to * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Circular score ring: the arc fills to `percent` and a small "satellite" dot marks its end. */
function scoreRing(percent, size) {
  const r = 44;
  const circumference = 2 * Math.PI * r;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ring");
  const circle = (cls) => {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", 50);
    c.setAttribute("cy", 50);
    c.setAttribute("r", r);
    c.classList.add(cls);
    return c;
  };
  const track = circle("ring-track");
  const arc = circle("ring-arc");
  arc.setAttribute("stroke-dasharray", circumference);
  arc.setAttribute("stroke-dashoffset", circumference);
  const dotWrap = document.createElementNS(SVG_NS, "g");
  dotWrap.classList.add("ring-dot");
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", 50);
  dot.setAttribute("cy", 6);
  dot.setAttribute("r", 4.5);
  dotWrap.append(dot);
  svg.append(track, arc, dotWrap);
  // Start empty, then fill on the next frame so the CSS transition runs.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    arc.setAttribute("stroke-dashoffset", circumference * (1 - percent / 100));
    dotWrap.style.transform = `rotate(${(percent / 100) * 360}deg)`;
  }));
  return svg;
}

/** Crop photo with a drawn fallback underneath (shown while loading or if the photo fails). */
function cropPhoto(anio, images) {
  const box = h("span", { class: "crop-photo" });
  box.append(h("span", { class: "crop-fallback", "aria-hidden": "true" },
    anio.descanso ? icon("furrows", 22) : anio.nombre.slice(0, 1)));
  const meta = images?.[anio.id];
  if (meta?.url) {
    const img = h("img", { src: meta.url, alt: meta.alt ?? anio.nombre, loading: "lazy", decoding: "async" });
    img.addEventListener("error", () => img.remove());
    box.append(img);
  }
  return box;
}

function confidencePill(confianza) {
  return h("span", { class: `conf conf-${confianza.clase}` }, h("span", { class: "conf-dot", "aria-hidden": "true" }), confianza.texto);
}

const rankLabel = (f) => (f.posicion === 0 ? "Best option" : `Option ${f.posicion + 1}`);

/** One selectable card of the left column. */
function rotationCard(f, { selected, images, onSelect, index }) {
  const card = h("button", {
    type: "button",
    class: `rot-card${selected ? " is-selected" : ""}`,
    role: "tab",
    id: `tab-${f.id}`,
    "aria-selected": String(selected),
    "aria-controls": "rotation-detail",
    style: `--i:${index}`,
    onclick: () => onSelect(f.id),
  },
  h("span", { class: "rot-top" },
    h("span", { class: `rot-rank${f.posicion === 0 ? " is-best" : ""}` }, f.posicion === 0 && icon("star", 14), rankLabel(f)),
    confidencePill(f.confianza)),
  h("span", { class: "rot-main" },
    h("span", { class: "rot-text" },
      h("span", { class: "rot-name", text: f.nombre }),
      h("span", { class: "rot-seq", text: f.secuencia })),
    h("span", { class: "rot-score" },
      scoreRing(f.porcentaje, 64),
      h("span", { class: "rot-score-num" }, h("b", { text: f.porcentaje }), h("small", { text: "%" })))),
  h("span", { class: "rot-thumbs" }, f.anios.map((a) => cropPhoto(a, images))));
  return card;
}

function accordion(title, body, { count = null } = {}) {
  return h("details", { class: "acc" },
    h("summary", {},
      h("span", { class: "acc-title", text: title }),
      count != null && h("span", { class: "acc-count", text: count }),
      icon("chevron", 18)),
    h("div", { class: "acc-body" }, body));
}

const list = (items, cls = "") => h("ul", { class: cls }, items.map((t) => h("li", { text: t })));

function criteriaBars(f) {
  return h("div", { class: "bars" }, f.criterios.map((c, i) => {
    const fill = h("span", { class: "bar-fill", style: "width:0" });
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${c.valor}%`; }));
    return h("div", { class: "bar-row", style: `--i:${i}` },
      h("span", { class: "bar-icon" }, icon(CRITERIO_ICON[c.id] ?? "check", 18)),
      h("div", { class: "bar-main" },
        h("div", { class: "bar-head" },
          h("span", { class: "bar-label" }, c.label, c.importante && h("span", { class: "tag tag-accent", text: "Important to you" })),
          h("span", { class: "bar-value" }, h("span", { class: "bar-word", text: c.palabra }), h("b", { text: `${c.valor} %` }))),
        h("div", { class: "bar-track", role: "img", "aria-label": `${c.label}: ${c.valor} %, ${c.palabra.toLowerCase()}` }, fill)));
  }));
}

function sources(f, images) {
  const used = [...new Set(f.anios.map((a) => a.id))].map((id) => ({ id, meta: images?.[id] })).filter((x) => x.meta);
  return h("div", {},
    f.fuentes.map((s) => h("div", { class: "source" },
      h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", text: `${s.institucion}: ${s.titulo}` }),
      h("p", { text: `${s.seccion}. ${s.alcance} Accessed: ${s.consultado}.` }))),
    used.length > 0 && h("div", { class: "source" },
      h("p", { class: "source-title", text: "Reference photos (Wikimedia Commons)" }),
      h("p", {}, used.flatMap(({ meta }, i) => [
        i > 0 && " · ",
        h("a", { href: meta.pagina, target: "_blank", rel: "noopener noreferrer", text: `${meta.alt}: ${meta.autor}, ${meta.licencia}` }),
      ]))));
}

/**
 * Right column for the selected rotation. Returns the element plus the two canvases,
 * which the caller fills with Chart.js once the element is in the document.
 */
function rotationDetail(f, { images, onExport }) {
  const number = h("b", { text: "0" });
  countUp(number, f.porcentaje);
  const riskCanvas = h("canvas", { "aria-label": "Monthly climate risk chart", role: "img" });
  const radarCanvas = h("canvas", { "aria-label": "Chart comparing the three rotations", role: "img" });

  const el = h("article", { class: "detail", "aria-labelledby": `tab-${f.id}` },
    h("header", { class: "detail-hero reveal", style: "--i:0" },
      h("div", { class: "hero-score" },
        scoreRing(f.porcentaje, 148),
        h("div", { class: "hero-score-num" }, h("span", {}, number, h("small", { text: "%" })), h("em", { text: "matches your priorities" }))),
      h("div", { class: "hero-text" },
        h("p", { class: "eyebrow", text: `Rotation ${f.id} · ${rankLabel(f)}` }),
        h("h3", { text: f.nombre }),
        h("p", { class: "lead", text: f.resumen[0] }),
        f.resumen.slice(1).map((t) => h("p", { text: t })),
        h("div", { class: "conf-row" }, confidencePill(f.confianza), h("span", { class: "conf-why", text: f.confianza.explicacion })))),

    h("section", { class: "block reveal", style: "--i:1" },
      h("h4", { text: "The rotation, year by year" }),
      h("ol", { class: "years" }, f.anios.map((a, i) => h("li", { class: "year", style: `--i:${i}` },
        cropPhoto(a, images),
        h("div", { class: "year-body" },
          h("span", { class: "year-n", text: `Year ${a.anio}` }),
          h("span", { class: "year-name", text: a.nombre }),
          h("span", { class: "year-detail", text: a.detalle }),
          a.rasgos.length > 0 && h("span", { class: "year-tags" }, a.rasgos.map((r) => h("span", { class: "tag", text: r }))))))),
      f.descripcion && h("p", { class: "hint", text: f.descripcion })),

    h("div", { class: "stats-grid" },
      h("section", { class: "block reveal", style: "--i:2" },
        h("h4", { text: "Performance by criterion" }),
        h("p", { class: "hint", text: "Closer to 100 % is better." }),
        criteriaBars(f)),
      h("section", { class: "block reveal", style: "--i:3" },
        h("h4", { text: "Compared with the other rotations" }),
        h("p", { class: "hint", text: "The highlighted shape is this rotation; larger is better." }),
        h("div", { class: "chart-wrap chart-radar" }, radarCanvas))),

    h("section", { class: "block reveal", style: "--i:4" },
      h("h4", { text: "Climate risks, month by month" }),
      h("p", { class: "hint", text: "Highlighted bars mark months when this rotation has crops in the field." }),
      h("div", { class: "chart-wrap" }, riskCanvas)),

    f.avisos.length > 0 && h("section", { class: "block block-alert reveal", style: "--i:5" },
      h("h4", {}, icon("alert", 18), "Watch for frost"),
      list(f.avisos)),

    h("section", { class: "accs reveal", style: "--i:6" },
      f.evidenciaDisponible
        ? [
          accordion("Why consider it?", [
            h("p", { text: f.porQue }),
            f.beneficios.map((b) => h("p", {}, b.texto, " ", h("span", { class: "cite", text: `Respaldo: ${b.instituciones.join("; ")}` }))),
          ]),
          accordion("Limitations and missing information", [list(f.limites), list(f.faltantes)]),
          accordion("Questions to check on your plot", list(f.revisar)),
        ]
        : h("p", { class: "hint", text: "The evidence report could not be loaded. Try reloading the page." }),
      accordion("Data used in this result", [list(f.datosUsados), f.nota && h("p", { class: "hint", text: f.nota })]),
      accordion("Technical details", list(f.detalleTecnico)),
      accordion("Sources consulted", sources(f, images), { count: f.fuentes.length })),

    h("footer", { class: "detail-foot reveal", style: "--i:7" },
      h("button", { type: "button", class: "btn btn-primary", onclick: () => onExport(f) }, icon("download", 18), `Download this report (PDF)`)));

  return { el, riskCanvas, radarCanvas };
}

/** Left column: one card per rotation, entering one after another. */
export function renderRotationList(listEl, fichas, { selectedId, images, onSelect }) {
  listEl.classList.add("is-fresh");
  listEl.replaceChildren(...fichas.map((f, index) =>
    rotationCard(f, { selected: f.id === selectedId, images, onSelect, index })));
}

/** Moves the selection to another card without redrawing the list (so nothing re-animates). */
export function markSelected(listEl, selectedId) {
  listEl.classList.remove("is-fresh");
  for (const card of listEl.querySelectorAll(".rot-card")) {
    const on = card.id === `tab-${selectedId}`;
    card.classList.toggle("is-selected", on);
    card.setAttribute("aria-selected", String(on));
  }
}

/**
 * Right column for one rotation.
 * @returns {{ riskCanvas: HTMLCanvasElement, radarCanvas: HTMLCanvasElement }} canvases for Chart.js
 */
export function renderRotationDetail(detailEl, ficha, { images, onExport }) {
  const detail = rotationDetail(ficha, { images, onExport });
  detailEl.setAttribute("aria-labelledby", `tab-${ficha.id}`);
  detailEl.replaceChildren(detail.el);
  return { riskCanvas: detail.riskCanvas, radarCanvas: detail.radarCanvas };
}
