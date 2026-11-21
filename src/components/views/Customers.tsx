"use client";
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { useUi } from "../CargoApp";
import { Icon } from "../Icon";
import { PayPill, StatusPill, usePaged, Pager } from "../parts";
import { customerRows, customerShips, intlPhone, isPart, noPrice, goodsLabel, fmtDate, fmtDay, prettyPhone, regShort, tzs, type CustomerRow } from "@/lib/domain";

type Sort = "new" | "most" | "last" | "name" | "unpaid";
const SORTS: [Sort, string][] = [["new", "Newest registered"], ["most", "Most consignments"], ["last", "Last consignment"], ["unpaid", "Most unpaid"], ["name", "Name A–Z"]];

/** "02 Mar 2026" */
const dayYear = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const localDay = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };

/** CSV that Excel opens directly (UTF-8 with BOM). */
function downloadCsv(rows: CustomerRow[], company: string) {
  const esc = (v: string | number) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["Name", "Phone", "Registered", "Sent", "Received", "Last consignment", "Total charges (TZS)", "Unpaid (TZS)", "Notes"];
  const lines = rows.map((r) => [r.name, "+" + r.phone, r.registered ? localDay(r.registered) : "", r.sent, r.received, r.last ? localDay(r.last) : "", r.value, r.unpaid, r.notes].map(esc).join(","));
  const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(company || "shehena").replace(/[^\w]+/g, "-").toLowerCase()}-customers-${localDay(new Date().toISOString())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Add a customer by hand: name, phone and an optional note. Registered today. */
function NewCustomer({ all, onDone }: { all: CustomerRow[]; onDone: (phone?: string) => void }) {
  const { saveCustomer, toast } = useStore();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ph = intlPhone(phone);
  const dup = ph.length >= 12 ? all.find((r) => r.phone === ph) : undefined;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setErr("Enter the customer's name.");
    if (!/^255[67]\d{8}$/.test(ph)) return setErr("Enter a valid phone number, e.g. 0712 345 678.");
    if (dup?.id) return setErr(`${prettyPhone(ph)} is already saved as ${dup.name || "a customer"}.`);
    setErr(""); setBusy(true);
    const ok = await saveCustomer(ph, { name: name.trim(), notes: notes.trim() });
    setBusy(false);
    if (!ok) return;
    toast(`Customer added: ${name.trim()}`);
    onDone(ph);
  }
  return (
    <form noValidate onSubmit={save} className="card cu-new">
      <h3>New customer</h3>
      <div className="fields">
        <label className="f">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Asha Mohamed" autoFocus /></label>
        <label className="f">Phone number<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="0712 345 678" /></label>
        <label className="f full">Notes <small>optional: shop name, location, usual goods</small><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>
      {dup && <p className="note">This number is already a customer: <a href="#" onClick={(x) => { x.preventDefault(); onDone(dup.phone); }}><b>{dup.name || prettyPhone(dup.phone)}</b></a>{dup.id ? "" : " (from consignments; saving keeps the name you type)"}.</p>}
      <div className="err" role="alert">{err}</div>
      <div className="actions">
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save customer"}</button>
        <button className="btn" type="button" onClick={() => onDone()}>Cancel</button>
      </div>
    </form>
  );
}

