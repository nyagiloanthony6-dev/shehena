"use client";
// Reports for the Admin and CEO: one period, several tabs, each downloadable for Excel.
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { useUi } from "../CargoApp";
import { PayPill, StatusPill, TripPill } from "../parts";
import { DailyChart, YearPanel } from "../charts";
import { CLAIM_KINDS, PAY_LABEL, fmtDate, fmtDay, goodsLabel, pkgsOf, prettyPhone, regShort, sumCharge, tzs, type Shipment, type Trip } from "@/lib/domain";

type Period = "today" | "7" | "30" | "month" | "all" | "custom";
type Tab = "overview" | "pay" | "trucks" | "claims" | "discounts" | "bills" | "deliveries";
const TABS: [Tab, string][] = [
  ["overview", "Overview"], ["pay", "Paid & unpaid"], ["trucks", "Trucks & rentals"], ["claims", "Claims & refunds"],
  ["discounts", "Discounts"], ["bills", "Monthly bills"], ["deliveries", "Deliveries"],
];
// b = billed, pd = paid, u = unpaid at the counter, bl = on monthly bills
const agg = (L: Shipment[]) => ({ b: sumCharge(L), pd: sumCharge(L.filter((x) => x.pay === "paid")), u: sumCharge(L.filter((x) => x.pay === "unpaid")), bl: sumCharge(L.filter((x) => x.pay === "bill")) });
const localDay = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const daysSince = (iso?: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : 0);

