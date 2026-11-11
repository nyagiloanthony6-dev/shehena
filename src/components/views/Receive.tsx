"use client";
import { useMemo, useState } from "react";
import { printSlips, printerPrefs } from "../printer";
import { PrinterLine } from "../PrinterSetup";
import { RegionOptions } from "../RegionOptions";
import { useStore } from "../store";
import { useUi } from "../CargoApp";
import { FoundPicker, Slip } from "../parts";
import { METHODS, REGIONS, INTL, canRecordFound, chargeableKg, isAir, kgFmt, terms, volumeKg, type Pay, fmtDate, intlPhone, regShort, tzs, validPhone, ymd, type Item, type Shipment, type EditEntry, officesOf, isPart } from "@/lib/domain";

type Line = { name: string; pkgs: string; kg: string; unit: string; charge: string; l: string; w: string; h: string; rate: string };
const blankLine = (rate = ""): Line => ({ name: "", pkgs: "1", kg: "", unit: "", charge: "", l: "", w: "", h: "", rate });
type AirCfg = { air: boolean; div: number };
/** Air: volume weight of the line and the chargeable weight (higher of actual and volume, to the half kg). */
const airWeights = (l: Line, div: number) => {
  const vol = volumeKg(Number(l.l) || 0, Number(l.w) || 0, Number(l.h) || 0, parseInt(l.pkgs, 10) || 0, div);
  return { vol: Math.round(vol * 10) / 10, cw: chargeableKg(Number(l.kg) || 0, vol) };
};
/** A line's charge. Road: price per package × packages, or the typed amount. Air: chargeable kg × price per kg, or the typed amount. */
const lineCharge = (l: Line, c: AirCfg) => c.air
  ? (l.rate !== "" ? Math.round(airWeights(l, c.div).cw * (Number(l.rate) || 0)) : Number(l.charge) || 0)
  : (l.unit !== "" ? (Number(l.unit) || 0) * (parseInt(l.pkgs, 10) || 0) : Number(l.charge) || 0);
const toItems = (lines: Line[], c: AirCfg): Item[] => lines.map((l) => ({
  name: l.name.trim(), pkgs: parseInt(l.pkgs, 10) || 0, kg: l.kg ? Number(l.kg) : null,
  unit: !c.air && l.unit !== "" ? Number(l.unit) || 0 : null, charge: lineCharge(l, c),
  ...(c.air ? {
    l: Number(l.l) || null, w: Number(l.w) || null, h: Number(l.h) || null, ...airWeights(l, c.div),
    rate: l.rate !== "" ? Number(l.rate) || 0 : null,
  } : {}),
}));
const summary = (items: Item[]) => ({
  item: items.map((i) => i.name).filter(Boolean).join(", "),
  pkgs: items.reduce((a, i) => a + i.pkgs, 0),
  charge: items.reduce((a, i) => a + i.charge, 0),
  kg: items.reduce((a, i) => a + (Number(i.kg) || 0), 0) || null,
});

/** Item lines back from a saved consignment, for editing. */
const linesOf = (s: Shipment, c: AirCfg): Line[] => {
  const items: Item[] = Array.isArray(s.items) && s.items.length ? s.items
    : [{ name: s.item, pkgs: s.pkgs, kg: s.kg, unit: null, charge: Number(s.gross_charge ?? s.charge) || 0 }];
  return items.map((i) => ({
    name: i.name || "", pkgs: String(i.pkgs || 1), kg: i.kg != null ? String(i.kg) : "",
    unit: !c.air && i.unit != null ? String(i.unit) : "",
    charge: (c.air ? i.rate == null : i.unit == null) && Number(i.charge) ? String(i.charge) : "",
    l: i.l ? String(i.l) : "", w: i.w ? String(i.w) : "", h: i.h ? String(i.h) : "",
    rate: c.air && i.rate != null ? String(i.rate) : "",
  }));
};
/** Short text of a value for the edit history. */
const showVal = (k: string, v: unknown) => k === "charge" ? `TZS ${tzs(Number(v) || 0)}` : k === "origin" || k === "dest" ? regShort(String(v || "")) : String(v ?? "").trim() || "—";
const FIELD_LABEL: Record<string, string> = {
  s_name: "Sender name", s_phone: "Sender phone", r_name: "Receiver name", r_phone: "Receiver phone",
  origin: "From", dest: "To", item: "Goods", pkgs: "Packages", kg: "Kg", charge: "Charge", notes: "Notes",
};

