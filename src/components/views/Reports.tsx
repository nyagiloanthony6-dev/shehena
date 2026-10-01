"use client";
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { useUi } from "../CargoApp";
import { PayPill, StatusPill, TripPill } from "../parts";
import { DailyChart, YearPanel } from "../charts";
import { fmtDay, pkgsOf, regShort, sumCharge, tzs, type Shipment, type Trip } from "@/lib/domain";

type Period = "today" | "7" | "30" | "all";
const agg = (L: Shipment[]) => { const b = sumCharge(L), pd = sumCharge(L.filter((x) => x.pay === "paid")); return { b, pd, u: b - pd }; };

export default function Reports() {
  const { shipments, trips, tripShips, tripById } = useStore();
  const ui = useUi();
  const [period, setPeriod] = useState<Period>("30");
  const [truck, setTruck] = useState("");
  const [payView, setPayView] = useState<"unpaid" | "paid" | "all">("unpaid");

  const inPeriod = (iso?: string | null) => {
    if (!iso) return false;
    if (period === "all") return true;
    const d = new Date(iso), now = new Date();
    if (period === "today") return d.toDateString() === now.toDateString();
    return (now.getTime() - d.getTime()) / 864e5 <= Number(period);
  };

  const S = useMemo(() => shipments.filter((s) => inPeriod(s.received_at)), [shipments, period]); // eslint-disable-line react-hooks/exhaustive-deps
  const T = useMemo(() => trips.filter((t) => inPeriod(t.created_at)), [trips, period]); // eslint-disable-line react-hooks/exhaustive-deps
  const billed = sumCharge(S);
  const paid = S.filter((s) => s.pay === "paid");
  const paidAmt = sumCharge(paid);
  const dispatched = trips.filter((t) => t.departed_at && inPeriod(t.departed_at));

  const methods: Record<string, { n: number; v: number }> = {};
  paid.forEach((s) => { const k = s.method || "Not recorded"; methods[k] = methods[k] || { n: 0, v: 0 }; methods[k].n++; methods[k].v += Number(s.charge || 0); });
  const dests: Record<string, { n: number; p: number; b: number; u: number }> = {};
  S.forEach((s) => { const d = (dests[s.dest] = dests[s.dest] || { n: 0, p: 0, b: 0, u: 0 }); d.n++; d.p += s.pkgs; d.b += Number(s.charge || 0); if (s.pay !== "paid") d.u += Number(s.charge || 0); });
  const staffRows: Record<string, { n: number; c: number }> = {};
  S.forEach((s) => { const k = s.created_by_name || "—"; (staffRows[k] = staffRows[k] || { n: 0, c: 0 }).n++; });
  shipments.filter((s) => s.pay === "paid" && inPeriod(s.paid_at)).forEach((s) => { const k = s.paid_by || s.created_by_name || "—"; (staffRows[k] = staffRows[k] || { n: 0, c: 0 }).c += Number(s.charge || 0); });

  const byTruck = Object.values(T.reduce<Record<string, Trip[]>>((a, t) => { (a[t.plate] = a[t.plate] || []).push(t); return a; }, {}))
    .map((ts) => { const L = ts.flatMap(tripShips); return { plate: ts[0].plate, driver: ts[0].driver, ts, L, x: agg(L), tg: ts.reduce((a, t) => a + Number(t.target || 0), 0) }; })
    .sort((a, b) => b.x.b - a.x.b);
  const T2 = T.filter((t) => !truck || t.plate === truck);
  const T2ships = T2.flatMap(tripShips);
  const U = S.filter((x) => x.pay !== "paid");
  const V = payView === "paid" ? paid : payView === "unpaid" ? U : S;

  return (
    <section>
      <div className="sectionhead"><h1>Reports</h1>
        <div className="chips">{([["today", "Today"], ["7", "7 days"], ["30", "30 days"], ["all", "All time"]] as [Period, string][]).map(([k, l]) =>
          <button key={k} className="chip" aria-pressed={period === k} onClick={() => setPeriod(k)}>{l}</button>)}</div>
      </div>
      <div className="panel ypanel" style={{ marginBottom: 16 }}><YearPanel /></div>
      <div className="stats six">
        <div className="stat"><div className="lbl">Consignments</div><div className="v">{S.length}</div><div className="s">{pkgsOf(S)} packages</div></div>
        <div className="stat"><div className="lbl">Billed</div><div className="v">{tzs(billed)}</div><div className="s">TZS</div></div>
        <div className="stat"><div className="lbl">Collected</div><div className="v">{tzs(paidAmt)}</div><div className="s">TZS · {paid.length} paid</div></div>
        <div className={`stat${billed - paidAmt ? " warn" : ""}`}><div className="lbl">Outstanding</div><div className="v">{tzs(billed - paidAmt)}</div><div className="s">TZS · {S.length - paid.length} unpaid</div></div>
        <div className="stat"><div className="lbl">Trips dispatched</div><div className="v">{dispatched.length}</div><div className="s">{dispatched.filter((t) => t.status === "arrived").length} arrived</div></div>
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
            {S.length > 0 && <tfoot><tr><td>Total</td><td className="r num">{S.length}</td><td className="r num">{pkgsOf(S)}</td><td className="r num">{tzs(billed)}</td><td className="r num">{tzs(billed - paidAmt)}</td></tr></tfoot>}
          </table></div>
        </div>
        <div className="panel"><h2>By staff member</h2><div className="sub">Consignments received and payments recorded</div>
          <div className="ledger"><table className="small"><thead><tr><th>Staff</th><th className="r">Received</th><th className="r">Payments TZS</th></tr></thead>
            <tbody>{Object.entries(staffRows).map(([k, x]) => <tr key={k}><td>{k}</td><td className="r num">{x.n}</td><td className="r num">{tzs(x.c)}</td></tr>)}
              {!Object.keys(staffRows).length && <tr><td colSpan={3} className="sub">No activity in this period.</td></tr>}</tbody></table></div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}><h2>Collections by truck</h2><div className="sub">All trips each truck started in the period. Tap a row to see its trips.</div>
        <div className="ledger"><table className="small">
          <thead><tr><th>Truck</th><th className="r">Trips</th><th className="r">Pkgs</th><th className="r">Billed</th><th className="r">Paid</th><th className="r">Unpaid</th><th className="r">Avg per trip</th><th className="r">vs target</th></tr></thead>
          <tbody>{byTruck.map((r) => (
            <tr key={r.plate} className="row" onClick={() => setTruck(r.plate)}>
              <td><span className="mono wb" style={{ fontWeight: 600 }}>{r.plate}</span><div className="sub">{r.driver}</div></td>
              <td className="r num">{r.ts.length}</td><td className="r num">{pkgsOf(r.L)}</td><td className="r num">{tzs(r.x.b)}</td>
              <td className="r num" style={{ color: "var(--good)" }}>{tzs(r.x.pd)}</td><td className="r num" style={r.x.u ? { color: "var(--bad)" } : undefined}>{tzs(r.x.u)}</td>
              <td className="r num">{tzs(Math.round(r.x.b / r.ts.length))}</td><td className="r num">{r.tg ? Math.round((r.x.b / r.tg) * 100) + "%" : "—"}</td>
            </tr>))}
            {!byTruck.length && <tr><td colSpan={8} className="sub">No trucks dispatched in this period.</td></tr>}</tbody>
          {byTruck.length > 1 && (() => { const L = byTruck.flatMap((r) => r.L), x = agg(L); return <tfoot><tr><td>Total</td><td className="r num">{T.length}</td><td className="r num">{pkgsOf(L)}</td><td className="r num">{tzs(x.b)}</td><td className="r num">{tzs(x.pd)}</td><td className="r num">{tzs(x.u)}</td><td /><td /></tr></tfoot>; })()}
        </table></div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="ph" style={{ flexWrap: "wrap" }}>
          <div><h2>Collections by trip</h2><div className="sub">{truck ? `Trips by ${truck} in the period` : "Every trip started in the period"}</div></div>
          {truck && <div className="chips"><button className="chip" aria-pressed onClick={() => setTruck("")}>{truck} ✕</button></div>}
        </div>
        <div className="ledger"><table className="small">
          <thead><tr><th>Trip</th><th>Truck · to</th><th>Status</th><th className="r">Pkgs</th><th className="r">Billed</th><th className="r">Paid</th><th className="r">Unpaid</th><th className="r">Target</th></tr></thead>
          <tbody>{T2.map((t) => { const L = tripShips(t), x = agg(L); return (
            <tr key={t.id} className="row" onClick={() => ui.openTrip(t.id)}>
              <td className="mono wb">{t.no}<div className="sub">{fmtDay(t.departed_at || t.created_at)}</div></td>
              <td><span className="mono wb">{t.plate}</span><div className="sub">to {regShort(t.dest)}</div></td>
              <td><TripPill s={t.status} /></td><td className="r num">{pkgsOf(L)}</td><td className="r num">{tzs(x.b)}</td>
              <td className="r num" style={{ color: "var(--good)" }}>{tzs(x.pd)}</td><td className="r num" style={x.u ? { color: "var(--bad)" } : undefined}>{tzs(x.u)}</td>
              <td className="r num">{t.target ? <>{tzs(t.target)}<div className="sub">{Math.round((x.b / t.target) * 100)}%</div></> : <span className="sub">—</span>}</td>
            </tr>); })}
            {!T2.length && <tr><td colSpan={8} className="sub">No trips in this period.</td></tr>}</tbody>
          {T2.length > 0 && (() => { const x = agg(T2ships); return <tfoot><tr><td colSpan={3}>Total · {T2.length} trip{T2.length === 1 ? "" : "s"}</td><td className="r num">{pkgsOf(T2ships)}</td><td className="r num">{tzs(x.b)}</td><td className="r num">{tzs(x.pd)}</td><td className="r num">{tzs(x.u)}</td><td /></tr></tfoot>; })()}
        </table></div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="ph" style={{ flexWrap: "wrap" }}>
          <div><h2>Paid and unpaid</h2><div className="sub">Every consignment received in the period</div></div>
          <div className="chips">{([["unpaid", `Unpaid · ${U.length}`], ["paid", `Paid · ${paid.length}`], ["all", `All · ${S.length}`]] as ["unpaid" | "paid" | "all", string][]).map(([k, l]) =>
            <button key={k} className="chip" aria-pressed={payView === k} onClick={() => setPayView(k)}>{l}</button>)}</div>
        </div>
        <div className="ykpi" style={{ margin: "4px 0 10px" }}>
          <div><div className="lbl">Paid</div><div className="v" style={{ color: "var(--good)" }}>{tzs(paidAmt)}</div><div className="sub">TZS · {paid.length} consignments</div></div>
          <div className="due"><div className="lbl">Unpaid</div><div className="v">{tzs(sumCharge(U))}</div><div className="sub">TZS · {U.length} consignments</div></div>
          <div><div className="lbl">Share paid</div><div className="v">{S.length ? Math.round((paidAmt / Math.max(1, billed)) * 100) + "%" : "—"}</div><div className="sub">of TZS billed</div></div>
        </div>
        <div className="ledger"><table className="small">
          <thead><tr><th>Waybill</th><th>Sender → receiver</th><th>Truck</th><th>Status</th><th>Payment</th><th className="r">TZS</th></tr></thead>
          <tbody>{V.map((x) => { const t = tripById(x.trip_id); return (
            <tr key={x.id} className="row" onClick={() => ui.openShip(x.id)}>
              <td className="mono wb">{x.no}<div className="sub">{fmtDay(x.received_at)}</div></td>
              <td>{x.s_name}<div className="sub">to {x.r_name} · {regShort(x.dest)}</div></td>
              <td className="mono wb">{t ? t.plate : <span className="sub">Not loaded</span>}</td>
              <td><StatusPill s={x.status} /></td>
              <td><PayPill paid={x.pay === "paid"} />{x.pay === "paid" && <div className="sub">{x.method || ""}{x.paid_by ? " · " + x.paid_by : ""}</div>}</td>
              <td className="r num" style={{ fontWeight: 600 }}>{tzs(x.charge)}</td>
            </tr>); })}
            {!V.length && <tr><td colSpan={6} className="sub">Nothing here for this period.</td></tr>}</tbody>
          {V.length > 0 && <tfoot><tr><td colSpan={5}>Total · {V.length}</td><td className="r num">{tzs(sumCharge(V))}</td></tr></tfoot>}
        </table></div>
      </div>
    </section>
  );
}