/** Download rows as a CSV file that opens in Excel (UTF-8 with BOM). */
function downloadCsv(name: string, head: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = "﻿" + [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${name}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const XL = ({ onClick }: { onClick: () => void }) => <button className="btn sm" onClick={onClick}>Download (Excel)</button>;

export default function Reports() {
  const st = useStore();
  const { shipments, trips, tripShips, tripById, claims, claimPayments, accounts, billPayments, vehicles, hasExtras } = st;
  const ui = useUi();
  const [period, setPeriod] = useState<Period>("30");
  const [from, setFrom] = useState(() => localDay(new Date(Date.now() - 30 * 864e5)));
  const [to, setTo] = useState(() => localDay(new Date()));
  const [tab, setTab] = useState<Tab>("overview");
  const [truck, setTruck] = useState("");
  const [payView, setPayView] = useState<"unpaid" | "paid" | "bill" | "all">("unpaid");

  const range = useMemo((): [string, string] => {
    const now = new Date(), today = localDay(now);
    if (period === "custom") return [from, to];
    if (period === "today") return [today, today];
    if (period === "month") return [today.slice(0, 8) + "01", today];
    if (period === "all") return ["0000-01-01", "9999-12-31"];
    return [localDay(new Date(now.getTime() - Number(period) * 864e5)), today];
  }, [period, from, to]);
  const inPeriod = (iso?: string | null) => { if (!iso) return false; const d = iso.length === 10 ? iso : localDay(new Date(iso)); return d >= range[0] && d <= range[1]; };
  const label = period === "all" ? "all-time" : `${range[0]}_to_${range[1]}`;

  const S = useMemo(() => shipments.filter((s) => inPeriod(s.received_at)), [shipments, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const T = useMemo(() => trips.filter((t) => inPeriod(t.created_at)), [trips, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const billed = sumCharge(S);
  const paid = S.filter((s) => s.pay === "paid");
  const paidAmt = sumCharge(paid);
  const U = S.filter((x) => x.pay === "unpaid");
  const B = S.filter((x) => x.pay === "bill");
  const unpaidAmt = sumCharge(U);
  const dispatched = trips.filter((t) => t.departed_at && inPeriod(t.departed_at));

  return (
    <section>
      <div className="sectionhead"><h1>Reports</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div className="chips">{([["today", "Today"], ["7", "7 days"], ["30", "30 days"], ["month", "This month"], ["all", "All time"], ["custom", "Dates…"]] as [Period, string][]).map(([k, l]) =>
            <button key={k} className="chip" aria-pressed={period === k} onClick={() => setPeriod(k)}>{l}</button>)}</div>
          {period === "custom" && <>
            <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} style={{ width: "auto" }} aria-label="From date" />
            <span className="sub">to</span>
            <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} style={{ width: "auto" }} aria-label="To date" />
          </>}
        </div>
      </div>
      <nav className="tabs" role="tablist" style={{ marginBottom: 16 }}>{TABS.filter(([k]) => hasExtras || !["claims", "bills"].includes(k)).map(([k, l]) =>
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</nav>

      {tab === "overview" && <Overview S={S} />}

      {tab === "pay" && (() => {
        const V = payView === "paid" ? paid : payView === "unpaid" ? U : payView === "bill" ? B : S;
        // unpaid money by how long it has been owed (from arrival, or from receiving if not yet arrived)
        const age = (s: Shipment) => daysSince(s.arrived_at || s.received_at);
        const buckets: [string, (d: number) => boolean][] = [["0–2 days", (d) => d <= 2], ["3–7 days", (d) => d >= 3 && d <= 7], ["8–30 days", (d) => d >= 8 && d <= 30], ["Over 30 days", (d) => d > 30]];
        const allUnpaid = shipments.filter((s) => s.pay === "unpaid");
        const byReceiver = Object.values(allUnpaid.reduce<Record<string, { name: string; phone: string; n: number; v: number; oldest: number }>>((a, s) => {
          const k = s.r_phone || s.r_name; const r = (a[k] = a[k] || { name: s.r_name, phone: s.r_phone, n: 0, v: 0, oldest: 0 });
          r.n++; r.v += Number(s.charge || 0); r.oldest = Math.max(r.oldest, age(s)); return a;
        }, {})).sort((a, b) => b.v - a.v);
        return (
          <>
            <div className="stats">
              <div className="stat"><div className="lbl">Billed</div><div className="v">{tzs(billed)}</div><div className="s">TZS · {S.length} consignments</div></div>
              <div className="stat"><div className="lbl">Paid</div><div className="v">{tzs(paidAmt)}</div><div className="s">TZS · {paid.length}</div></div>
              <div className={`stat${unpaidAmt ? " warn" : ""}`}><div className="lbl">Unpaid</div><div className="v">{tzs(unpaidAmt)}</div><div className="s">TZS · {U.length}</div></div>
              <div className="stat"><div className="lbl">On monthly bills</div><div className="v">{tzs(sumCharge(B))}</div><div className="s">TZS · {B.length}</div></div>
            </div>
            <div className="rgrid">
              <div className="panel"><h2>Unpaid by age</h2><div className="sub">All unpaid goods now, by days since arrival (or receiving)</div>
                <div className="ledger"><table className="small"><thead><tr><th>Owed for</th><th className="r">Consignments</th><th className="r">TZS</th></tr></thead>
                  <tbody>{buckets.map(([l, f]) => { const L = allUnpaid.filter((s) => f(age(s))); return <tr key={l}><td>{l}</td><td className="r num">{L.length}</td><td className="r num" style={L.length && l.startsWith("Over") ? { color: "var(--bad)", fontWeight: 700 } : undefined}>{tzs(sumCharge(L))}</td></tr>; })}</tbody>
                  <tfoot><tr><td>Total</td><td className="r num">{allUnpaid.length}</td><td className="r num">{tzs(sumCharge(allUnpaid))}</td></tr></tfoot></table></div>
              </div>
              <div className="panel"><div className="ph"><div><h2>Who owes</h2><div className="sub">Receivers with unpaid goods now</div></div>
                <XL onClick={() => downloadCsv("Shehena-who-owes", ["Receiver", "Phone", "Consignments", "TZS owed", "Oldest (days)"], byReceiver.map((r) => [r.name, r.phone, r.n, r.v, r.oldest]))} /></div>
                <div className="ledger"><table className="small"><thead><tr><th>Receiver</th><th className="r">Cons.</th><th className="r">TZS</th><th className="r">Oldest</th></tr></thead>
                  <tbody>{byReceiver.slice(0, 15).map((r) => <tr key={r.phone + r.name}><td>{r.name}<div className="sub mono">{prettyPhone(r.phone)}</div></td><td className="r num">{r.n}</td><td className="r num">{tzs(r.v)}</td><td className="r num">{r.oldest} d</td></tr>)}
                    {!byReceiver.length && <tr><td colSpan={4} className="sub">Nobody owes anything.</td></tr>}</tbody></table></div>
              </div>
            </div>
            <div className="panel" style={{ marginTop: 16 }}>
              <div className="ph" style={{ flexWrap: "wrap" }}>
                <div><h2>Consignments in the period</h2><div className="sub">By payment</div></div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <div className="chips">{([["unpaid", `Unpaid · ${U.length}`], ["paid", `Paid · ${paid.length}`], ["bill", `Monthly bill · ${B.length}`], ["all", `All · ${S.length}`]] as [typeof payView, string][]).map(([k, l]) =>
                    <button key={k} className="chip" aria-pressed={payView === k} onClick={() => setPayView(k)}>{l}</button>)}</div>
                  <XL onClick={() => downloadCsv(`Shehena-${payView}-${label}`, ["Waybill", "Received", "Sender", "Receiver", "Receiver phone", "To", "Goods", "Packages", "Truck", "Status", "Payment", "Method", "Paid on", "Paid to", "Bill customer", "Discount", "TZS"],
                    V.map((x) => [x.no, fmtDate(x.received_at), x.s_name, x.r_name, x.r_phone, regShort(x.dest), goodsLabel(x), x.pkgs, tripById(x.trip_id)?.plate || "", x.status, PAY_LABEL[x.pay], x.method || "", x.paid_at ? fmtDate(x.paid_at) : "", x.paid_by || "", accounts.find((a) => a.id === x.account_id)?.name || "", x.discount || 0, Number(x.charge)]))} />
                </div>
              </div>
              <div className="ledger"><table className="small">
                <thead><tr><th>Waybill</th><th>Sender → receiver</th><th>Truck</th><th>Status</th><th>Payment</th><th className="r">TZS</th></tr></thead>
                <tbody>{V.slice(0, 300).map((x) => { const t = tripById(x.trip_id); return (
                  <tr key={x.id} className="row" onClick={() => ui.openShip(x.id)}>
                    <td className="mono wb">{x.no}<div className="sub">{fmtDay(x.received_at)}</div></td>
                    <td>{x.s_name}<div className="sub">to {x.r_name} · {regShort(x.dest)}</div></td>
                    <td className="mono wb">{t ? t.plate : <span className="sub">Not loaded</span>}</td>
                    <td><StatusPill s={x.status} /></td>
                    <td><PayPill pay={x.pay} />{x.pay === "paid" && <div className="sub">{x.method || ""}{x.paid_by ? " · " + x.paid_by : ""}</div>}{x.pay === "bill" && <div className="sub">{accounts.find((a) => a.id === x.account_id)?.name || ""}</div>}</td>
                    <td className="r num" style={{ fontWeight: 600 }}>{tzs(x.charge)}</td>
                  </tr>); })}
                  {!V.length && <tr><td colSpan={6} className="sub">Nothing here for this period.</td></tr>}</tbody>
                {V.length > 0 && <tfoot><tr><td colSpan={5}>Total · {V.length}{V.length > 300 ? " (first 300 shown; download for all)" : ""}</td><td className="r num">{tzs(sumCharge(V))}</td></tr></tfoot>}
              </table></div>
            </div>
          </>
        );
      })()}

      {tab === "trucks" && (() => {
        const byTruck = Object.values(T.reduce<Record<string, Trip[]>>((a, t) => { (a[t.plate] = a[t.plate] || []).push(t); return a; }, {}))
          .map((ts) => { const L = ts.flatMap(tripShips); const v = vehicles.find((x) => x.plate === ts[0].plate); const rent = ts.reduce((a, t) => a + Number(t.rent_cost || 0), 0);
            return { plate: ts[0].plate, driver: ts[0].driver, own: (v?.ownership || ts[0].ownership || "own") === "own", owner: v?.owner_name || ts[0].owner_name || "", monthRent: v?.ownership === "rental" && v.rent_basis === "month" ? Number(v.rent_amount || 0) : 0, ts, L, x: agg(L), rent, tg: ts.reduce((a, t) => a + Number(t.target || 0), 0) }; })
          .sort((a, b) => b.x.b - a.x.b);
        const T2 = T.filter((t) => !truck || t.plate === truck);
        const rentAll = byTruck.reduce((a, r) => a + r.rent, 0);
        const monthly = byTruck.filter((r) => r.monthRent);
        return (
          <>
            <div className="stats">
              <div className="stat"><div className="lbl">Trucks used</div><div className="v">{byTruck.length}</div><div className="s">{byTruck.filter((r) => !r.own).length} rental</div></div>
              <div className="stat"><div className="lbl">Trips started</div><div className="v">{T.length}</div><div className="s">{dispatched.length} dispatched</div></div>
              <div className="stat"><div className="lbl">Billed on trucks</div><div className="v">{tzs(byTruck.reduce((a, r) => a + r.x.b, 0))}</div><div className="s">TZS</div></div>
              <div className="stat"><div className="lbl">Rent (per-trip)</div><div className="v">{tzs(rentAll)}</div><div className="s">TZS{monthly.length ? ` + ${tzs(monthly.reduce((a, r) => a + r.monthRent, 0))}/month` : ""}</div></div>
            </div>
            <div className="panel"><div className="ph"><div><h2>Collections by truck</h2><div className="sub">Trips started in the period. Tap a row to see its trips.</div></div>
              <XL onClick={() => downloadCsv(`Shehena-trucks-${label}`, ["Truck", "Own/Rental", "Owner", "Driver", "Trips", "Packages", "Billed", "Paid", "Unpaid", "On bills", "Rent (per trip)", "Rent per month", "After rent", "Target"],
                byTruck.map((r) => [r.plate, r.own ? "Own" : "Rental", r.owner, r.driver, r.ts.length, pkgsOf(r.L), r.x.b, r.x.pd, r.x.u, r.x.bl, r.rent, r.monthRent || "", r.x.b - r.rent, r.tg]))} /></div>
              <div className="ledger"><table className="small">
                <thead><tr><th>Truck</th><th className="r">Trips</th><th className="r">Pkgs</th><th className="r">Billed</th><th className="r">Paid</th><th className="r">Unpaid</th><th className="r">Rent</th><th className="r">After rent</th><th className="r">vs target</th></tr></thead>
                <tbody>{byTruck.map((r) => (
                  <tr key={r.plate} className="row" onClick={() => setTruck(r.plate)}>
                    <td><span className="mono wb" style={{ fontWeight: 600 }}>{r.plate}</span>{!r.own && <span className="tag-rental">Rental</span>}<div className="sub">{r.driver}{!r.own && r.owner ? ` · owner ${r.owner}` : ""}</div></td>
                    <td className="r num">{r.ts.length}</td><td className="r num">{pkgsOf(r.L)}</td><td className="r num">{tzs(r.x.b)}</td>
                    <td className="r num" style={{ color: "var(--good)" }}>{tzs(r.x.pd)}</td><td className="r num" style={r.x.u ? { color: "var(--bad)" } : undefined}>{tzs(r.x.u)}</td>
                    <td className="r num">{r.own ? "—" : <>{tzs(r.rent)}{r.monthRent ? <div className="sub">{tzs(r.monthRent)}/month</div> : null}</>}</td>
                    <td className="r num" style={{ fontWeight: 600 }}>{tzs(r.x.b - r.rent)}</td>
                    <td className="r num">{r.tg ? Math.round((r.x.b / r.tg) * 100) + "%" : "—"}</td>
                  </tr>))}
                  {!byTruck.length && <tr><td colSpan={9} className="sub">No trips in this period.</td></tr>}</tbody>
              </table></div>
            </div>
            <div className="panel" style={{ marginTop: 16 }}>
              <div className="ph" style={{ flexWrap: "wrap" }}>
                <div><h2>Collections by trip</h2><div className="sub">{truck ? `Trips by ${truck}` : "Every trip started in the period"}</div></div>
                <div style={{ display: "flex", gap: 8 }}>
                  {truck && <div className="chips"><button className="chip" aria-pressed onClick={() => setTruck("")}>{truck} ✕</button></div>}
                  <XL onClick={() => downloadCsv(`Shehena-trips-${label}`, ["Trip", "Truck", "Own/Rental", "From", "To", "Status", "Loaded", "Departed", "Arrived", "Consignments", "Packages", "Billed", "Paid", "Unpaid", "On bills", "Rent", "After rent", "Target"],
                    T2.map((t) => { const L = tripShips(t), x = agg(L); return [t.no, t.plate, t.ownership === "rental" ? "Rental" : "Own", regShort(t.origin), regShort(t.dest), t.status, fmtDate(t.created_at), fmtDate(t.departed_at), fmtDate(t.arrived_at), L.length, pkgsOf(L), x.b, x.pd, x.u, x.bl, Number(t.rent_cost || 0), x.b - Number(t.rent_cost || 0), t.target]; }))} />
                </div>
              </div>
              <div className="ledger"><table className="small">
                <thead><tr><th>Trip</th><th>Truck · to</th><th>Status</th><th className="r">Pkgs</th><th className="r">Billed</th><th className="r">Paid</th><th className="r">Unpaid</th><th className="r">Rent</th></tr></thead>
                <tbody>{T2.map((t) => { const L = tripShips(t), x = agg(L); return (
                  <tr key={t.id} className="row" onClick={() => ui.openTrip(t.id)}>
                    <td className="mono wb">{t.no}<div className="sub">{fmtDay(t.departed_at || t.created_at)}</div></td>
                    <td><span className="mono wb">{t.plate}</span>{t.ownership === "rental" && <span className="tag-rental">Rental</span>}<div className="sub">to {regShort(t.dest)}</div></td>
                    <td><TripPill s={t.status} /></td><td className="r num">{pkgsOf(L)}</td><td className="r num">{tzs(x.b)}</td>
                    <td className="r num" style={{ color: "var(--good)" }}>{tzs(x.pd)}</td><td className="r num" style={x.u ? { color: "var(--bad)" } : undefined}>{tzs(x.u)}</td>
                    <td className="r num">{t.ownership === "rental" ? tzs(t.rent_cost || 0) : "—"}</td>
                  </tr>); })}
                  {!T2.length && <tr><td colSpan={8} className="sub">No trips in this period.</td></tr>}</tbody>
              </table></div>
            </div>
          </>
        );
      })()}

      {tab === "claims" && (() => {
        const paidOf = (id: string) => claimPayments.filter((p) => p.claim_id === id).reduce((a, p) => a + Number(p.amount), 0);
        const C = claims.filter((c) => inPeriod(c.reported_on));
        const P = claimPayments.filter((p) => inPeriod(p.paid_on)).sort((a, b) => a.paid_on.localeCompare(b.paid_on));
        const owedAll = claims.reduce((a, c) => a + (c.closed ? 0 : Math.max(0, Number(c.compensation) - paidOf(c.id))), 0);
        const claimOf = (id: string) => claims.find((c) => c.id === id);
        return (
          <>
            <div className="stats">
              <div className="stat"><div className="lbl">Claims reported</div><div className="v">{C.length}</div><div className="s">in the period</div></div>
              <div className="stat"><div className="lbl">Goods value</div><div className="v">{tzs(C.reduce((a, c) => a + Number(c.goods_value), 0))}</div><div className="s">TZS, reported in period</div></div>
              <div className="stat"><div className="lbl">Refunds paid</div><div className="v">{tzs(P.reduce((a, p) => a + Number(p.amount), 0))}</div><div className="s">TZS paid in period · {P.length} payment{P.length === 1 ? "" : "s"}</div></div>
              <div className={`stat${owedAll ? " warn" : ""}`}><div className="lbl">Still owed</div><div className="v">{tzs(owedAll)}</div><div className="s">TZS, all open claims</div></div>
            </div>
            <div className="rgrid">
              <div className="panel"><h2>By type of problem</h2><div className="sub">Claims reported in the period</div>
                <div className="ledger"><table className="small"><thead><tr><th>Type</th><th className="r">Claims</th><th className="r">Compensation</th><th className="r">Paid</th></tr></thead>
                  <tbody>{CLAIM_KINDS.map(([k, en, sw]) => { const L = C.filter((c) => c.kind === k); return <tr key={k}><td>{sw} <span className="sub">{en}</span></td><td className="r num">{L.length}</td><td className="r num">{tzs(L.reduce((a, c) => a + Number(c.compensation), 0))}</td><td className="r num">{tzs(L.reduce((a, c) => a + paidOf(c.id), 0))}</td></tr>; })}</tbody></table></div>
              </div>
              <div className="panel"><div className="ph"><div><h2>Refunds paid</h2><div className="sub">Compensation payments made in the period</div></div>
                <XL onClick={() => downloadCsv(`Shehena-refunds-paid-${label}`, ["Date paid", "Customer", "Waybill", "Problem", "Amount", "Method", "Reference", "Recorded by"],
                  P.map((p) => { const c = claimOf(p.claim_id); return [p.paid_on, c?.customer_name || "", c?.waybill || "", c?.kind || "", Number(p.amount), p.method, p.reference, p.recorded_by || ""]; }))} /></div>
                <div className="ledger"><table className="small"><thead><tr><th>Date</th><th>Customer</th><th className="r">TZS</th></tr></thead>
                  <tbody>{P.map((p) => { const c = claimOf(p.claim_id); return <tr key={p.id} className="row" onClick={() => c && ui.openClaim(c.id)}><td>{fmtDate(p.paid_on + "T12:00:00").slice(0, 11)}</td><td>{c?.customer_name}<div className="sub">{c?.waybill} · {p.method}</div></td><td className="r num">{tzs(p.amount)}</td></tr>; })}
                    {!P.length && <tr><td colSpan={3} className="sub">No refunds paid in this period.</td></tr>}</tbody></table></div>
              </div>
            </div>
            <div className="panel" style={{ marginTop: 16 }}><div className="ph"><div><h2>Claims</h2><div className="sub">Reported in the period</div></div>
              <XL onClick={() => downloadCsv(`Shehena-claims-${label}`, ["Reported", "Customer", "Phone", "Waybill", "Problem", "What happened", "Goods value", "Compensation", "Paid", "Still owed", "Closed", "Recorded by"],
                C.map((c) => [c.reported_on, c.customer_name, c.customer_phone, c.waybill, c.kind, c.description, Number(c.goods_value), Number(c.compensation), paidOf(c.id), c.closed ? 0 : Math.max(0, Number(c.compensation) - paidOf(c.id)), c.closed ? "Yes" : "No", c.created_by_name || ""]))} /></div>
              <div className="ledger"><table className="small"><thead><tr><th>Customer</th><th>Problem</th><th className="r">Value</th><th className="r">Compensation</th><th className="r">Paid</th><th className="r">Owed</th></tr></thead>
                <tbody>{C.map((c) => { const pd = paidOf(c.id), ow = c.closed ? 0 : Math.max(0, Number(c.compensation) - pd); return (
                  <tr key={c.id} className="row" onClick={() => ui.openClaim(c.id)}><td>{c.customer_name}<div className="sub mono">{c.waybill}</div></td><td><span className={`pill claim-${c.kind}`}>{c.kind}</span><div className="sub">{fmtDate(c.reported_on + "T12:00:00").slice(0, 11)}</div></td>
                    <td className="r num">{tzs(c.goods_value)}</td><td className="r num">{tzs(c.compensation)}</td><td className="r num">{tzs(pd)}</td><td className="r num" style={ow ? { color: "var(--bad)" } : undefined}>{tzs(ow)}</td></tr>); })}
                  {!C.length && <tr><td colSpan={6} className="sub">No claims reported in this period.</td></tr>}</tbody></table></div>
            </div>
          </>
        );
      })()}

      {tab === "discounts" && (() => {
        const D = S.filter((x) => Number(x.discount || 0) > 0);
        const amt = D.reduce((a, x) => a + Number(x.discount || 0), 0);
        const by: Record<string, { n: number; v: number }> = {};
        D.forEach((x) => { const k = x.discount_by || "—"; (by[k] = by[k] || { n: 0, v: 0 }).n++; by[k].v += Number(x.discount || 0); });
        return (
          <>
            <div className="stats">
              <div className="stat"><div className="lbl">Discounts given</div><div className="v">{tzs(amt)}</div><div className="s">TZS · {D.length} consignments</div></div>
              <div className="stat"><div className="lbl">Share of charges</div><div className="v">{billed + amt ? ((amt / (billed + amt)) * 100).toFixed(1) + "%" : "—"}</div><div className="s">before discount</div></div>
            </div>
            <div className="rgrid">
              <div className="panel"><h2>By staff member</h2>
                <div className="ledger"><table className="small"><thead><tr><th>Given by</th><th className="r">Count</th><th className="r">TZS</th></tr></thead>
                  <tbody>{Object.entries(by).sort((a, b) => b[1].v - a[1].v).map(([k, x]) => <tr key={k}><td>{k}</td><td className="r num">{x.n}</td><td className="r num">{tzs(x.v)}</td></tr>)}
                    {!D.length && <tr><td colSpan={3} className="sub">No discounts in this period.</td></tr>}</tbody></table></div>
              </div>
              <div className="panel"><div className="ph"><div><h2>Every discount</h2></div>
                <XL onClick={() => downloadCsv(`Shehena-discounts-${label}`, ["Waybill", "Received", "Sender", "Receiver", "Before discount", "Discount", "After discount", "Reason", "Given by", "Payment"],
                  D.map((x) => [x.no, fmtDate(x.received_at), x.s_name, x.r_name, Number(x.gross_charge ?? Number(x.charge) + Number(x.discount || 0)), Number(x.discount), Number(x.charge), x.discount_reason || "", x.discount_by || "", PAY_LABEL[x.pay]]))} /></div>
                <div className="ledger"><table className="small"><thead><tr><th>Waybill</th><th>Reason</th><th className="r">TZS</th></tr></thead>
                  <tbody>{D.map((x) => <tr key={x.id} className="row" onClick={() => ui.openShip(x.id)}><td className="mono wb">{x.no}<div className="sub">{x.r_name}</div></td><td>{x.discount_reason}<div className="sub">by {x.discount_by}</div></td><td className="r num">{tzs(x.discount)}</td></tr>)}
                    {!D.length && <tr><td colSpan={3} className="sub">None.</td></tr>}</tbody></table></div>
              </div>
            </div>
          </>
        );
      })()}

      {tab === "bills" && (() => {
        const rows = accounts.map((a) => {
          const L = shipments.filter((s) => s.pay === "bill" && s.account_id === a.id);
          const P = billPayments.filter((p) => p.account_id === a.id);
          const inL = L.filter((s) => inPeriod(s.received_at)), inP = P.filter((p) => inPeriod(p.paid_on));
          return { a, n: inL.length, billedP: sumCharge(inL), paidP: inP.reduce((x, p) => x + Number(p.amount), 0), balance: sumCharge(L) - P.reduce((x, p) => x + Number(p.amount), 0) };
        }).sort((x, y) => y.balance - x.balance);
        return (
          <>
            <div className="stats">
              <div className="stat"><div className="lbl">Billed in period</div><div className="v">{tzs(rows.reduce((a, r) => a + r.billedP, 0))}</div><div className="s">TZS</div></div>
              <div className="stat"><div className="lbl">Paid in period</div><div className="v">{tzs(rows.reduce((a, r) => a + r.paidP, 0))}</div><div className="s">TZS</div></div>
              <div className="stat warn"><div className="lbl">Owed now</div><div className="v">{tzs(rows.reduce((a, r) => a + r.balance, 0))}</div><div className="s">TZS, all bill customers</div></div>
            </div>
            <div className="panel"><div className="ph"><div><h2>Bill customers</h2></div>
              <XL onClick={() => downloadCsv(`Shehena-monthly-bills-${label}`, ["Customer", "Phone", "Consignments in period", "Billed in period", "Paid in period", "Balance owed now", "Active"],
                rows.map((r) => [r.a.name, r.a.phone, r.n, r.billedP, r.paidP, r.balance, r.a.active ? "Yes" : "No"]))} /></div>
              <div className="ledger"><table className="small"><thead><tr><th>Customer</th><th className="r">Cons.</th><th className="r">Billed</th><th className="r">Paid</th><th className="r">Owed now</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.a.id} className="row" onClick={() => ui.openAccount(r.a.id)}><td>{r.a.name}<div className="sub mono">{prettyPhone(r.a.phone)}</div></td><td className="r num">{r.n}</td><td className="r num">{tzs(r.billedP)}</td><td className="r num">{tzs(r.paidP)}</td><td className="r num" style={r.balance > 0 ? { color: "var(--bad)", fontWeight: 700 } : undefined}>{tzs(r.balance)}</td></tr>)}
                  {!rows.length && <tr><td colSpan={5} className="sub">No bill customers.</td></tr>}</tbody></table></div>
            </div>
          </>
        );
      })()}

      {tab === "deliveries" && (() => {
        const D = shipments.filter((s) => s.status === "collected" && inPeriod(s.collected_at)).sort((a, b) => String(b.collected_at).localeCompare(String(a.collected_at)));
        const notReceiver = D.filter((s) => s.collector_name && s.collector_name.trim().toLowerCase() !== s.r_name.trim().toLowerCase());
        const by: Record<string, number> = {};
        D.forEach((s) => { const k = s.collected_by || "—"; by[k] = (by[k] || 0) + 1; });
        return (
          <>
            <div className="stats">
              <div className="stat"><div className="lbl">Delivered</div><div className="v">{D.length}</div><div className="s">{pkgsOf(D)} packages collected</div></div>
              <div className="stat"><div className="lbl">Collected by someone else</div><div className="v">{notReceiver.length}</div><div className="s">not the named receiver</div></div>
              <div className="stat"><div className="lbl">Waiting now</div><div className="v">{shipments.filter((s) => s.status === "arrived").length}</div><div className="s">arrived, not collected</div></div>
            </div>
            <div className="panel"><div className="ph"><div><h2>Delivery notes</h2><div className="sub">{Object.entries(by).map(([k, n]) => `${k}: ${n}`).join(" · ") || "Released in the period"}</div></div>
              <XL onClick={() => downloadCsv(`Shehena-deliveries-${label}`, ["Delivery note", "Collected", "Waybill", "To", "Receiver", "Collected by", "Collector phone", "ID", "Packages", "Goods", "Payment", "Released by", "Remarks"],
                D.map((s) => [s.dn_no || "", fmtDate(s.collected_at), s.no, regShort(s.dest), s.r_name, s.collector_name || "", s.collector_phone || "", s.collector_id || "", s.pkgs, goodsLabel(s), PAY_LABEL[s.pay], s.collected_by || "", s.collect_note || ""]))} /></div>
              <div className="ledger"><table className="small"><thead><tr><th>Delivery note</th><th>Receiver → collected by</th><th>Goods</th><th>Released by</th></tr></thead>
                <tbody>{D.slice(0, 300).map((s) => (
                  <tr key={s.id} className="row" onClick={() => ui.openShip(s.id)}>
                    <td className="mono wb">{s.dn_no || "—"}<div className="sub">{fmtDate(s.collected_at)}</div></td>
                    <td>{s.r_name}{s.collector_name && s.collector_name !== s.r_name ? <> → <b>{s.collector_name}</b></> : null}<div className="sub">{s.collector_id}</div></td>
                    <td>{goodsLabel(s)} · {s.pkgs} pkg<div className="sub mono">{s.no}</div></td>
                    <td>{s.collected_by}{s.collect_note ? <div className="sub">{s.collect_note}</div> : null}</td>
                  </tr>))}
                  {!D.length && <tr><td colSpan={4} className="sub">No goods released in this period.</td></tr>}</tbody></table></div>
            </div>
          </>
        );
      })()}
    </section>
  );
}

/** The general picture: charts, totals, by destination, by staff. */
function Overview({ S }: { S: Shipment[] }) {
  const { shipments } = useStore();
  const billed = sumCharge(S);
  const paid = S.filter((s) => s.pay === "paid");
  const paidAmt = sumCharge(paid);
  const U = S.filter((x) => x.pay === "unpaid"), B = S.filter((x) => x.pay === "bill");
  const methods: Record<string, { n: number; v: number }> = {};
  paid.forEach((s) => { const k = s.method || "Not recorded"; methods[k] = methods[k] || { n: 0, v: 0 }; methods[k].n++; methods[k].v += Number(s.charge || 0); });
  const dests: Record<string, { n: number; p: number; b: number; u: number }> = {};
  S.forEach((s) => { const d = (dests[s.dest] = dests[s.dest] || { n: 0, p: 0, b: 0, u: 0 }); d.n++; d.p += s.pkgs; d.b += Number(s.charge || 0); if (s.pay === "unpaid") d.u += Number(s.charge || 0); });
  const staffRows: Record<string, { n: number; c: number }> = {};
  S.forEach((s) => { const k = s.created_by_name || "—"; (staffRows[k] = staffRows[k] || { n: 0, c: 0 }).n++; });
  paid.forEach((s) => { const k = s.paid_by || s.created_by_name || "—"; (staffRows[k] = staffRows[k] || { n: 0, c: 0 }).c += Number(s.charge || 0); });
  return (
    <>
      <div className="panel ypanel" style={{ marginBottom: 16 }}><YearPanel /></div>
      <div className="stats six">
        <div className="stat"><div className="lbl">Consignments</div><div className="v">{S.length}</div><div className="s">{pkgsOf(S)} packages</div></div>
        <div className="stat"><div className="lbl">Billed</div><div className="v">{tzs(billed)}</div><div className="s">TZS</div></div>
        <div className="stat"><div className="lbl">Collected</div><div className="v">{tzs(paidAmt)}</div><div className="s">TZS · {paid.length} paid</div></div>
        <div className={`stat${sumCharge(U) ? " warn" : ""}`}><div className="lbl">Outstanding</div><div className="v">{tzs(sumCharge(U))}</div><div className="s">TZS · {U.length} unpaid{B.length ? ` · ${tzs(sumCharge(B))} on bills` : ""}</div></div>
        <div className="stat"><div className="lbl">Delivered</div><div className="v">{S.filter((s) => s.status === "collected").length}</div><div className="s">of these consignments</div></div>
        <div className="stat"><div className="lbl">Awaiting pickup</div><div className="v">{shipments.filter((s) => s.status === "arrived").length}</div><div className="s">at destinations now</div></div>
      </div>
      <div className="rgrid">
        <div className="panel"><h2>Billed per day</h2><div className="sub">TZS, last 14 days. Faded bars are days with unpaid charges still open.</div><DailyChart /></div>
        <div className="panel"><h2>Payments by method</h2><div className="sub">Paid consignments in the period</div>
          <div className="ledger"><table className="small"><thead><tr><th>Method</th><th className="r">Count</th><th className="r">TZS</th></tr></thead>
            <tbody>{Object.entries(methods).sort((a, b) => b[1].v - a[1].v).map(([k, x]) => <tr key={k}><td>{k}</td><td className="r num">{x.n}</td><td className="r num">{tzs(x.v)}</td></tr>)}
              {!paid.length && <tr><td colSpan={3} className="sub">No payments in this period.</td></tr>}</tbody></table></div>
        </div>
      </div>
      <div className="rgrid">
        <div className="panel"><h2>By destination</h2>
          <div className="ledger"><table className="small"><thead><tr><th>Destination</th><th className="r">Cons.</th><th className="r">Pkgs</th><th className="r">Billed</th><th className="r">Unpaid</th></tr></thead>
            <tbody>{Object.entries(dests).sort((a, b) => b[1].b - a[1].b).map(([k, x]) =>
              <tr key={k}><td>{regShort(k)}</td><td className="r num">{x.n}</td><td className="r num">{x.p}</td><td className="r num">{tzs(x.b)}</td><td className="r num" style={x.u ? { color: "var(--bad)" } : undefined}>{tzs(x.u)}</td></tr>)}
              {!S.length && <tr><td colSpan={5} className="sub">No consignments in this period.</td></tr>}</tbody>
            {S.length > 0 && <tfoot><tr><td>Total</td><td className="r num">{S.length}</td><td className="r num">{pkgsOf(S)}</td><td className="r num">{tzs(billed)}</td><td className="r num">{tzs(sumCharge(U))}</td></tr></tfoot>}
          </table></div>
        </div>
        <div className="panel"><h2>By staff member</h2><div className="sub">Consignments received and payments recorded</div>
          <div className="ledger"><table className="small"><thead><tr><th>Staff</th><th className="r">Received</th><th className="r">Payments TZS</th></tr></thead>
            <tbody>{Object.entries(staffRows).map(([k, x]) => <tr key={k}><td>{k}</td><td className="r num">{x.n}</td><td className="r num">{tzs(x.c)}</td></tr>)}
              {!Object.keys(staffRows).length && <tr><td colSpan={3} className="sub">No activity in this period.</td></tr>}</tbody></table></div>
        </div>
      </div>
    </>
  );
}
