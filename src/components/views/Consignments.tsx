"use client";
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { useUi } from "../CargoApp";
import { Icon } from "../Icon";
import { PayPill, StatusPill, usePaged, Pager } from "../parts";
import { sumPaid, sumBalance, isPart, noPrice, nameOr, tripSearchIndex, truckMatches, isAir, statusList, REGIONS, STATUS, officesOf, goodsLabel, itemsOf, fmtDate, intlPhone, regShort, sumCharge, tzs } from "@/lib/domain";

const localDay = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const inDays = (iso: string, from: string, to: string) => { const d = localDay(iso); return (!from || d >= from) && (!to || d <= to); };

export default function Consignments() {
  const { shipments, trips, tripById, can, company } = useStore();
  const tripIdx = useMemo(() => tripSearchIndex(trips), [trips]);
  // Only the towns this company delivers to: its offices (not the head office), plus any other town it has actually sent goods to.
  const destList = useMemo(() => {
    const head = company.default_origin || "DAR";
    const mine = officesOf(company).filter((c) => c !== head);
    const used = [...new Set(shipments.map((s) => s.dest))].filter((c) => !mine.includes(c));
    return REGIONS.filter(([c]) => mine.includes(c) || used.includes(c)).sort((a, b) => (mine.includes(a[0]) ? 0 : 1) - (mine.includes(b[0]) ? 0 : 1) || mine.indexOf(a[0]) - mine.indexOf(b[0]) || a[1].localeCompare(b[1]));
  }, [company, shipments]);
  const ui = useUi();
  const [q, setQ] = useState("");
  const [dest, setDest] = useState("");
  const [status, setStatus] = useState("");
  // Received between these dates (inclusive), in the office's local time.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const pay = ui.listPay;

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const qd = ql.replace(/\D/g, "").replace(/^0/, "");
    return shipments.filter((s) =>
      (!from && !to || inDays(s.received_at, from, to)) &&
      (!dest || s.dest === dest) && (!status || s.status === status) && (!pay || s.pay === pay) &&
      (!ql || [s.no, s.s_name, s.r_name, s.item, ...itemsOf(s).map((l) => l.name)].join(" ").toLowerCase().includes(ql) ||
        (qd.length >= 4 && (intlPhone(s.s_phone).includes(qd) || intlPhone(s.r_phone).includes(qd))) ||
        truckMatches(tripIdx, s.trip_id, q)));
  }, [shipments, q, dest, status, pay, from, to, tripIdx]);
  const { rows, pager } = usePaged(list, [q, dest, status, pay, from, to].join("|"));
  const today = localDay(new Date().toISOString());
  const quick = (days: number) => { setFrom(localDay(new Date(Date.now() - (days - 1) * 864e5).toISOString())); setTo(today); };
  const paidSum = sumPaid(list), owed = sumBalance(list);

  return (
    <section>
      <div className="sectionhead">
        <h1>Consignments</h1>
        {can("receive") && <button className="btn primary" onClick={() => ui.go("new")}><Icon name="new" />Receive goods</button>}
      </div>
      <div className="filters">
        <div className="searchbox"><Icon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search waybill, name, phone, item or truck plate (T 186 DNH)" aria-label="Search" /></div>
        <select value={dest} onChange={(e) => setDest(e.target.value)} aria-label="Destination" style={{ width: "auto", maxWidth: "100%" }}>
          <option value="">All destinations</option>{destList.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
      </div>
      <div className="filters datefilters" style={{ marginTop: 8 }}>
        <span className="sub">Received</span>
        <div className="chips">
          <button className="chip" aria-pressed={from === today && to === today} onClick={() => { setFrom(today); setTo(today); }}>Today</button>
          <button className="chip" aria-pressed={to === today && from === localDay(new Date(Date.now() - 6 * 864e5).toISOString())} onClick={() => quick(7)}>7 days</button>
          <button className="chip" aria-pressed={to === today && from === today.slice(0, 8) + "01" && from !== today} onClick={() => { setFrom(today.slice(0, 8) + "01"); setTo(today); }}>This month</button>
        </div>
        <label className="datefilter"><span className="sub">from</span>
          <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} aria-label="Received from date" style={{ width: "auto" }} /></label>
        <label className="datefilter"><span className="sub">to</span>
          <input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} aria-label="Received to date" style={{ width: "auto" }} /></label>
        {(from || to) && <button className="btn sm" type="button" onClick={() => { setFrom(""); setTo(""); }}>All dates</button>}
      </div>
      <div className="filters" style={{ marginTop: 8 }}>
        <div className="chips">{([["", "All statuses"], ...statusList(isAir(company))] as [string, string][]).map(([k, l]) => <button key={k} className="chip" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}</div>
        <div className="chips">{([["", "Any payment"], ["unpaid", "Not paid"], ["paid", "Paid"], ["bill", "Monthly bill"]] as ["" | "paid" | "unpaid" | "bill", string][]).map(([k, l]) => <button key={k} className="chip" aria-pressed={pay === k} onClick={() => ui.setListPay(k)}>{l}</button>)}</div>
      </div>
      {list.length > 0 && (
        <div className="sub" style={{ marginTop: 12 }}>
          Showing <b>{list.length}</b> · TZS <b>{tzs(sumCharge(list))}</b> billed · <span style={{ color: "var(--good)" }}>TZS <b>{tzs(paidSum)}</b> paid</span> · <span style={{ color: "var(--bad)" }}>TZS <b>{tzs(owed)}</b> unpaid</span>
        </div>
      )}
      {list.length > 0 && (
        <div className="ledger main"><table>
          <thead><tr><th>Waybill</th><th>Goods</th><th>Sender → receiver</th><th>Route</th><th className="r">Charge (TZS)</th><th>Status</th></tr></thead>
          <tbody>{rows.map((s) => {
            const t = tripById(s.trip_id);
            return (
              <tr className="row" key={s.id} tabIndex={0} onClick={() => ui.openShip(s.id)} onKeyDown={(e) => e.key === "Enter" && ui.openShip(s.id)}>
                <td><span className="mono wb">{s.no}</span>{s.found_on_arrival && <span className="tag-found" title="Found on arrival, not recorded at loading">Found</span>}<div className="sub">{fmtDate(s.received_at)}</div></td>
                <td><b style={{ fontWeight: 600 }}>{goodsLabel(s)}</b><div className="sub">{s.pkgs} pkg{s.pkgs === 1 ? "" : "s"}{s.kg ? ` · ${s.kg} kg` : ""}</div></td>
                <td>{nameOr(s.s_name)}<div className="sub">to {nameOr(s.r_name)}</div></td>
                <td className="route">{regShort(s.origin)}<i>→</i>{regShort(s.dest)}</td>
                <td className="r"><span className="num amt">{tzs(s.charge)}</span><div style={{ marginTop: 3 }}>{noPrice(s) ? <span className="pill pay-part">No charge yet</span> : <PayPill pay={s.pay} part={isPart(s)} />}</div></td>
                <td><StatusPill s={s.status} />{t && <div className="sub mono" style={{ marginTop: 3 }}>{t.plate}</div>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      <div className="cards">{rows.map((s) => (
        <button className="ccard" key={s.id} onClick={() => ui.openShip(s.id)}>
          <div className="ctop"><span className="mono wb sub">{s.no}{s.found_on_arrival && <span className="tag-found">Found</span>}</span><StatusPill s={s.status} /></div>
          <div><b>{goodsLabel(s)}</b> · {s.pkgs} pkg{s.pkgs === 1 ? "" : "s"}</div>
          <div className="sub">{nameOr(s.s_name)} → {nameOr(s.r_name)} · {regShort(s.dest)}</div>
          <div className="cbot"><b>TZS {tzs(s.charge)}</b>{noPrice(s) ? <span className="pill pay-part">No charge yet</span> : <PayPill pay={s.pay} part={isPart(s)} />}</div>
        </button>
      ))}</div>
      <Pager pager={pager} />
      {!shipments.length && (
        <div className="empty"><h3>No consignments yet</h3><p>Each parcel recorded under <b>Receive goods</b> appears here with its payment and delivery status.</p>
          {can("receive") && <button className="btn primary" onClick={() => ui.go("new")}>Receive the first consignment</button>}</div>
      )}
      {shipments.length > 0 && !list.length && <div className="empty"><h3>Nothing matches</h3><p>Try another name, phone or waybill number, or clear the filters.</p></div>}
    </section>
  );
}
