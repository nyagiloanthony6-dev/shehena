/** Shehena logo: a cargo tag with an S cut through it, plus the lowercase "shehena" wordmark. */
export const BRAND = { navy: "#14213F", amber: "#F2A23A" };

const TAG = "M30 20 H62 L80 38 V76 A6 6 0 0 1 74 82 H30 A6 6 0 0 1 24 76 V26 A6 6 0 0 1 30 20 Z";
const S = "M62 51 Q62 44 52 44 Q42 44 42 51 Q42 58 52 60 Q62 62 62 69 Q62 76 52 76 Q42 76 42 69";

/** The tag on its own (viewBox 0 0 100 100). `tile` adds a rounded square behind it, as in the app icon. */
export function tagSvg(o: { tag?: string; cut?: string; tile?: string; size?: number } = {}) {
  const tag = o.tag ?? BRAND.amber, cut = o.cut ?? BRAND.navy, size = o.size ?? 100;
  const tile = o.tile ? `<rect width="100" height="100" rx="24" fill="${o.tile}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">${tile}<g transform="rotate(-8 52 51)"><path d="${TAG}" fill="${tag}"/><circle cx="66" cy="32" r="5" fill="${cut}"/><path d="${S}" fill="none" stroke="${cut}" stroke-width="7.5" stroke-linecap="round"/></g></svg>`;
}
export const TAG_PATH = TAG;
export const S_PATH = S;

/** PNG of the tag for PDFs (browser only). Returns null if the canvas is unavailable. */
export async function tagPng(o: Parameters<typeof tagSvg>[0] = {}, px = 240): Promise<string | null> {
  if (typeof document === "undefined") return null;
  try {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(tagSvg({ ...o, size: px }));
    await img.decode();
    const c = document.createElement("canvas");
    c.width = px; c.height = px;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, px, px);
    return c.toDataURL("image/png");
  } catch { return null; }
}

type Pdf = {
  addImage: (d: string, f: string, x: number, y: number, w: number, h: number) => unknown;
  setFont: (f: string, s: string) => unknown; setFontSize: (n: number) => unknown;
  setTextColor: (...c: number[]) => unknown; text: (t: string, x: number, y: number) => unknown;
  getTextWidth: (t: string) => number; setDrawColor: (...c: number[]) => unknown; setFillColor: (...c: number[]) => unknown;
  setLineWidth: (n: number) => unknown; line: (a: number, b: number, c: number, d: number) => unknown;
  circle: (x: number, y: number, r: number, s: string) => unknown;
};

/** Draws the full logo (tag + "shehena" + route line) on a jsPDF page. `light` = white text for dark headers. */
export async function pdfLogo(doc: Pdf, x: number, y: number, light = true) {
  const png = await tagPng();
  if (png) doc.addImage(png, "PNG", x, y - 9, 13, 13);
  const tx = png ? x + 15.5 : x;
  doc.setFont("helvetica", "bold"); doc.setFontSize(21);
  if (light) doc.setTextColor(255, 255, 255); else doc.setTextColor(20, 33, 63);
  doc.text("shehena", tx, y);
  const w = doc.getTextWidth("shehena");
  doc.setDrawColor(242, 162, 58); doc.setFillColor(242, 162, 58); doc.setLineWidth(0.7);
  doc.line(tx + 1.2, y + 3.2, tx + w - 1.2, y + 3.2);
  doc.circle(tx + 1.2, y + 3.2, 0.9, "S");
  doc.circle(tx + w - 1.2, y + 3.2, 1.05, "F");
}
