// Thermal receipt printers.
//
// One description of each slip (receipt, package sticker, delivery note) is printed four ways,
// chosen per device under "Printer" (it depends on the printer attached to that device):
//   system    – the printer installed on this computer/phone (e.g. XPrinter on Windows): an 58/80 mm
//               page through the print dialog. With Chrome started with --kiosk-printing it prints
//               straight away, no dialog.
//   bluetooth – a Bluetooth (BLE) thermal printer, straight from Chrome (Android, Windows, Mac).
//   usb       – a USB thermal printer, straight from Chrome (WebUSB; on Windows only when no
//               printer driver is holding it — otherwise use "system").
//   rawbt     – Android phones with the free RawBT app (works with classic Bluetooth printers too).
//   pdf       – the PDF files, as before.
// Direct modes send ESC/POS commands (the language almost every thermal printer understands).
import { PAY_LABEL, fmtDate, itemsOf, prettyPhone, regName, regShort, tzs, type Company, type Shipment, type Trip } from "@/lib/domain";
import { packages, stickerPrefs } from "./stickers";

export type PrintMode = "system" | "bluetooth" | "usb" | "rawbt" | "pdf";
export interface PrinterPrefs {
  mode: PrintMode;
  cols: 32 | 42 | 48;      // characters per line: 58 mm = 32, 80 mm = 48 (42 on some)
  stickers: boolean;       // print package stickers on the thermal printer after the receipt
  auto: boolean;           // print as soon as goods are saved / released
  copies: 1 | 2;           // receipts: 2 = one for the sender, one for the office
  cut: boolean;            // send a paper cut after each slip
  name?: string;           // name of the paired Bluetooth/USB printer (for display)
}
export const PRINT_MODES: [PrintMode, string, string][] = [
  ["system", "Printer installed on this device", "Any thermal printer with its driver installed (Windows, Mac, Android print service). Opens the print dialog, sized for the roll."],
  ["bluetooth", "Bluetooth thermal printer (Chrome)", "Prints straight to a Bluetooth printer from Chrome on Android, Windows or Mac. Not on iPhone."],
  ["usb", "USB thermal printer, direct (Chrome)", "Prints straight over USB from Chrome. On Windows, use \"installed on this device\" if the printer has a driver."],
  ["rawbt", "RawBT app (Android)", "For Android phones with the free RawBT app. Works with any Bluetooth or USB thermal printer set up in RawBT."],
  ["pdf", "PDF download", "Download PDF files and print them yourself."],
];
export const PAPER: [PrinterPrefs["cols"], string][] = [[48, "80 mm roll (48 characters)"], [42, "80 mm roll (42 characters)"], [32, "58 mm roll (32 characters)"]];

