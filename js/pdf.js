// PDF export of the rotation cards. jsPDF is loaded only when the user asks for a PDF.

const JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
let loading = null;

function loadJsPdf() {
  if (globalThis.jspdf?.jsPDF) return Promise.resolve(globalThis.jspdf.jsPDF);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = JSPDF_URL;
    script.onload = () => resolve(globalThis.jspdf.jsPDF);
    script.onerror = () => {
      loading = null; // allow a retry once the connection is back
      reject(new Error("jsPDF could not be loaded"));
    };
    document.head.append(script);
  });
  return loading;
}

/** jsPDF's built-in fonts only cover Latin-1: replace the few other characters the cards use. */
export function pdfText(texto) {
  return String(texto ?? "")
    .replace(/→/g, ">")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[   ]/g, " ")
    .replace(/[^\x00-\xff]/g, "");
}

/** "soworbit-rotation-b.pdf" / "soworbit-rotations.pdf" */
export function nombreArchivo(fichas) {
  return fichas.length === 1 ? `soworbit-rotation-${fichas[0].id.toLowerCase()}.pdf` : "soworbit-rotations.pdf";
}

const INK = [19, 28, 46];
const MUTED = [85, 98, 122];
const NAVY = [10, 16, 28];
const BLUE = [27, 95, 209];
const LEVEL = { alto: [26, 127, 67], medio: [176, 122, 0], bajo: [192, 53, 43] };
const MARGIN = 16;
const WIDTH = 210 - MARGIN * 2;
const BOTTOM = 297 - 18;

function writer(doc) {
  let y = MARGIN;
  const ensure = (space) => {
    if (y + space > BOTTOM) {
      doc.addPage();
      y = MARGIN + 4;
    }
  };
  const text = (value, { size = 10, style = "normal", color = INK, indent = 0, gap = 1.6 } = {}) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lineHeight = size * 0.42;
    for (const line of doc.splitTextToSize(pdfText(value), WIDTH - indent)) {
      ensure(lineHeight);
      doc.text(line, MARGIN + indent, y + lineHeight * 0.8);
      y += lineHeight;
    }
    y += gap;
  };
  const bullets = (items, options = {}) => {
    for (const item of items) {
      ensure(5);
      doc.setFillColor(...MUTED);
      doc.circle(MARGIN + 1.4, y + 2.1, 0.6, "F");
      text(item, { indent: 4.5, ...options });
    }
  };
  const heading = (value) => {
    y += 2.5;
    ensure(12);
    text(value, { size: 11.5, style: "bold", gap: 1.2 });
  };
  return {
    doc, ensure, text, bullets, heading,
    get y() { return y; },
    set y(value) { y = value; },
  };
}