export default function Customers() {
  const { shipments, customers, hasCustomers, company, can } = useStore();
  const [adding, setAdding] = useState(false);
  const ui = useUi();
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "month" | "senders" | "receivers" | "unpaid">("all");
  const [sort, setSort] = useState<Sort>("new");
  const all = useMemo(() => customerRows(shipments, customers), [shipments, customers]);
  const today = localDay(new Date().toISOString());
  const monthStart = today.slice(0, 8) + "01";
  const newMonth = all.filter((r) => r.registered && localDay(r.registered) >= monthStart);
  const active30 = all.filter((r) => r.last && Date.now() - new Date(r.last).getTime() < 30 * 864e5);

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const qd = ql.replace(/\D/g, "").replace(/^(255|0)/, "");
    const L = all.filter((r) =>
      (show === "all" || (show === "month" ? localDay(r.registered) >= monthStart : show === "senders" ? r.sent > 0 : show === "receivers" ? r.received > 0 : r.unpaid > 0)) &&
      (!ql || [r.name, ...r.names, r.notes].join(" ").toLowerCase().includes(ql) || (qd.length >= 3 && r.phone.includes(qd))));
    const by: Record<Sort, (a: CustomerRow, b: CustomerRow) => number> = {
      new: (a, b) => b.registered.localeCompare(a.registered),
      most: (a, b) => b.sent + b.received - (a.sent + a.received),
      last: (a, b) => (b.last || "").localeCompare(a.last || ""),
      unpaid: (a, b) => b.unpaid - a.unpaid,
      name: (a, b) => (a.name || "~").localeCompare(b.name || "~"),
    };
    return [...L].sort(by[sort]);
  }, [all, q, show, sort, monthStart]);
  const { rows, pager } = usePaged(list, [q, show, sort].join("|"));

  return (
    <section>
      <div className="sectionhead">
        <div><h1>Customers</h1><div className="sub">Everyone who has sent or received goods. A customer is registered with their first consignment; new ones are added automatically.</div></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {all.length > 0 && <button className="btn" onClick={() => downloadCsv(list, company.name)}>Download (Excel)</button>}
          {hasCustomers && can("receive") && !adding && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="new" />New customer</button>}
        </div>
      </div>
      {adding && <NewCustomer all={all} onDone={(ph) => { setAdding(false); if (ph) ui.openCustomer(ph); }} />}
      {!hasCustomers && all.length > 0 && <p className="note">These customers come from your consignments. Run database update 0025 in Supabase to save them and keep notes.</p>}
      <div className="stats cu-stats">
        <div className="stat"><div className="lbl">Customers</div><div className="v">{all.length}</div><div className="s">{all.filter((r) => r.sent).length} senders · {all.filter((r) => r.received).length} receivers</div></div>
        <div className="stat"><div className="lbl">New this month</div><div className="v">{newMonth.length}</div><div className="s">registered since {fmtDay(monthStart)}</div></div>
        <div className="stat"><div className="lbl">Active</div><div className="v">{active30.length}</div><div className="s">sent or received in the last 30 days</div></div>
      </div>
      <div className="filters" style={{ marginTop: 14 }}>
        <div className="searchbox"><Icon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer name or phone" aria-label="Search customers" /></div>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort customers" style={{ width: "auto" }}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      <div className="filters" style={{ marginTop: 8 }}>
        <div className="chips">{([["all", `All · ${all.length}`], ["month", `New this month · ${newMonth.length}`], ["senders", "Senders"], ["receivers", "Receivers"], ["unpaid", "Owe money"]] as [typeof show, string][]).map(([k, l]) =>
          <button key={k} className="chip" aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}</div>
      </div>
      {list.length > 0 && (
        <div className="ledger main"><table>
          <thead><tr><th>Customer</th><th>Registered</th><th className="r">Sent</th><th className="r">Received</th><th>Last consignment</th><th className="r">Unpaid (TZS)</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr className="row" key={r.phone} tabIndex={0} onClick={() => ui.openCustomer(r.phone)} onKeyDown={(e) => e.key === "Enter" && ui.openCustomer(r.phone)}>
              <td><b style={{ fontWeight: 600 }}>{r.name || "No name"}</b><div className="sub mono">{prettyPhone(r.phone)}</div></td>
              <td>{dayYear(r.registered)}</td>
              <td className="r num">{r.sent}</td>
              <td className="r num">{r.received}</td>
              <td>{r.last ? fmtDay(r.last) : <span className="sub">—</span>}</td>
              <td className="r num" style={{ color: r.unpaid ? "var(--bad)" : undefined }}>{r.unpaid ? tzs(r.unpaid) : "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="cards">{rows.map((r) => (
        <button className="ccard" key={r.phone} onClick={() => ui.openCustomer(r.phone)}>
          <div className="ctop"><b>{r.name || "No name"}</b><span className="sub">since {dayYear(r.registered)}</span></div>
          <div className="sub mono">{prettyPhone(r.phone)}</div>
          <div className="cbot"><span className="sub">{r.sent} sent · {r.received} received{r.last ? ` · last ${fmtDay(r.last)}` : ""}</span>{r.unpaid > 0 && <b style={{ color: "var(--bad)" }}>TZS {tzs(r.unpaid)}</b>}</div>
        </button>
      ))}</div>
      <Pager pager={pager} />
      {!all.length && <div className="empty"><h3>No customers yet</h3><p>Senders and receivers are saved here when you receive goods.</p></div>}
      {all.length > 0 && !list.length && <div className="empty"><h3>Nothing matches</h3><p>Try another name or phone number, or clear the filters.</p></div>}
    </section>
  );
}