const blank = (origin: string, dest?: string) => ({
  s_phone: "", s_name: "", r_phone: "", r_name: "",
  origin, dest: dest || (origin === "DOD" ? "DAR" : "DOD"), pay: "unpaid" as Pay | "part", method: METHODS[0], notes: "", part: "",
  account_id: "", discount: "", discount_reason: "",
});

export default function Receive() {
  const { company, shipments, trips, me, insert, patch, toast, accounts, hasExtras, can, hasPart, logPayment } = useStore();
  // Branch staff always receive at their own office; it can't be changed.
  const station = me.role === "agent" ? me.station || null : null;
  const home = station || company.default_origin || "DAR";
  // Air: goods usually fly to Tanzania, so prefer a Tanzanian office as the destination.
  const firstDest = officesOf(company).find((x) => x !== home && !INTL.has(x)) || officesOf(company).find((x) => x !== home);
  const cfg: AirCfg = { air: isAir(company), div: Number(company.vol_divisor) || 6000 };
  const W = terms(company);
  const defRate = cfg.air && Number(company.kg_rate) > 0 ? String(company.kg_rate) : "";
  const activeAccounts = accounts.filter((a) => a.active);
  const ui = useUi();
  // "Found on arrival" mode: goods discovered on an arrived truck that were never recorded at loading.
  const trip = ui.foundTrip ? trips.find((t) => t.id === ui.foundTrip && t.status === "arrived") || null : null;
  // Edit mode: correcting a consignment that was already saved.
  // Keep the consignment being edited even if the lists reload for a moment, so an edit can
  // never turn into a new consignment with a new number.
  const [editSnap] = useState(() => (ui.editId ? shipments.find((x) => x.id === ui.editId) || null : null));
  const editing = ui.editId ? shipments.find((x) => x.id === ui.editId) || editSnap : null;
  const found = !editing && !!trip && canRecordFound(me.role, company);
  const routeLocked = !!editing && editing.status !== "received";
  const [foundNote, setFoundNote] = useState("");
  const [f, setF] = useState(() => editing
    ? { ...blank(editing.origin, editing.dest), s_name: editing.s_name || "", s_phone: editing.s_phone || "", r_name: editing.r_name || "", r_phone: editing.r_phone || "", notes: editing.notes || "" }
    : blank(home, firstDest));
  const [lines, setLines] = useState<Line[]>(() => editing ? linesOf(editing, cfg) : [blankLine(defRate)]);
  const setLine = (i: number, k: keyof Line, v: string) => setLines((L) => L.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const items = toItems(lines, cfg);
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

  const disc = editing ? Number(editing.discount || 0) : Math.max(0, Math.round(Number(f.discount) || 0));
  const net = Math.max(0, tot.charge - disc);
  const partAmt = Math.round(Number(f.part) || 0);
  const account = activeAccounts.find((a) => a.id === f.account_id);
  const preview: Partial<Shipment> = editing ? {
    ...editing, s_name: f.s_name, s_phone: f.s_phone, r_name: f.r_name, r_phone: f.r_phone, notes: f.notes, origin: f.origin, dest: f.dest,
    ...tot, items, gross_charge: tot.charge, charge: net,
  } : {
    ...f, ...tot, items, gross_charge: tot.charge, charge: net, discount: disc, account_id: f.account_id || null, ...(found ? { origin: trip!.origin, dest: trip!.dest } : {}),
    no: `${f.origin}-${f.dest}-…`, method: f.pay === "paid" || f.pay === "part" ? f.method : null, created_by_name: me.full_name,
    pay: f.pay === "part" ? "unpaid" : f.pay, paid_amount: f.pay === "part" ? partAmt : 0,
  };

  /** Save corrections to a consignment that was already saved, and keep a record of what changed. */
  async function saveEdit(old: Shipment) {
    const next: Partial<Shipment> = {
      s_name: f.s_name.trim(), s_phone: f.s_phone.trim(), r_name: f.r_name.trim(), r_phone: f.r_phone.trim(),
      notes: f.notes.trim(), ...(routeLocked ? {} : { origin: f.origin, dest: f.dest }),
      ...tot, items, gross_charge: tot.charge, charge: net,
    };
    const changes: Record<string, [string, string]> = {};
    for (const k of Object.keys(FIELD_LABEL) as (keyof Shipment)[]) {
      if (!(k in next)) continue;
      const a = showVal(k, old[k]), b = showVal(k, next[k]);
      if (a !== b) changes[FIELD_LABEL[k]] = [a, b];
    }
    const itemsChanged = JSON.stringify(old.items || []) !== JSON.stringify(items);
    if (!Object.keys(changes).length && !itemsChanged) { toast("Nothing changed."); return; }
    if (!Object.keys(changes).length) changes["Goods details"] = ["", "updated"];
    const now = new Date().toISOString();
    // Edit history needs migration 0021; without it the correction is still saved.
    const tracked = "edit_log" in old;
    const entry: EditEntry = { at: now, by: me.full_name, changes };
    setBusy(true);
    const ok = await patch<Shipment>("shipments", old.id, {
      ...next, ...(tracked ? { edited_at: now, edited_by: me.full_name, edit_log: [...(old.edit_log || []), entry] } : {}),
    });
    setBusy(false);
    if (!ok) return;
    ui.editShip(null);
    ui.go("list");
    ui.openShip(old.id);
    const priced = !(Number(old.charge) > 0) && net > 0;
    toast(`Saved changes to ${old.no}.${priced ? " The charge is now set." : ""} Reprint the receipt if the customer needs a new one.`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const miss: string[] = [];
    // Names are optional (they can be added later by editing); phones are needed for notices.
    const hadSenderPhone = !editing || !!editing.s_phone;
    if ((!found && hadSenderPhone || f.s_phone.trim()) && !validPhone(f.s_phone)) miss.push("a valid sender phone (e.g. 0712 345 678)");
    if (!validPhone(f.r_phone)) miss.push("a valid receiver phone");
    if (items.some((i) => !i.name)) miss.push(items.length > 1 ? "a name for every item" : "item name");
    if (items.some((i) => i.pkgs < 1)) miss.push(cfg.air ? "at least 1 piece for every item" : "at least 1 package for every item");
    if (cfg.air && items.some((i) => !Number(i.kg) && !Number(i.vol))) miss.push("the weight (or the size) of every item");
    if (!found && f.origin === f.dest) miss.push("a destination different from the origin");
    if (ui.editId && !editing) return setErr("That consignment couldn't be found. Close this page and open the consignment again.");
    if (editing) {
      if (miss.length) return setErr("Please add " + miss.join(", ") + ".");
      if (disc > tot.charge) return setErr(`The charge can't be less than the discount already given (TZS ${tzs(disc)}). Change the discount on the consignment first.`);
      if (editing.pay === "paid" && net !== Number(editing.charge)) return setErr(`This consignment is paid in full (TZS ${tzs(editing.charge)}), so its charge can't change. The Admin must undo the payment first.`);
      if (isPart(editing) && net < Number(editing.paid_amount || 0)) return setErr(`TZS ${tzs(editing.paid_amount || 0)} has already been paid; the charge can't be less than that.`);
      return saveEdit(editing);
    }
    if (!(net > 0) && f.pay !== "unpaid") miss.push("the charge (or choose \"Not paid\" to add the price later)");
    if (f.pay === "bill" && !account) miss.push("the bill customer (account)");
    if (f.pay === "part" && !(partAmt > 0 && partAmt < net)) miss.push(`the amount paid now (more than 0 and less than TZS ${tzs(net)})`);
    if (disc > tot.charge) miss.push("a discount no bigger than the charge");
    if (disc > 0 && !f.discount_reason.trim()) miss.push("the reason for the discount");
    if (miss.length) return setErr("Please add " + miss.join(", ") + ".");
    setErr(""); setBusy(true);
    const now = new Date().toISOString();
    const row: Partial<Shipment> = {
      s_name: f.s_name.trim(), s_phone: f.s_phone.trim(), r_name: f.r_name.trim(), r_phone: f.r_phone.trim(),
      ...tot, items, origin: f.origin, dest: f.dest, pay: f.pay === "part" ? "unpaid" : f.pay, method: f.pay === "paid" || f.pay === "part" ? f.method : null,
      paid_at: f.pay === "paid" ? now : null, paid_by: f.pay === "paid" || f.pay === "part" ? me.full_name : null,
      ...(f.pay === "part" ? { paid_amount: partAmt } : {}),
      notes: f.notes.trim(), status: "received", received_at: now, notices: [], created_by: me.id, created_by_name: me.full_name,
      ...(f.pay === "bill" ? { account_id: f.account_id } : {}),
      // The database also works these out from the item lines and the discount.
      ...(disc > 0 ? { discount: disc, discount_reason: f.discount_reason.trim(), discount_by: me.full_name, discount_at: now, gross_charge: tot.charge, charge: net } : {}),
    };
    if (found) Object.assign(row, {
      // They travelled on this truck; the database also enforces this.
      trip_id: trip!.id, origin: trip!.origin, dest: trip!.dest, status: "arrived", found_on_arrival: true, found_note: foundNote.trim(),
      loaded_at: trip!.departed_at || now, transit_at: trip!.departed_at || now, arrived_at: trip!.arrived_at || now,
      ...(me.role === "admin" ? { checked_by: me.full_name, checked_at: now } : {}),
    });
    const origin = row.origin!, dest = row.dest!;
    let saved: Shipment | null = null;
    for (let i = 0; i < 3 && !saved; i++) {
      saved = await insert<Shipment>("shipments", { ...row, no: `${origin}-${dest}-${ymd()}-${Math.floor(Math.random() * 9000) + 1000}` });
    }
    setBusy(false);
    if (!saved) return;
    // Keep a record of the money taken now (full or part), for the payment history and reports.
    if (f.pay === "paid") await logPayment(saved, Number(saved.charge), f.method);
    else if (f.pay === "part") await logPayment(saved, partAmt, f.method);
    setF(blank(home, firstDest));
    setLines([blankLine(defRate)]);
    setFoundNote("");
    if (found) ui.recordFound(null);
    ui.go("list");
    ui.openShip(saved.id);
    // Receipt for the sender and a sticker for every package, on this device's printer.
    if (printerPrefs().auto) {
      try {
        const msg = await printSlips("receipt", saved, company, { account: activeAccounts.find((a) => a.id === saved!.account_id)?.name });
        toast(`Saved ${saved.no}${found ? ` as found on ${trip!.plate}` : ""}. ${msg}`);
      } catch (e) {
        const m = (e as Error).message;
        toast(`Saved ${saved.no}, but it didn't print${m === "NEEDS_PAIRING" ? ": choose the printer under Printer settings below." : m ? `: ${m}` : "."} Use the print buttons below.`, true);
      }
    } else toast(Number(saved.charge) > 0
      ? `Saved ${saved.no}. Print the receipt and send the notices below.`
      : `Saved ${saved.no} without a charge. Use "Add the charge" before the goods are released.`);
  }

  return (
    <section>
      <div className="sectionhead"><h1>{editing ? <>Edit <span className="mono">{editing.no}</span></> : found ? "Record found goods" : "Receive goods"}</h1><span className="sub">{editing ? "Correct the saved details. Every change is recorded with your name." : found ? `Goods that came off the ${W.vehicle} but were never recorded at loading.` : "Record the consignment, then hand the sender the receipt. Names and the charge can be added later."}</span></div>
      {editing && (
        <div className="notice" role="status" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>Editing a saved consignment{routeLocked ? ". The route can't change because the goods are already loaded" : ""}. Payments and discounts are changed on the consignment itself.</span>
          <button className="btn sm" type="button" onClick={() => { ui.editShip(null); ui.go("list"); ui.openShip(editing.id); }}>Cancel</button>
        </div>
      )}
      {ui.editId && !editing && <div className="notice warn" role="status">That consignment is no longer available.</div>}
      <div style={{ margin: "-6px 0 12px" }}><PrinterLine /></div>
      {!found && !editing && canRecordFound(me.role, company) && (
        <div className="notice" role="note" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>Goods came off an arrived {W.vehicle} but are not on its manifest? Record them here with the proper charge and a receipt.</span>
          <FoundPicker />
        </div>
      )}
      {found && (
        <div className="notice warn" role="status">
          <span><b>Found on {trip!.plate}</b> · trip {trip!.no} · {regShort(trip!.origin)} → {regShort(trip!.dest)}, arrived {fmtDate(trip!.arrived_at)}. Enter the receiver and the proper charge.{me.role !== "admin" && " The Admin will check this record."}</span>
          <button className="btn sm" type="button" onClick={() => ui.recordFound(null)}>Cancel</button>
        </div>
      )}
      <form className="formgrid" noValidate onSubmit={submit}>
        <div>
          <fieldset><legend>{found ? "Sender (if known)" : "Sender (brought the goods)"}</legend>
            <div className="fields">
              <label className="f">Phone number<input value={f.s_phone} onChange={(e) => onPhone("s_phone", e.target.value)} inputMode="tel" placeholder="0712 345 678" /></label>
              <label className="f">Customer name <small>optional</small><input value={f.s_name} onChange={(e) => set("s_name", e.target.value)} autoComplete="off" /></label>
            </div>
            {sKnown && <div className="hint">✓ Known customer: {sKnown.name}{sKnown.n ? ` · ${sKnown.n} previous consignment${sKnown.n === 1 ? "" : "s"}` : ""}</div>}
          </fieldset>
          <fieldset><legend>Receiver at destination</legend>
            <div className="fields">
              <label className="f">Phone number<input value={f.r_phone} onChange={(e) => onPhone("r_phone", e.target.value)} inputMode="tel" placeholder="0754 000 111" /></label>
              <label className="f">Receiver name <small>optional</small><input value={f.r_name} onChange={(e) => set("r_name", e.target.value)} autoComplete="off" /></label>
            </div>
            {rKnown && <div className="hint">✓ Known customer: {rKnown.name}{rKnown.n ? ` · ${rKnown.n} previous consignment${rKnown.n === 1 ? "" : "s"}` : ""}</div>}
          </fieldset>
          {found ? (
            <fieldset><legend>How were they found?</legend>
              <label className="f full">Note <small>optional</small><textarea rows={2} value={foundNote} onChange={(e) => setFoundNote(e.target.value)} placeholder="e.g. 2 extra bales at the back of the truck, no waybill; driver says loaded at Ubungo" aria-label="How the goods were found" /></label>
            </fieldset>
          ) : (
          <fieldset><legend>Route</legend>
            <div className="fields">
              <label className="f">From{station && !editing && <small>your office</small>}<select value={f.origin} disabled={!!station || routeLocked} onChange={(e) => set("origin", e.target.value)}><RegionOptions offices={officesOf(company)} /></select></label>
              <label className="f">To<select value={f.dest} disabled={routeLocked} onChange={(e) => set("dest", e.target.value)}><RegionOptions offices={officesOf(company)} /></select></label>
            </div>
          </fieldset>
          )}
          <fieldset><legend>Goods and charges</legend>
            <p className="sub" style={{ margin: "0 0 10px" }}>{cfg.air
              ? <>One line per kind of goods. Enter the pieces, the total actual weight and the size of one piece: the chargeable weight is the higher of actual and volume weight (L × W × H ÷ {cfg.div}), to the next half kg.</>
              : "One line per kind of goods. Price/pkg, Charge and Kg are optional — enter a price per package and the charge is worked out for you, or leave the charge empty to add it later."}</p>
            <div className="ilines">
              {lines.map((l, i) => cfg.air ? (
                <div className="iline air" key={i}>
                  <span className="inum" aria-hidden="true">{i + 1}</span>
                  <label className="f iname">Item<input value={l.name} onChange={(e) => setLine(i, "name", e.target.value)} placeholder={i === 0 ? "e.g. Phone accessories" : "e.g. Garments"} aria-label={`Item ${i + 1} name`} /></label>
                  <label className="f">Pieces<input type="number" min={1} step={1} value={l.pkgs} onChange={(e) => setLine(i, "pkgs", e.target.value)} aria-label={`Item ${i + 1} packages`} /></label>
                  <label className="f">Actual kg <small>all pieces</small><input type="number" min={0} step={0.1} value={l.kg} onChange={(e) => setLine(i, "kg", e.target.value)} aria-label={`Item ${i + 1} weight`} /></label>
                  {lines.length > 1
                    ? <button type="button" className="btn sm iremove" onClick={() => setLines((L) => L.filter((_, j) => j !== i))} aria-label={`Remove item ${i + 1}`} title="Remove this item">✕</button>
                    : <span />}
                  <div className="airrow">
                    <label className="f w2">L cm<input type="number" min={0} value={l.l} onChange={(e) => setLine(i, "l", e.target.value)} aria-label={`Item ${i + 1} length`} /></label>
                    <label className="f w2">W cm<input type="number" min={0} value={l.w} onChange={(e) => setLine(i, "w", e.target.value)} aria-label={`Item ${i + 1} width`} /></label>
                    <label className="f w2">H cm<input type="number" min={0} value={l.h} onChange={(e) => setLine(i, "h", e.target.value)} aria-label={`Item ${i + 1} height`} /></label>
                    <label className="f w3">Volume kg<input value={kgFmt(airWeights(l, cfg.div).vol)} readOnly tabIndex={-1} aria-label={`Item ${i + 1} volume weight`} /></label>
                    <label className="f w3">Chargeable kg<input value={kgFmt(airWeights(l, cfg.div).cw)} readOnly tabIndex={-1} aria-label={`Item ${i + 1} chargeable weight`} /></label>
                    <label className="f w5">Price per kg (TZS)<input type="number" min={0} step={0.5} value={l.rate} onChange={(e) => setLine(i, "rate", e.target.value)} aria-label={`Item ${i + 1} price per kg`} /></label>
                    <label className="f w7">Charge (TZS)
                      {l.rate !== ""
                        ? <input value={tzs(lineCharge(l, cfg))} readOnly tabIndex={-1} aria-label={`Item ${i + 1} charge`} title="Chargeable kg × price per kg" />
                        : <input type="number" min={0} step={500} value={l.charge} onChange={(e) => setLine(i, "charge", e.target.value)} aria-label={`Item ${i + 1} charge`} />}
                    </label>
                  </div>
                </div>
              ) : (
                <div className="iline" key={i}>
                  <span className="inum" aria-hidden="true">{i + 1}</span>
                  <label className="f iname">Item<input value={l.name} onChange={(e) => setLine(i, "name", e.target.value)} placeholder={i === 0 ? "e.g. Cartons of cooking oil" : "e.g. Mattresses"} aria-label={`Item ${i + 1} name`} /></label>
                  <label className="f">Packages<input type="number" min={1} step={1} value={l.pkgs} onChange={(e) => setLine(i, "pkgs", e.target.value)} aria-label={`Item ${i + 1} packages`} /></label>
                  <label className="f">Price/pkg<input type="number" min={0} step={500} value={l.unit} onChange={(e) => setLine(i, "unit", e.target.value)} aria-label={`Item ${i + 1} price per package`} /></label>
                  <label className="f">Charge (TZS)
                    {l.unit !== ""
                      ? <input value={tzs(lineCharge(l, cfg))} readOnly tabIndex={-1} aria-label={`Item ${i + 1} charge`} title="Price per package × packages" />
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
              <button type="button" className="btn sm" onClick={() => setLines((L) => [...L, blankLine(defRate)])}>+ Add another item</button>
              <span><b>{items.length}</b> item{items.length === 1 ? "" : "s"} · <b>{tot.pkgs}</b> {cfg.air ? "piece" : "package"}{tot.pkgs === 1 ? "" : "s"}{cfg.air ? <> · <b>{kgFmt(items.reduce((a, x) => a + Number(x.cw || 0), 0))}</b> kg chargeable</> : null} · Total <b className="mono">TZS {tzs(tot.charge)}</b></span>
            </div>
          </fieldset>
          {editing ? (
          <fieldset><legend>Charge and notes</legend>
            <div className="fields">
              <div className="f" style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 13, fontWeight: 500 }}>{disc > 0 ? "Total to pay" : "Total charge"}
                <div className="mono" style={{ fontSize: 20, fontWeight: 600, padding: "6px 0" }}>TZS {tzs(net)}</div>
                {disc > 0 && <div className="sub">TZS {tzs(tot.charge)} − discount {tzs(disc)}</div>}
                {net !== Number(editing.charge) && <div className="sub">was TZS {tzs(editing.charge)}</div>}</div>
              <div className="f sub" style={{ alignSelf: "center" }}>{editing.pay === "paid" ? "Paid in full, so the charge can't change." : editing.pay === "bill" ? "On the monthly bill; the bill updates with the new charge." : isPart(editing) ? `TZS ${tzs(editing.paid_amount || 0)} paid so far.` : "Not paid yet."}</div>
              <label className="f full">Notes <small>optional</small><textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Fragile, keep upright…" /></label>
            </div>
          </fieldset>
          ) : (
          <fieldset><legend>Payment</legend>
            <div className="fields">
              <div className="f" style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 13, fontWeight: 500 }}>{disc > 0 ? "Total to pay" : "Total charge"}
                <div className="mono" style={{ fontSize: 20, fontWeight: 600, padding: "6px 0" }}>TZS {tzs(net)}</div>
                {disc > 0 && <div className="sub">TZS {tzs(tot.charge)} − discount {tzs(disc)}</div>}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 13, fontWeight: 500 }}>Status
                <div className="seg">
                  <label><input type="radio" name="pay" checked={f.pay === "paid"} onChange={() => set("pay", "paid")} /><span>Paid</span></label>
                  {hasPart && <label><input type="radio" name="pay" checked={f.pay === "part"} onChange={() => set("pay", "part")} /><span>Part paid</span></label>}
                  <label><input type="radio" name="pay" checked={f.pay === "unpaid"} onChange={() => set("pay", "unpaid")} /><span>Not paid</span></label>
                  {hasExtras && can("bill") && <label><input type="radio" name="pay" checked={f.pay === "bill"} onChange={() => set("pay", "bill")} /><span>Monthly bill</span></label>}
                </div>
              </div>
              {f.pay === "bill" && (activeAccounts.length
                ? <label className="f">Bill customer<select value={f.account_id} onChange={(e) => set("account_id", e.target.value)} aria-label="Bill customer"><option value="">Choose…</option>{activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
                : <div className="f sub">No bill customers yet. {can("accounts") ? <a href="#" onClick={(e) => { e.preventDefault(); ui.go("bills"); }}>Open a bill account</a> : "Ask the Admin to open one."}</div>)}
              {hasExtras && <label className="f">Discount (TZS) <small>optional</small><input type="number" min={0} step={500} value={f.discount} onChange={(e) => set("discount", e.target.value)} aria-label="Discount" /></label>}
              {hasExtras && disc > 0 && <label className="f">Reason for discount<input value={f.discount_reason} onChange={(e) => set("discount_reason", e.target.value)} placeholder="e.g. Regular customer" aria-label="Discount reason" /></label>}
              {f.pay === "part" && <label className="f">Paid now (TZS)<input type="number" min={0} step={500} value={f.part} onChange={(e) => set("part", e.target.value)} aria-label="Amount paid now" /></label>}
              {f.pay === "part" && partAmt > 0 && <div className="f sub" style={{ alignSelf: "end" }}>Balance TZS <b>{tzs(Math.max(0, net - partAmt))}</b> to pay at collection</div>}
              {(f.pay === "paid" || f.pay === "part") && <label className="f">Payment method<select value={f.method} onChange={(e) => set("method", e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>}
              <label className="f full">Notes <small>optional</small><textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Fragile, keep upright…" /></label>
            </div>
          </fieldset>
          )}
          <div className="err" role="alert">{err}</div>
          <div className="actions">
            {ui.editId ? <>
              <button className="btn primary" type="submit" disabled={busy || !editing}>{busy ? "Saving…" : "Save changes"}</button>
              <button className="btn" type="button" onClick={() => { const id = ui.editId; ui.editShip(null); ui.go("list"); if (id) ui.openShip(id); }}>Cancel</button>
            </> : <>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : found ? "Save found goods & issue receipt" : "Save & issue receipt"}</button>
            <button className="btn" type="button" onClick={() => { setF(blank(home, firstDest)); setLines([blankLine(defRate)]); setErr(""); }}>Clear</button>
            </>}
          </div>
        </div>
        <aside className="preview"><div className="lbl" style={{ marginBottom: 8 }}>Receipt preview</div><Slip s={preview} company={company} account={account?.name} /></aside>
      </form>
    </section>
  );
}
