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
  const [report, setReport] = useState(false);
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
        <button className={`btn sm${report ? " primary" : ""}`} style={{ marginLeft: "auto" }} onClick={() => setReport(!report)} aria-expanded={report}>{report ? "Hide report" : "Report"}</button>
      </div>
      {report && <div className="report-box"><RunnerReport /></div>}
      {[...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([n, L]) => <RunnerCard key={n} name={n} list={L} />)}
      {!groups.size && <p className="quiet">To send goods with a delivery person, find the consignment below (search the receipt number or the customer) and press <b>Give to delivery person</b>. The receipt prints for them to carry.</p>}
    </>
  );
}

// ------------------------------------------------------------------ report

const localDay = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
type RPeriod = "today" | "7" | "month" | "30" | "all" | "custom";

function csvDownload(name: string, head: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = "﻿" + [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${name}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

type RRow = { name: string; phone: string; L: Shipment[]; done: Shipment[]; out: Shipment[]; handed: number; owes: number };

/** A4 report: summary per delivery person, then each person's goods. */
async function reportPdf(rows: RRow[], company: Company, periodText: string, only?: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = 14, R = 196;
  let y = 18;
  const head = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text((company.name || "Shehena").toUpperCase(), L, y);
    doc.setFontSize(11); doc.text(only ? `DELIVERY PERSON: ${only.toUpperCase()}` : "DELIVERY PEOPLE REPORT", R, y, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.text(`${periodText}  ·  printed ${fmtDate(new Date().toISOString())}`, L, y + 6); y += 16;
  };
  const room = (h: number) => { if (y + h > 282) { doc.addPage(); y = 18; } };
  head();
  const list = only ? rows.filter((r) => r.name === only) : rows;
  // summary table
  const cols: [string, number, "left" | "right"][] = [["Delivery person", L, "left"], ["Phone", L + 52, "left"], ["Given", L + 104, "right"], ["Delivered", L + 124, "right"], ["Still out", L + 142, "right"], ["Handed in", L + 162, "right"], ["To hand in", R, "right"]];
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); cols.forEach(([h, x, a]) => doc.text(h, x, y, { align: a })); y += 2; doc.line(L, y, R, y); y += 5;
  doc.setFont("helvetica", "normal");
  for (const r of list) {
    room(7);
    const v = [r.name, r.phone ? prettyPhone(r.phone) : "-", String(r.L.length), String(r.done.length), String(r.out.length), tzs(r.handed), tzs(r.owes)];
    cols.forEach(([, x, a], j) => doc.text(v[j], x, y, { align: a })); y += 6;
  }
  if (!only && list.length > 1) {
    doc.line(L, y - 3, R, y - 3); doc.setFont("helvetica", "bold");
    const t = list.reduce((a, r) => ({ n: a.n + r.L.length, d: a.d + r.done.length, o: a.o + r.out.length, h: a.h + r.handed, w: a.w + r.owes }), { n: 0, d: 0, o: 0, h: 0, w: 0 });
    ["Total", "", String(t.n), String(t.d), String(t.o), tzs(t.h), tzs(t.w)].forEach((v, j) => doc.text(v, cols[j][1], y + 1, { align: cols[j][2] })); y += 8;
  }
  // each person's goods
  for (const r of list) {
    room(26); y += 6;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text(r.name, L, y);
    doc.setFontSize(9.5); doc.text(`Handed in TZS ${tzs(r.handed)}  ·  still to hand in TZS ${tzs(r.owes)}`, R, y, { align: "right" }); y += 6;
    const c2: [string, number, "left" | "right"][] = [["Waybill", L, "left"], ["Given", L + 38, "left"], ["Receiver", L + 72, "left"], ["Goods", L + 104, "left"], ["Status", L + 134, "left"], ["TZS", R, "right"]];
    doc.setFontSize(8.5); c2.forEach(([h, x, a]) => doc.text(h, x, y, { align: a })); y += 2; doc.line(L, y, R, y); y += 4.5;
    doc.setFont("helvetica", "normal");
    for (const s of [...r.L].sort((a, b) => String(a.runner_out_at).localeCompare(String(b.runner_out_at)))) {
      room(6);
      const cut = (t: string, w: number) => { const p = doc.splitTextToSize(t || "-", w); return p.length > 1 ? p[0].replace(/.$/, "…") : p[0]; };
      const done = !!s.runner_settled_at;
      const v = [s.no, fmtDate(s.runner_out_at).slice(0, 11), cut(s.r_name, 30), cut(goodsLabel(s), 28), done ? `Delivered ${fmtDate(s.runner_settled_at).slice(0, 6)}` : "Still out", done ? `${tzs(s.runner_amount || 0)} in` : `${tzs(balanceOf(s))} owed`];
      c2.forEach(([, x, a], j) => doc.text(v[j], x, y, { align: a })); y += 5.2;
    }
  }
  y += 14; room(14); doc.setFontSize(9.5);
  doc.line(L, y, L + 70, y); doc.line(R - 70, y, R, y); y += 5;
  doc.text("Checked by (sign)", L, y); doc.text(only ? `${only} (sign)` : "Approved by (sign)", R - 70, y);
  doc.save(`Delivery-people${only ? "-" + only.replace(/\s+/g, "-") : ""}-${localDay(new Date())}.pdf`);
}

/**
 * Delivery people report: per person, goods handed out in the period, delivered, still out, money
 * handed in and still to hand in; click a person for their goods. View on screen, or download as
 * Excel or PDF. Pass `range` to use the Reports page's period; otherwise it has its own.
 */
export function RunnerReport({ range: outer }: { range?: [string, string] }) {
  const { shipments, company, me } = useStore();
  const ui = useUi();
  const [period, setPeriod] = useState<RPeriod>("today");
  const [from, setFrom] = useState(() => localDay(new Date(Date.now() - 7 * 864e5)));
  const [to, setTo] = useState(() => localDay(new Date()));
  const [pick, setPick] = useState("");
  const range = useMemo((): [string, string] => {
    if (outer) return outer;
    const now = new Date(), today = localDay(now);
    if (period === "custom") return [from, to];
    if (period === "today") return [today, today];
    if (period === "month") return [today.slice(0, 8) + "01", today];
    if (period === "all") return ["0000-01-01", "9999-12-31"];
    return [localDay(new Date(now.getTime() - Number(period) * 864e5)), today];
  }, [outer, period, from, to]);
  const inPeriod = (iso?: string | null) => { if (!iso) return false; const d = localDay(new Date(iso)); return d >= range[0] && d <= range[1]; };
  const periodText = range[0] === "0000-01-01" ? "All time" : range[0] === range[1] ? range[0] : `${range[0]} to ${range[1]}`;
  const fileTag = range[0] === "0000-01-01" ? "all-time" : `${range[0]}_to_${range[1]}`;

  const G = shipments.filter((s) => s.runner_name && inPeriod(s.runner_out_at) && (!me.station || s.dest === me.station));
  const people = new Map<string, Shipment[]>();
  G.forEach((s) => people.set(s.runner_name!, [...(people.get(s.runner_name!) || []), s]));
  const rows: RRow[] = [...people.entries()].map(([name, L]) => {
    const done = L.filter((s) => s.runner_settled_at), out = L.filter((s) => !s.runner_settled_at);
    return { name, phone: L.find((s) => s.runner_phone)?.runner_phone || "", L, done, out,
      handed: done.reduce((a, s) => a + Number(s.runner_amount || 0), 0), owes: out.reduce((a, s) => a + balanceOf(s), 0) };
  }).sort((a, b) => b.owes - a.owes || a.name.localeCompare(b.name));
  const sel = rows.find((r) => r.name === pick);
  const tot = rows.reduce((a, r) => ({ n: a.n + r.L.length, d: a.d + r.done.length, h: a.h + r.handed, o: a.o + r.owes }), { n: 0, d: 0, h: 0, o: 0 });
  const excelAll = () => csvDownload(`Delivery-people-${fileTag}`,
    ["Delivery person", "Phone", "Waybill", "Given", "Given by", "Receiver", "Receiver phone", "Goods", "Packages", "Charge", "Status", "Delivered", "TZS handed in", "TZS still to hand in"],
    rows.flatMap((r) => r.L.map((s) => [r.name, r.phone, s.no, fmtDate(s.runner_out_at), s.runner_by || "", s.r_name, s.r_phone, goodsLabel(s), s.pkgs, s.charge,
      s.runner_settled_at ? "Delivered" : "Still out", s.runner_settled_at ? fmtDate(s.runner_settled_at) : "", s.runner_settled_at ? Number(s.runner_amount || 0) : 0, s.runner_settled_at ? 0 : balanceOf(s)])));

  return (
    <>
      {!outer && (
        <div className="filters" style={{ marginBottom: 12 }}>
          <div className="chips">{([["today", "Today"], ["7", "7 days"], ["month", "This month"], ["30", "30 days"], ["all", "All time"], ["custom", "Dates…"]] as [RPeriod, string][]).map(([k, l]) =>
            <button key={k} className="chip" aria-pressed={period === k} onClick={() => setPeriod(k)}>{l}</button>)}</div>
          {period === "custom" && <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "auto" }} aria-label="From date" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "auto" }} aria-label="To date" />
          </>}
        </div>
      )}
      <div className="stats">
        <div className="stat"><div className="lbl">Delivery people</div><div className="v">{rows.length}</div><div className="s">{tot.n} consignments given out</div></div>
        <div className="stat"><div className="lbl">Delivered</div><div className="v">{tot.d}</div><div className="s">settled at the office</div></div>
        <div className="stat"><div className="lbl">Handed in</div><div className="v">{tzs(tot.h)}</div><div className="s">TZS received from them</div></div>
        <div className={`stat${tot.o ? " warn" : ""}`}><div className="lbl">Still to hand in</div><div className="v">{tzs(tot.o)}</div><div className="s">TZS for goods still out</div></div>
      </div>
      <div className="panel"><div className="ph" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div><h2>By delivery person</h2><div className="sub">{periodText} · goods handed out in this period. Click a name for their goods.</div></div>
        <div className="actions" style={{ margin: 0 }}>
          <button className="btn sm" disabled={!rows.length} onClick={excelAll}>Download (Excel)</button>
          <button className="btn sm" disabled={!rows.length} onClick={() => reportPdf(rows, company, periodText)}>Download PDF</button>
        </div></div>
        <div className="ledger"><table className="small"><thead><tr><th>Delivery person</th><th className="r">Given</th><th className="r">Delivered</th><th className="r">Still out</th><th className="r">Handed in</th><th className="r">Still to hand in</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.name} className="row" onClick={() => setPick(r.name === pick ? "" : r.name)} aria-selected={r.name === pick}>
              <td><b>{r.name}</b>{r.phone ? <div className="sub mono">{prettyPhone(r.phone)}</div> : null}</td>
              <td className="r num">{r.L.length}</td><td className="r num">{r.done.length}</td><td className="r num">{r.out.length}</td>
              <td className="r num">{tzs(r.handed)}</td><td className="r num" style={{ color: r.owes ? "var(--bad)" : undefined }}><b>{tzs(r.owes)}</b></td>
            </tr>))}
            {!rows.length && <tr><td colSpan={6} className="sub">No goods were given to delivery people in this period.</td></tr>}</tbody>
          {rows.length > 1 && <tfoot><tr><td>Total</td><td className="r num">{tot.n}</td><td className="r num">{tot.d}</td><td className="r num">{tot.n - tot.d}</td><td className="r num">{tzs(tot.h)}</td><td className="r num">{tzs(tot.o)}</td></tr></tfoot>}</table></div>
      </div>
      {sel && (
        <div className="panel" style={{ marginTop: 14 }}><div className="ph" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div><h2>{sel.name}</h2><div className="sub">{sel.L.length} consignments · TZS {tzs(sel.handed)} handed in · TZS {tzs(sel.owes)} still to hand in</div></div>
          <div className="actions" style={{ margin: 0 }}>
            <button className="btn sm" onClick={() => csvDownload(`Delivery-${sel.name.replace(/\s+/g, "-")}-${fileTag}`, ["Waybill", "Given", "Given by", "Receiver", "Receiver phone", "Goods", "Packages", "Charge", "Status", "Delivered", "TZS handed in", "TZS still to hand in"],
              sel.L.map((s) => [s.no, fmtDate(s.runner_out_at), s.runner_by || "", s.r_name, s.r_phone, goodsLabel(s), s.pkgs, s.charge, s.runner_settled_at ? "Delivered" : "Still out", s.runner_settled_at ? fmtDate(s.runner_settled_at) : "", s.runner_settled_at ? Number(s.runner_amount || 0) : 0, s.runner_settled_at ? 0 : balanceOf(s)]))}>Download (Excel)</button>
            <button className="btn sm" onClick={() => reportPdf(rows, company, periodText, sel.name)}>Download PDF</button>
          </div></div>
          <div className="ledger"><table className="small"><thead><tr><th>Waybill</th><th>Receiver</th><th>Goods</th><th>Status</th><th className="r">TZS</th></tr></thead>
            <tbody>{[...sel.L].sort((a, b) => String(b.runner_out_at).localeCompare(String(a.runner_out_at))).map((s) => (
              <tr key={s.id} className="row" onClick={() => ui.openShip(s.id)}>
                <td className="mono wb">{s.no}<div className="sub">given {fmtDate(s.runner_out_at)}</div></td>
                <td>{s.r_name}<div className="sub mono">{prettyPhone(s.r_phone)}</div></td>
                <td>{goodsLabel(s)} · {s.pkgs} pkg</td>
                <td>{s.runner_settled_at ? <span className="pill pay-paid">Delivered</span> : <span className="pill pay-part">Still out</span>}<div className="sub">{s.runner_settled_at ? fmtDate(s.runner_settled_at) : ""}</div></td>
                <td className="r num">{s.runner_settled_at ? <>{tzs(s.runner_amount || 0)}<div className="sub">handed in</div></> : <b style={{ color: balanceOf(s) ? "var(--bad)" : undefined }}>{tzs(balanceOf(s))}<div className="sub">to hand in</div></b>}</td>
              </tr>))}</tbody></table></div>
        </div>
      )}
    </>
  );
}