export function CustomerSheet({ phone }: { phone: string }) {
  const { shipments, customers, hasCustomers, saveCustomer, can, toast } = useStore();
  const ui = useUi();
  const ph = intlPhone(phone);
  const row = useMemo(() => customerRows(shipments, customers).find((r) => r.phone === ph), [shipments, customers, ph]);
  const ships = useMemo(() => customerShips(shipments, ph), [shipments, ph]);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(row?.name || "");
  const [notes, setNotes] = useState(row?.notes || "");
  if (!row) return <div className="sheet-h"><p className="sub">This customer was not found.</p><button className="btn sm" onClick={ui.close}>Close</button></div>;
  const paidSum = ships.reduce((a, s) => a + (s.pay === "paid" ? Number(s.charge || 0) : isPart(s) ? Number(s.paid_amount || 0) : 0), 0);
  const canEdit = hasCustomers && can("receive");
  const wa = `https://wa.me/${row.phone}`;

  return (
    <>
      <div className="sheet-h">
        <div><div className="lbl">Customer · registered {dayYear(row.registered)}</div><h2>{row.name || "No name"}</h2><div className="sub mono">{prettyPhone(row.phone)}</div></div>
        <button className="btn sm" onClick={ui.close}>Close</button>
      </div>
      <div className="actions" style={{ marginTop: 0 }}>
        <a className="btn sm" href={`tel:+${row.phone}`}>Call</a>
        <a className="btn sm" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>
        {canEdit && !edit && <button className="btn sm" onClick={() => { setName(row.name); setNotes(row.notes); setEdit(true); }}>Edit name / notes</button>}
      </div>
      {edit && (
        <div className="card">
          <div className="fields">
            <label className="f">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" /></label>
            <label className="f">Phone <small>can&apos;t change</small><input value={prettyPhone(row.phone)} readOnly /></label>
            <label className="f full">Notes <small>e.g. shop name, location, usual goods</small><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          </div>
          <div className="actions">
            <button className="btn primary" onClick={async () => { if (await saveCustomer(row.phone, { name: name.trim(), notes: notes.trim() })) { toast("Customer saved"); setEdit(false); } }}>Save</button>
            <button className="btn" onClick={() => setEdit(false)}>Cancel</button>
          </div>
          <p className="note">The new name is used the next time you receive goods for this phone number.</p>
        </div>
      )}
      {!edit && row.notes && <div className="card"><h3>Notes</h3><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{row.notes}</p></div>}
      <div className="stats cu-stats" style={{ marginTop: 12 }}>
        <div className="stat"><div className="lbl">Consignments</div><div className="v">{ships.length}</div><div className="s">{row.sent} sent · {row.received} received</div></div>
        <div className="stat"><div className="lbl">Total charges</div><div className="v">{tzs(row.value)}</div><div className="s">TZS · {tzs(paidSum)} paid</div></div>
        <div className={`stat${row.unpaid ? " warn" : ""}`}><div className="lbl">Unpaid</div><div className="v">{tzs(row.unpaid)}</div><div className="s">TZS{row.last ? ` · last ${fmtDay(row.last)}` : ""}</div></div>
      </div>
      {row.names.length > 1 && <p className="note">Also recorded as: {row.names.filter((n) => n !== row.name).join(", ")}</p>}
      <div className="card"><h3>Consignments · {ships.length}</h3>
        {ships.map((s) => {
          const asSender = intlPhone(s.s_phone) === row.phone;
          return (
            <button className="lrow cu-ship" key={s.id} onClick={() => ui.openShip(s.id)}>
              <div><span className="mono">{s.no}</span> · <b>{goodsLabel(s)}</b> · {s.pkgs} pkg
                <div className="sub"><span className={`cu-role ${asSender ? "s" : "r"}`}>{asSender ? "Sent" : "Received"}</span> {asSender ? `to ${s.r_name || "—"}` : `from ${s.s_name || "—"}`} · {regShort(s.origin)} → {regShort(s.dest)} · {fmtDate(s.received_at)}</div>
              </div>
              <div className="r" style={{ textAlign: "right" }}><StatusPill s={s.status} /><div style={{ marginTop: 4 }}>{noPrice(s) ? <span className="pill no-price">No price yet</span> : <PayPill pay={s.pay} part={isPart(s)} />}</div></div>
            </button>
          );
        })}
        {!ships.length && <p className="sub">No consignments yet.</p>}
      </div>
    </>
  );
}
