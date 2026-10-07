"use client";
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { useUi } from "../CargoApp";
import { PayPill, SendButtons, sentLog, useArriveTrip } from "../parts";
import { METHODS, REGIONS, fmtDate, fmtDay, prettyPhone, regShort, sumCharge, tzs, type Shipment, type Trip } from "@/lib/domain";

const daysSince = (iso?: string | null) => Math.floor((Date.now() - new Date(iso || Date.now()).getTime()) / 864e5);

/** A truck on the road, with a one-tap "mark arrived". */
function RoadTruck({ t }: { t: Trip }) {
  const { tripShips, can } = useStore();
  const ui = useUi();
  const arrive = useArriveTrip();
  const [confirm, setConfirm] = useState(false);
  const list = tripShips(t);
  const unpaid = list.filter((s) => s.pay !== "paid");
  return (
    <div className="trip" style={{ cursor: "default" }}>
      <div className="top"><span className="plate">{t.plate}</span><span className="pill st-departed">On the road</span></div>
      <div className="route">{regShort(t.origin)}<i>→</i>{regShort(t.dest)}</div>
      <div className="sub">Left {fmtDate(t.departed_at)} · {t.driver || "No driver"}{t.driver_phone ? ` · ${prettyPhone(t.driver_phone)}` : ""}</div>
      <div className="tline">
        <span><b>{list.length}</b> consignment{list.length === 1 ? "" : "s"}</span>
        <span>TZS <b>{tzs(sumCharge(list))}</b></span>
        {unpaid.length > 0 && <span style={{ color: "var(--bad)" }}><b style={{ color: "inherit" }}>{unpaid.length}</b> to pay on arrival · TZS <b style={{ color: "inherit" }}>{tzs(sumCharge(unpaid))}</b></span>}
      </div>
      <div className="actions" style={{ marginTop: 4 }}>
        {can("dispatch") && (confirm
          ? <><button className="btn sm primary" onClick={async () => { setConfirm(false); if (await arrive(t)) ui.openTrip(t.id); }}>Yes, it arrived in {regShort(t.dest)}</button><button className="btn sm" onClick={() => setConfirm(false)}>Not yet</button></>
          : <button className="btn sm primary" onClick={() => setConfirm(true)}>Mark arrived</button>)}
        <button className="btn sm" onClick={() => ui.openTrip(t.id)}>View manifest</button>
      </div>
    </div>
  );
}

/** One consignment waiting at the destination office. */
function WaitingRow({ s }: { s: Shipment }) {
  const { tripById, can, patch, me, toast } = useStore();
  const ui = useUi();
  const [method, setMethod] = useState(METHODS[0]);
  const [paying, setPaying] = useState(false);
  const d = daysSince(s.arrived_at);
  const notified = sentLog(s, "arrived", "receiver").length > 0;
  const lastReminder = sentLog(s, "reminder", "receiver").at(-1);
  const reminderDue = s.pay !== "paid" && notified && d >= 2 && (!lastReminder || daysSince(lastReminder.at) >= 2);
  const t = tripById(s.trip_id);
  const at = () => new Date().toISOString();
  return (
    <div className="nrow" style={{ alignItems: "start" }}>
      <div style={{ minWidth: 0 }}>
        <button className="link" style={{ fontSize: 14.5, color: "var(--fg)" }} onClick={() => ui.openShip(s.id)}><b>{s.r_name}</b></button>{" "}
        <span className="mono sub">{prettyPhone(s.r_phone)}</span>
        <div className="sub"><span className="mono">{s.no}</span> · {s.item} · {s.pkgs} pkg · {regShort(s.dest)}{t ? ` · ${t.plate}` : ""}</div>
        <div className="sub" style={{ marginTop: 2, display: "flex", gap: "4px 10px", flexWrap: "wrap", alignItems: "center" }}>
          <PayPill paid={s.pay === "paid"} />
          {s.pay !== "paid" && <b style={{ color: "var(--bad)" }}>TZS {tzs(s.charge)} due</b>}
          <span>{d < 1 ? "Arrived today" : d === 1 ? "Waiting 1 day" : `Waiting ${d} days`}</span>
          {notified ? <span className="tick">✓ Notified</span> : <span style={{ color: "var(--amber)", fontWeight: 600 }}>Not notified yet</span>}
          {lastReminder && <span>Reminded {fmtDay(lastReminder.at)}</span>}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "end" }}>
        <div className="actions" style={{ margin: 0, justifyContent: "end" }}>
          {!notified && <SendButtons s={s} kind="arrived" to="receiver" />}
          {reminderDue && <><span className="sub" style={{ alignSelf: "center" }}>Reminder:</span><SendButtons s={s} kind="reminder" to="receiver" /></>}
        </div>
        <div className="actions" style={{ margin: 0, justifyContent: "end" }}>
          {s.pay === "paid" && can("dispatch") && (
            <button className="btn sm primary" onClick={async () => { if (await patch<Shipment>("shipments", s.id, { status: "collected", collected_at: at(), collected_by: me.full_name })) toast(`Released to ${s.r_name}`); }}>Release goods</button>
          )}
          {s.pay !== "paid" && can("pay") && (paying ? (
            <>
              <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: "auto" }} aria-label="Payment method">{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
              <button className="btn sm primary" onClick={async () => { const now = at(); if (await patch<Shipment>("shipments", s.id, { pay: "paid", method, paid_at: now, paid_by: me.full_name, status: "collected", collected_at: now, collected_by: me.full_name })) toast(`Paid and released to ${s.r_name}`); }}>Confirm TZS {tzs(s.charge)} &amp; release</button>
              <button className="btn sm" onClick={() => setPaying(false)}>Cancel</button>
            </>
          ) : <button className="btn sm" onClick={() => setPaying(true)}>Take payment &amp; release</button>)}
        </div>
      </div>
    </div>
  );
}

