"use client";
// Monthly bill customers (wateja wa bili): consignments go on their account, they pay monthly.
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { useUi } from "../CargoApp";
import { StatusPill } from "../parts";
import { METHODS, officesOf, fmtDate, goodsLabel, intlPhone, prettyPhone, regShort, tzs, type BillAccount, type BillPayment, type Shipment } from "@/lib/domain";

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString();
export const monthOf = (iso: string) => (iso.length === 10 ? iso : local(new Date(iso))).slice(0, 7);
const today = () => local(new Date()).slice(0, 10);
export const monthName = (m: string, sw = false) =>
  new Date(m + "-15T12:00:00").toLocaleDateString(sw ? "sw-TZ" : "en-GB", { month: "long", year: "numeric" });
const lastMonths = (n: number) => {
  const out: string[] = []; const d = new Date(); d.setDate(15);
  for (let i = 0; i < n; i++) { out.push(local(d).slice(0, 7)); d.setMonth(d.getMonth() - 1); }
  return out;
};

/** Everything about one account: its consignments and payments, totals by month and overall. */
export function useAccount(id: string) {
  const { shipments, billPayments } = useStore();
  return useMemo(() => {
    const ships = shipments.filter((s) => s.pay === "bill" && s.account_id === id).sort((a, b) => a.received_at.localeCompare(b.received_at));
    const pays = billPayments.filter((p) => p.account_id === id).sort((a, b) => a.paid_on.localeCompare(b.paid_on));
    const billed = ships.reduce((a, s) => a + Number(s.charge || 0), 0);
    const paid = pays.reduce((a, p) => a + Number(p.amount || 0), 0);
    /** Balance at the end of month m (YYYY-MM): billed up to then − paid up to then. */
    const balanceAt = (m: string) =>
      ships.filter((s) => monthOf(s.received_at) <= m).reduce((a, s) => a + Number(s.charge || 0), 0) -
      pays.filter((p) => p.paid_on.slice(0, 7) <= m).reduce((a, p) => a + Number(p.amount || 0), 0);
    const inMonth = (m: string) => ({
      ships: ships.filter((s) => monthOf(s.received_at) === m),
      pays: pays.filter((p) => p.paid_on.slice(0, 7) === m),
    });
    return { ships, pays, billed, paid, balance: billed - paid, balanceAt, inMonth };
  }, [shipments, billPayments, id]);
}

