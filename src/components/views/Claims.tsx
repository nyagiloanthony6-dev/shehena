"use client";
// Changamoto: goods lost, damaged or broken. Who, what happened, compensation, what's been paid and when.
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { useUi } from "../CargoApp";
import { CLAIM_KINDS, METHODS, fmtDate, goodsLabel, intlPhone, prettyPhone, regShort, tzs, type Claim, type ClaimKind, type ClaimPayment } from "@/lib/domain";

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const day = (d: string) => fmtDate(d + "T12:00:00").slice(0, 11);
export const kindLabel = (k: ClaimKind) => { const x = CLAIM_KINDS.find((c) => c[0] === k)!; return `${x[1]} · ${x[2]}`; };

export function useClaimTotals() {
  const { claimPayments } = useStore();
  return useMemo(() => {
    const paid: Record<string, number> = {};
    claimPayments.forEach((p) => { paid[p.claim_id] = (paid[p.claim_id] || 0) + Number(p.amount || 0); });
    return (c: Claim) => { const pd = paid[c.id] || 0; return { paid: pd, balance: Math.max(0, Number(c.compensation) - pd) }; };
  }, [claimPayments]);
}
const isOpen = (c: Claim, bal: number) => !c.closed && (bal > 0 || Number(c.compensation) === 0);

