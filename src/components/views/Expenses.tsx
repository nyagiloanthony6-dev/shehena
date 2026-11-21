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

const OTHER = "__other";
const CAT_ICON: [RegExp, string][] = [[/\btra\b|tax/i, "TR"], [/mizani|weigh/i, "MZ"], [/fuel|diesel|mafuta/i, "FU"], [/driver|turnboy|allow/i, "DR"], [/toll|park/i, "TL"], [/police|fine/i, "PO"], [/load/i, "LD"], [/repair|tyre|spare/i, "RP"],
  [/wage|salar|mshahara/i, "WG"], [/day work|vibarua/i, "VB"], [/secur|guard|mlinzi/i, "SC"], [/city|jiji|council/i, "JJ"], [/rent|kodi/i, "RN"], [/electric|water|maji|umeme/i, "EW"], [/airtime|internet|bundle/i, "AT"], [/station|print/i, "ST"], [/transport|bodaboda/i, "TP"], [/tea|food|chai/i, "TF"], [/petty/i, "PC"]];
/** Two-letter badge for a category. */
export const catBadge = (c: string) => (CAT_ICON.find(([r]) => r.test(c))?.[1] || c.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "EX").slice(0, 2);

/** Record (or correct) an expense. With `trip`, it is that trip's expense. */
export function ExpenseForm({ trip, edit, onDone }: { trip?: Trip; edit?: Expense; onDone?: () => void }) {
  const { company, trips, me, insert, patch, toast, expenses } = useStore();
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
  const [other, setOther] = useState(false);
  const [more, setMore] = useState(!!edit);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const recent = useMemo(() => trips.filter((t) => t.status !== "arrived" || Date.now() - new Date(t.arrived_at || t.created_at).getTime() < 45 * 864e5)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 60), [trips]);
  // Suggested categories plus the ones this company already uses.
  const cats = useMemo(() => {
    const base = EXPENSE_CATS[f.kind];
    const used = [...new Set(expenses.filter((e) => e.kind === f.kind).map((e) => e.category))].filter((c) => !base.includes(c)).sort();
    return { base, used };
  }, [expenses, f.kind]);
  const known = cats.base.includes(f.category) || cats.used.includes(f.category);
  const showOther = other || (!!f.category && !known);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const amount = Math.round(Number(String(f.amount).replace(/[^\d.]/g, "")));
    if (f.kind === "trip" && !f.trip_id) return setErr("Choose the trip.");
    if (!f.category.trim()) return setErr("Choose what the money was for.");
    if (!(amount > 0)) return setErr("Enter the amount.");
    setErr(""); setBusy(true);
    const row = { kind: f.kind, trip_id: f.kind === "trip" ? f.trip_id : null, station: me.station || f.station, category: f.category.trim(), amount,
      method: f.method, paid_to: f.paid_to.trim(), reference: f.reference.trim(), spent_on: f.spent_on, description: f.description.trim() };
    const ok = edit ? await patch<Expense>("expenses", edit.id, row) : !!(await insert<Expense>("expenses", { ...row, created_by: me.id, created_by_name: me.full_name, created_at: new Date().toISOString() }));
    setBusy(false);
    if (!ok) return;
    toast(edit ? "Expense updated" : `Expense recorded · TZS ${tzs(amount)} · ${f.category.trim()}`);
    if (!edit) { setF((x) => ({ ...x, category: "", amount: "", paid_to: "", reference: "", description: "" })); setOther(false); }
    onDone?.();
  }

  return (
    <form noValidate onSubmit={save} className="xf">
      {!trip && !edit && (
        <div className="xf-seg" role="radiogroup" aria-label="Expense type">
          <button type="button" role="radio" aria-checked={f.kind === "office"} onClick={() => { setF((x) => ({ ...x, kind: "office", category: "" })); setOther(false); }}>Office expense</button>
          <button type="button" role="radio" aria-checked={f.kind === "trip"} onClick={() => { setF((x) => ({ ...x, kind: "trip", category: "", trip_id: x.trip_id || recent[0]?.id || "" })); setOther(false); }}>Trip expense</button>
        </div>
      )}
      {f.kind === "trip" && !trip && (
        <label className="xf-f">Truck / trip<select value={f.trip_id} onChange={(e) => set("trip_id", e.target.value)}>
          <option value="">Choose the trip…</option>
          {recent.map((t) => <option key={t.id} value={t.id}>{t.plate} · {regShort(t.origin)} → {regShort(t.dest)} · {t.status === "loading" ? "loading" : t.status === "departed" ? "on the road" : "arrived"}</option>)}
        </select></label>
      )}
      <div className="xf-main">
        <label className="xf-f">What for
          <select value={showOther ? OTHER : f.category} onChange={(e) => { if (e.target.value === OTHER) { setOther(true); set("category", ""); } else { setOther(false); set("category", e.target.value); } }} aria-label="Category">
            <option value="">Choose…</option>
            <optgroup label={f.kind === "trip" ? "Trip charges" : "Office costs"}>{cats.base.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
            {cats.used.length > 0 && <optgroup label="Used before">{cats.used.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>}
            <option value={OTHER}>Other… (type it)</option>
          </select>
        </label>
        <label className="xf-f xf-amt">Amount
          <span className="xf-tzs"><i>TZS</i><input inputMode="numeric" value={f.amount ? tzs(String(f.amount).replace(/[^\d]/g, "")) : ""} onChange={(e) => set("amount", e.target.value.replace(/[^\d]/g, ""))} placeholder="0" aria-label="Amount in TZS" /></span>
        </label>
        <label className="xf-f">Paid by<select value={f.method} onChange={(e) => set("method", e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
      </div>
      {showOther && <label className="xf-f">Other: what was it for?<input autoFocus value={f.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Generator service" /></label>}
      {!more && <button type="button" className="xf-more" onClick={() => setMore(true)}>+ Paid to, receipt no., date, note</button>}
      {more && (
        <div className="xf-grid">
          <label className="xf-f">Paid to<input value={f.paid_to} onChange={(e) => set("paid_to", e.target.value)} placeholder="e.g. TRA, Mizani Vigwaza, Hamisi" /></label>
          <label className="xf-f">Receipt / control no.<input value={f.reference} onChange={(e) => set("reference", e.target.value)} /></label>
          <label className="xf-f">Date<input type="date" value={f.spent_on} max={localDay(new Date())} onChange={(e) => e.target.value && set("spent_on", e.target.value)} /></label>
          <label className="xf-f">Office that paid
            <select value={me.station || f.station} disabled={!!me.station} onChange={(e) => set("station", e.target.value)}>
              {offices.map((c) => <option key={c} value={c}>{REGIONS.find(([r]) => r === c)?.[1] || c}</option>)}
            </select></label>
          <label className="xf-f xf-wide">Note<input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. 3 vibarua for offloading" /></label>
        </div>
      )}
      <div className="err" role="alert">{err}</div>
      <div className="xf-actions">
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : edit ? "Save changes" : "Record expense"}</button>
        {onDone && <button className="btn" type="button" onClick={onDone}>Cancel</button>}
        {!more && <span className="sub">Office: {regShort(me.station || f.station)} · {dayLabel(f.spent_on)}</span>}
      </div>
    </form>
  );
}

type Line = { key: number; category: string; other: boolean; amount: string; method: string; paid_to: string; description: string };
let lineKey = 1;
const blank = (method = "Cash"): Line => ({ key: lineKey++, category: "", other: false, amount: "", method, paid_to: "", description: "" });

/** Record several expenses in one go: add lines, then save them all together. With `trip`, they are that trip's expenses. */
export function ExpenseBatch({ trip, onDone }: { trip?: Trip; onDone?: () => void }) {
  const { company, trips, me, insert, toast, expenses } = useStore();
  const offices = officesOf(company);
  const [kind, setKind] = useState<Expense["kind"]>(trip ? "trip" : "office");
  const [tripId, setTripId] = useState(trip?.id || "");
  const [station, setStation] = useState(me.station || trip?.origin || company.default_origin || offices[0]);
  const [day, setDay] = useState(localDay(new Date()));
  const [lines, setLines] = useState<Line[]>(() => [blank()]);
  const [err, setErr] = useState("");
  const [bad, setBad] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const recent = useMemo(() => trips.filter((t) => t.status !== "arrived" || Date.now() - new Date(t.arrived_at || t.created_at).getTime() < 45 * 864e5)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 60), [trips]);
  const cats = useMemo(() => {
    const base = EXPENSE_CATS[kind];
    const used = [...new Set(expenses.filter((e) => e.kind === kind).map((e) => e.category))].filter((c) => !base.includes(c)).sort();
    return { base, used };
  }, [expenses, kind]);
  const amt = (l: Line) => Math.round(Number(l.amount || 0));
  const filled = lines.filter((l) => l.category.trim() || amt(l) > 0);
  const total = filled.reduce((a, l) => a + amt(l), 0);
  const upd = (key: number, v: Partial<Line>) => setLines((L) => L.map((l) => (l.key === key ? { ...l, ...v } : l)));
  const addLine = () => setLines((L) => [...L, blank(L[L.length - 1]?.method)]);
  const focusLast = () => setTimeout(() => { const el = document.querySelectorAll<HTMLSelectElement>(".xb-line select[aria-label^='What for']"); el[el.length - 1]?.focus(); }, 30);

  async function saveAll(e: React.FormEvent) {
    e.preventDefault();
    if (kind === "trip" && !tripId) return setErr("Choose the trip these expenses belong to.");
    const wrong = filled.filter((l) => !l.category.trim() || !(amt(l) > 0)).map((l) => l.key);
    setBad(wrong);
    if (!filled.length) return setErr("Add at least one expense: what it was for and the amount.");
    if (wrong.length) return setErr(`Line${wrong.length === 1 ? "" : "s"} ${wrong.map((k) => lines.findIndex((l) => l.key === k) + 1).join(", ")}: choose what for and enter the amount.`);
    setErr(""); setBusy(true);
    let ok = 0, sum = 0; const failed: number[] = [];
    for (const l of filled) {
      const row = { kind, trip_id: kind === "trip" ? tripId : null, station: me.station || station, category: l.category.trim(), amount: amt(l), method: l.method,
        paid_to: l.paid_to.trim(), reference: "", spent_on: day, description: l.description.trim(), created_by: me.id, created_by_name: me.full_name, created_at: new Date().toISOString() };
      if (await insert<Expense>("expenses", row)) { ok++; sum += amt(l); } else failed.push(l.key);
    }
    setBusy(false);
    if (ok) toast(`${ok} expense${ok === 1 ? "" : "s"} recorded · TZS ${tzs(sum)}`);
    if (failed.length) { setLines((L) => L.filter((l) => failed.includes(l.key))); setErr("Some lines were not saved. Check them and press Save again."); return; }
    setLines([blank(lines[lines.length - 1]?.method)]); setBad([]);
    onDone?.();
  }

  return (
    <form noValidate onSubmit={saveAll} className="xf xb">
      <div className="xb-top">
        {!trip && (
          <div className="xf-seg" role="radiogroup" aria-label="Expense type">
            <button type="button" role="radio" aria-checked={kind === "office"} onClick={() => { setKind("office"); setLines((L) => L.map((l) => ({ ...l, category: "", other: false }))); }}>Office expenses</button>
            <button type="button" role="radio" aria-checked={kind === "trip"} onClick={() => { setKind("trip"); setTripId((x) => x || recent[0]?.id || ""); setLines((L) => L.map((l) => ({ ...l, category: "", other: false }))); }}>Trip expenses</button>
          </div>
        )}
        {kind === "trip" && !trip && (
          <label className="xf-f xb-trip">Truck / trip<select value={tripId} onChange={(e) => setTripId(e.target.value)}>
            <option value="">Choose the trip…</option>
            {recent.map((t) => <option key={t.id} value={t.id}>{t.plate} · {regShort(t.origin)} → {regShort(t.dest)} · {t.status === "loading" ? "loading" : t.status === "departed" ? "on the road" : "arrived"}</option>)}
          </select></label>
        )}
        <label className="xf-f">Date<input type="date" value={day} max={localDay(new Date())} onChange={(e) => e.target.value && setDay(e.target.value)} /></label>
        <label className="xf-f">Office that paid
          <select value={me.station || station} disabled={!!me.station} onChange={(e) => setStation(e.target.value)}>
            {offices.map((c) => <option key={c} value={c}>{REGIONS.find(([r]) => r === c)?.[1] || c}</option>)}
          </select></label>
      </div>

      <div className="xb-lines">
        <div className="xb-head" aria-hidden="true"><span>#</span><span>What for</span><span>Amount (TZS)</span><span>Paid by</span><span>Paid to</span><span>Note</span><span /></div>
        {lines.map((l, i) => (
          <div key={l.key} className={`xb-line${bad.includes(l.key) ? " bad" : ""}`}>
            <span className="xb-n">{i + 1}</span>
            {l.other
              ? <span className="xb-other"><input autoFocus value={l.category} onChange={(e) => upd(l.key, { category: e.target.value })} placeholder="Type what it was for" aria-label={`What for, line ${i + 1}`} /><button type="button" title="Back to the list" onClick={() => upd(l.key, { other: false, category: "" })}>↺</button></span>
              : <select value={l.category} aria-label={`What for, line ${i + 1}`} onChange={(e) => e.target.value === OTHER ? upd(l.key, { other: true, category: "" }) : upd(l.key, { category: e.target.value })}>
                  <option value="">Choose…</option>
                  <optgroup label={kind === "trip" ? "Trip charges" : "Office costs"}>{cats.base.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
                  {cats.used.length > 0 && <optgroup label="Used before">{cats.used.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>}
                  <option value={OTHER}>Other… (type it)</option>
                </select>}
            <input className="xb-amt" inputMode="numeric" value={l.amount ? tzs(l.amount) : ""} placeholder="0" aria-label={`Amount, line ${i + 1}`}
              onChange={(e) => upd(l.key, { amount: e.target.value.replace(/[^\d]/g, "") })}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (i === lines.length - 1) { addLine(); focusLast(); } } }} />
            <select value={l.method} onChange={(e) => upd(l.key, { method: e.target.value })} aria-label={`Paid by, line ${i + 1}`}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
            <input value={l.paid_to} onChange={(e) => upd(l.key, { paid_to: e.target.value })} placeholder="Paid to (optional)" aria-label={`Paid to, line ${i + 1}`} />
            <input value={l.description} onChange={(e) => upd(l.key, { description: e.target.value })} placeholder="Note (optional)" aria-label={`Note, line ${i + 1}`} />
            <button type="button" className="xb-del" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1 && !l.category && !l.amount}
              onClick={() => setLines((L) => (L.length === 1 ? [blank(l.method)] : L.filter((x) => x.key !== l.key)))}>✕</button>
          </div>
        ))}
        <button type="button" className="xb-add" onClick={() => { addLine(); focusLast(); }}>+ Add another expense</button>
      </div>

      <div className="err" role="alert">{err}</div>
      <div className="xb-foot">
        <div className="xb-total"><span>{filled.length} expense{filled.length === 1 ? "" : "s"}</span><b>TZS {tzs(total)}</b></div>
        <div className="xf-actions">
          {onDone && <button className="btn" type="button" onClick={onDone}>Cancel</button>}
          <button className="btn primary" type="submit" disabled={busy || !filled.length}>{busy ? "Saving…" : filled.length > 1 ? `Save all ${filled.length}` : "Save expense"}</button>
        </div>
      </div>
    </form>
  );
}

export default function Expenses() {
  const { expenses, hasExpenses, trips, company, can, me } = useStore();
  const ui = useUi();
  const recordable = can("receive");
  const [open, setOpen] = useState(true);
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
  const byCat = Object.entries(list.reduce<Record<string, { v: number; k: Expense["kind"] }>>((a, e) => { a[e.category] = { v: (a[e.category]?.v || 0) + Number(e.amount), k: e.kind }; return a; }, {})).sort((a, b) => b[1].v - a[1].v);
  const top = byCat[0]?.[1].v || 1;
  const total = sumExp(list);
  const tripSum = sumExp(list.filter((e) => e.kind === "trip"));
  const officeSum = total - tripSum;
  const days = rows.reduce<[string, Expense[]][]>((a, e) => { const l = a[a.length - 1]; if (l && l[0] === e.spent_on) l[1].push(e); else a.push([e.spent_on, [e]]); return a; }, []);
  const dayTotal = (d: string) => sumExp(list.filter((e) => e.spent_on === d));
  const PERIODS: [Period, string][] = [["today", "Today"], ["7", "7 days"], ["month", "This month"], ["last", "Last month"], ["all", "All time"], ["custom", "Dates…"]];
  const periodName = period === "custom" ? `${dayLabel(range[0])} – ${dayLabel(range[1])}` : PERIODS.find(([k]) => k === period)?.[1];

  return (
    <section className="xp">
      <div className="sectionhead">
        <div><h1>Expenses</h1><div className="sub">Trip charges and office costs, recorded by the office that paid.</div></div>
        <div className="xp-period">
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {period === "custom" && <>
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="From date" />
            <input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="To date" />
          </>}
        </div>
      </div>
      {!hasExpenses && <p className="note">Run database update 0026 in Supabase to start recording expenses.</p>}

      {recordable && hasExpenses && (
        <div className="xp-rec">
          <button className="xp-rec-h" onClick={() => setOpen(!open)} aria-expanded={open}><span className="xp-plus">+</span><b>Record expenses</b><span className="sub">{open ? "Hide" : "Show"}</span></button>
          {open && <ExpenseBatch />}
        </div>
      )}

      <div className="xp-sum">
        <div className="xp-hero">
          <div className="lbl">Spent · {periodName}</div>
          <div className="xp-big"><small>TZS</small>{tzs(total)}</div>
          <div className="xp-split" aria-hidden="true"><i className="t" style={{ width: total ? `${(tripSum / total) * 100}%` : 0 }} /><i className="o" style={{ width: total ? `${(officeSum / total) * 100}%` : 0 }} /></div>
          <div className="xp-legend">
            <button aria-pressed={kind === "trip"} onClick={() => { setKind(kind === "trip" ? "" : "trip"); setCat(""); }}><i className="t" />Trips <b>{tzs(tripSum)}</b></button>
            <button aria-pressed={kind === "office"} onClick={() => { setKind(kind === "office" ? "" : "office"); setCat(""); }}><i className="o" />Offices <b>{tzs(officeSum)}</b></button>
          </div>
          <div className="xp-meta">{list.length} expense{list.length === 1 ? "" : "s"}{list.length ? ` · average ${tzs(Math.round(total / list.length))}` : ""}</div>
          <div className="xp-mini">
            <div><span>Today</span><b>{tzs(sumExp(list.filter((e) => e.spent_on === today)))}</b></div>
            <div><span>Biggest</span><b>{byCat[0] ? tzs(byCat[0][1].v) : "—"}</b><small>{byCat[0]?.[0] || ""}</small></div>
            <div><span>Trips with costs</span><b>{new Set(list.filter((e) => e.trip_id).map((e) => e.trip_id)).size}</b></div>
          </div>
        </div>
        <div className="xp-cats">
          <div className="xp-cats-h"><b>By category</b>{list.length > 0 && <button className="btn sm" onClick={() => csv(list, plate, company.name)}>Download (Excel)</button>}</div>
          {byCat.slice(0, 7).map(([c, x]) => (
            <button key={c} className="xp-cat" aria-pressed={cat === c} onClick={() => setCat(cat === c ? "" : c)}>
              <span className={`xp-badge xb-${x.k}`}>{catBadge(c)}</span>
              <span className="xp-cat-n">{c}<span className="xp-bar"><i className={x.k} style={{ width: `${Math.max(3, (x.v / top) * 100)}%` }} /></span></span>
              <b className="num">{tzs(x.v)}</b>
            </button>))}
          {!byCat.length && <p className="sub" style={{ margin: "10px 0 0" }}>No expenses in this period.</p>}
        </div>
      </div>

      <div className="xp-filters">
        <div className="searchbox"><Icon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search note, paid to, truck…" aria-label="Search expenses" /></div>
        <select value={kind} onChange={(e) => { setKind(e.target.value as "" | Expense["kind"]); setCat(""); }} aria-label="Type"><option value="">Trips and offices</option><option value="trip">Trip expenses</option><option value="office">Office expenses</option></select>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{catsHere.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        {offices.length > 1 && !me.station && <select value={office} onChange={(e) => setOffice(e.target.value)} aria-label="Office"><option value="">All offices</option>{offices.map((c) => <option key={c} value={c}>{regShort(c)}</option>)}</select>}
      </div>

      <div className="xp-list">
        {days.map(([d, L]) => (
          <div key={d} className="xp-day">
            <div className="xp-day-h"><b>{d === today ? "Today" : dayLabel(d)}</b><span className="num">TZS {tzs(dayTotal(d))}</span></div>
            {L.map((e) => { const t = tripOf(e.trip_id); return (
              <button key={e.id} className="xp-row" onClick={() => ui.openExpense(e.id)}>
                <span className={`xp-badge xb-${e.kind}`}>{catBadge(e.category)}</span>
                <span className="xp-row-m"><b>{e.category}</b>
                  <span className="sub">{[t ? t.plate : "Office", regShort(e.station), e.paid_to, e.description].filter(Boolean).join(" · ")}</span></span>
                <span className="xp-row-r"><b className="num">{tzs(e.amount)}</b><span className="sub">{e.method}</span></span>
              </button>); })}
          </div>
        ))}
      </div>
      <Pager pager={pager} />
      {hasExpenses && !expenses.length && <div className="empty"><h3>No expenses yet</h3><p>Record trip charges like TRA and Mizani, and office costs like wages and security, with the form above.</p></div>}
      {expenses.length > 0 && !list.length && <div className="empty"><h3>Nothing here</h3><p>Choose another period or clear the filters.</p></div>}
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
