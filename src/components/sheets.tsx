"use client";
import { useState } from "react";
import { useStore } from "./store";
import { useUi } from "./CargoApp";
import { BulkNotices, Meter, NotifyBlock, PayPill, Slip, StatusPill, TripSummary, downloadReceipt, tripTotals } from "./parts";
import { METHODS, STATUS, TSTATUS, fmtDate, fmtDay, pkgsOf, prettyPhone, regShort, tzs, type Shipment, type Trip } from "@/lib/domain";

export function ShipmentSheet({ id }: { id: string }) {
  const { shipById, tripById, can, patch, remove, me, company, toast } = useStore();
  const ui = useUi();
  const [method, setMethod] = useState(METHODS[0]);
  const [confirmDel, setConfirmDel] = useState(false);
  const s = shipById(id);
  if (!s) return <div className="sheet-h"><p className="sub">This consignment no longer exists.</p><button className="btn sm" onClick={ui.close}>Close</button></div>;
  const idx = STATUS.findIndex((x) => x[0] === s.status);
  const t = tripById(s.trip_id);
  const times: Record<string, string | null> = { received: s.received_at, loaded: s.loaded_at, transit: s.transit_at, arrived: s.arrived_at, collected: s.collected_at };
  const now = () => new Date().toISOString();
  const P = (v: Partial<Shipment>) => patch<Shipment>("shipments", s.id, v);

  return (
    <>
      <div className="sheet-h">
        <div><div className="lbl">Waybill</div><h2 style={{ fontFamily: "var(--f-mono)" }}>{s.no}</h2></div>
        <button className="btn sm" onClick={ui.close}>Close</button>
      </div>

      <div className="card"><h3>Delivery status</h3>
        <div className="steps">{STATUS.map(([k, l], i) => <div key={k} className={i <= idx ? "done" : ""}>{l}<small>{times[k] ? fmtDay(times[k]) : " "}</small></div>)}</div>
        {t && <p className="note">Vehicle <b className="mono">{t.plate}</b> · trip <a href="#" onClick={(e) => { e.preventDefault(); ui.openTrip(t.id); }}>{t.no}</a> · driver {t.driver || "—"}</p>}
        <div className="actions">
          {s.status === "received" && can("load") && <button className="btn" onClick={() => ui.go("trips")}>Load onto a vehicle</button>}
          {s.status === "arrived" && can("dispatch") && <button className="btn primary" onClick={async () => { if (await P({ status: "collected", collected_at: now(), collected_by: me.full_name })) toast("Marked as collected"); }}>Mark as collected</button>}
          {s.status === "collected" && can("undo") && <button className="btn sm" onClick={() => P({ status: "arrived", collected_at: null, collected_by: null })}>Undo collected</button>}
        </div>
        {s.status === "collected" && <p className="note">Collected {fmtDate(s.collected_at)}{s.collected_by ? " · released by " + s.collected_by : ""}</p>}
      </div>

      <div className="card"><h3>Payment</h3>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div>
            <span className="mono" style={{ fontSize: 17, fontWeight: 600 }}>TZS {tzs(s.charge)}</span> <PayPill paid={s.pay === "paid"} />
            {s.pay === "paid" && s.paid_at && <div className="sub">{s.method || ""} · {fmtDate(s.paid_at)}{s.paid_by ? " · by " + s.paid_by : ""}</div>}
          </div>
          {s.pay === "paid"
            ? can("undo") && <button className="btn sm" onClick={() => P({ pay: "unpaid", paid_at: null, method: null, paid_by: null })}>Mark not paid</button>
            : can("pay") && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: "auto" }} aria-label="Payment method">{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
                <button className="btn primary sm" onClick={async () => { if (await P({ pay: "paid", method, paid_at: now(), paid_by: me.full_name })) toast("Payment recorded"); }}>Record payment</button>
              </div>
            )}
        </div>
      </div>

      {(s.status === "arrived" || s.status === "collected") && (
        <div className="card"><h3>Arrival notice</h3><NotifyBlock s={s} kind="arrived" to="receiver" />
          <details style={{ marginTop: 10 }}><summary className="sub" style={{ cursor: "pointer" }}>Also tell the sender</summary><NotifyBlock s={s} kind="arrived" to="sender" /></details>
        </div>
      )}
      {["transit", "arrived", "collected"].includes(s.status) && <div className="card"><h3>Departure notice</h3><NotifyBlock s={s} kind="departed" to="receiver" /></div>}
      <div className="card"><h3>Goods received notice</h3><NotifyBlock s={s} kind="received" to="receiver" />
        <details style={{ marginTop: 10 }}><summary className="sub" style={{ cursor: "pointer" }}>Send receipt to the sender</summary><NotifyBlock s={s} kind="received" to="sender" /></details>
      </div>
      <div className="card"><h3>Receipt</h3><Slip s={s} company={company} />
        <div className="actions" style={{ marginTop: 20 }}><button className="btn" onClick={() => downloadReceipt(s, company)}>Download receipt (PDF)</button></div>
      </div>
      {can("delete") && (
        <div className="card"><h3>Record</h3>
          {confirmDel
            ? <div className="confirm">Delete {s.no} permanently? <button className="btn sm danger" onClick={async () => { ui.close(); if (await remove("shipments", s.id)) toast("Consignment deleted"); }}>Delete</button><button className="btn sm" onClick={() => setConfirmDel(false)}>Keep</button></div>
            : <button className="btn sm danger" onClick={() => setConfirmDel(true)}>Delete consignment</button>}
        </div>
      )}
    </>
  );
}

