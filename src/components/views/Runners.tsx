"use client";
// Delivery people: casual workers who take arrived goods (with their receipts) to customers and come
// back with the money. Staff hand goods out to a person, then settle when they return: each consignment
// is either delivered (the balance is received and the goods are released) or returned to the office.
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { useUi } from "../CargoApp";
import { METHODS, balanceOf, fmtDate, goodsLabel, isOut, prettyPhone, tzs, type Company, type Shipment } from "@/lib/domain";

const dnNumber = () => {
  const t = new Date();
  return `DN-${String(t.getFullYear()).slice(2)}${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}-${Math.floor(Math.random() * 90000) + 10000}`;
};

/** A4 handover sheet: what the delivery person took, what to collect from each customer, and signatures. */
export async function downloadHandover(name: string, phone: string, list: Shipment[], company: Company, by: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = 14, R = 196;
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text((company.name || "Shehena").toUpperCase(), L, 18);
  doc.setFontSize(11); doc.text("DELIVERY HANDOVER SHEET", R, 18, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`Delivery person: ${name}${phone ? "  ·  " + prettyPhone(phone) : ""}`, L, 27);
  doc.text(`Handed out ${fmtDate(list[0]?.runner_out_at || new Date().toISOString())} by ${by}`, L, 33);
  let y = 44;
  const cols: [string, number, "left" | "right"][] = [["#", L, "left"], ["Waybill", L + 7, "left"], ["Receiver", L + 45, "left"], ["Phone", L + 92, "left"], ["Goods", L + 120, "left"], ["Pkgs", L + 160, "right"], ["To collect", R, "right"]];
  doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  cols.forEach(([h, x, a]) => doc.text(h, x, y, { align: a }));
  y += 2; doc.line(L, y, R, y); y += 5; doc.setFont("helvetica", "normal");
  const cut = (t: string, w: number) => { const s = doc.splitTextToSize(t || "-", w); return s.length > 1 ? s[0].replace(/.$/, "…") : s[0]; };
  list.forEach((s, i) => {
    if (y > 270) { doc.addPage(); y = 20; }
    const owe = balanceOf(s);
    const v = [String(i + 1), s.no, cut(s.r_name, 44), prettyPhone(s.r_phone), cut(goodsLabel(s), 36), String(s.pkgs), owe ? `TZS ${tzs(owe)}` : "Paid"];
    cols.forEach(([, x, a], j) => doc.text(v[j], x, y, { align: a }));
    y += 7;
  });
  doc.line(L, y - 3, R, y - 3); y += 3;
  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(`${list.length} consignments  ·  ${list.reduce((a, s) => a + Number(s.pkgs || 0), 0)} packages`, L, y);
  doc.text(`Money to hand in: TZS ${tzs(list.reduce((a, s) => a + balanceOf(s), 0))}`, R, y, { align: "right" });
  y += 22; doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  doc.line(L, y, L + 70, y); doc.line(R - 70, y, R, y); y += 5;
  doc.text("Handed out by (sign)", L, y); doc.text(`${name} (sign)`, R - 70, y);
  y += 10; doc.setFontSize(8.5); doc.setTextColor(110);
  doc.text("Bring back the money for every delivered consignment and any goods not delivered.", L, y);
  doc.save(`Handover-${name.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

/** Names (and phones) of delivery people used before, for suggestions. */
function useKnownRunners() {
  const { shipments } = useStore();
  return useMemo(() => {
    const m = new Map<string, string>();
    shipments.forEach((s) => { if (s.runner_name) m.set(s.runner_name, s.runner_phone || m.get(s.runner_name) || ""); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shipments]);
}

/**
 * On one consignment (found by searching its receipt/waybill number or the receiver): give it to a
 * delivery person and print its receipt for them to carry.
 */
export function GiveToRunner({ s, compact = false }: { s: Shipment; compact?: boolean }) {
  const { patch, me, toast, company, can, hasRunners, accounts } = useStore();
  const known = useKnownRunners();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  if (!hasRunners || !can("pay") || s.status !== "arrived" || isOut(s)) return null;
  if (!open) return <button className="btn sm" type="button" onClick={() => setOpen(true)}>Give to delivery person</button>;

  async function give(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast("Enter the delivery person's name.", true);
    setBusy(true);
    const values = { runner_name: name.trim(), runner_phone: phone.trim(), runner_out_at: new Date().toISOString(), runner_by: me.full_name, runner_settled_at: null, runner_amount: 0 };
    const ok = await patch<Shipment>("shipments", s.id, values);
    if (ok) {
      let msg = "";
      try { const { printSlips } = await import("../printer"); msg = await printSlips("receipt", { ...s, ...values }, company, { account: accounts.find((x) => x.id === s.account_id)?.name }); } catch { msg = "Print the receipt from the consignment."; }
      toast(`${s.no} given to ${name.trim()}${balanceOf(s) ? `, to collect TZS ${tzs(balanceOf(s))}` : ""}. ${msg}`);
      setOpen(false); setName(""); setPhone("");
    }
    setBusy(false);
  }

  return (
    <form className="runner-give" noValidate onSubmit={give} style={compact ? { flexBasis: "100%" } : undefined}>
      <input value={name} list="runner-names" autoFocus onChange={(e) => { setName(e.target.value); const k = known.find(([n]) => n.toLowerCase() === e.target.value.trim().toLowerCase()); if (k && !phone) setPhone(k[1]); }} placeholder="Delivery person's name" aria-label="Delivery person name" />
      <datalist id="runner-names">{known.map(([n]) => <option key={n} value={n} />)}</datalist>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Phone (optional)" aria-label="Delivery person phone" />
      <button className="btn sm primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Give & print receipt"}</button>
      <button className="btn sm" type="button" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

/** One delivery person with goods out: settle the delivered ones, take back the rest. */
function RunnerCard({ name, list }: { name: string; list: Shipment[] }) {
  const { patch, takePayment, me, toast, company, can } = useStore();
  const ui = useUi();
  // Everything is ticked unless staff untick it (goods added later are ticked too).
  const [skip, setSkip] = useState<string[]>([]);
  const [method, setMethod] = useState(METHODS[0]);
  const [busy, setBusy] = useState(false);
  const sel = list.filter((s) => !skip.includes(s.id));
  const owe = list.reduce((a, s) => a + balanceOf(s), 0);
  const now = sel.reduce((a, s) => a + balanceOf(s), 0);
  const phone = list.find((s) => s.runner_phone)?.runner_phone || "";
  const since = list.map((s) => s.runner_out_at || "").sort()[0];

  async function delivered() {
    if (!sel.length) return toast("Tick the goods that were delivered.", true);
    setBusy(true);
    let done = 0, money = 0;
    for (const s of sel) {
      const at = new Date().toISOString(), bal = balanceOf(s);
      const release: Partial<Shipment> = {
        status: "collected", collected_at: at, collected_by: me.full_name, dn_no: dnNumber(),
        collector_name: s.r_name, collector_phone: s.r_phone, collect_note: `Delivered by ${name}`,
        runner_settled_at: at, runner_amount: bal,
      };
      const ok = bal > 0 ? await takePayment(s, bal, method, release) : await patch<Shipment>("shipments", s.id, release);
      if (ok) { done++; money += bal; }
    }
    setBusy(false);
    if (done) toast(`${done} delivered by ${name}. TZS ${tzs(money)} received${money ? ` (${method})` : ""}.`);
  }
  async function returned(s: Shipment) {
    if (await patch<Shipment>("shipments", s.id, { runner_name: "", runner_phone: "", runner_out_at: null, runner_by: null })) toast(`${s.no} is back at the office.`);
  }

  return (
    <div className="panel runner">
      <div className="ph">
        <div><h2>{name}</h2><div className="sub">{phone ? <span className="mono">{prettyPhone(phone)} · </span> : null}out since {fmtDate(since)} · {list.length} consignment{list.length === 1 ? "" : "s"}</div></div>
        <div className="r"><div className="lbl">Money to hand in</div><b className="num" style={{ fontSize: 18, color: owe ? "var(--bad)" : "var(--ok)" }}>TZS {tzs(owe)}</b></div>
      </div>
      {list.map((s) => (
        <div className="rrow" key={s.id}>
          {can("pay") && <input type="checkbox" checked={!skip.includes(s.id)} onChange={(e) => setSkip((t) => e.target.checked ? t.filter((x) => x !== s.id) : [...t, s.id])} aria-label={`Delivered ${s.no}`} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <button className="link" style={{ color: "var(--fg)" }} onClick={() => ui.openShip(s.id)}><b>{s.r_name}</b></button> <span className="sub mono">{prettyPhone(s.r_phone)}</span>
            <div className="sub"><span className="mono">{s.no}</span> · {goodsLabel(s)} · {s.pkgs} pkg</div>
          </div>
          <span className="num" style={{ whiteSpace: "nowrap" }}>{balanceOf(s) ? `TZS ${tzs(balanceOf(s))}` : "Paid"}</span>
          {can("pay") && <button className="btn sm" onClick={() => returned(s)} title="Not delivered: the goods came back to the office">Returned</button>}
        </div>
      ))}
      {can("pay") && (
        <div className="actions" style={{ alignItems: "center" }}>
          <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: "auto" }} aria-label={`Money from ${name} paid by`}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
          <button className="btn primary" disabled={busy || !sel.length} onClick={delivered}>{busy ? "Saving…" : `Delivered: received TZS ${tzs(now)} for ${sel.length}`}</button>
          <button className="btn" onClick={() => downloadHandover(name, phone, list, company, list[0]?.runner_by || me.full_name)}>Handover sheet (PDF)</button>
        </div>
      )}
      {can("pay") && <p className="note">Tick the goods that reached the customer and whose money was handed in, then press Delivered. They are marked paid and released with a delivery note. Goods that came back: press Returned.</p>}
    </div>
  );
}

/** Arrivals section: delivery people with goods out, waiting to hand in their money. */
export function DeliveryPeople() {
  const { shipments, hasRunners, me } = useStore();
  if (!hasRunners) return null;
  const out = shipments.filter((s) => isOut(s) && (!me.station || s.dest === me.station));
  const groups = new Map<string, Shipment[]>();
  out.forEach((s) => groups.set(s.runner_name!, [...(groups.get(s.runner_name!) || []), s]));
  const total = out.reduce((a, s) => a + balanceOf(s), 0);
  return (
    <>
      <div className="group-h" style={{ marginTop: 26 }}>
        <h2>Delivery people</h2>
        <span className="sub">{groups.size ? `${groups.size} out · TZS ${tzs(total)} to hand in` : "none out"}</span>
      </div>
      {[...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([n, L]) => <RunnerCard key={n} name={n} list={L} />)}
      {!groups.size && <p className="quiet">To send goods with a delivery person, find the consignment below (search the receipt number or the customer) and press <b>Give to delivery person</b>. The receipt prints for them to carry.</p>}
    </>
  );
}