export default function Bills() {
  const { accounts, can, hasExtras, insert, me, toast, company } = useStore();
  const branch = me.role === "agent";
  const ui = useUi();
  const [month, setMonth] = useState(() => lastMonths(1)[0]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", phone: "", notes: "", station: "" });
  const [q, setQ] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  if (!hasExtras) return (
    <section><div className="sectionhead"><h1>Monthly bills</h1></div>
      <div className="banner">Monthly bills aren&apos;t switched on yet. The system owner needs to run update <b>0008</b> in the database.</div></section>
  );

  const shown = accounts.filter((a) => (showClosed || a.active) && (!q.trim() || (a.name + " " + a.phone).toLowerCase().includes(q.trim().toLowerCase())));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return toast("Enter the customer's name.", true);
    // Branch staff's accounts belong to their office (the database sets this too); the Admin may pick one.
    const station = branch ? me.station || null : f.station || null;
    const a = await insert<BillAccount>("bill_accounts", { name: f.name.trim(), phone: f.phone.trim(), notes: f.notes.trim(), active: true, created_by_name: me.full_name, ...(station ? { station } : {}) });
    if (a) { toast(`${a.name} can now send goods on a monthly bill.`); setF({ name: "", phone: "", notes: "", station: "" }); setAdding(false); }
  }

  return (
    <section>
      <div className="sectionhead">
        <div><h1>Monthly bills</h1><div className="sub">Wateja wa bili: customers who send goods now and pay once a month.</div></div>
        {can("openAccount") && <button className={`btn${adding ? "" : " primary"}`} onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Open a bill account"}</button>}
      </div>

      {adding && (
        <form noValidate onSubmit={add} style={{ marginBottom: 14 }}>
          <fieldset><legend>New bill customer</legend>
            <div className="fields">
              <label className="f">Customer or business name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Duka la Juma, Kariakoo" aria-label="Account name" /></label>
              <label className="f">Phone<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" aria-label="Account phone" /></label>
              {!branch && <label className="f">Office <small>branch staff there can see and bill this customer</small>
                <select value={f.station} onChange={(e) => setF({ ...f, station: e.target.value })} aria-label="Account office"><option value="">Head office only</option>{officesOf(company).map((c) => <option key={c} value={c}>{regShort(c)}</option>)}</select></label>}
              <label className="f full">Notes <small>terms agreed, contact person</small><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. Pays by the 5th of each month" /></label>
            </div>
            <div className="actions"><button className="btn primary" type="submit">Open account</button></div>
          </fieldset>
        </form>
      )}

      <AllAccountsSummary month={month} />

      <div className="filters" style={{ marginTop: 16 }}>
        <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto" }} aria-label="Month">
          {lastMonths(18).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
        </select>
        <div className="searchbox" style={{ flex: "1 1 200px" }}><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer name or phone" aria-label="Search bill customers" style={{ paddingLeft: 11 }} /></div>
        <label className="check"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed accounts</label>
      </div>

      <div className="ledger" style={{ marginTop: 12 }}><table>
        <thead><tr><th>Customer</th><th className="r">Consignments in {monthName(month).split(" ")[0]}</th><th className="r">Billed in month</th><th className="r">Paid in month</th><th className="r">Balance owed now</th></tr></thead>
        <tbody>{shown.map((a) => <AccountRow key={a.id} a={a} month={month} onOpen={() => ui.openAccount(a.id)} />)}</tbody>
      </table>
        {!accounts.length && <div className="empty"><h3>No bill customers yet</h3><p>{can("accounts") ? "Open an account for each customer who pays monthly. Then choose “Monthly bill” when receiving their goods." : "The Admin opens bill accounts."}</p></div>}
      </div>
    </section>
  );
}

function AllAccountsSummary({ month }: { month: string }) {
  const { shipments, billPayments, accounts } = useStore();
  const billedM = shipments.filter((s) => s.pay === "bill" && monthOf(s.received_at) === month).reduce((a, s) => a + Number(s.charge || 0), 0);
  const paidM = billPayments.filter((p) => p.paid_on.slice(0, 7) === month).reduce((a, p) => a + Number(p.amount || 0), 0);
  const owed = shipments.filter((s) => s.pay === "bill").reduce((a, s) => a + Number(s.charge || 0), 0) - billPayments.reduce((a, p) => a + Number(p.amount || 0), 0);
  return (
    <div className="stats">
      <div className="stat"><div className="lbl">Bill customers</div><div className="v">{accounts.filter((a) => a.active).length}</div><div className="s">active accounts</div></div>
      <div className="stat"><div className="lbl">Billed in {monthName(month).split(" ")[0]}</div><div className="v">{tzs(billedM)}</div><div className="s">TZS</div></div>
      <div className="stat"><div className="lbl">Paid in {monthName(month).split(" ")[0]}</div><div className="v">{tzs(paidM)}</div><div className="s">TZS received</div></div>
      <div className={`stat${owed > 0 ? " warn" : ""}`}><div className="lbl">Owed now</div><div className="v">{tzs(owed)}</div><div className="s">TZS, all bill customers</div></div>
    </div>
  );
}

function AccountRow({ a, month, onOpen }: { a: BillAccount; month: string; onOpen: () => void }) {
  const x = useAccount(a.id);
  const m = x.inMonth(month);
  return (
    <tr className="row" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <td><b>{a.name}</b>{a.station && <span className="tag-rental">{regShort(a.station)}</span>}{!a.active && <span className="sub"> · closed</span>}<div className="sub mono">{a.phone ? prettyPhone(a.phone) : "—"}</div></td>
      <td className="r num">{m.ships.length}</td>
      <td className="r num">{tzs(m.ships.reduce((s, z) => s + Number(z.charge || 0), 0))}</td>
      <td className="r num" style={{ color: "var(--good)" }}>{tzs(m.pays.reduce((s, z) => s + Number(z.amount || 0), 0))}</td>
      <td className="r num" style={x.balance > 0 ? { color: "var(--bad)", fontWeight: 700 } : undefined}>{tzs(x.balance)}</td>
    </tr>
  );
}

export function AccountSheet({ id }: { id: string }) {
  const { accounts, company, can, insert, patch, remove, me, toast } = useStore();
  const ui = useUi();
  const a = accounts.find((x) => x.id === id);
  const x = useAccount(id);
  const [month, setMonth] = useState(() => lastMonths(1)[0]);
  const [pay, setPay] = useState({ amount: "", paid_on: today(), method: METHODS[1], reference: "", note: "" });
  const [edit, setEdit] = useState(false);
  const [ef, setEf] = useState({ name: a?.name || "", phone: a?.phone || "", notes: a?.notes || "", station: a?.station || "" });
  const [undo, setUndo] = useState<string | null>(null);
  if (!a) return <div className="sheet-h"><p className="sub">This account no longer exists.</p><button className="btn sm" onClick={ui.close}>Close</button></div>;
  const m = x.inMonth(month);
  const billedM = m.ships.reduce((s, z) => s + Number(z.charge || 0), 0);
  const paidM = m.pays.reduce((s, z) => s + Number(z.amount || 0), 0);
  const prev = (() => { const d = new Date(month + "-15T12:00:00"); d.setMonth(d.getMonth() - 1); return local(d).slice(0, 7); })();
  const opening = x.balanceAt(prev), closing = x.balanceAt(month);
  const sw = company.message_lang !== "en";
  const how = company.payment_instructions?.trim();
  const msg = sw
    ? `Habari ${a.name}, bili yako ya ${monthName(month, true)} kutoka ${company.name}: mizigo ${m.ships.length}, TZS ${tzs(billedM)}. Salio la nyuma TZS ${tzs(opening)}, umelipa TZS ${tzs(paidM)}. Jumla unayodaiwa: TZS ${tzs(closing)}.${how ? ` Lipa kupitia: ${how}.` : ""} Asante.`
    : `Hello ${a.name}, your ${monthName(month)} bill from ${company.name}: ${m.ships.length} consignments, TZS ${tzs(billedM)}. Previous balance TZS ${tzs(opening)}, paid TZS ${tzs(paidM)}. Total due: TZS ${tzs(closing)}.${how ? ` Pay via: ${how}.` : ""} Thank you.`;

  async function record(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(pay.amount);
    if (!(amount > 0)) return toast("Enter the amount received.", true);
    if (!pay.paid_on) return toast("Enter the date paid.", true);
    const p = await insert<BillPayment>("bill_payments", { account_id: id, amount, paid_on: pay.paid_on, method: pay.method, reference: pay.reference.trim(), note: pay.note.trim(), recorded_by: me.full_name });
    if (p) { toast(`Payment of TZS ${tzs(amount)} recorded for ${a!.name}.`); setPay({ ...pay, amount: "", reference: "", note: "" }); }
  }

  return (
    <>
      <div className="sheet-h">
        <div><div className="lbl">Monthly bill customer</div><h2>{a.name}</h2><div className="sub">{a.phone ? prettyPhone(a.phone) : "No phone"}{a.notes ? ` · ${a.notes}` : ""}{!a.active ? " · closed" : ""}</div></div>
        <button className="btn sm" onClick={ui.close}>Close</button>
      </div>

      <div className="card"><h3>Balance</h3>
        <dl className="kv">
          <dt>Billed (all time)</dt><dd className="num">TZS {tzs(x.billed)} <span className="sub">· {x.ships.length} consignment{x.ships.length === 1 ? "" : "s"}</span></dd>
          <dt>Paid (all time)</dt><dd className="num">TZS {tzs(x.paid)}</dd>
          <dt>Owed now</dt><dd className="num" style={{ fontWeight: 700, color: x.balance > 0 ? "var(--bad)" : "var(--good)" }}>TZS {tzs(x.balance)}</dd>
        </dl>
      </div>

      <div className="card"><h3>Statement</h3>
        <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto" }} aria-label="Statement month">{lastMonths(18).map((mm) => <option key={mm} value={mm}>{monthName(mm)}</option>)}</select>
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>Balance brought forward</dt><dd className="num">TZS {tzs(opening)}</dd>
          <dt>Goods this month</dt><dd className="num">TZS {tzs(billedM)} <span className="sub">· {m.ships.length} consignment{m.ships.length === 1 ? "" : "s"}</span></dd>
          <dt>Paid this month</dt><dd className="num">− TZS {tzs(paidM)}</dd>
          <dt>Balance at month end</dt><dd className="num" style={{ fontWeight: 700 }}>TZS {tzs(closing)}</dd>
        </dl>
        {m.ships.length > 0 && (
          <div className="ledger" style={{ border: 0, marginTop: 8 }}><table className="small" style={{ minWidth: 0 }}>
            <thead><tr><th>Date</th><th>Waybill</th><th>To</th><th>Goods</th><th className="r">TZS</th></tr></thead>
            <tbody>{m.ships.map((s: Shipment) => (
              <tr key={s.id} className="row" onClick={() => ui.openShip(s.id)}>
                <td>{fmtDate(s.received_at).slice(0, 6)}</td><td className="mono wb">{s.no}<div className="sub"><StatusPill s={s.status} /></div></td>
                <td>{s.r_name}<div className="sub">{regShort(s.dest)}</div></td><td>{goodsLabel(s)} · {s.pkgs} pkg</td><td className="r num">{tzs(s.charge)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
        <div className="actions">
          <button className="btn sm primary" onClick={() => downloadStatement(a, month, company, x, opening, closing)}>Statement (PDF)</button>
          {a.phone && <a className="btn wa sm" href={`https://wa.me/${intlPhone(a.phone)}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>}
          {a.phone && <a className="btn sm" href={`sms:+${intlPhone(a.phone)}?body=${encodeURIComponent(msg)}`}>SMS</a>}
        </div>
      </div>

      {can("pay") && (
        <form className="card" noValidate onSubmit={record}><h3>Record a payment</h3>
          <div className="fields">
            <label className="f">Amount (TZS)<input type="number" min={0} step={1000} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder={x.balance > 0 ? String(x.balance) : ""} aria-label="Bill payment amount" /></label>
            <label className="f">Date paid<input type="date" value={pay.paid_on} onChange={(e) => setPay({ ...pay, paid_on: e.target.value })} aria-label="Bill payment date" /></label>
            <label className="f">Paid by<select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{METHODS.map((mm) => <option key={mm}>{mm}</option>)}</select></label>
            <label className="f">Reference <small>optional</small><input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="e.g. M-Pesa code" /></label>
            <label className="f full">Note <small>optional</small><input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="e.g. For September bill" /></label>
          </div>
          <div className="actions"><button className="btn primary sm" type="submit">Record payment</button></div>
        </form>
      )}

      <div className="card"><h3>Payments · {x.pays.length}</h3>
        {[...x.pays].reverse().map((p) => (
          <div className="lrow" key={p.id} style={{ flexWrap: "wrap" }}>
            <div><b className="num">TZS {tzs(p.amount)}</b><div className="sub">{fmtDate(p.paid_on + "T12:00:00").slice(0, 11)}{p.method && ` · ${p.method}`}{p.reference && ` · ${p.reference}`}{p.note && ` · ${p.note}`}{p.recorded_by && ` · by ${p.recorded_by}`}</div></div>
            {can("delete") && (undo === p.id
              ? <div className="confirm">Remove this payment? <button className="btn sm danger" onClick={async () => { setUndo(null); if (await remove("bill_payments", p.id)) toast("Payment removed"); }}>Remove</button><button className="btn sm" onClick={() => setUndo(null)}>Keep</button></div>
              : <button className="btn sm" onClick={() => setUndo(p.id)}>Remove</button>)}
          </div>
        ))}
        {!x.pays.length && <p className="sub">No payments yet.</p>}
      </div>

      {can("accounts") && (
        <div className="card"><h3>Account</h3>
          {edit ? (
            <>
              <div className="fields">
                <label className="f">Name<input value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} /></label>
                <label className="f">Phone<input value={ef.phone} onChange={(e) => setEf({ ...ef, phone: e.target.value })} /></label>
                <label className="f">Office<select value={ef.station} onChange={(e) => setEf({ ...ef, station: e.target.value })} aria-label="Edit account office"><option value="">Head office only</option>{officesOf(company).map((c) => <option key={c} value={c}>{regShort(c)}</option>)}</select></label>
                <label className="f full">Notes<input value={ef.notes} onChange={(e) => setEf({ ...ef, notes: e.target.value })} /></label>
              </div>
              <div className="actions"><button className="btn sm primary" onClick={async () => { if (!ef.name.trim()) return; if (await patch<BillAccount>("bill_accounts", a.id, { name: ef.name.trim(), phone: ef.phone.trim(), notes: ef.notes.trim(), ...("station" in a ? { station: ef.station || null } : {}) })) { toast("Account saved"); setEdit(false); } }}>Save</button><button className="btn sm" onClick={() => setEdit(false)}>Cancel</button></div>
            </>
          ) : (
            <div className="actions" style={{ marginTop: 0 }}>
              <button className="btn sm" onClick={() => setEdit(true)}>Edit details</button>
              <button className="btn sm" onClick={async () => { if (await patch<BillAccount>("bill_accounts", a.id, { active: !a.active })) toast(a.active ? "Account closed. Old bills and payments stay." : "Account reopened."); }}>{a.active ? "Close account" : "Reopen account"}</button>
            </div>
          )}
          <p className="note">A closed account can&apos;t take new goods on bill, but its balance and history stay.</p>
        </div>
      )}
    </>
  );
}

/** A4 statement for one month: brought forward, goods, payments, balance. */
async function downloadStatement(a: BillAccount, month: string, company: { name: string; branch: string; phone: string; payment_instructions?: string },
  x: ReturnType<typeof useAccount>, opening: number, closing: number) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = 16, R = 194;
  const m = x.inMonth(month);
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text((company.name || "Shehena").toUpperCase(), L, 18);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(80, 88, 104);
  doc.text([company.branch, company.phone ? "Tel " + company.phone : ""].filter(Boolean).join(" · ") || " ", L, 24);
  doc.setTextColor(20, 24, 31); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text("STATEMENT OF ACCOUNT", R, 18, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text(monthName(month), R, 24, { align: "right" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text(a.name, L, 38);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.text(a.phone ? prettyPhone(a.phone) : "", L, 43);
  let y = 54;
  const row = (c: string[], bold = false) => {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(c[0], L, y); doc.text(c[1], L + 24, y); doc.text(c[2], L + 70, y); doc.text(c[3], R - 30, y, { align: "right" }); doc.text(c[4], R, y, { align: "right" });
    y += 6;
  };
  doc.setFontSize(9); doc.setFillColor(232, 236, 242); doc.rect(L - 2, y - 4.5, R - L + 4, 6.5, "F");
  row(["Date", "Reference", "Details", "Charges", "Payments"], true);
  row(["", "", "Balance brought forward", tzs(opening), ""]);
  const lines = [
    ...m.ships.map((s) => ({ d: s.received_at.slice(0, 10), r: s.no, t: `${goodsLabel(s)} (${s.pkgs}) to ${s.r_name}, ${regShort(s.dest)}`, c: Number(s.charge), p: 0 })),
    ...m.pays.map((p) => ({ d: p.paid_on, r: p.reference || p.method, t: `Payment${p.method ? " · " + p.method : ""}${p.note ? " · " + p.note : ""}`, c: 0, p: Number(p.amount) })),
  ].sort((u, v) => u.d.localeCompare(v.d));
  lines.forEach((l) => row([fmtDate(l.d + "T12:00:00").slice(0, 11), doc.splitTextToSize(l.r || "", 44)[0] || "", doc.splitTextToSize(l.t, 56)[0], l.c ? tzs(l.c) : "", l.p ? tzs(l.p) : ""]));
  y += 2; doc.setDrawColor(200, 206, 216); doc.line(L, y - 3, R, y - 3);
  row(["", "", "Totals this month", tzs(m.ships.reduce((s, z) => s + Number(z.charge), 0)), tzs(m.pays.reduce((s, z) => s + Number(z.amount), 0))], true);
  y += 4; doc.setFontSize(12); doc.setFont("helvetica", "bold");
  doc.text("Balance due", L, y); doc.text(`TZS ${tzs(closing)}`, R, y, { align: "right" });
  if (company.payment_instructions?.trim()) { y += 10; doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.text(doc.splitTextToSize(`How to pay: ${company.payment_instructions.trim()}`, R - L), L, y); }
  doc.setFontSize(8.5); doc.setTextColor(120, 128, 140); doc.text("Shehena · Developed by Serengeti Labs", L, 288);
  doc.save(`Statement-${a.name.replace(/[^a-z0-9]+/gi, "-")}-${month}.pdf`);
}