export default function Arrivals() {
  const { trips, shipments } = useStore();
  const ui = useUi();
  const [show, setShow] = useState<"all" | "unpaid" | "paid" | "notify">("all");
  const [dest, setDest] = useState("");
  const [q, setQ] = useState("");

  const road = trips.filter((t) => t.status === "departed").sort((a, b) => (a.departed_at || "").localeCompare(b.departed_at || ""));
  const waitingAll = useMemo(() => shipments.filter((s) => s.status === "arrived")
    .sort((a, b) => (a.pay === "paid" ? 1 : 0) - (b.pay === "paid" ? 1 : 0) || (a.arrived_at || "").localeCompare(b.arrived_at || "")), [shipments]);
  const unpaid = waitingAll.filter((s) => s.pay !== "paid");
  const notNotified = waitingAll.filter((s) => !sentLog(s, "arrived", "receiver").length);
  const today = new Date().toDateString();
  const collectedToday = shipments.filter((s) => s.status === "collected" && s.collected_at && new Date(s.collected_at).toDateString() === today);
  const destOptions = REGIONS.filter(([c]) => waitingAll.some((s) => s.dest === c));
  const ql = q.trim().toLowerCase();
  const waiting = waitingAll.filter((s) =>
    (show === "all" || (show === "unpaid" ? s.pay !== "paid" : show === "paid" ? s.pay === "paid" : !sentLog(s, "arrived", "receiver").length)) &&
    (!dest || s.dest === dest) &&
    (!ql || [s.no, s.r_name, s.r_phone, s.s_name, s.item].join(" ").toLowerCase().includes(ql)));

  return (
    <section>
      <div className="sectionhead">
        <div><h1>Arrivals</h1><div className="sub">Trucks coming in, goods waiting for customers, and payments to collect before release.</div></div>
      </div>
      <div className="stats">
        <div className="stat"><div className="lbl">On the road</div><div className="v">{road.length}</div><div className="s">truck{road.length === 1 ? "" : "s"} to receive</div></div>
        <div className="stat"><div className="lbl">Waiting for pickup</div><div className="v">{waitingAll.length}</div><div className="s">consignments at destinations</div></div>
        <div className={`stat${notNotified.length ? " warn" : ""}`}><div className="lbl">Not notified</div><div className="v">{notNotified.length}</div><div className="s">customers not told yet</div></div>
        <div className={`stat${unpaid.length ? " warn" : ""}`}><div className="lbl">To collect</div><div className="v">{tzs(sumCharge(unpaid))}</div><div className="s">TZS from {unpaid.length} customer{unpaid.length === 1 ? "" : "s"}</div></div>
        <div className="stat"><div className="lbl">Released today</div><div className="v">{collectedToday.length}</div><div className="s">TZS {tzs(sumCharge(collectedToday))}</div></div>
      </div>

      <div className="group-h"><h2>Trucks on the road</h2><span className="sub">{road.length}</span></div>
      {road.length ? <div className="trips">{road.map((t) => <RoadTruck key={t.id} t={t} />)}</div>
        : <p className="quiet">No trucks on the road. Trucks appear here once they&apos;re dispatched from the Loading bay.</p>}

      <div className="group-h" style={{ marginTop: 26 }}><h2>Waiting for customers</h2><span className="sub">{waitingAll.length}</span></div>
      <div className="filters">
        <div className="chips">
          {([["all", `All · ${waitingAll.length}`], ["unpaid", `Unpaid · ${unpaid.length}`], ["paid", `Paid · ${waitingAll.length - unpaid.length}`], ["notify", `Not notified · ${notNotified.length}`]] as [typeof show, string][]).map(([k, l]) =>
            <button key={k} className="chip" aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}
        </div>
        {destOptions.length > 1 && (
          <select value={dest} onChange={(e) => setDest(e.target.value)} style={{ width: "auto" }} aria-label="Destination">
            <option value="">All destinations</option>{destOptions.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        )}
        <div className="searchbox" style={{ flex: "1 1 200px" }}><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer, phone or waybill" aria-label="Search waiting goods" style={{ paddingLeft: 11 }} /></div>
      </div>
      <div className="panel" style={{ marginTop: 12 }}>
        {waiting.map((s) => <WaitingRow key={s.id} s={s} />)}
        {!waitingAll.length && <p className="quiet">No goods waiting. When a truck is marked arrived, its consignments appear here.</p>}
        {waitingAll.length > 0 && !waiting.length && <p className="quiet">Nothing matches this filter.</p>}
      </div>
      {collectedToday.length > 0 && (
        <>
          <div className="group-h" style={{ marginTop: 26 }}><h2>Released today</h2><span className="sub">{collectedToday.length}</span></div>
          <div className="panel">
            {collectedToday.map((s) => (
              <button className="mrow" key={s.id} onClick={() => ui.openShip(s.id)}>
                <div><b>{s.r_name}</b><div className="sub"><span className="mono">{s.no}</span> · {s.item} · released by {s.collected_by || "—"}</div></div>
                <div className="r"><b>{tzs(s.charge)}</b><div className="sub">{s.method || "Paid"} · {fmtDate(s.collected_at).slice(-5)}</div></div>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
