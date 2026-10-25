"use client";
// Releasing goods at the destination: who collected them, payment if still owed, and the delivery note.
import { useState } from "react";
import { useStore } from "./store";
import { METHODS, PAY_LABEL, fmtDate, itemsOf, prettyPhone, regName, tzs, type Company, type Shipment, type Trip } from "@/lib/domain";

export const ID_TYPES = ["NIDA", "Driving licence", "Voter ID", "Passport", "Work ID", "Other"];

const dnNumber = () => {
  const t = new Date();
  return `DN-${String(t.getFullYear()).slice(2)}${String(t.getMonth() + 1).padStart(2, "0")}${String(t.getDate()).padStart(2, "0")}-${Math.floor(Math.random() * 90000) + 10000}`;
};

/**
 * Release form: who is collecting (the receiver or someone sent by them), their ID, remarks,
 * and the payment when goods are still unpaid. Saves, then downloads the delivery note.
 */
export function ReleaseForm({ s, onDone }: { s: Shipment; onDone: () => void }) {
  const { patch, me, toast, company, tripById, hasV9, can } = useStore();
  const [f, setF] = useState({ name: s.r_name, phone: s.r_phone, idType: ID_TYPES[0], idNo: "", note: "", method: METHODS[0] });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const unpaid = s.pay === "unpaid";
  if (unpaid && !can("pay")) return <p className="note">This consignment is unpaid. Only staff who take payments can release it.</p>;

  async function release(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return toast("Enter the name of the person collecting.", true);
    if (!f.idNo.trim()) return toast("Enter their ID number (as on the ID shown).", true);
    setBusy(true);
    const at = new Date().toISOString();
    const dn = dnNumber();
    const details = { collector_name: f.name.trim(), collector_phone: f.phone.trim(), collector_id: `${f.idType} ${f.idNo.trim()}`, collect_note: f.note.trim() };
    const values: Partial<Shipment> = {
      status: "collected", collected_at: at, collected_by: me.full_name,
      ...(unpaid ? { pay: "paid" as const, method: f.method, paid_at: at, paid_by: me.full_name } : {}),
      // Before update 0009 is run these columns don't exist yet; the note is still printed.
      ...(hasV9 ? { dn_no: dn, ...details } : {}),
    };
    const ok = await patch<Shipment>("shipments", s.id, values);
    setBusy(false);
    if (!ok) return;
    toast(`${unpaid ? `TZS ${tzs(s.charge)} received. ` : ""}Released to ${details.collector_name}. Delivery note ${dn} downloading.`);
    try { await downloadDeliveryNote({ ...s, ...values, dn_no: dn, ...details }, company, tripById(s.trip_id)); } catch { toast("Released, but the delivery note couldn't be made. Download it from the consignment.", true); }
    onDone();
  }

  return (
    <form className="paybox release" noValidate onSubmit={release}>
      <div className="lbl" style={{ marginBottom: 8 }}>Release to the customer · delivery note</div>
      <div className="fields">
        <label className="f">Collected by<input value={f.name} onChange={(e) => set("name", e.target.value)} aria-label="Collected by" /></label>
        <label className="f">Their phone<input value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" aria-label="Collector phone" /></label>
        <label className="f">ID type<select value={f.idType} onChange={(e) => set("idType", e.target.value)} aria-label="ID type">{ID_TYPES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="f">ID number<input value={f.idNo} onChange={(e) => set("idNo", e.target.value)} aria-label="ID number" /></label>
        <label className="f full">Remarks <small>optional: condition of goods, packages short…</small><input value={f.note} onChange={(e) => set("note", e.target.value)} placeholder={`All ${s.pkgs} package${s.pkgs === 1 ? "" : "s"} received in good condition`} aria-label="Release remarks" /></label>
        {unpaid && <label className="f">Payment of TZS {tzs(s.charge)}<select value={f.method} onChange={(e) => set("method", e.target.value)} aria-label="Payment method">{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>}
      </div>
      {f.name.trim() && f.name.trim().toLowerCase() !== s.r_name.toLowerCase() && <p className="note" style={{ margin: "6px 0 0", color: "var(--amber)" }}>Not the receiver ({s.r_name}). Make sure they were sent by the receiver.</p>}
      <div className="actions">
        <button className="btn primary sm" type="submit" disabled={busy}>{busy ? "Saving…" : unpaid ? `Record TZS ${tzs(s.charge)} & release` : "Release & print delivery note"}</button>
        <button className="btn sm" type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

/** On a collected consignment: the delivery note details and a reprint button. */
export function DeliveryNoteCard({ s }: { s: Shipment }) {
  const { company, tripById } = useStore();
  if (s.status !== "collected") return null;
  return (
    <div className="card"><h3>Delivery note{s.dn_no ? ` · ${s.dn_no}` : ""}</h3>
      <dl className="kv">
        <dt>Collected</dt><dd>{fmtDate(s.collected_at)}</dd>
        {s.collector_name ? <><dt>By</dt><dd>{s.collector_name}{s.collector_phone ? <span className="sub mono"> · {prettyPhone(s.collector_phone)}</span> : null}</dd></> : null}
        {s.collector_id ? <><dt>ID</dt><dd>{s.collector_id}</dd></> : null}
        {s.collect_note ? <><dt>Remarks</dt><dd>{s.collect_note}</dd></> : null}
        <dt>Released by</dt><dd>{s.collected_by || "—"}</dd>
      </dl>
      <div className="actions"><button className="btn sm" onClick={() => downloadDeliveryNote(s, company, tripById(s.trip_id))}>Delivery note (PDF)</button></div>
    </div>
  );
}

/** 80 mm delivery note, same printer as the receipt. No amounts; signature lines for both sides. */
export async function downloadDeliveryNote(s: Shipment, company: Company, trip?: Trip) {
  const { jsPDF } = await import("jspdf");
  const lines = itemsOf(s);
  const doc = new jsPDF({ unit: "mm", format: [80, 190 + Math.max(0, lines.length - 1) * 6] });
  let y = 10;
  const L = 6, W = 68;
  const line = (t: string, sz = 9, b = false) => { doc.setFont("helvetica", b ? "bold" : "normal"); doc.setFontSize(sz); const w = doc.splitTextToSize(String(t), W); doc.text(w, L, y); y += w.length * sz * 0.42 + 1.6; };
  const pair = (k: string, v: string) => { doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.text(k, L, y); const w = doc.splitTextToSize(String(v || "-"), 42); doc.setFont("helvetica", "bold"); doc.text(w, L + 26, y); y += w.length * 3.8 + 1.2; };
  const dash = () => { doc.setLineDashPattern([1, 1], 0); doc.line(L, y, L + W, y); y += 4; };
  line((company.name || "Shehena").toUpperCase(), 13, true);
  line([company.branch, company.phone ? "Tel " + company.phone : ""].filter(Boolean).join(" · ") || " ", 8); y += 2;
  line("DELIVERY NOTE", 8, true); line(s.dn_no || "-", 12, true); y += 1;
  pair("Date", fmtDate(s.collected_at || new Date().toISOString()));
  pair("Waybill", s.no);
  pair("Route", `${regName(s.origin)} to ${regName(s.dest)}`);
  if (trip) pair("Vehicle", trip.plate);
  pair("Sender", s.s_name || "-");
  pair("Receiver", `${s.r_name}, ${prettyPhone(s.r_phone)}`);
  dash();
  doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.text("Goods", L, y); doc.text("Pkgs", L + W, y, { align: "right" }); y += 4;
  doc.setFont("helvetica", "normal");
  for (const l of lines) { const w = doc.splitTextToSize(l.name, 54); doc.text(w, L, y); doc.text(String(l.pkgs), L + W, y, { align: "right" }); y += w.length * 3.6 + 1; }
  y += 1; pair("Total packages", String(s.pkgs));
  pair("Payment", s.pay === "paid" ? "Paid" : PAY_LABEL[s.pay]);
  dash();
  pair("Collected by", s.collector_name || s.r_name);
  if (s.collector_phone) pair("Phone", prettyPhone(s.collector_phone));
  if (s.collector_id) pair("ID", s.collector_id);
  if (s.collect_note) pair("Remarks", s.collect_note);
  pair("Released by", s.collected_by || "-");
  y += 8; doc.setLineDashPattern([], 0);
  doc.line(L, y, L + 30, y); doc.line(L + 38, y, L + W, y); y += 3.5;
  doc.setFontSize(7.5); doc.setFont("helvetica", "normal");
  doc.text("Released by (sign)", L, y); doc.text("Received by (sign)", L + 38, y); y += 7;
  line("The goods above were received complete and in the condition stated.", 7.5);
  doc.save(`Delivery-note-${s.dn_no || s.no}.pdf`);
}