const KEY = "shehena.printer";
const DEFAULTS: PrinterPrefs = { mode: "system", cols: 48, stickers: true, auto: true, copies: 1, cut: true };
export function printerPrefs(): PrinterPrefs {
  try {
    const old = JSON.parse(localStorage.getItem("shehena.stickers") || "{}");
    // Before printers were added, receipts were PDFs; keep that for devices that turned auto off.
    const base = { ...DEFAULTS, ...(old.auto === false ? { auto: false } : {}) };
    return { ...base, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch { return DEFAULTS; }
}
export function savePrinterPrefs(p: PrinterPrefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ } }

// ------------------------------------------------------------------ the slips

type Line =
  | { t: "text"; text: string; align?: "left" | "center" | "right"; bold?: boolean; size?: 1 | 2 | 3 }
  | { t: "pair"; k: string; v: string; bold?: boolean }
  | { t: "item"; name: string; pkgs: string; amount: string; bold?: boolean }
  | { t: "rule" }
  | { t: "qr"; data: string }
  | { t: "sign"; left: string; right: string }
  | { t: "feed"; n: number };
type Slip = { lines: Line[]; label: string };

const payText = (s: Shipment, account?: string) =>
  s.pay === "paid" ? "PAID" + (s.method ? ` (${s.method})` : "") : s.pay === "bill" ? "MONTHLY BILL" + (account ? ` (${account})` : "") : "NOT PAID - due on collection";

function head(company: Company, title: string, no: string): Line[] {
  return [
    { t: "text", text: (company.name || "Shehena").toUpperCase(), align: "center", bold: true, size: 2 },
    { t: "text", text: [company.branch, company.phone ? "Tel " + company.phone : ""].filter(Boolean).join(" - "), align: "center" },
    { t: "rule" },
    { t: "text", text: title, align: "center", bold: true },
    { t: "text", text: no, align: "center", bold: true, size: 2 },
  ];
}

export function receiptSlip(s: Shipment, company: Company, account?: string): Slip {
  const L: Line[] = head(company, "CARGO RECEIPT", s.no);
  L.push({ t: "pair", k: "Date", v: fmtDate(s.received_at) },
    { t: "pair", k: "Sender", v: `${s.s_name}, ${prettyPhone(s.s_phone)}` },
    { t: "pair", k: "Receiver", v: `${s.r_name}, ${prettyPhone(s.r_phone)}` },
    { t: "pair", k: "Route", v: `${regName(s.origin)} to ${regName(s.dest)}` }, { t: "rule" },
    { t: "item", name: "Item", pkgs: "Pkgs", amount: "TZS", bold: true });
  for (const l of itemsOf(s)) L.push({ t: "item", name: l.name, pkgs: String(l.pkgs), amount: tzs(l.charge) });
  L.push({ t: "rule" }, { t: "pair", k: "Packages", v: String(s.pkgs) });
  if (s.kg) L.push({ t: "pair", k: "Weight", v: `${s.kg} kg` });
  if (s.notes) L.push({ t: "pair", k: "Notes", v: s.notes });
  const disc = Number(s.discount || 0);
  if (disc > 0) L.push({ t: "pair", k: "Subtotal", v: "TZS " + tzs(s.gross_charge ?? Number(s.charge) + disc) },
    { t: "pair", k: "Discount", v: "- TZS " + tzs(disc) + (s.discount_reason ? ` (${s.discount_reason})` : "") });
  L.push({ t: "text", text: `TOTAL  TZS ${tzs(s.charge)}`, align: "right", bold: true, size: 2 },
    { t: "pair", k: "Payment", v: payText(s, account), bold: true },
    { t: "pair", k: "Served by", v: s.created_by_name || "-" }, { t: "rule" },
    { t: "qr", data: s.no },
    { t: "text", text: "Keep this receipt. The receiver collects with ID and the waybill number.", align: "center" },
    { t: "text", text: "Shehena - Serengeti Labs", align: "center" });
  return { lines: L, label: `Receipt ${s.no}` };
}

/** Package stickers: waybill, route, package n of N, QR. No amount, names or phone numbers. */
export function stickerSlips(s: Shipment, company: Company): Slip[] {
  const list = packages(s), total = list.length, showItem = stickerPrefs().showItem;
  return list.map((k) => ({
    label: `Sticker ${k.n}/${total}`,
    lines: [
      { t: "text", text: (company.name || "Shehena").toUpperCase(), align: "center", bold: true },
      { t: "text", text: new Date(s.received_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }), align: "center" },
      { t: "rule" },
      { t: "text", text: "TO", align: "center" },
      { t: "text", text: regShort(s.dest).toUpperCase(), align: "center", bold: true, size: 3 },
      { t: "text", text: `from ${regShort(s.origin)}`, align: "center" },
      { t: "text", text: s.no, align: "center", bold: true },
      { t: "qr", data: `${s.no}#${k.n}/${total}` },
      { t: "text", text: "PACKAGE", align: "center" },
      { t: "text", text: `${k.n} / ${total}`, align: "center", bold: true, size: 3 },
      ...(showItem ? [{ t: "text", text: k.item, align: "center" } as Line] : []),
    ],
  }));
}

