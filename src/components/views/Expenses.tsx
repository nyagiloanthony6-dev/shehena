"use client";
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { useUi } from "../CargoApp";
import { Icon } from "../Icon";
import { usePaged, Pager } from "../parts";
import { EXPENSE_CATS, METHODS, REGIONS, officesOf, regShort, sumExp, tzs, fmtDate, type Expense, type Trip } from "@/lib/domain";

type Period = "today" | "7" | "month" | "last" | "all" | "custom";
const localDay = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const dayLabel = (d: string) => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** Can this person still change or delete the expense? Admin always; the recorder for 24 hours. */
export function canChangeExpense(e: Expense, me: { id: string; role: string }) {
  return me.role === "admin" || (e.created_by === me.id && Date.now() - new Date(e.created_at).getTime() < 24 * 36e5);
}

function csv(rows: Expense[], tripPlate: (id: string | null) => string, company: string) {
  const esc = (v: string | number) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["Date", "Type", "Office", "Trip / truck", "Category", "Description", "Paid to", "Method", "Reference", "TZS", "Recorded by"];
  const lines = rows.map((e) => [e.spent_on, e.kind === "trip" ? "Trip" : "Office", regShort(e.station), tripPlate(e.trip_id), e.category, e.description, e.paid_to, e.method, e.reference, e.amount, e.created_by_name].map(esc).join(","));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `${(company || "shehena").replace(/[^\w]+/g, "-").toLowerCase()}-expenses-${localDay(new Date())}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Record (or correct) an expense. With `trip`, it is that trip's expense. */
export function ExpenseForm({ trip, edit, onDone }: { trip?: Trip; edit?: Expense; onDone?: () => void }) {
  const { company, trips, me, insert, patch, toast } = useStore();
  const offices = officesOf(company);
  const station0 = me.station || trip?.origin || company.default_origin || offices[0];
  const [f, setF] = useState(() => ({
    kind: (edit?.kind || (trip ? "trip" : "office")) as Expense["kind"],
    trip_id: edit?.trip_id || trip?.id || "",
    station: edit?.station || station0,
    category: edit?.category || "",
    amount: edit ? String(edit.amount) : "",
    method: edit?.method || "Cash",
    paid_to: edit?.paid_to || "",
    reference: edit?.reference || "",
    spent_on: edit?.spent_on || localDay(new Date()),
    description: edit?.description || "",
  }));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const recent = useMemo(() => trips.filter((t) => t.status !== "arrived" || Date.now() - new Date(t.arrived_at || t.created_at).getTime() < 45 * 864e5)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 60), [trips]);
  const cats = EXPENSE_CATS[f.kind];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const amount = Math.round(Number(f.amount));
    if (f.kind === "trip" && !f.trip_id) return setErr("Choose the trip.");
    if (!f.category.trim()) return setErr("Choose or type what the money was for.");
    if (!(amount > 0)) return setErr("Enter the amount.");
    setErr(""); setBusy(true);
    const row = { kind: f.kind, trip_id: f.kind === "trip" ? f.trip_id : null, station: me.station || f.station, category: f.category.trim(), amount,
      method: f.method, paid_to: f.paid_to.trim(), reference: f.reference.trim(), spent_on: f.spent_on, description: f.description.trim() };
    const ok = edit ? await patch<Expense>("expenses", edit.id, row) : !!(await insert<Expense>("expenses", { ...row, created_by: me.id, created_by_name: me.full_name, created_at: new Date().toISOString() }));
    setBusy(false);
    if (!ok) return;
    toast(edit ? "Expense updated" : `Expense recorded · TZS ${tzs(amount)} ${f.category.trim()}`);
    if (!edit) setF((x) => ({ ...x, category: "", amount: "", paid_to: "", reference: "", description: "" }));
    onDone?.();
  }

  return (
    <form noValidate onSubmit={save} className="expform">
      {!trip && !edit && (
        <div className="seg" role="radiogroup" aria-label="Expense type">
          <button type="button" aria-pressed={f.kind === "office"} onClick={() => setF((x) => ({ ...x, kind: "office", category: "" }))}>Office expense</button>
          <button type="button" aria-pressed={f.kind === "trip"} onClick={() => setF((x) => ({ ...x, kind: "trip", category: "", trip_id: x.trip_id || recent[0]?.id || "" }))}>Trip expense</button>
        </div>
      )}
      <div className="fields">
        {f.kind === "trip" && !trip && (
          <label className="f full">Trip<select value={f.trip_id} onChange={(e) => set("trip_id", e.target.value)}>
            <option value="">Choose the truck / trip…</option>
            {recent.map((t) => <option key={t.id} value={t.id}>{t.plate} · {regShort(t.origin)} → {regShort(t.dest)} · {t.status === "loading" ? "loading" : t.status === "departed" ? "on the road" : "arrived"} · {t.no}</option>)}
          </select></label>
        )}
        <div className="f full"><span>What for</span>
          <div className="chips catchips">{cats.map((c) => <button type="button" key={c} className="chip" aria-pressed={f.category === c} onClick={() => set("category", c)}>{c}</button>)}</div>
          <input value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="Or type another" aria-label="Category" list={`cats-${f.kind}`} />
          <datalist id={`cats-${f.kind}`}>{cats.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <label className="f">Amount (TZS)<input type="number" inputMode="numeric" min={0} step={500} value={f.amount} onChange={(e) => set("amount", e.target.value)} placeholder="e.g. 20000" /></label>
        <label className="f">Paid by<select value={f.method} onChange={(e) => set("method", e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="f">Paid to <small>optional</small><input value={f.paid_to} onChange={(e) => set("paid_to", e.target.value)} placeholder="e.g. TRA, Mizani Kibaha, Hamisi" /></label>
        <label className="f">Receipt / control no. <small>optional</small><input value={f.reference} onChange={(e) => set("reference", e.target.value)} /></label>
        <label className="f">Date<input type="date" value={f.spent_on} max={localDay(new Date())} onChange={(e) => e.target.value && set("spent_on", e.target.value)} /></label>
        <label className="f">Office that paid{me.station && <small>your office</small>}
          <select value={me.station || f.station} disabled={!!me.station} onChange={(e) => set("station", e.target.value)}>
            {offices.map((c) => <option key={c} value={c}>{REGIONS.find(([r]) => r === c)?.[1] || c}</option>)}
          </select></label>
        <label className="f full">Note <small>optional</small><input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. 3 vibarua for offloading" /></label>
      </div>
      <div className="err" role="alert">{err}</div>
      <div className="actions" style={{ marginTop: 4 }}>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : edit ? "Save changes" : "Record expense"}</button>
        {onDone && <button className="btn" type="button" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}

export default function Expenses() {
  const { expenses, hasExpenses, trips, company, can, me } = useStore();
  const ui = useUi();
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<Period>("month");
  const today = localDay(new Date());
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [kind, setKind] = useState<"" | Expense["kind"]>("");
  const [office, setOffice] = useState("");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const tripOf = (id: string | null) => (id ? trips.find((t) => t.id === id) : undefined);
  const plate = (id: string | null) => { const t = tripOf(id); return t ? `${t.plate} (${t.no})` : ""; };

  const range = useMemo((): [string, string] => {
    const now = new Date();
    if (period === "custom") return [from, to];
    if (period === "today") return [today, today];
    if (period === "7") return [localDay(new Date(now.getTime() - 6 * 864e5)), today];
    if (period === "month") return [today.slice(0, 8) + "01", today];
    if (period === "last") { const d = new Date(now.getFullYear(), now.getMonth(), 0); return [localDay(new Date(d.getFullYear(), d.getMonth(), 1)), localDay(d)]; }
    return ["0000-01-01", "9999-12-31"];
  }, [period, from, to, today]);
  const inP = expenses.filter((e) => e.spent_on >= range[0] && e.spent_on <= range[1]);
  const offices = [...new Set(inP.map((e) => e.station))];
  const catsHere = [...new Set(inP.filter((e) => !kind || e.kind === kind).map((e) => e.category))].sort();
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return inP.filter((e) => (!kind || e.kind === kind) && (!office || e.station === office) && (!cat || e.category === cat) &&
      (!ql || [e.category, e.description, e.paid_to, e.reference, e.created_by_name, plate(e.trip_id)].join(" ").toLowerCase().includes(ql)))
      .sort((a, b) => b.spent_on.localeCompare(a.spent_on) || b.created_at.localeCompare(a.created_at));
  }, [inP, kind, office, cat, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const { rows, pager } = usePaged(list, [period, from, to, kind, office, cat, q].join("|"));
  const byCat = Object.entries(list.reduce<Record<string, number>>((a, e) => { a[e.category] = (a[e.category] || 0) + Number(e.amount); return a; }, {})).sort((a, b) => b[1] - a[1]);
  const top = byCat[0]?.[1] || 1;
  const total = sumExp(list);
  const recordable = can("receive");

  return (
    <section>
      <div className="sectionhead">
        <div><h1>Expenses</h1><div className="sub">Trip charges (TRA, Mizani, fuel…) and office costs (wages, day workers, security, city council, petty cash), recorded by the office that paid.</div></div>
        {recordable && hasExpenses && <button className={`btn${open ? "" : " primary"}`} onClick={() => setOpen(!open)}>{open ? "Close" : <><Icon name="new" />Record expense</>}</button>}
      </div>
      {!hasExpenses && <p className="note">Run database update 0026 in Supabase to start recording expenses.</p>}
      {open && <fieldset style={{ marginTop: 12 }}><legend>Record an expense</legend><ExpenseForm /></fieldset>}

      <div className="filters" style={{ marginTop: 14 }}>
        <div className="chips">{([["today", "Today"], ["7", "7 days"], ["month", "This month"], ["last", "Last month"], ["all", "All time"], ["custom", "Dates…"]] as [Period, string][]).map(([k, l]) =>
          <button key={k} className="chip" aria-pressed={period === k} onClick={() => setPeriod(k)}>{l}</button>)}</div>
        {period === "custom" && <span className="datefilter">
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="From date" style={{ width: "auto" }} />
          <span className="sub">to</span>
          <input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="To date" style={{ width: "auto" }} /></span>}
      </div>

      <div className="stats">
        <div className="stat"><div className="lbl">Total spent</div><div className="v">{tzs(total)}</div><div className="s">TZS · {list.length} expense{list.length === 1 ? "" : "s"}</div></div>
        <div className="stat"><div className="lbl">Trip expenses</div><div className="v">{tzs(sumExp(list.filter((e) => e.kind === "trip")))}</div><div className="s">TZS on {new Set(list.filter((e) => e.trip_id).map((e) => e.trip_id)).size} trips</div></div>
        <div className="stat"><div className="lbl">Office expenses</div><div className="v">{tzs(sumExp(list.filter((e) => e.kind === "office")))}</div><div className="s">TZS</div></div>
        <div className="stat"><div className="lbl">Biggest</div><div className="v" style={{ fontSize: byCat[0] ? undefined : 18 }}>{byCat[0] ? tzs(byCat[0][1]) : "—"}</div><div className="s">{byCat[0] ? byCat[0][0] : "nothing yet"}</div></div>
      </div>

      <div className="filters" style={{ marginTop: 12 }}>
        <div className="searchbox"><Icon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search category, note, paid to, truck" aria-label="Search expenses" /></div>
        <div className="chips">{([["", "All"], ["trip", "Trip"], ["office", "Office"]] as ["" | Expense["kind"], string][]).map(([k, l]) =>
          <button key={k} className="chip" aria-pressed={kind === k} onClick={() => { setKind(k); setCat(""); }}>{l}</button>)}</div>
        {offices.length > 1 && !me.station && <select value={office} onChange={(e) => setOffice(e.target.value)} aria-label="Office" style={{ width: "auto" }}>
          <option value="">All offices</option>{offices.map((c) => <option key={c} value={c}>{regShort(c)}</option>)}</select>}
        {catsHere.length > 1 && <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category" style={{ width: "auto" }}>
          <option value="">All categories</option>{catsHere.map((c) => <option key={c} value={c}>{c}</option>)}</select>}
      </div>

      {byCat.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="ph"><h2>By category</h2>{list.length > 0 && <button className="btn sm" onClick={() => csv(list, plate, company.name)}>Download (Excel)</button>}</div>
          <div className="catbars">{byCat.map(([c, v]) => (
            <button key={c} className="catbar" onClick={() => setCat(cat === c ? "" : c)} aria-pressed={cat === c}>
              <span className="cb-l">{c}</span><span className="cb-bar"><i style={{ width: `${Math.max(3, (v / top) * 100)}%` }} /></span><span className="cb-v num">{tzs(v)}</span>
            </button>))}
          </div>
        </div>
      )}

      {list.length > 0 && (
        <div className="ledger main"><table>
          <thead><tr><th>Date</th><th>What for</th><th>Office / trip</th><th>Paid to</th><th className="r">TZS</th><th>Recorded by</th></tr></thead>
          <tbody>{rows.map((e) => { const t = tripOf(e.trip_id); return (
            <tr className="row" key={e.id} tabIndex={0} onClick={() => ui.openExpense(e.id)} onKeyDown={(k) => k.key === "Enter" && ui.openExpense(e.id)}>
              <td>{dayLabel(e.spent_on)}</td>
              <td><b style={{ fontWeight: 600 }}>{e.category}</b><span className={`exk ${e.kind}`}>{e.kind === "trip" ? "Trip" : "Office"}</span>{e.description && <div className="sub">{e.description}</div>}</td>
              <td>{regShort(e.station)}{t && <div className="sub mono">{t.plate}</div>}</td>
              <td>{e.paid_to || <span className="sub">—</span>}<div className="sub">{e.method}{e.reference ? ` · ${e.reference}` : ""}</div></td>
              <td className="r num" style={{ fontWeight: 600 }}>{tzs(e.amount)}</td>
              <td className="sub">{e.created_by_name}</td>
            </tr>); })}</tbody>
          <tfoot><tr><td colSpan={4}>Total</td><td className="r num">{tzs(total)}</td><td /></tr></tfoot>
        </table></div>
      )}
      <div className="cards">{rows.map((e) => { const t = tripOf(e.trip_id); return (
        <button className="ccard" key={e.id} onClick={() => ui.openExpense(e.id)}>
          <div className="ctop"><b>{e.category}</b><b className="num">TZS {tzs(e.amount)}</b></div>
          <div className="sub">{dayLabel(e.spent_on)} · {regShort(e.station)}{t ? ` · ${t.plate}` : ""}<span className={`exk ${e.kind}`}>{e.kind === "trip" ? "Trip" : "Office"}</span></div>
          {(e.description || e.paid_to) && <div className="sub">{[e.paid_to, e.description].filter(Boolean).join(" · ")}</div>}
        </button>); })}</div>
      <Pager pager={pager} />
      {hasExpenses && !expenses.length && <div className="empty"><h3>No expenses yet</h3><p>Record trip charges like TRA and Mizani on each truck, and office costs like wages and security here.</p>
        {recordable && <button className="btn primary" onClick={() => setOpen(true)}>Record the first expense</button>}</div>}
      {expenses.length > 0 && !list.length && <div className="empty"><h3>Nothing in this period</h3><p>Choose another period or clear the filters.</p></div>}
    </section>
  );
}

export function ExpenseSheet({ id }: { id: string }) {
  const { expenses, trips, me, remove, toast } = useStore();
  const ui = useUi();
  const e = expenses.find((x) => x.id === id);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  if (!e) return <div className="sheet-h"><p className="sub">This expense no longer exists.</p><button className="btn sm" onClick={ui.close}>Close</button></div>;
  const t = e.trip_id ? trips.find((x) => x.id === e.trip_id) : undefined;
  const mine = canChangeExpense(e, me);
  return (
    <>
      <div className="sheet-h">
        <div><div className="lbl">{e.kind === "trip" ? "Trip expense" : "Office expense"} · {dayLabel(e.spent_on)}</div><h2>{e.category} · TZS {tzs(e.amount)}</h2></div>
        <div style={{ display: "flex", gap: 8 }}>
          {mine && !edit && <button className="btn sm" onClick={() => setEdit(true)}>Edit</button>}
          <button className="btn sm" onClick={ui.close}>Close</button>
        </div>
      </div>
      {edit ? <div className="card"><ExpenseForm edit={e} trip={t} onDone={() => setEdit(false)} /></div> : (
        <div className="card">
          <dl className="kv">
            <dt>Amount</dt><dd><b>TZS {tzs(e.amount)}</b> · {e.method}</dd>
            <dt>Office</dt><dd>{regShort(e.station)}</dd>
            {t && <><dt>Trip</dt><dd><a href="#" onClick={(x) => { x.preventDefault(); ui.openTrip(t.id); }}><span className="mono">{t.plate}</span> · {t.no}</a> · {regShort(t.origin)} → {regShort(t.dest)}</dd></>}
            {e.paid_to && <><dt>Paid to</dt><dd>{e.paid_to}</dd></>}
            {e.reference && <><dt>Receipt no.</dt><dd className="mono">{e.reference}</dd></>}
            {e.description && <><dt>Note</dt><dd>{e.description}</dd></>}
            <dt>Recorded</dt><dd>{e.created_by_name || "—"} · {fmtDate(e.created_at)}</dd>
            {e.updated_at && <><dt>Changed</dt><dd>{e.updated_by || "—"} · {fmtDate(e.updated_at)}</dd></>}
          </dl>
          {!mine && <p className="note">Only the Admin can change this expense now (the person who recorded it can for 24 hours).</p>}
          {mine && (
            <div className="actions">
              {del ? <div className="confirm">Delete this expense? <button className="btn sm danger" onClick={async () => { ui.close(); if (await remove("expenses", e.id)) toast("Expense deleted"); }}>Delete</button><button className="btn sm" onClick={() => setDel(false)}>Keep</button></div>
                : <button className="btn sm danger" onClick={() => setDel(true)}>Delete expense</button>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
