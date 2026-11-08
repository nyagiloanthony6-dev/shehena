"use client";
// Releasing goods at the destination: who collected them, payment if still owed, and the delivery note.
import { useState } from "react";
import { useStore } from "./store";
import { printSlips } from "./printer";
import { hasFeature, paidOf, METHODS, PAY_LABEL, fmtDate, itemsOf, prettyPhone, regName, tzs, type Company, type Shipment, type Trip } from "@/lib/domain";

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
  const { patch, me, toast, company, tripById, hasV9, hasExtras, can, accounts, logPayment } = useStore();
  const [f, setF] = useState({ name: s.r_name, phone: s.r_phone, idType: ID_TYPES[0], idNo: "", note: "", method: METHODS[0], how: "pay", account: "", disc: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const unpaid = s.pay === "unpaid";
  const needId = hasFeature(company, "require_id");
  if (unpaid && !can("pay")) return <p className="note">This consignment is unpaid. Only staff who take payments can release it.</p>;
  // Unpaid goods: pay now or put on the customer's monthly bill, with an optional discount.
  const before = paidOf(s); // part paid earlier (e.g. at the origin)
  // A part-paid consignment can't go on a monthly bill; the balance is collected here.
  const bills = hasExtras && can("bill") && !before ? accounts.filter((a) => a.active) : [];
  const onBill = unpaid && f.how === "bill";
  const d0 = Number(s.discount || 0);
  const gross = Number(s.gross_charge ?? Number(s.charge) + d0);
  const discAllowed = unpaid && hasExtras;
  const disc = discAllowed && f.disc.trim() !== "" ? Math.round(Number(f.disc) || 0) : d0;
  const due = gross - disc;
  const balance = Math.max(0, due - before);

  async function release(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return toast("Enter the name of the person collecting.", true);
    // The ID is optional unless the company requires it (Settings → Extra features).
    if (needId && !f.idNo.trim()) return toast("Enter their ID number (as on the ID shown).", true);
    if (disc < 0 || disc > gross) return toast(`The discount must be between 0 and TZS ${tzs(gross)}.`, true);
    if (due < before) return toast(`TZS ${tzs(before)} has already been paid; the discount can be at most TZS ${tzs(gross - before)}.`, true);
    if (disc !== d0 && disc > 0 && !f.reason.trim()) return toast("Write the reason for the discount.", true);
    if (onBill && !f.account) return toast("Choose the customer's bill account.", true);
    setBusy(true);
    const at = new Date().toISOString();
    const dn = dnNumber();
    const details = { collector_name: f.name.trim(), collector_phone: f.phone.trim(), collector_id: f.idNo.trim() ? `${f.idType} ${f.idNo.trim()}` : "", collect_note: f.note.trim() };
    const values: Partial<Shipment> = {
      status: "collected", collected_at: at, collected_by: me.full_name,
      ...(disc !== d0 ? { discount: disc, discount_reason: disc ? f.reason.trim() : "", discount_by: disc ? me.full_name : null, discount_at: disc ? at : null, gross_charge: gross, charge: due } : {}),
      ...(onBill ? { pay: "bill" as const, account_id: f.account } : unpaid ? { pay: "paid" as const, method: f.method, paid_at: at, paid_by: me.full_name } : {}),
      // Before update 0009 is run these columns don't exist yet; the note is still printed.
      ...(hasV9 ? { dn_no: dn, ...details } : {}),
    };
    const ok = await patch<Shipment>("shipments", s.id, values);
    setBusy(false);
    if (!ok) return;
    if (unpaid && !onBill) await logPayment({ ...s, ...values } as Shipment, balance, f.method);
    toast(`${onBill ? `TZS ${tzs(due)} put on ${bills.find((a) => a.id === f.account)?.name || "the bill"}. ` : unpaid ? `TZS ${tzs(balance)} received${before ? ` (balance; TZS ${tzs(before)} paid before)` : ""}. ` : ""}Released to ${details.collector_name}. Delivery note ${dn} printing.`);
    try { await printSlips("delivery", { ...s, ...values, dn_no: dn, ...details } as Shipment, company, { trip: tripById(s.trip_id) }); }
    catch (e) { const m = (e as Error).message; toast(`Released, but the delivery note didn't print${m === "NEEDS_PAIRING" ? " (choose the printer under Printer settings)" : ""}. Print it from the consignment.`, true); }
    onDone();
  }

  return (
    <form className="paybox release" noValidate onSubmit={release}>
      <div className="lbl" style={{ marginBottom: 8 }}>Release to the customer · delivery note</div>
      <div className="fields">
        <label className="f">Collected by<input value={f.name} onChange={(e) => set("name", e.target.value)} aria-label="Collected by" /></label>
        <label className="f">Their phone<input value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" aria-label="Collector phone" /></label>
        <label className="f">ID type {!needId && <small>optional</small>}<select value={f.idType} onChange={(e) => set("idType", e.target.value)} aria-label="ID type">{ID_TYPES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="f">ID number {!needId && <small>optional</small>}<input value={f.idNo} onChange={(e) => set("idNo", e.target.value)} aria-label="ID number" /></label>
        <label className="f full">Remarks <small>optional: condition of goods, packages short…</small><input value={f.note} onChange={(e) => set("note", e.target.value)} placeholder={`All ${s.pkgs} package${s.pkgs === 1 ? "" : "s"} received in good condition`} aria-label="Release remarks" /></label>
        {unpaid && bills.length > 0 && <label className="f">Payment<select value={f.how} onChange={(e) => set("how", e.target.value)} aria-label="Release payment"><option value="pay">Pays now</option><option value="bill">Monthly bill</option></select></label>}
        {unpaid && !onBill && <label className="f">{before ? <>Balance TZS {tzs(balance)} <small>TZS {tzs(before)} paid before</small></> : <>Payment of TZS {tzs(due)}</>}<select value={f.method} onChange={(e) => set("method", e.target.value)} aria-label="Payment method">{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>}
        {onBill && <label className="f">Bill customer<select value={f.account} onChange={(e) => set("account", e.target.value)} aria-label="Release bill account"><option value="">Choose…</option>{bills.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
        {discAllowed && <label className="f">Discount (TZS) <small>optional</small><input type="number" min={0} step={500} value={f.disc} onChange={(e) => set("disc", e.target.value)} placeholder={d0 ? String(d0) : "0"} aria-label="Release discount" /></label>}
        {discAllowed && disc !== d0 && disc > 0 && <label className="f">Reason for discount<input value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="e.g. Regular customer, asked at collection" aria-label="Release discount reason" /></label>}
      </div>
      {discAllowed && disc !== d0 && <p className="note" style={{ margin: "6px 0 0" }}>TZS {tzs(gross)} − discount {tzs(disc)} = <b>TZS {tzs(due)}</b>{before ? <> − paid {tzs(before)} = balance <b>TZS {tzs(balance)}</b></> : null}</p>}
      {f.name.trim() && f.name.trim().toLowerCase() !== s.r_name.toLowerCase() && <p className="note" style={{ margin: "6px 0 0", color: "var(--amber)" }}>Not the receiver ({s.r_name}). Make sure they were sent by the receiver.</p>}
      <div className="actions">
        <button className="btn primary sm" type="submit" disabled={busy}>{busy ? "Saving…" : onBill ? "Put on bill & release" : unpaid ? `Record TZS ${tzs(balance)} & release` : "Release & print delivery note"}</button>
        <button className="btn sm" type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

/** On a collected consignment: the delivery note details and a reprint button. */
export function DeliveryNoteCard({ s }: { s: Shipment }) {
  const { company, tripById, toast } = useStore();
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
      <div className="actions">
        <button className="btn sm" onClick={async () => { try { toast(await printSlips("delivery", s, company, { trip: tripById(s.trip_id) })); } catch (e) { const m = (e as Error).message; toast(m === "NEEDS_PAIRING" ? "Choose the printer under Printer settings first." : m || "Couldn't print.", true); } }}>Print delivery note</button>
        <button className="btn sm" onClick={() => downloadDeliveryNote(s, company, tripById(s.trip_id))}>Delivery note (PDF)</button>
      </div>
    </div>
  );
}

/** 80 mm delivery note, same printer as the receipt: goods with their charges, payment, signature lines. */
export async function downloadDeliveryNote(s: Shipment, company: Company, trip?: Trip) {
  const { jsPDF } = await import("jspdf");
  const lines = itemsOf(s);
  const doc = new jsPDF({ unit: "mm", format: [80, 205 + Math.max(0, lines.length - 1) * 6] });
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
  doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.text("Goods", L, y); doc.text("Pkgs", L + 46, y, { align: "right" }); doc.text("TZS", L + W, y, { align: "right" }); y += 4;
  doc.setFont("helvetica", "normal");
  for (const l of lines) { const w = doc.splitTextToSize(l.name, 38); doc.text(w, L, y); doc.text(String(l.pkgs), L + 46, y, { align: "right" }); doc.text(tzs(l.charge), L + W, y, { align: "right" }); y += w.length * 3.6 + 1; }
  y += 1; pair("Total packages", String(s.pkgs));
  const disc = Number(s.discount || 0);
  if (disc > 0) { pair("Subtotal", `TZS ${tzs(s.gross_charge ?? Number(s.charge) + disc)}`); pair("Discount", `- TZS ${tzs(disc)}`); }
  pair("Amount charged", `TZS ${tzs(s.charge)}`);
  pair("Payment", s.pay === "paid" ? `Paid${s.method ? ` (${s.method})` : ""}` : s.pay === "bill" ? "On monthly bill" : PAY_LABEL[s.pay]);
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