export function deliverySlip(s: Shipment, company: Company, trip?: Trip): Slip {
  const L: Line[] = head(company, "DELIVERY NOTE", s.dn_no || s.no);
  L.push({ t: "pair", k: "Date", v: fmtDate(s.collected_at || new Date().toISOString()) },
    { t: "pair", k: "Waybill", v: s.no },
    { t: "pair", k: "Route", v: `${regName(s.origin)} to ${regName(s.dest)}` },
    ...(trip ? [{ t: "pair", k: "Vehicle", v: trip.plate } as Line] : []),
    { t: "pair", k: "Sender", v: s.s_name || "-" },
    { t: "pair", k: "Receiver", v: `${s.r_name}, ${prettyPhone(s.r_phone)}` }, { t: "rule" },
    { t: "item", name: "Goods", pkgs: "Pkgs", amount: "", bold: true });
  for (const l of itemsOf(s)) L.push({ t: "item", name: l.name, pkgs: String(l.pkgs), amount: "" });
  L.push({ t: "pair", k: "Packages", v: String(s.pkgs) },
    { t: "pair", k: "Payment", v: s.pay === "paid" ? "Paid" : PAY_LABEL[s.pay] }, { t: "rule" },
    { t: "pair", k: "Collected by", v: s.collector_name || s.r_name });
  if (s.collector_phone) L.push({ t: "pair", k: "Phone", v: prettyPhone(s.collector_phone) });
  if (s.collector_id) L.push({ t: "pair", k: "ID", v: s.collector_id });
  if (s.collect_note) L.push({ t: "pair", k: "Remarks", v: s.collect_note });
  L.push({ t: "pair", k: "Released by", v: s.collected_by || "-" }, { t: "feed", n: 3 },
    { t: "sign", left: "Released by (sign)", right: "Received by (sign)" }, { t: "feed", n: 1 },
    { t: "text", text: "The goods above were received complete and in the condition stated.", align: "center" });
  return { lines: L, label: `Delivery note ${s.dn_no || s.no}` };
}

// ------------------------------------------------------------------ ESC/POS

/** Thermal printers print plain ASCII reliably; swap the few characters we use for safe ones. */
export const ascii = (t: string) => String(t ?? "")
  .replace(/[–—−]/g, "-").replace(/[·•]/g, "-").replace(/[×]/g, "x").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/→/g, ">")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "?");

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of ascii(text).split("\n")) {
    let cur = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (word.length > width) { if (cur) { out.push(cur); cur = ""; } for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width)); continue; }
      if (!cur) cur = word; else if (cur.length + 1 + word.length <= width) cur += " " + word; else { out.push(cur); cur = word; }
    }
    out.push(cur);
  }
  return out;
}

const ESC = 0x1b, GS = 0x1d;
export function escpos(slips: Slip[], p: Pick<PrinterPrefs, "cols" | "cut">): Uint8Array {
  const b: number[] = [];
  const raw = (...n: number[]) => b.push(...n);
  const text = (t: string) => { for (const ch of ascii(t)) b.push(ch.charCodeAt(0)); };
  const nl = () => b.push(0x0a);
  const W = p.cols;
  raw(ESC, 0x40); // reset
  slips.forEach((slip, si) => {
    for (const l of slip.lines) {
      raw(ESC, 0x61, 0); raw(ESC, 0x45, 0); raw(GS, 0x21, 0);
      if (l.t === "text") {
        // Shrink big text whose longest word wouldn't fit the line at that size (e.g. a waybill on 58 mm).
        const longest = Math.max(0, ...ascii(l.text).split(/\s+/).map((w) => w.length));
        let sz = l.size || 1;
        while (sz > 1 && longest > Math.floor(W / sz)) sz--;
        raw(ESC, 0x61, l.align === "center" ? 1 : l.align === "right" ? 2 : 0);
        if (l.bold) raw(ESC, 0x45, 1);
        if (sz > 1) raw(GS, 0x21, sz === 3 ? 0x22 : 0x11);
        for (const w of wrap(l.text, Math.floor(W / sz))) { text(w); nl(); }
      } else if (l.t === "pair") {
        const kw = W >= 42 ? 13 : 10;
        const vs = wrap(l.v, W - kw);
        vs.forEach((v, i) => {
          text((i === 0 ? ascii(l.k) : "").padEnd(kw).slice(0, kw));
          if (l.bold) raw(ESC, 0x45, 1);
          text(v); raw(ESC, 0x45, 0); nl();
        });
      } else if (l.t === "item") {
        const aw = l.amount === "" && !l.bold ? 0 : 10, pw = 5, nw = W - pw - (aw ? aw + 1 : 0);
        if (l.bold) raw(ESC, 0x45, 1);
        const names = wrap(l.name, nw);
        names.forEach((n, i) => {
          text(n.padEnd(nw));
          if (i === 0) { text(ascii(l.pkgs).padStart(pw)); if (aw) text(" " + ascii(l.amount).padStart(aw)); }
          nl();
        });
      } else if (l.t === "rule") { text("-".repeat(W)); nl(); }
      else if (l.t === "feed") { for (let i = 0; i < l.n; i++) nl(); }
      else if (l.t === "sign") { const h = Math.floor((W - 2) / 2); text("_".repeat(h) + "  " + "_".repeat(h)); nl(); text(ascii(l.left).padEnd(h + 2).slice(0, h + 2) + ascii(l.right).slice(0, h)); nl(); }
      else if (l.t === "qr") {
        const d = Array.from(ascii(l.data), (c) => c.charCodeAt(0)), n = d.length + 3;
        raw(ESC, 0x61, 1);
        raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0);                 // model 2
        raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, W >= 42 ? 7 : 5);         // module size
        raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);                    // error correction M
        raw(GS, 0x28, 0x6b, n & 0xff, n >> 8, 0x31, 0x50, 0x30, ...d);  // store
        raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);                    // print
        nl();
      }
    }
    raw(ESC, 0x61, 0); raw(ESC, 0x45, 0); raw(GS, 0x21, 0);
    raw(ESC, 0x64, si === slips.length - 1 ? 4 : 3); // feed past the tear bar
    if (p.cut) raw(GS, 0x56, 0x42, 0);               // partial cut (ignored by printers without a cutter)
  });
  return new Uint8Array(b);
}