export default function Claims() {
  const { claims, can, hasExtras } = useStore();
  const ui = useUi();
  const totals = useClaimTotals();
  const [adding, setAdding] = useState(false);
  const [show, setShow] = useState<"open" | "settled" | "all">("open");
  const [q, setQ] = useState("");
  useEffect(() => { if (ui.claimFor) setAdding(true); }, [ui.claimFor]);

  if (!hasExtras) return (
    <section><div className="sectionhead"><h1>Claims</h1></div>
      <div className="banner">Claims aren&apos;t switched on yet. The system owner needs to run update <b>0008</b> in the database.</div></section>
  );

  const rows = claims.map((c) => ({ c, ...totals(c) }));
  const open = rows.filter((r) => isOpen(r.c, r.balance));
  const ql = q.trim().toLowerCase();
  const list = rows.filter((r) => (show === "all" || (show === "open" ? isOpen(r.c, r.balance) : !isOpen(r.c, r.balance))) &&
    (!ql || [r.c.customer_name, r.c.customer_phone, r.c.waybill, r.c.description].join(" ").toLowerCase().includes(ql)));
  const sum = (k: "compensation" | "paid" | "balance") => rows.reduce((a, r) => a + Number(k === "compensation" ? r.c.compensation : r[k]), 0);

  return (
    <section>
      <div className="sectionhead">
        <div><h1>Claims</h1><div className="sub">Changamoto: goods lost, damaged or broken, and the compensation owed to the customer.</div></div>
        {can("claims") && <button className={`btn${adding ? "" : " primary"}`} onClick={() => { setAdding(!adding); if (adding) ui.reportClaim(null); }}>{adding ? "Cancel" : "Record a claim"}</button>}
      </div>
      {adding && <ClaimForm done={(id) => { setAdding(false); ui.reportClaim(null); if (id) ui.openClaim(id); }} />}
      <div className="stats">
        <div className="stat"><div className="lbl">Open claims</div><div className="v">{open.length}</div><div className="s">{rows.length} recorded in total</div></div>
        <div className="stat"><div className="lbl">Compensation agreed</div><div className="v">{tzs(sum("compensation"))}</div><div className="s">TZS, all claims</div></div>
        <div className="stat"><div className="lbl">Paid to customers</div><div className="v">{tzs(sum("paid"))}</div><div className="s">TZS</div></div>
        <div className={`stat${sum("balance") ? " warn" : ""}`}><div className="lbl">Still owed</div><div className="v">{tzs(sum("balance"))}</div><div className="s">TZS to customers</div></div>
      </div>
      <div className="filters" style={{ marginTop: 16 }}>
        <div className="chips">{([["open", `Open · ${open.length}`], ["settled", `Settled · ${rows.length - open.length}`], ["all", `All · ${rows.length}`]] as [typeof show, string][]).map(([k, l]) =>
          <button key={k} className="chip" aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}</div>
        <div className="searchbox" style={{ flex: "1 1 200px" }}><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer, phone or waybill" aria-label="Search claims" style={{ paddingLeft: 11 }} /></div>
      </div>
      <div className="ledger" style={{ marginTop: 12 }}><table>
        <thead><tr><th>Customer</th><th>Problem</th><th>Waybill</th><th className="r">Compensation</th><th className="r">Paid</th><th className="r">Still owed</th></tr></thead>
        <tbody>{list.map(({ c, paid, balance }) => (
          <tr key={c.id} className="row" tabIndex={0} onClick={() => ui.openClaim(c.id)} onKeyDown={(e) => e.key === "Enter" && ui.openClaim(c.id)}>
            <td><b>{c.customer_name}</b><div className="sub mono">{c.customer_phone ? prettyPhone(c.customer_phone) : "—"}</div></td>
            <td><span className={`pill claim-${c.kind}`}>{kindLabel(c.kind)}</span><div className="sub">reported {day(c.reported_on)}</div></td>
            <td className="mono wb">{c.waybill || "—"}</td>
            <td className="r num">{tzs(c.compensation)}</td>
            <td className="r num" style={{ color: "var(--good)" }}>{tzs(paid)}</td>
            <td className="r num" style={balance ? { color: "var(--bad)", fontWeight: 700 } : undefined}>{c.closed && !balance ? "Settled" : tzs(balance)}</td>
          </tr>))}</tbody>
      </table>
        {!rows.length && <div className="empty"><h3>No claims</h3><p>When goods are lost, damaged or broken, record it here, or from the consignment with &ldquo;Report lost or damaged goods&rdquo;.</p></div>}
        {rows.length > 0 && !list.length && <div className="empty"><p>Nothing matches.</p></div>}
      </div>
    </section>
  );
}

function ClaimForm({ done }: { done: (id?: string) => void }) {
  const { shipments, insert, me, toast } = useStore();
  const ui = useUi();
  const from = shipments.find((s) => s.id === ui.claimFor);
  const [f, setF] = useState({
    waybill: from?.no || "", customer_name: from?.r_name || "", customer_phone: from?.r_phone || "",
    kind: "damaged" as ClaimKind, description: from ? `${goodsLabel(from)} (${from.pkgs} pkg) to ${regShort(from.dest)}` : "",
    goods_value: "", compensation: "", reported_on: local(new Date()),
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const ship = shipments.find((s) => s.no.toLowerCase() === f.waybill.trim().toLowerCase());
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.customer_name.trim()) return toast("Enter the customer's name.", true);
    const comp = Number(f.compensation || 0), val = Number(f.goods_value || 0);
    if (comp < 0 || val < 0) return toast("Amounts can't be negative.", true);
    setBusy(true);
    const c = await insert<Claim>("claims", {
      shipment_id: ship?.id || null, waybill: ship?.no || f.waybill.trim(), customer_name: f.customer_name.trim(), customer_phone: f.customer_phone.trim(),
      kind: f.kind, description: f.description.trim(), goods_value: val, compensation: comp, reported_on: f.reported_on, closed: false, created_by_name: me.full_name,
    });
    setBusy(false);
    if (c) { toast(`Claim recorded for ${c.customer_name}.`); done(c.id); }
  }
  return (
    <form noValidate onSubmit={save} style={{ marginBottom: 14 }}>
      <fieldset><legend>Record a claim</legend>
        <div className="fields">
          <label className="f">Waybill no. <small>optional</small>
            <input list="claim-waybills" value={f.waybill} onChange={(e) => {
              const v = e.target.value; const s = shipments.find((x) => x.no.toLowerCase() === v.trim().toLowerCase());
              setF((x) => ({ ...x, waybill: v, ...(s && !x.customer_name ? { customer_name: s.r_name, customer_phone: s.r_phone, description: x.description || `${goodsLabel(s)} (${s.pkgs} pkg) to ${regShort(s.dest)}` } : {}) }));
            }} aria-label="Claim waybill" placeholder="e.g. DAR-DOD-261020-1234" />
            <datalist id="claim-waybills">{shipments.slice(0, 300).map((s) => <option key={s.id} value={s.no}>{s.r_name} · {goodsLabel(s)}</option>)}</datalist>
          </label>
          <div className="f" style={{ justifyContent: "end" }}>{ship ? <span className="hint">✓ {goodsLabel(ship)} · {ship.s_name} → {ship.r_name} · TZS {tzs(ship.charge)}</span> : f.waybill.trim() ? <span className="sub">Not found in your consignments; it will be saved as typed.</span> : null}</div>
          <label className="f">Customer name<input value={f.customer_name} onChange={(e) => set("customer_name", e.target.value)} aria-label="Claim customer name" /></label>
          <label className="f">Customer phone<input value={f.customer_phone} onChange={(e) => set("customer_phone", e.target.value)} inputMode="tel" aria-label="Claim customer phone" /></label>
          <div className="f full">Type of problem
            <div className="seg" style={{ marginTop: 5 }}>{CLAIM_KINDS.map(([k, en, sw]) => (
              <label key={k}><input type="radio" name="kind" checked={f.kind === k} onChange={() => set("kind", k)} /><span>{sw} <small style={{ opacity: .75 }}>{en}</small></span></label>
            ))}</div>
          </div>
          <label className="f full">What happened<textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. 2 cartons of oil broken when unloading at Dodoma" aria-label="Claim description" /></label>
          <label className="f">Value of the goods (TZS) <small>gharama ya mzigo</small><input type="number" min={0} step={1000} value={f.goods_value} onChange={(e) => set("goods_value", e.target.value)} aria-label="Goods value" /></label>
          <label className="f">Compensation agreed (TZS) <small>kiasi cha fidia</small><input type="number" min={0} step={1000} value={f.compensation} onChange={(e) => set("compensation", e.target.value)} aria-label="Compensation" /></label>
          <label className="f">Date reported<input type="date" value={f.reported_on} onChange={(e) => set("reported_on", e.target.value)} /></label>
        </div>
        <div className="actions"><button className="btn primary" type="submit" disabled={busy}>Save claim</button><button className="btn" type="button" onClick={() => done()}>Cancel</button></div>
      </fieldset>
    </form>
  );
}

export function ClaimSheet({ id }: { id: string }) {
  const { claims, claimPayments, shipments, company, can, insert, patch, remove, me, toast } = useStore();
  const ui = useUi();
  const c = claims.find((x) => x.id === id);
  const totals = useClaimTotals();
  const [pay, setPay] = useState({ amount: "", paid_on: local(new Date()), method: METHODS[1], reference: "" });
  const [edit, setEdit] = useState(false);
  const [ef, setEf] = useState({ goods_value: String(c?.goods_value ?? ""), compensation: String(c?.compensation ?? ""), description: c?.description || "" });
  const [undo, setUndo] = useState<string | null>(null);
  if (!c) return <div className="sheet-h"><p className="sub">This claim no longer exists.</p><button className="btn sm" onClick={ui.close}>Close</button></div>;
  const { paid, balance } = totals(c);
  const pays = claimPayments.filter((p) => p.claim_id === id).sort((a, b) => a.paid_on.localeCompare(b.paid_on));
  const ship = shipments.find((s) => s.id === c.shipment_id);
  const sw = company.message_lang !== "en";
  const msg = sw
    ? `Habari ${c.customer_name}, kuhusu mzigo ${c.waybill || ""} (${kindLabel(c.kind).split(" · ")[1].toLowerCase()}): fidia iliyokubaliwa ni TZS ${tzs(c.compensation)}. Tumekulipa TZS ${tzs(paid)}${balance ? `, salio ni TZS ${tzs(balance)}` : ", malipo yamekamilika"}. Samahani kwa usumbufu. ${company.name}`
    : `Hello ${c.customer_name}, about waybill ${c.waybill || ""} (${kindLabel(c.kind).split(" · ")[0].toLowerCase()}): the agreed compensation is TZS ${tzs(c.compensation)}. We have paid TZS ${tzs(paid)}${balance ? `; TZS ${tzs(balance)} remains` : "; it is fully paid"}. We apologise for the trouble. ${company.name}`;

  async function record(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(pay.amount);
    if (!(amount > 0)) return toast("Enter the amount paid to the customer.", true);
    if (amount > balance && balance > 0) return toast(`That's more than the TZS ${tzs(balance)} still owed.`, true);
    const p = await insert<ClaimPayment>("claim_payments", { claim_id: id, amount, paid_on: pay.paid_on, method: pay.method, reference: pay.reference.trim(), recorded_by: me.full_name });
    if (p) { toast(`Payment of TZS ${tzs(amount)} recorded.${amount >= balance ? " Claim fully paid." : ""}`); setPay({ ...pay, amount: "", reference: "" }); }
  }

  return (
    <>
      <div className="sheet-h">
        <div><div className="lbl">Claim · {kindLabel(c.kind)}</div><h2>{c.customer_name}</h2><div className="sub">{c.customer_phone ? prettyPhone(c.customer_phone) : "No phone"} · reported {day(c.reported_on)}{c.created_by_name ? ` by ${c.created_by_name}` : ""}</div></div>
        <button className="btn sm" onClick={ui.close}>Close</button>
      </div>
      <div className="card"><h3>Money</h3>
        <dl className="kv">
          <dt>Value of goods</dt><dd className="num">TZS {tzs(c.goods_value)}</dd>
          <dt>Compensation agreed</dt><dd className="num">TZS {tzs(c.compensation)}</dd>
          <dt>Paid so far</dt><dd className="num" style={{ color: "var(--good)" }}>TZS {tzs(paid)}</dd>
          <dt>Still owed</dt><dd className="num" style={{ fontWeight: 700, color: balance ? "var(--bad)" : "var(--good)" }}>{balance ? `TZS ${tzs(balance)}` : "Fully paid"}</dd>
        </dl>
        {c.customer_phone && (
          <div className="actions">
            <a className="btn wa sm" href={`https://wa.me/${intlPhone(c.customer_phone)}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer">Update customer on WhatsApp</a>
            <a className="btn sm" href={`sms:+${intlPhone(c.customer_phone)}?body=${encodeURIComponent(msg)}`}>SMS</a>
          </div>
        )}
      </div>
      <div className="card"><h3>What happened</h3>
        <p style={{ margin: 0 }}>{c.description || <span className="sub">No description.</span>}</p>
        <p className="note">Waybill {ship ? <a href="#" className="mono" onClick={(e) => { e.preventDefault(); ui.openShip(ship.id); }}>{ship.no}</a> : <span className="mono">{c.waybill || "—"}</span>}
          {ship && <> · {goodsLabel(ship)} · {ship.s_name} → {ship.r_name} · {regShort(ship.dest)}</>}</p>
      </div>
      {can("claims") && balance > 0 && !c.closed && (
        <form className="card" noValidate onSubmit={record}><h3>Record a payment to the customer</h3>
          <div className="fields">
            <label className="f">Amount (TZS)<input type="number" min={0} step={1000} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder={String(balance)} aria-label="Claim payment amount" /></label>
            <label className="f">Date paid<input type="date" value={pay.paid_on} onChange={(e) => setPay({ ...pay, paid_on: e.target.value })} aria-label="Claim payment date" /></label>
            <label className="f">Paid by<select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
            <label className="f">Reference <small>optional</small><input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>
          </div>
          <div className="actions"><button className="btn primary sm" type="submit">Record payment</button></div>
        </form>
      )}
      <div className="card"><h3>Payments · {pays.length}</h3>
        {pays.map((p) => (
          <div className="lrow" key={p.id} style={{ flexWrap: "wrap" }}>
            <div><b className="num">TZS {tzs(p.amount)}</b><div className="sub">{day(p.paid_on)}{p.method && ` · ${p.method}`}{p.reference && ` · ${p.reference}`}{p.recorded_by && ` · by ${p.recorded_by}`}</div></div>
            {can("delete") && (undo === p.id
              ? <div className="confirm">Remove? <button className="btn sm danger" onClick={async () => { setUndo(null); if (await remove("claim_payments", p.id)) toast("Payment removed"); }}>Remove</button><button className="btn sm" onClick={() => setUndo(null)}>Keep</button></div>
              : <button className="btn sm" onClick={() => setUndo(p.id)}>Remove</button>)}
          </div>
        ))}
        {!pays.length && <p className="sub">Nothing paid yet.</p>}
      </div>
      {can("delete") && (
        <div className="card"><h3>Admin</h3>
          {edit ? (
            <>
              <div className="fields">
                <label className="f">Value of goods (TZS)<input type="number" value={ef.goods_value} onChange={(e) => setEf({ ...ef, goods_value: e.target.value })} /></label>
                <label className="f">Compensation agreed (TZS)<input type="number" value={ef.compensation} onChange={(e) => setEf({ ...ef, compensation: e.target.value })} aria-label="Edit compensation" /></label>
                <label className="f full">What happened<textarea rows={2} value={ef.description} onChange={(e) => setEf({ ...ef, description: e.target.value })} /></label>
              </div>
              <div className="actions"><button className="btn sm primary" onClick={async () => { if (await patch<Claim>("claims", c.id, { goods_value: Number(ef.goods_value) || 0, compensation: Number(ef.compensation) || 0, description: ef.description.trim() })) { toast("Claim updated"); setEdit(false); } }}>Save</button><button className="btn sm" onClick={() => setEdit(false)}>Cancel</button></div>
            </>
          ) : (
            <div className="actions" style={{ marginTop: 0 }}>
              <button className="btn sm" onClick={() => setEdit(true)}>Change amounts</button>
              <button className="btn sm" onClick={async () => { if (await patch<Claim>("claims", c.id, { closed: !c.closed })) toast(c.closed ? "Claim reopened" : "Claim closed"); }}>{c.closed ? "Reopen claim" : "Close claim"}</button>
            </div>
          )}
          <p className="note">Only the Admin changes the agreed amounts or closes a claim. Close a claim when the customer accepts less than agreed or withdraws it.</p>
        </div>
      )}
    </>
  );
}
