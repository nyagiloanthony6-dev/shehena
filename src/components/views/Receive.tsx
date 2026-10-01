"use client";
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { useUi } from "../CargoApp";
import { Slip } from "../parts";
import { METHODS, REGIONS, intlPhone, validPhone, ymd, type Shipment } from "@/lib/domain";

const blank = (origin: string) => ({
  s_phone: "", s_name: "", r_phone: "", r_name: "", item: "", pkgs: "1", kg: "",
  origin, dest: origin === "DOD" ? "DAR" : "DOD", charge: "", pay: "unpaid" as "paid" | "unpaid", method: METHODS[0], notes: "",
});

export default function Receive() {
  const { company, shipments, me, insert, toast } = useStore();
  const ui = useUi();
  const [f, setF] = useState(() => blank(company.default_origin || "DAR"));
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
    ...f, pkgs: parseInt(f.pkgs, 10) || 0, kg: f.kg ? Number(f.kg) : null, charge: Number(f.charge) || 0,
    no: `${f.origin}-${f.dest}-…`, method: f.pay === "paid" ? f.method : null, created_by_name: me.full_name,
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const miss: string[] = [];
    if (!f.s_name.trim()) miss.push("sender name");
    if (!validPhone(f.s_phone)) miss.push("a valid sender phone (e.g. 0712 345 678)");
    if (!f.r_name.trim()) miss.push("receiver name");
    if (!validPhone(f.r_phone)) miss.push("a valid receiver phone");
    if (!f.item.trim()) miss.push("item name");
    if ((parseInt(f.pkgs, 10) || 0) < 1) miss.push("number of packages");
    if (f.origin === f.dest) miss.push("a destination different from the origin");
    if (miss.length) return setErr("Please add " + miss.join(", ") + ".");
    setErr(""); setBusy(true);
    const now = new Date().toISOString();
    const row: Partial<Shipment> = {
      s_name: f.s_name.trim(), s_phone: f.s_phone.trim(), r_name: f.r_name.trim(), r_phone: f.r_phone.trim(),
      item: f.item.trim(), pkgs: parseInt(f.pkgs, 10), kg: f.kg ? Number(f.kg) : null, origin: f.origin, dest: f.dest,
      charge: Number(f.charge) || 0, pay: f.pay, method: f.pay === "paid" ? f.method : null,
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
    ui.go("list");
    ui.openShip(saved.id);
    toast(`Saved ${saved.no}. Send the notices below.`);
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
          <fieldset><legend>Goods</legend>
            <div className="fields">
              <label className="f full">Item name / description<input value={f.item} onChange={(e) => set("item", e.target.value)} placeholder="e.g. Cartons of cooking oil" /></label>
              <label className="f">Number of packages<input type="number" min={1} step={1} value={f.pkgs} onChange={(e) => set("pkgs", e.target.value)} /></label>
              <label className="f">Weight (kg) <small>optional</small><input type="number" min={0} step={0.1} value={f.kg} onChange={(e) => set("kg", e.target.value)} /></label>
              <label className="f">From<select value={f.origin} onChange={(e) => set("origin", e.target.value)}>{REGIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
              <label className="f">To<select value={f.dest} onChange={(e) => set("dest", e.target.value)}>{REGIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
            </div>
          </fieldset>
          <fieldset><legend>Payment</legend>
            <div className="fields">
              <label className="f">Charge (TZS)<input type="number" min={0} step={500} value={f.charge} onChange={(e) => set("charge", e.target.value)} /></label>
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
            <button className="btn" type="button" onClick={() => { setF(blank(company.default_origin || "DAR")); setErr(""); }}>Clear</button>
          </div>
        </div>
        <aside className="preview"><div className="lbl" style={{ marginBottom: 8 }}>Receipt preview</div><Slip s={preview} company={company} /></aside>
      </form>
    </section>
  );
}