// ------------------------------------------------------------------ connections

/* eslint-disable @typescript-eslint/no-explicit-any */
type BtChar = { properties: { write: boolean; writeWithoutResponse: boolean }; writeValue(v: BufferSource): Promise<void>; writeValueWithoutResponse?(v: BufferSource): Promise<void> };
let bt: { device: any; char: BtChar } | null = null;
let usb: { device: any; ep: number } | null = null;

// Services used by common Bluetooth thermal printers (Xprinter, Goojprt, MTP, Rongta, generic "BlueTooth Printer").
const BT_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb", "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "0000ff00-0000-1000-8000-00805f9b34fb", "0000ffe0-0000-1000-8000-00805f9b34fb", "0000fee7-0000-1000-8000-00805f9b34fb",
  "0000ae30-0000-1000-8000-00805f9b34fb", "0000af30-0000-1000-8000-00805f9b34fb",
];
export const hasBluetooth = () => typeof navigator !== "undefined" && !!(navigator as any).bluetooth;
export const hasUsb = () => typeof navigator !== "undefined" && !!(navigator as any).usb;
export const isAndroid = () => typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

async function btCharacteristic(device: any): Promise<BtChar> {
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  const services = await server.getPrimaryServices();
  for (const svc of services) {
    for (const c of await svc.getCharacteristics()) if (c.properties.writeWithoutResponse || c.properties.write) return c;
  }
  throw new Error("This Bluetooth device has no printer connection. Choose the thermal printer from the list.");
}

/** Ask the user to choose a Bluetooth printer (must be called from a button tap). */
export async function pairBluetooth(): Promise<string> {
  if (!hasBluetooth()) throw new Error("This browser can't reach Bluetooth printers. Use Chrome on Android or on a computer, or choose another way to print.");
  const device = await (navigator as any).bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
  bt = { device, char: await btCharacteristic(device) };
  return device.name || "Bluetooth printer";
}
async function btWrite(data: Uint8Array) {
  if (!bt) {
    // Chrome remembers printers paired before; reconnect without asking when it can.
    const known = hasBluetooth() && (navigator as any).bluetooth.getDevices ? await (navigator as any).bluetooth.getDevices() : [];
    for (const d of known) { try { bt = { device: d, char: await btCharacteristic(d) }; break; } catch { /* try the next */ } }
    if (!bt) throw new Error("NEEDS_PAIRING");
  }
  if (!bt.device.gatt.connected) bt.char = await btCharacteristic(bt.device);
  const c = bt.char, size = 180;
  for (let i = 0; i < data.length; i += size) {
    const part = data.slice(i, i + size);
    if (c.properties.writeWithoutResponse && c.writeValueWithoutResponse) { await c.writeValueWithoutResponse(part); await new Promise((r) => setTimeout(r, 25)); }
    else await c.writeValue(part);
  }
}