export function TripSheet({ id }: { id: string }) {
  const { tripById, tripShips, shipments, can, patch, patchMany, remove, me, toast } = useStore();
  const ui = useUi();
  const [confirm, setConfirm] = useState<"" | "depart" | "arrive" | "del">("");
  const t = tripById(id);
  const [target, setTarget] = useState(String(t?.target || ""));
  if (!t) return <div className="sheet-h"><p className="sub">This trip no longer exists.</p><button className="btn sm" onClick={ui.close}>Close</button></div>;
  const list = tripShips(t);
  const idx = TSTATUS.findIndex((x) => x[0] === t.status);
  const times: Record<string, string | null> = { loading: t.created_at, departed: t.departed_at, arrived: t.arrived_at };
  const n = pkgsOf(list);
  const full = t.target > 0 && tripTotals(list).billed >= t.target;
  const now = () => new Date().toISOString();
  const waiting = shipments.filter((s) => s.status === "received" && s.origin === t.origin)
    .sort((a, b) => (a.dest === t.dest ? 0 : 1) - (b.dest === t.dest ? 0 : 1) || a.received_at.localeCompare(b.received_at));

  const depart = async () => {
    setConfirm("");
    const at = now();
    if (await patch<Trip>("trips", t.id, { status: "departed", departed_at: at, departed_by: me.full_name })) {
      await patchMany("shipments", list.map((s) => s.id), { status: "transit", transit_at: at });
      toast(`${t.plate} departed. Send the departure notices.`);
    }
  };
  const arrive = async () => {
    setConfirm("");
    const at = now();
    if (await patch<Trip>("trips", t.id, { status: "arrived", arrived_at: at, arrived_by: me.full_name })) {
      await patchMany("shipments", list.filter((s) => s.status === "transit").map((s) => s.id), { status: "arrived", arrived_at: at });
      toast(`${t.plate} arrived. Send the arrival notices.`);
    }
  };

  return (
    <>
      <div className="sheet-h">
        <div><div className="lbl">Trip {t.no}</div><h2><span className="mono">{t.plate}</span> · {regShort(t.origin)} → {regShort(t.dest)}</h2></div>
        <button className="btn sm" onClick={ui.close}>Close</button>
      </div>
      <div className="card">
        <div className="steps">{TSTATUS.map(([k, l], i) => <div key={k} className={i <= idx ? "done" : ""}>{l}<small>{times[k] ? fmtDay(times[k]) : " "}</small></div>)}</div>
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Driver</dt><dd>{t.driver || "—"} {t.driver_phone && <>· <span className="mono">{prettyPhone(t.driver_phone)}</span></>}</dd>
          <dt>Loaded by</dt><dd>{t.created_by_name || "—"}</dd>
          {t.departed_by && <><dt>Dispatched by</dt><dd>{t.departed_by}</dd></>}
        </dl>
        <div style={{ marginTop: 12 }}><Meter trip={t} /></div>
        {can("target") && (
          <div className="actions" style={{ alignItems: "center" }}>
            <span className="sub">Target TZS</span>
            <input type="number" min={0} step={10000} value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 150 }} aria-label="Trip target" />
            <button className="btn sm primary" onClick={async () => { if (await patch<Trip>("trips", t.id, { target: Number(target) || 0, target_set_by: me.full_name })) toast("Trip target saved"); }}>Save target</button>
          </div>
        )}
        {t.target_set_by && <p className="note">Target set by {t.target_set_by}</p>}
      </div>
      <TripSummary trip={t} />

      {t.status === "loading" && can("dispatch") && (
        <div className="card"><h3>Dispatch</h3>
          {full ? <p style={{ margin: "0 0 8px" }}><b>This truck has reached its collection target.</b> Close loading and send departure notices.</p>
            : <p className="sub" style={{ margin: "0 0 8px" }}>You can dispatch before the target is reached.</p>}
          {confirm === "depart"
            ? <div className="confirm go">Mark {t.plate} as departed with {list.length} consignment{list.length === 1 ? "" : "s"}? <button className="btn sm go" onClick={depart}>Yes, departed</button><button className="btn sm" onClick={() => setConfirm("")}>Not yet</button></div>
            : <button className="btn go" onClick={() => setConfirm("depart")} disabled={!list.length}>Close loading &amp; mark departed</button>}
          {!list.length && can("delete") && (
            <div className="actions">
              {confirm === "del"
                ? <div className="confirm">Delete this empty trip? <button className="btn sm danger" onClick={async () => { ui.close(); await remove("trips", t.id); }}>Delete</button><button className="btn sm" onClick={() => setConfirm("")}>Keep</button></div>
                : <button className="btn sm danger" onClick={() => setConfirm("del")}>Delete empty trip</button>}
            </div>
          )}
        </div>
      )}
      {t.status === "departed" && can("dispatch") && (
        <div className="card"><h3>Arrival</h3>
          {confirm === "arrive"
            ? <div className="confirm go">Mark {t.plate} as arrived in {regShort(t.dest)}? <button className="btn sm primary" onClick={arrive}>Yes, arrived</button><button className="btn sm" onClick={() => setConfirm("")}>Not yet</button></div>
            : <button className="btn primary" onClick={() => setConfirm("arrive")}>Mark arrived in {regShort(t.dest)}</button>}
          <p className="note">All consignments on this vehicle move to &quot;Arrived&quot; and arrival notices become ready.</p>
        </div>
      )}
      {t.status === "arrived" && <BulkNotices trip={t} kind="arrived" />}
      {t.status !== "loading" && <BulkNotices trip={t} kind="departed" />}

      {t.status === "loading" && (
        <>
          <div className="card"><h3>On this vehicle · {list.length}</h3>
            {list.map((s) => (
              <div className="lrow" key={s.id}>
                <div><span className="mono">{s.no}</span> · <b>{s.item}</b> · {s.pkgs} pkg · TZS {tzs(s.charge)}
                  <div className="sub">{s.r_name} · {regShort(s.dest)}{s.dest !== t.dest && <span style={{ color: "var(--amber)" }}> · drop on the way</span>}</div>
                </div>
                {can("load") && <button className="btn sm" onClick={() => patch<Shipment>("shipments", s.id, { status: "received", trip_id: null, loaded_at: null })}>Unload</button>}
              </div>
            ))}
            {!list.length && <p className="sub">Nothing loaded yet. Add consignments from the list below.</p>}
          </div>
          {can("load") && (
            <div className="card"><h3>Waiting at {regShort(t.origin)} · {waiting.length}</h3>
              {waiting.map((s) => (
                <div className="lrow" key={s.id}>
                  <div><span className="mono">{s.no}</span> · <b>{s.item}</b> · {s.pkgs} pkg · TZS {tzs(s.charge)}
                    <div className="sub">{s.r_name} · <b style={{ color: s.dest === t.dest ? "var(--good)" : "var(--muted)" }}>{regShort(s.dest)}</b> · {s.pay === "paid" ? "Paid" : "Not paid"}</div>
                  </div>
                  <button className="btn sm primary" onClick={() => patch<Shipment>("shipments", s.id, { status: "loaded", trip_id: t.id, loaded_at: now() })}>Load</button>
                </div>
              ))}
              {!waiting.length && <p className="sub">No consignments waiting at this office.</p>}
            </div>
          )}
        </>
      )}
      {t.status !== "loading" && (
        <div className="card"><h3>Manifest · {list.length} consignments, {n} packages</h3>
          {list.map((s) => (
            <div className="lrow" key={s.id}>
              <div><a href="#" className="mono" onClick={(e) => { e.preventDefault(); ui.openShip(s.id); }}>{s.no}</a> · {s.item} · {s.pkgs} pkg<div className="sub">{s.r_name} · {regShort(s.dest)}</div></div>
              <StatusPill s={s.status} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
