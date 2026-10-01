"use client";
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { useUi } from "../CargoApp";
import { Icon } from "../Icon";
import { PayPill, StatusPill } from "../parts";
import { REGIONS, STATUS, fmtDate, intlPhone, regShort, sumCharge, tzs } from "@/lib/domain";

export default function Consignments() {
  const { shipments, tripById, can } = useStore();
  const ui = useUi();
  const [q, setQ] = useState("");
  const [dest, setDest] = useState("");
  const [status, setStatus] = useState("");
  const pay = ui.listPay;

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const qd = ql.replace(/\D/g, "").replace(/^0/, "");
    return shipments.filter((s) =>
      (!dest || s.dest === dest) && (!status || s.status === status) && (!pay || s.pay === pay) &&
      (!ql || [s.no, s.s_name, s.r_name, s.item].join(" ").toLowerCase().includes(ql) ||
        (qd.length >= 4 && (intlPhone(s.s_phone).includes(qd) || intlPhone(s.r_phone).includes(qd)))));
  }, [shipments, q, dest, status, pay]);
  const paid = list.filter((x) => x.pay === "paid");

  return (
    <section>
      <div className="sectionhead">
        <h1>Consignments</h1>
        {can("receive") && <button className="btn primary" onClick={() => ui.go("new")}><Icon name="new" />Receive goods</button>}
      </div>
      <div className="filters">
        <div className="searchbox"><Icon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search waybill no., name, phone or item" aria-label="Search" /></div>
        <select value={dest} onChange={(e) => setDest(e.target.value)} aria-label="Destination" style={{ width: "auto", maxWidth: "100%" }}>
          <option value="">All destinations</option>{REGIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
      </div>
      <div className="filters" style={{ marginTop: 8 }}>
        <div className="chips">{([["", "All statuses"], ...STATUS] as [string, string][]).map(([k, l]) => <button key={k} className="chip" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}</div>
        <div className="chips">{([["", "Any payment"], ["unpaid", "Not paid"], ["paid", "Paid"]] as ["" | "paid" | "unpaid", string][]).map(([k, l]) => <button key={k} className="chip" aria-pressed={pay === k} onClick={() => ui.setListPay(k)}>{l}</button>)}</div>
      </div>
      {list.length > 0 && (
        <div className="sub" style={{ marginTop: 12 }}>
          Showing <b>{list.length}</b> · TZS <b>{tzs(sumCharge(list))}</b> billed · <span style={{ color: "var(--good)" }}>TZS <b>{tzs(sumCharge(paid))}</b> paid</span> · <span style={{ color: "var(--bad)" }}>TZS <b>{tzs(sumCharge(list) - sumCharge(paid))}</b> unpaid</span>
        </div>
      )}
      {list.length > 0 && (
        <div className="ledger main"><table>
          <thead><tr><th>Waybill</th><th>Goods</th><th>Sender → receiver</th><th>Route</th><th className="r">Charge (TZS)</th><th>Status</th></tr></thead>
          <tbody>{list.map((s) => {
            const t = tripById(s.trip_id);
            return (
              <tr className="row" key={s.id} tabIndex={0} onClick={() => ui.openShip(s.id)} onKeyDown={(e) => e.key === "Enter" && ui.openShip(s.id)}>
                <td><span className="mono wb">{s.no}</span><div className="sub">{fmtDate(s.received_at)}</div></td>
                <td><b style={{ fontWeight: 600 }}>{s.item}</b><div className="sub">{s.pkgs} pkg{s.pkgs === 1 ? "" : "s"}{s.kg ? ` · ${s.kg} kg` : ""}</div></td>
                <td>{s.s_name}<div className="sub">to {s.r_name}</div></td>
                <td className="route">{regShort(s.origin)}<i>→</i>{regShort(s.dest)}</td>
                <td className="r"><span className="num amt">{tzs(s.charge)}</span><div style={{ marginTop: 3 }}><PayPill paid={s.pay === "paid"} /></div></td>
                <td><StatusPill s={s.status} />{t && <div className="sub mono" style={{ marginTop: 3 }}>{t.plate}</div>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      <div className="cards">{list.map((s) => (
        <button className="ccard" key={s.id} onClick={() => ui.openShip(s.id)}>
          <div className="ctop"><span className="mono wb sub">{s.no}</span><StatusPill s={s.status} /></div>
          <div><b>{s.item}</b> · {s.pkgs} pkg{s.pkgs === 1 ? "" : "s"}</div>
          <div className="sub">{s.s_name} → {s.r_name} · {regShort(s.dest)}</div>
          <div className="cbot"><b>TZS {tzs(s.charge)}</b><PayPill paid={s.pay === "paid"} /></div>
        </button>
      ))}</div>
      {!shipments.length && (
        <div className="empty"><h3>No consignments yet</h3><p>Each parcel recorded under <b>Receive goods</b> appears here with its payment and delivery status.</p>
          {can("receive") && <button className="btn primary" onClick={() => ui.go("new")}>Receive the first consignment</button>}</div>
      )}
      {shipments.length > 0 && !list.length && <div className="empty"><h3>Nothing matches</h3><p>Try another name, phone or waybill number, or clear the filters.</p></div>}
    </section>
  );
}