export async function pairUsb(): Promise<string> {
  if (!hasUsb()) throw new Error("This browser can't reach USB printers directly. Use Chrome, or choose \"Printer installed on this device\".");
  const device = await (navigator as any).usb.requestDevice({ filters: [] });
  usb = await openUsb(device);
  return device.productName || "USB printer";
}
async function openUsb(device: any) {
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  for (const iface of device.configuration.interfaces) {
    for (const alt of iface.alternates) {
      const ep = alt.endpoints.find((e: any) => e.direction === "out" && e.type === "bulk");
      if (ep) {
        try { await device.claimInterface(iface.interfaceNumber); } catch { throw new Error("Windows is using this printer through its driver. Choose \"Printer installed on this device\" instead."); }
        return { device, ep: ep.endpointNumber };
      }
    }
  }
  throw new Error("This USB device isn't a printer.");
}
async function usbWrite(data: Uint8Array) {
  if (!usb) {
    const known = hasUsb() ? await (navigator as any).usb.getDevices() : [];
    if (!known.length) throw new Error("NEEDS_PAIRING");
    usb = await openUsb(known[0]);
  }
  for (let i = 0; i < data.length; i += 4096) await usb.device.transferOut(usb.ep, data.slice(i, i + 4096));
}

function rawbt(data: Uint8Array) {
  let s = ""; data.forEach((x) => { s += String.fromCharCode(x); });
  const b64 = btoa(s);
  window.location.href = `intent:base64,${b64}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ------------------------------------------------------------------ print dialog (installed printer)

const esc = (t: string) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function slipsHtml(slips: Slip[], cols: number) {
  const QR = (await import("qrcode")).default;
  const mm = cols <= 32 ? 48 : 72; // printable width of 58 / 80 mm rolls
  const parts: string[] = [];
  for (const slip of slips) {
    const h: string[] = [];
    for (const l of slip.lines) {
      if (l.t === "text") h.push(`<div class="t ${l.align || ""} ${l.bold ? "b" : ""} s${l.size || 1}">${esc(l.text)}</div>`);
      else if (l.t === "pair") h.push(`<div class="p"><span>${esc(l.k)}</span><span class="${l.bold ? "b" : ""}">${esc(l.v)}</span></div>`);
      else if (l.t === "item") h.push(`<div class="i ${l.bold ? "b" : ""}"><span>${esc(l.name)}</span><span>${esc(l.pkgs)}</span><span>${esc(l.amount)}</span></div>`);
      else if (l.t === "rule") h.push(`<hr>`);
      else if (l.t === "feed") h.push(`<div style="height:${l.n * 4}mm"></div>`);
      else if (l.t === "sign") h.push(`<div class="sg"><span>${esc(l.left)}</span><span>${esc(l.right)}</span></div>`);
      else if (l.t === "qr") h.push(`<div class="center"><img class="qr" src="${await QR.toDataURL(l.data, { margin: 0, width: 240, errorCorrectionLevel: "M" })}"></div>`);
    }
    parts.push(`<section>${h.join("")}</section>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(slips[0]?.label || "Print")}</title><style>
