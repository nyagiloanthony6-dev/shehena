"use client";
// Printer settings for this device: how to reach the thermal printer, paper width, and what to print.
import { useEffect, useState } from "react";
import { useStore } from "./store";
import { PAPER, PRINT_MODES, hasBluetooth, hasUsb, isAndroid, pairBluetooth, pairUsb, printTest, printerPrefs, savePrinterPrefs, type PrinterPrefs, type PrintMode } from "./printer";
import { STICKER_SIZES, saveStickerPrefs, stickerPrefs, type StickerPrefs } from "./stickers";

export const modeLabel = (p: PrinterPrefs) => {
  const m = PRINT_MODES.find((x) => x[0] === p.mode)?.[1] || "";
  return p.mode === "pdf" ? m : `${p.name ? p.name + " · " : ""}${m} · ${p.cols === 32 ? "58" : "80"} mm`;
};

/** Hook: this device's printer settings, kept in step with the setup form. */
export function usePrinterPrefs() {
  const [p, setP] = useState<PrinterPrefs | null>(null);
  useEffect(() => {
    setP(printerPrefs());
    const on = () => setP(printerPrefs());
    window.addEventListener("shehena-printer", on);
    return () => window.removeEventListener("shehena-printer", on);
  }, []);
  return p;
}

export function PrinterSetup({ onDone }: { onDone?: () => void }) {
  const { company, toast } = useStore();
  const [p, setP] = useState<PrinterPrefs>(() => printerPrefs());
  const [sp, setSp] = useState<StickerPrefs>(() => stickerPrefs());
  const [busy, setBusy] = useState(false);
  const set = (x: Partial<PrinterPrefs>) => { const n = { ...p, ...x }; setP(n); savePrinterPrefs(n); window.dispatchEvent(new Event("shehena-printer")); };
  const setS = (x: Partial<StickerPrefs>) => { const n = { ...sp, ...x }; setSp(n); saveStickerPrefs(n); };
  const mode = PRINT_MODES.find((m) => m[0] === p.mode)!;
  const direct = p.mode === "bluetooth" || p.mode === "usb";
  const supported = p.mode === "bluetooth" ? hasBluetooth() : p.mode === "usb" ? hasUsb() : true;

  async function pair() {
    setBusy(true);
    try { const name = p.mode === "bluetooth" ? await pairBluetooth() : await pairUsb(); set({ name }); toast(`Connected to ${name}. Print a test slip to check.`); }
    catch (e) { const m = (e as Error).message || ""; if (!/cancel|chosen|No device selected/i.test(m)) toast(m || "Couldn't connect to the printer.", true); }
    setBusy(false);
  }
  async function test() {
    setBusy(true);
    try { await printTest(company, p); if (p.mode !== "system") toast("Test slip sent."); }
    catch (e) { const m = (e as Error).message; toast(m === "NEEDS_PAIRING" ? "Choose the printer first." : m || "Couldn't print.", true); }
    setBusy(false);
  }

  return (
    <div className="printer-setup">
      <div className="fields">
        <label className="f full">How this device prints
          <select value={p.mode} onChange={(e) => set({ mode: e.target.value as PrintMode, name: undefined })} aria-label="Print method">
            {PRINT_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <small style={{ marginTop: 4 }}>{mode[2]}</small>
        </label>
        {p.mode !== "pdf" && <label className="f">Paper<select value={p.cols} onChange={(e) => set({ cols: Number(e.target.value) as PrinterPrefs["cols"] })} aria-label="Paper width">{PAPER.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
        {p.mode !== "pdf" && <label className="f">Receipts<select value={p.copies} onChange={(e) => set({ copies: Number(e.target.value) as 1 | 2 })} aria-label="Receipt copies"><option value={1}>1 copy</option><option value={2}>2 copies (sender + office)</option></select></label>}
        {p.mode === "pdf" && <label className="f">Sticker size<select value={sp.size} onChange={(e) => setS({ size: e.target.value as StickerPrefs["size"] })}>{STICKER_SIZES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
      </div>
      <div className="checks" style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        <label className="check"><input type="checkbox" checked={p.auto} onChange={(e) => set({ auto: e.target.checked })} /> Print the receipt as soon as goods are saved</label>
        {p.mode !== "pdf" && <label className="check"><input type="checkbox" checked={p.stickers} onChange={(e) => set({ stickers: e.target.checked })} /> Print a sticker for every package after the receipt</label>}
        <label className="check"><input type="checkbox" checked={sp.showItem} onChange={(e) => setS({ showItem: e.target.checked })} /> Show the goods description on stickers</label>
        {p.mode !== "pdf" && p.mode !== "system" && <label className="check"><input type="checkbox" checked={p.cut} onChange={(e) => set({ cut: e.target.checked })} /> Cut the paper after each slip (printers with a cutter)</label>}
      </div>
      {!supported && <p className="note" style={{ color: "var(--bad)" }}>This browser can&apos;t do this. Use Google Chrome{p.mode === "bluetooth" ? " on Android or a computer (not iPhone)" : ""}, or choose another way to print.</p>}
      {p.mode === "rawbt" && !isAndroid() && <p className="note">RawBT is an Android app. On this device, choose another way to print.</p>}
      {p.mode === "rawbt" && <p className="note">Install <b>RawBT</b> from the Play Store, pair your printer in RawBT, then print a test slip here.</p>}
      {p.mode === "system" && <p className="note">Install the printer&apos;s driver and set it as the default printer. In the print window choose that printer, paper {p.cols === 32 ? "58" : "80"} mm and margins None. Tip for a counter PC: start Chrome with <code>--kiosk-printing</code> and slips print straight away without the window.</p>}
      <div className="actions">
        {direct && <button className="btn sm primary" type="button" disabled={busy || !supported} onClick={pair}>{p.name ? `Change printer (${p.name})` : "Choose printer"}</button>}
        {p.mode !== "pdf" && <button className="btn sm" type="button" disabled={busy || !supported} onClick={test}>Print a test slip</button>}
        {onDone && <button className="btn sm" type="button" onClick={onDone}>Done</button>}
      </div>
      <p className="note">These settings are for this device only, because each counter has its own printer.</p>
    </div>
  );
}

/** One line showing this device's printer, with the settings opening underneath. */
export function PrinterLine() {
  const p = usePrinterPrefs();
  const [open, setOpen] = useState(false);
  return (
    <div className="printer-line">
      <span className="sub">Printer: <b>{p ? modeLabel(p) : "…"}</b> · <button className="link" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide printer settings" : "Printer settings"}</button></span>
      {open && <div className="paybox" style={{ marginTop: 8 }}><PrinterSetup onDone={() => setOpen(false)} /></div>}
    </div>
  );
}