function cover(w, meta) {
  const { doc } = w;
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, 210, 30, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text("SowOrbit", MARGIN, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(190, 205, 228);
  doc.text(pdfText("Crop rotations using NASA data"), MARGIN, 21);
  doc.text(pdfText(meta.fecha ?? ""), 210 - MARGIN, 21, { align: "right" });
  w.y = 36;
  if (meta.lugar) w.text(meta.lugar, { size: 9.5, color: MUTED });
}

function fichaPage(w, f) {
  const { doc } = w;
  w.ensure(34);
  // Title row: name on the left, percentage on the right.
  const top = w.y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...BLUE);
  doc.text(`${f.porcentaje} %`, 210 - MARGIN, top + 8, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(pdfText("matches your priorities"), 210 - MARGIN, top + 12.5, { align: "right" });
  w.text(f.posicion === 0 ? "Best option for your priorities" : `Option ${f.posicion + 1}`, { size: 8.5, color: MUTED, gap: 0.6 });
  w.text(`Rotation ${f.id}: ${f.nombre}`, { size: 15, style: "bold", gap: 1 });
  w.text(f.secuencia, { size: 10.5, gap: 2 });
  // Confidence chip, colored by level.
  const color = LEVEL[f.confianza.clase] ?? LEVEL.bajo;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  const chipWidth = doc.getTextWidth(pdfText(f.confianza.texto)) + 6;
  doc.setFillColor(...color);
  doc.roundedRect(MARGIN, w.y, chipWidth, 5.6, 2.8, 2.8, "F");
  doc.setTextColor(255, 255, 255);
  doc.text(pdfText(f.confianza.texto), MARGIN + 3, w.y + 3.9);
  w.y += 8;
  w.text(f.confianza.explicacion, { size: 8.5, color: MUTED, gap: 2.5 });

  w.heading("At a glance");
  for (const frase of f.resumen) w.text(frase);
  if (f.descripcion) w.text(f.descripcion, { color: MUTED });

  w.heading("The rotation, year by year");
  w.bullets(f.anios.map((a) =>
    `Year ${a.anio}: ${a.nombre}. ${a.detalle}${a.rasgos.length ? `. ${a.rasgos.join(", ")}` : ""}.`));

  w.heading("Performance by criterion");
  for (const c of f.criterios) {
    w.ensure(8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(pdfText(c.label), MARGIN, w.y + 3.4);
    doc.text(pdfText(`${c.palabra} · ${c.valor} %`), 210 - MARGIN, w.y + 3.4, { align: "right" });
    doc.setFillColor(226, 232, 242);
    doc.roundedRect(MARGIN, w.y + 5, WIDTH, 1.8, 0.9, 0.9, "F");
    doc.setFillColor(...BLUE);
    doc.roundedRect(MARGIN, w.y + 5, Math.max(1.8, (WIDTH * c.valor) / 100), 1.8, 0.9, 0.9, "F");
    w.y += 9.5;
  }

  if (f.avisos.length) {
    w.heading("Watch for frost");
    w.bullets(f.avisos);
  }
  if (f.porQue) {
    w.heading("Why consider it?");
    w.text(f.porQue);
    w.bullets(f.beneficios.map((b) => `${b.texto} [${b.instituciones.join("; ")}]`));
  }
  if (f.limites.length || f.faltantes.length) {
    w.heading("Limitations and missing information");
    w.bullets([...f.limites, ...f.faltantes]);
  }
  if (f.revisar.length) {
    w.heading("Questions to check on your plot");
    w.bullets(f.revisar);
  }
  w.heading("Data used in this result");
  w.bullets(f.datosUsados, { size: 9 });
  w.heading("Technical details");
  w.bullets(f.detalleTecnico, { size: 9, color: MUTED });
  if (f.fuentes.length) {
    w.heading("Sources consulted");
    for (const s of f.fuentes) {
      w.text(`${s.institucion}: ${s.titulo}`, { size: 9, style: "bold", gap: 0.4 });
      w.text(`${s.seccion}. ${s.alcance} Accessed: ${s.consultado}.`, { size: 8.5, color: MUTED, gap: 0.4 });
      w.text(s.url, { size: 8.5, color: BLUE, gap: 2 });
    }
  }
  if (f.nota) w.text(f.nota, { size: 8.5, color: MUTED });
}

function footers(doc) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(213, 222, 236);
    doc.line(MARGIN, 297 - 13, 210 - MARGIN, 297 - 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(pdfText("SowOrbit supports local agricultural advisors. Historical climate, not a forecast."), MARGIN, 297 - 8.5);
    doc.text(`${i} / ${pages}`, 210 - MARGIN, 297 - 8.5, { align: "right" });
  }
}

/**
 * Downloads a PDF with the given cards (one or several).
 * @param {Array} fichas  view models from construirFicha()
 * @param {Object} meta   { lugar, fecha, comunes: string[] } shown once for the whole document
 */
export async function exportarPdf(fichas, meta = {}) {
  const JsPdf = await loadJsPdf();
  const doc = new JsPdf({ unit: "mm", format: "a4" });
  const w = writer(doc);
  cover(w, meta);
  fichas.forEach((f, i) => {
    if (i > 0) {
      doc.addPage();
      w.y = MARGIN + 4;
    }
    fichaPage(w, f);
  });
  if (meta.comunes?.length) {
    w.heading("Before planting");
    w.bullets(meta.comunes, { size: 9 });
  }
  footers(doc);
  doc.save(nombreArchivo(fichas));
}
