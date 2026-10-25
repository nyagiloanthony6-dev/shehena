// Package stickers: one per package, pasted on the goods at receiving.
// Deliberately shows NO amount, NO names and NO phone numbers — only what loaders and the
// destination office need: waybill number, route, package n of N, and a QR code of the waybill.
import type { jsPDF as JsPDF } from "jspdf";
import { itemsOf, regShort, type Company, type Shipment } from "@/lib/domain";

export type StickerSize = "100x75" | "100x150" | "80x60" | "a4";
export const STICKER_SIZES: [StickerSize, string][] = [
  ["100x75", "Label 100 × 75 mm"],
  ["100x150", "Label 100 × 150 mm (4 × 6 in)"],
  ["80x60", "80 mm thermal roll (80 × 60 mm)"],
  ["a4", "A4 sheet, 8 stickers per page"],
];
export interface StickerPrefs { size: StickerSize; showItem: boolean; auto: boolean }
const KEY = "shehena.stickers";
const DEFAULTS: StickerPrefs = { size: "100x75", showItem: true, auto: true };

/** Sticker settings live on this device, because they depend on the printer attached to it. */
export function stickerPrefs(): StickerPrefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEFAULTS; }
}
export function saveStickerPrefs(p: StickerPrefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ } }

/** One entry per physical package, in item-line order. */
export function packages(s: Shipment) {
  const out: { n: number; item: string }[] = [];
  for (const l of itemsOf(s)) for (let i = 0; i < Math.max(1, Number(l.pkgs) || 0); i++) out.push({ n: out.length + 1, item: l.name });
  return out.slice(0, 500);
}

const dims = (size: StickerSize): [number, number] => size === "100x150" ? [100, 150] : size === "80x60" ? [80, 60] : [100, 75];
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/** Largest font (pt) up to `max` at which `text` fits in `width` mm. */
function fit(doc: JsPDF, text: string, width: number, max: number, min = 7) {
  let sz = max;
  doc.setFontSize(sz);
  while (sz > min && doc.getTextWidth(text) > width) doc.setFontSize(--sz);
  return sz;
}
const clip = (doc: JsPDF, text: string, width: number) => {
  if (doc.getTextWidth(text) <= width) return text;
  let t = text; while (t.length > 1 && doc.getTextWidth(t + "…") > width) t = t.slice(0, -1);
  return t + "…";
};

async function qr(text: string) {
  const QR = (await import("qrcode")).default;
  return QR.toDataURL(text, { margin: 0, width: 300, errorCorrectionLevel: "M" });
}

