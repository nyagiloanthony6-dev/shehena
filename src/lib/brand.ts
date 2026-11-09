/** Shehena logo "Njia": an S drawn as a road from the origin (ring) to the destination (dot), plus the "SHEHENA" wordmark. */
export const BRAND = { navy: "#14213F", amber: "#F2A23A", white: "#FFFFFF" };

/** The road, in a 100 x 100 box. */
export const ROUTE_PATH = "M30 72 H56 A13 13 0 0 0 56 46 H44 A13 13 0 0 1 44 20 H70";

export type MarkColors = { tile: string; route: string; ring: string; dot: string };
/** On navy surfaces (side bar, login, PDF headers): amber tile, navy road. */
export const ON_DARK: MarkColors = { tile: BRAND.amber, route: BRAND.navy, ring: BRAND.navy, dot: BRAND.navy };
/** Standalone (app icon, white pages): navy tile, amber road, white ends. */
export const ON_LIGHT: MarkColors = { tile: BRAND.navy, route: BRAND.amber, ring: BRAND.white, dot: BRAND.white };

/** The mark as an SVG string. `small` thickens the road and drops the ring for 16-32 px icons. */
export function markSvg(c: MarkColors = ON_LIGHT, size = 100, small = false) {
  const ends = small
    ? `<circle cx="70" cy="20" r="8" fill="${c.dot}"/>`
    : `<circle cx="30" cy="72" r="6.5" fill="${c.tile}" stroke="${c.ring}" stroke-width="3.5"/><circle cx="70" cy="20" r="7" fill="${c.dot}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}"><rect width="100" height="100" rx="24" fill="${c.tile}"/><path d="${ROUTE_PATH}" fill="none" stroke="${c.route}" stroke-width="${small ? 11 : 9}" stroke-linecap="round" stroke-linejoin="round"/>${ends}</svg>`;
}

/** PNG of the mark for PDFs (browser only). Returns null if the canvas is unavailable. */
export async function markPng(c: MarkColors = ON_DARK, px = 240): Promise<string | null> {
  if (typeof document === "undefined") return null;
  try {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markSvg(c, px));
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = px; cv.height = px;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, px, px);
    return cv.toDataURL("image/png");
  } catch { return null; }
}

type Pdf = {
  addImage: (d: string, f: string, x: number, y: number, w: number, h: number) => unknown;
  setFont: (f: string, s: string) => unknown; setFontSize: (n: number) => unknown;
  setTextColor: (...c: number[]) => unknown; text: (t: string, x: number, y: number, o?: { charSpace?: number }) => unknown;
};

/** Draws the full logo (mark + "SHEHENA") on a jsPDF page. `light` = white text for dark headers. */
export async function pdfLogo(doc: Pdf, x: number, y: number, light = true) {
  const png = await markPng(light ? ON_DARK : ON_LIGHT);
  if (png) doc.addImage(png, "PNG", x, y - 9.5, 12, 12);
  const tx = png ? x + 15 : x;
  doc.setFont("helvetica", "bold"); doc.setFontSize(19);
  if (light) doc.setTextColor(255, 255, 255); else doc.setTextColor(20, 33, 63);
  doc.text("SHEHENA", tx, y, { charSpace: 0.6 });
}
