"use client";
import { useMemo, useState } from "react";
import { downloadReceiptAndStickers, packages, stickerPrefs } from "../stickers";
import { useStore } from "../store";
import { useUi } from "../CargoApp";
import { Slip } from "../parts";
import { METHODS, REGIONS, intlPhone, tzs, validPhone, ymd, type Item, type Shipment } from "@/lib/domain";

type Line = { name: string; pkgs: string; kg: string; unit: string; charge: string };
const blankLine = (): Line => ({ name: "", pkgs: "1", kg: "", unit: "", charge: "" });
/** A line's charge: price per package × packages when a unit price is given, otherwise the typed amount. */
const lineCharge = (l: Line) => (l.unit !== "" ? (Number(l.unit) || 0) * (parseInt(l.pkgs, 10) || 0) : Number(l.charge) || 0);
const toItems = (lines: Line[]): Item[] => lines.map((l) => ({
  name: l.name.trim(), pkgs: parseInt(l.pkgs, 10) || 0, kg: l.kg ? Number(l.kg) : null,
  unit: l.unit !== "" ? Number(l.unit) || 0 : null, charge: lineCharge(l),
}));
const summary = (items: Item[]) => ({
  item: items.map((i) => i.name).filter(Boolean).join(", "),
  pkgs: items.reduce((a, i) => a + i.pkgs, 0),
  charge: items.reduce((a, i) => a + i.charge, 0),
  kg: items.reduce((a, i) => a + (Number(i.kg) || 0), 0) || null,
});

const blank = (origin: string) => ({
  s_phone: "", s_name: "", r_phone: "", r_name: "",
  origin, dest: origin === "DOD" ? "DAR" : "DOD", pay: "unpaid" as "paid" | "unpaid", method: METHODS[0], notes: "",
});