function drawSticker(doc: JsPDF, x: number, y: number, w: number, h: number, s: Shipment, company: Company, pkg: { n: number; item: string }, total: number, img: string, prefs: StickerPrefs) {
  const p = Math.max(3, Math.min(w, h) * 0.055);
  const iw = w - 2 * p;
  doc.setDrawColor(20, 24, 31); doc.setLineWidth(0.35); doc.setLineDashPattern([], 0);
  doc.roundedRect(x + 0.6, y + 0.6, w - 1.2, h - 1.2, 2, 2);
  doc.setTextColor(20, 24, 31);
  // header: company + date
  doc.setFont("helvetica", "bold"); fit(doc, (company.name || "Shehena").toUpperCase(), iw * 0.68, 10, 6);
  doc.text(clip(doc, (company.name || "Shehena").toUpperCase(), iw * 0.68), x + p, y + p + 3);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.text(shortDate(s.received_at), x + w - p, y + p + 3, { align: "right" });
  doc.setLineWidth(0.25); doc.line(x + p, y + p + 5.2, x + w - p, y + p + 5.2);

  const portrait = h > w * 1.2;
  const to = regShort(s.dest).toUpperCase(), from = regShort(s.origin);
  const pk = `${pkg.n} / ${total}`;
  if (portrait) {
    let cy = y + p + 16;
    doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.text("TO", x + p, cy - 6);
    fit(doc, to, iw, 40); doc.text(to, x + p, cy + 7); cy += 13;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(`from ${from}`, x + p, cy); cy += 8;
    doc.setFont("courier", "bold"); fit(doc, s.no, iw, 18); doc.text(s.no, x + p, cy); cy += 4;
    const q = Math.min(iw * 0.62, h - (cy - y) - 34);
    doc.addImage(img, "PNG", x + (w - q) / 2, cy, q, q); cy += q + 11;
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.text("PACKAGE", x + w / 2, cy - 5, { align: "center" });
    fit(doc, pk, iw, 34); doc.text(pk, x + w / 2, cy + 6, { align: "center" }); cy += 12;
    if (prefs.showItem) { doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(clip(doc, pkg.item, iw), x + w / 2, cy, { align: "center" }); }
    return;
  }
  // landscape: text on the left, QR + package count on the right
  const q = Math.min(h - 2 * p - 18, w * 0.34);
  const tw = iw - q - 3;
  let cy = y + p + 9.5;
  doc.setFontSize(Math.max(6, h * 0.085)); doc.setFont("helvetica", "bold"); doc.text("TO", x + p, cy); cy += h * 0.2;
  const big = fit(doc, to, tw, Math.max(16, h * 0.42)); doc.text(to, x + p, cy); cy += Math.max(4, h * 0.075);
  void big;
  doc.setFont("helvetica", "normal"); doc.setFontSize(Math.max(7, h * 0.1)); doc.text(`from ${from}`, x + p, cy); cy += h * 0.14;
  doc.setFont("courier", "bold"); fit(doc, s.no, tw, Math.max(10, h * 0.17)); doc.text(s.no, x + p, cy);
  if (prefs.showItem) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(Math.max(6.5, h * 0.1));
    doc.text(clip(doc, pkg.item, tw), x + p, y + h - p - 1);
  }
  const qx = x + w - p - q, qy = y + p + 7;
  doc.addImage(img, "PNG", qx, qy, q, q);
  doc.setFont("helvetica", "bold"); doc.setFontSize(Math.max(6, h * 0.08)); doc.text("PACKAGE", qx + q / 2, qy + q + 3.5, { align: "center" });
  fit(doc, pk, q + 4, Math.max(12, h * 0.26)); doc.text(pk, qx + q / 2, y + h - p - 0.5, { align: "center" });
}

/** Add every package sticker to `doc` (new pages), or start a new document when `doc` is null. */
export async function addStickers(doc: JsPDF | null, s: Shipment, company: Company, prefs = stickerPrefs()) {
  const { jsPDF } = await import("jspdf");
  const list = packages(s);
  const total = list.length;
  const imgs = new Map<number, string>();
  for (const k of list) imgs.set(k.n, await qr(`${s.no}#${k.n}/${total}`));
  if (prefs.size === "a4") {
    const W = 99, H = 67.7, ML = 5.5, MT = 13;
    list.forEach((k, i) => {
      const slot = i % 8;
      if (slot === 0) { if (doc) doc.addPage("a4", "portrait"); else doc = new jsPDF({ unit: "mm", format: "a4" }); }
      const cx = ML + (slot % 2) * (W + 1.5), cy = MT + Math.floor(slot / 2) * H;
      drawSticker(doc!, cx, cy, W, H, s, company, k, total, imgs.get(k.n)!, prefs);
    });
    return doc!;
  }
  const [w, h] = dims(prefs.size);
  const orient = w > h ? "landscape" : "portrait";
  for (const k of list) {
    if (doc) doc.addPage([w, h], orient); else doc = new jsPDF({ unit: "mm", format: [w, h], orientation: orient });
    drawSticker(doc, 0, 0, w, h, s, company, k, total, imgs.get(k.n)!, prefs);
  }
  return doc!;
}

export async function downloadStickers(s: Shipment, company: Company) {
  (await addStickers(null, s, company)).save(`Stickers-${s.no}.pdf`);
}

/** Receipt first, then every sticker, in one PDF — what the cashier prints when goods arrive. */
export async function downloadReceiptAndStickers(s: Shipment, company: Company, account?: string) {
  const { receiptDoc } = await import("./parts");
  const doc = await addStickers(await receiptDoc(s, company, account), s, company);
  doc.save(`Receipt-and-stickers-${s.no}.pdf`);
}