@page { margin: 0 }
* { box-sizing: border-box } html, body { margin: 0; background: #fff; color: #000 }
body { width: ${mm}mm; margin: 0 auto; font: 11px/1.3 Arial, Helvetica, sans-serif }
section { padding: 2mm 0 6mm } section + section { break-before: page; page-break-before: always }
.t { white-space: pre-wrap; word-break: break-word } .center { text-align: center } .right { text-align: right } .b { font-weight: 700 }
.s2 { font-size: 16px } .s3 { font-size: 26px; line-height: 1.1 }
.p { display: grid; grid-template-columns: ${cols <= 32 ? 17 : 22}mm 1fr; gap: 1mm } .p span:last-child { word-break: break-word }
.i { display: grid; grid-template-columns: 1fr 9mm ${cols <= 32 ? 14 : 18}mm; gap: 1mm } .i span:not(:first-child) { text-align: right }
hr { border: 0; border-top: 1px dashed #000; margin: 1.5mm 0 } .qr { width: ${cols <= 32 ? 24 : 30}mm; margin: 1.5mm auto; display: block }
.sg { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm } .sg span { border-top: 1px solid #000; padding-top: 1mm; font-size: 10px }
</style></head><body>${parts.join("")}</body></html>`;
}

async function printDialog(slips: Slip[], cols: number) {
  const html = await slipsHtml(slips, cols);
  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(f);
  const d = f.contentDocument!;
  d.open(); d.write(html); d.close();
  await Promise.all(Array.from(d.images).map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })));
  // Each slip is its own page, exactly as long as its content, so the roll doesn't feed blank paper.
  const paper = cols <= 32 ? 58 : 80;
  f.style.width = `${paper}mm`; f.style.height = "2000px";
  const css = Array.from(d.querySelectorAll("section")).map((sec, i) => {
    const mm = Math.ceil((sec as HTMLElement).getBoundingClientRect().height * 25.4 / 96) + 2;
    return `@page slip${i} { size: ${paper}mm ${Math.max(30, mm)}mm; margin: 0 } section:nth-of-type(${i + 1}) { page: slip${i} }`;
  }).join("\n");
  const st = d.createElement("style"); st.textContent = css; d.head.appendChild(st);
  await new Promise((r) => setTimeout(r, 50));
  f.contentWindow!.focus();
  f.contentWindow!.print();
  setTimeout(() => f.remove(), 60_000);
}

// ------------------------------------------------------------------ public

export type PrintKind = "receipt" | "stickers" | "receipt+stickers" | "delivery";

/**
 * Print with this device's printer settings. Returns a short message for a toast.
 * Throws Error("NEEDS_PAIRING") when a Bluetooth/USB printer must be chosen first (needs a tap).
 */
export async function printSlips(kind: PrintKind, s: Shipment, company: Company, opts: { account?: string; trip?: Trip; prefs?: PrinterPrefs } = {}) {
  const p = opts.prefs || printerPrefs();
  if (p.mode === "pdf") {
    if (kind === "delivery") { const { downloadDeliveryNote } = await import("./release"); await downloadDeliveryNote(s, company, opts.trip); }
    else if (kind === "receipt") { const { downloadReceipt } = await import("./parts"); await downloadReceipt(s, company, opts.account); }
    else if (kind === "stickers") { const { downloadStickers } = await import("./stickers"); await downloadStickers(s, company); }
    else { const { downloadReceiptAndStickers } = await import("./stickers"); await downloadReceiptAndStickers(s, company, opts.account); }
    return "PDF downloading.";
  }
  const slips: Slip[] = [];
  if (kind === "delivery") slips.push(deliverySlip(s, company, opts.trip));
  if (kind === "receipt" || kind === "receipt+stickers") for (let i = 0; i < p.copies; i++) slips.push(receiptSlip(s, company, opts.account));
  if (kind === "stickers" || (kind === "receipt+stickers" && p.stickers)) slips.push(...stickerSlips(s, company));
  const what = kind === "delivery" ? "Delivery note" : kind === "stickers" ? `${slips.length} sticker${slips.length === 1 ? "" : "s"}`
    : `Receipt${slips.length > p.copies ? ` and ${slips.length - p.copies} sticker${slips.length - p.copies === 1 ? "" : "s"}` : ""}`;
  if (p.mode === "system") { await printDialog(slips, p.cols); return `${what} sent to the print window.`; }
  const data = escpos(slips, p);
  if (p.mode === "bluetooth") await btWrite(data);
  else if (p.mode === "usb") await usbWrite(data);
  else rawbt(data);
  return `${what} sent to the printer.`;
}

/** Print a test slip so the user can check the width and connection. */
export async function printTest(company: Company, prefs: PrinterPrefs) {
  const slip: Slip = { label: "Test", lines: [
    { t: "text", text: (company.name || "Shehena").toUpperCase(), align: "center", bold: true, size: 2 },
    { t: "text", text: "PRINTER TEST", align: "center", bold: true },
    { t: "rule" },
    { t: "text", text: "1234567890".repeat(5).slice(0, prefs.cols) },
    { t: "pair", k: "Paper", v: PAPER.find((x) => x[0] === prefs.cols)?.[1] || "" },
    { t: "pair", k: "Connection", v: PRINT_MODES.find((x) => x[0] === prefs.mode)?.[1] || "" },
    { t: "item", name: "Item", pkgs: "Pkgs", amount: "TZS", bold: true },
    { t: "item", name: "Sample goods", pkgs: "2", amount: tzs(45000) },
    { t: "qr", data: "SHEHENA-TEST" },
    { t: "text", text: "If the numbers above fill one line exactly, the paper width is right.", align: "center" },
  ] };
  if (prefs.mode === "system") return printDialog([slip], prefs.cols);
  const data = escpos([slip], prefs);
  if (prefs.mode === "bluetooth") return btWrite(data);
  if (prefs.mode === "usb") return usbWrite(data);
  if (prefs.mode === "rawbt") return rawbt(data);
}
