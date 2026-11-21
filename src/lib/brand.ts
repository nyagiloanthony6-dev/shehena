/** Shehena logo "Lebo": a tilted cargo tag with an S, plus the "SHEHENA" wordmark. */
export const BRAND = { navy: "#14213F", amber: "#F2A23A", white: "#FFFFFF" };

/** The tag (before rotation), in a 100 x 100 box. */
export const TAG_PATH = "M30 20 H62 L80 38 V76 A6 6 0 0 1 74 82 H30 A6 6 0 0 1 24 76 V26 A6 6 0 0 1 30 20 Z";
/** The letter S (Space Grotesk Bold), drawn as a shape so it looks the same everywhere. */
export const S_PATH = "M47.26 72.62Q43.7 72.62 40.97 71.34Q38.24 70.06 36.7 67.69Q35.16 65.31 35.16 61.97V60.74H40.88V61.97Q40.88 64.74 42.6 66.13Q44.32 67.51 47.26 67.51Q50.26 67.51 51.73 66.32Q53.2 65.14 53.2 63.29Q53.2 62.01 52.48 61.22Q51.75 60.43 50.37 59.92Q48.98 59.42 47 58.98L45.99 58.76Q42.82 58.05 40.55 56.97Q38.29 55.9 37.08 54.14Q35.87 52.38 35.87 49.56Q35.87 46.74 37.21 44.74Q38.55 42.74 40.99 41.66Q43.44 40.58 46.74 40.58Q50.04 40.58 52.61 41.71Q55.18 42.83 56.66 45.05Q58.13 47.27 58.13 50.62V51.94H52.41V50.62Q52.41 48.86 51.73 47.78Q51.05 46.7 49.77 46.19Q48.5 45.69 46.74 45.69Q44.1 45.69 42.84 46.68Q41.59 47.67 41.59 49.38Q41.59 50.53 42.18 51.32Q42.78 52.11 43.96 52.64Q45.15 53.17 47 53.56L48.01 53.78Q51.31 54.49 53.75 55.59Q56.2 56.69 57.56 58.49Q58.92 60.3 58.92 63.11Q58.92 65.93 57.49 68.06Q56.06 70.2 53.45 71.41Q50.83 72.62 47.26 72.62Z";
/** Everything on the tag is turned 8 degrees. */
export const TAG_TURN = "rotate(-8 50 50)";

export type MarkColors = { tile: string; tag: string; ink: string };
/** App icon / white pages: navy tile, amber tag, navy S and hole. */
export const ON_LIGHT: MarkColors = { tile: BRAND.navy, tag: BRAND.amber, ink: BRAND.navy };
/** On navy surfaces (side bar, login, PDF headers): no tile, so the amber tag sits straight on the navy. */
export const ON_DARK: MarkColors = { tile: "none", tag: BRAND.amber, ink: BRAND.navy };

/** The mark as an SVG string. */
export function markSvg(c: MarkColors = ON_LIGHT, size = 100) {
  const tile = c.tile === "none" ? "" : `<rect width="100" height="100" rx="24" fill="${c.tile}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">${tile}<g transform="${TAG_TURN}"><path d="${TAG_PATH}" fill="${c.tag}"/><circle cx="66" cy="34" r="5" fill="${c.ink}"/><path d="${S_PATH}" fill="${c.ink}"/></g></svg>`;
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