export default function Receive() {
  const { company, shipments, me, insert, toast } = useStore();
  const ui = useUi();
  const [f, setF] = useState(() => blank(company.default_origin || "DAR"));
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const setLine = (i: number, k: keyof Line, v: string) => setLines((L) => L.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const items = toItems(lines);
  const tot = summary(items);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  /** Known customer lookup: fills the name from earlier consignments with this phone. */
  const known = (phone: string, as: "s" | "r") => {
    const p = intlPhone(phone);
    if (p.length < 12) return null;
    const asSender = shipments.filter((s) => intlPhone(s.s_phone) === p);
    const asReceiver = shipments.filter((s) => intlPhone(s.r_phone) === p);
    const last = [...asSender.map((s) => ({ at: s.received_at, name: s.s_name })), ...asReceiver.map((s) => ({ at: s.received_at, name: s.r_name }))]
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!last) return null;
    return { name: last.name, n: (as === "s" ? asSender : asReceiver).length };
  };
  const sKnown = useMemo(() => known(f.s_phone, "s"), [f.s_phone, shipments]); // eslint-disable-line react-hooks/exhaustive-deps
  const rKnown = useMemo(() => known(f.r_phone, "r"), [f.r_phone, shipments]); // eslint-disable-line react-hooks/exhaustive-deps
  const onPhone = (k: "s_phone" | "r_phone", v: string) => {
    const as = k === "s_phone" ? "s" : "r";
    const hit = known(v, as);
    setF((x) => ({ ...x, [k]: v, ...(hit && !x[as === "s" ? "s_name" : "r_name"].trim() ? { [as === "s" ? "s_name" : "r_name"]: hit.name } : {}) }));
  };

  const preview: Partial<Shipment> = {
    ...f, ...tot, items,
    no: `${f.origin}-${f.dest}-…`, method: f.pay === "paid" ? f.method : null, created_by_name: me.full_name,
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const miss: string[] = [];
    if (!f.s_name.trim()) miss.push("sender name");
    if (!validPhone(f.s_phone)) miss.push("a valid sender phone (e.g. 0712 345 678)");
    if (!f.r_name.trim()) miss.push("receiver name");
    if (!validPhone(f.r_phone)) miss.push("a valid receiver phone");
    if (items.some((i) => !i.name)) miss.push(items.length > 1 ? "a name for every item" : "item name");
    if (items.some((i) => i.pkgs < 1)) miss.push("at least 1 package for every item");
    if (f.origin === f.dest) miss.push("a destination different from the origin");
    if (miss.length) return setErr("Please add " + miss.join(", ") + ".");
    setErr(""); setBusy(true);
    const now = new Date().toISOString();
    const row: Partial<Shipment> = {
      s_name: f.s_name.trim(), s_phone: f.s_phone.trim(), r_name: f.r_name.trim(), r_phone: f.r_phone.trim(),
      ...tot, items, origin: f.origin, dest: f.dest, pay: f.pay, method: f.pay === "paid" ? f.method : null,
      paid_at: f.pay === "paid" ? now : null, paid_by: f.pay === "paid" ? me.full_name : null,
      notes: f.notes.trim(), status: "received", received_at: now, notices: [], created_by: me.id, created_by_name: me.full_name,
    };
    let saved: Shipment | null = null;
    for (let i = 0; i < 3 && !saved; i++) {
      saved = await insert<Shipment>("shipments", { ...row, no: `${f.origin}-${f.dest}-${ymd()}-${Math.floor(Math.random() * 9000) + 1000}` });
    }
    setBusy(false);
    if (!saved) return;
    setF(blank(company.default_origin || "DAR"));
    setLines([blankLine()]);
    ui.go("list");
    ui.openShip(saved.id);
    // Receipt for the sender and a sticker for every package, in one PDF.
    if (stickerPrefs().auto) {
      const n = packages(saved).length;
      toast(`Saved ${saved.no}. Receipt and ${n} sticker${n === 1 ? "" : "s"} downloading.`);
      try { await downloadReceiptAndStickers(saved, company); } catch { toast("Saved, but the PDF couldn't be made. Use Receipt + stickers below.", true); }
    } else toast(`Saved ${saved.no}. Send the notices below.`);
  }

  return (
    <section>
      <div className="sectionhead"><h1>Receive goods</h1><span className="sub">Record the consignment, then hand the sender the receipt.</span></div>
      <form className="formgrid" noValidate onSubmit={submit}>
        <div>
          <fieldset><legend>Sender (brought the goods)</legend>
            <div className="fields">
              <label className="f">Phone number<input value={f.s_phone} onChange={(e) => onPhone("s_phone", e.target.value)} inputMode="tel" placeholder="0712 345 678" /></label>
              <label className="f">Customer name<input value={f.s_name} onChange={(e) => set("s_name", e.target.value)} autoComplete="off" /></label>
            </div>
            {sKnown && <div className="hint">✓ Known customer: {sKnown.name}{sKnown.n ? ` · ${sKnown.n} previous consignment${sKnown.n === 1 ? "" : "s"}` : ""}</div>}
          </fieldset>
          <fieldset><legend>Receiver at destination</legend>
            <div className="fields">
              <label className="f">Phone number<input value={f.r_phone} onChange={(e) => onPhone("r_phone", e.target.value)} inputMode="tel" placeholder="0754 000 111" /></label>
              <label className="f">Receiver name<input value={f.r_name} onChange={(e) => set("r_name", e.target.value)} autoComplete="off" /></label>
            </div>
            {rKnown && <div className="hint">✓ Known customer: {rKnown.name}{rKnown.n ? ` · ${rKnown.n} previous consignment${rKnown.n === 1 ? "" : "s"}` : ""}</div>}
          </fieldset>
          <fieldset><legend>Route</legend>
            <div className="fields">
              <label className="f">From<select value={f.origin} onChange={(e) => set("origin", e.target.value)}>{REGIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
              <label className="f">To<select value={f.dest} onChange={(e) => set("dest", e.target.value)}>{REGIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
            </div>
          </fieldset>
          <fieldset><legend>Goods and charges</legend>
            <p className="sub" style={{ margin: "0 0 10px" }}>One line per kind of goods. Price/pkg and Kg are optional — enter a price per package and the charge is worked out for you.</p>
            <div className="ilines">
              {lines.map((l, i) => (
                <div className="iline" key={i}>
                  <span className="inum" aria-hidden="true">{i + 1}</span>
                  <label className="f iname">Item<input value={l.name} onChange={(e) => setLine(i, "name", e.target.value)} placeholder={i === 0 ? "e.g. Cartons of cooking oil" : "e.g. Mattresses"} aria-label={`Item ${i + 1} name`} /></label>
                  <label className="f">Packages<input type="number" min={1} step={1} value={l.pkgs} onChange={(e) => setLine(i, "pkgs", e.target.value)} aria-label={`Item ${i + 1} packages`} /></label>
                  <label className="f">Price/pkg<input type="number" min={0} step={500} value={l.unit} onChange={(e) => setLine(i, "unit", e.target.value)} aria-label={`Item ${i + 1} price per package`} /></label>
                  <label className="f">Charge (TZS)
                    {l.unit !== ""
                      ? <input value={tzs(lineCharge(l))} readOnly tabIndex={-1} aria-label={`Item ${i + 1} charge`} title="Price per package × packages" />
                      : <input type="number" min={0} step={500} value={l.charge} onChange={(e) => setLine(i, "charge", e.target.value)} aria-label={`Item ${i + 1} charge`} />}
                  </label>
                  <label className="f">Kg<input type="number" min={0} step={0.1} value={l.kg} onChange={(e) => setLine(i, "kg", e.target.value)} aria-label={`Item ${i + 1} weight`} /></label>
                  {lines.length > 1
                    ? <button type="button" className="btn sm iremove" onClick={() => setLines((L) => L.filter((_, j) => j !== i))} aria-label={`Remove item ${i + 1}`} title="Remove this item">✕</button>
                    : <span />}
                </div>
              ))}
            </div>
            <div className="itotal">
              <button type="button" className="btn sm" onClick={() => setLines((L) => [...L, blankLine()])}>+ Add another item</button>
              <span><b>{items.length}</b> item{items.length === 1 ? "" : "s"} · <b>{tot.pkgs}</b> package{tot.pkgs === 1 ? "" : "s"} · Total <b className="mono">TZS {tzs(tot.charge)}</b></span>
            </div>
          </fieldset>
          <fieldset><legend>Payment</legend>
            <div className="fields">
              <div className="f" style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 13, fontWeight: 500 }}>Total charge
                <div className="mono" style={{ fontSize: 20, fontWeight: 600, padding: "6px 0" }}>TZS {tzs(tot.charge)}</div></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 13, fontWeight: 500 }}>Status
                <div className="seg">
                  <label><input type="radio" name="pay" checked={f.pay === "paid"} onChange={() => set("pay", "paid")} /><span>Paid</span></label>
                  <label><input type="radio" name="pay" checked={f.pay === "unpaid"} onChange={() => set("pay", "unpaid")} /><span>Not paid</span></label>
                </div>
              </div>
              {f.pay === "paid" && <label className="f">Payment method<select value={f.method} onChange={(e) => set("method", e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>}
              <label className="f full">Notes <small>optional</small><textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Fragile, keep upright…" /></label>
            </div>
          </fieldset>
          <div className="err" role="alert">{err}</div>
          <div className="actions">
            <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save & issue receipt"}</button>
            <button className="btn" type="button" onClick={() => { setF(blank(company.default_origin || "DAR")); setLines([blankLine()]); setErr(""); }}>Clear</button>
          </div>
        </div>
        <aside className="preview"><div className="lbl" style={{ marginBottom: 8 }}>Receipt preview</div><Slip s={preview} company={company} /></aside>
      </form>
    </section>
  );
}
