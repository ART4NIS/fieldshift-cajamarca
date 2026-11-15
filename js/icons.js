// Small stroke icons (24x24, currentColor). One visual family for the whole interface.
const PATHS = {
  drop: ["M12 3.5c3.2 3.6 5.5 6.6 5.5 9.6a5.5 5.5 0 0 1-11 0c0-3 2.3-6 5.5-9.6z"],
  sprout: ["M12 20v-8", "M12 12c0-3.3-2.2-5.5-6-5.5 0 3.6 2.2 5.5 6 5.5z", "M12 14c0-2.8 2-4.8 6-4.8 0 3-2 4.8-6 4.8z"],
  mountain: ["M3 19l6-10 4 6 2-3 6 7z"],
  grass: ["M3 20h18", "M7 20c0-4 0-7-1.5-10", "M12 20c0-6 0-10 1-14", "M17 20c0-4 .5-6.500 2-9"],
  snow: ["M12 3v18", "M4.2 7.5l15.6 9", "M19.8 7.5l-15.6 9", "M9.5 4.5L12 7l2.5-2.5", "M9.5 19.5L12 17l2.5 2.5"],
  pin: ["M12 21s-6.5-5.6-6.5-10.500a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z", "M12 8.2a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z"],
  chart: ["M3 20h18", "M6 20v-8", "M12 20V5", "M18 20v-11"],
  book: ["M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z", "M5 17a3 3 0 0 1 3-3h11"],
  sun: [
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
    "M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8",
  ],
  moon: ["M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.500z"],
  download: ["M12 4v11", "M7.5 11l4.5 4.5 4.5-4.5", "M5 20h14"],
  arrow: ["M5 12h14", "M13 6l6 6-6 6"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  chevron: ["M6 9l6 6 6-6"],
  furrows: ["M3 9c3-2 6-2 9 0s6 2 9 0", "M3 14c3-2 6-2 9 0s6 2 9 0", "M3 19c3-2 6-2 9 0s6 2 9 0"],
  alert: ["M12 4l9 15.500H3z", "M12 10v4.5", "M12 17v.4"],
  star: ["M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.800-5.200 2.800 1-5.800-4.300-4.100 5.900-.800z"],
};

export const CRITERIO_ICON = { agua: "drop", suelo: "sprout", erosion: "mountain", forraje: "grass", clima: "snow" };

/** SVG element for a named icon; decorative by default (aria-hidden). */
export function icon(name, size = 20) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  for (const d of PATHS[name] ?? []) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
