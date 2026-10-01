"use client";
import { useState } from "react";
import { useStore } from "../store";
import { useUi } from "../CargoApp";
import { Icon } from "../Icon";
import { TripCard } from "../parts";
import { REGIONS, TSTATUS, fmtDay, pkgsOf, sumCharge, tzs, ymd, type Trip, type Vehicle } from "@/lib/domain";

function TargetRow({ v }: { v: Vehicle }) {
  const { patch, me, toast } = useStore();
  const [val, setVal] = useState(String(v.target || ""));
  return (
    <div className="lrow">
      <div><span className="mono" style={{ fontWeight: 600 }}>{v.plate}</span> · {v.driver || "—"}
        <div className="sub">{v.target_set_by ? `Set by ${v.target_set_by} · ${fmtDay(v.target_set_at)}` : v.target ? "" : "No target yet"}</div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span className="sub">TZS</span>
        <input type="number" min={0} step={10000} value={val} onChange={(e) => setVal(e.target.value)} style={{ width: 140 }} aria-label={`Target for ${v.plate}`} />
        <button className="btn sm primary" onClick={async () => {
          if (await patch<Vehicle>("vehicles", v.id, { target: Number(val) || 0, target_set_by: me.full_name, target_set_at: new Date().toISOString() })) toast(`Target for ${v.plate} saved`);
        }}>Save</button>
      </div>
    </div>
  );
}

export default function Loading() {
  const { company, trips, shipments, vehicles, can, insert, me, toast } = useStore();
  const ui = useUi();
  const origin0 = company.default_origin || "DAR";
  const [f, setF] = useState({ vehicle: "", plate: "", driver: "", driver_phone: "", target: "", origin: origin0, dest: origin0 === "DOD" ? "DAR" : "DOD" });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const waiting = shipments.filter((s) => s.status === "received");

  const pickVehicle = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    setF((x) => v ? { ...x, vehicle: id, plate: v.plate, driver: v.driver, driver_phone: v.driver_phone, target: String(v.target || "") } : { ...x, vehicle: "" });
  };

  async function start(e: React.FormEvent) {
    e.preventDefault();
    const plate = f.plate.trim().toUpperCase();
    if (!plate || f.origin === f.dest) return setErr("Enter the plate number and a destination different from the origin.");
    if (trips.some((t) => t.plate === plate && t.status !== "arrived")) return setErr(`${plate} already has an open trip. Finish it first.`);
    setErr("");
    const saved = vehicles.find((v) => v.plate === plate);
    const target = can("target") ? Number(f.target) || 0 : saved?.target || 0;
    const t = await insert<Trip>("trips", {
      no: `TRIP-${ymd()}-${f.dest}-${Math.floor(Math.random() * 900) + 100}`, plate, driver: f.driver.trim(), driver_phone: f.driver_phone.trim(),
      target, target_set_by: can("target") && target ? me.full_name : saved?.target_set_by || null,
      origin: f.origin, dest: f.dest, status: "loading", created_by: me.id, created_by_name: me.full_name,
    });
    if (!t) return;
    ui.setTripFormOpen(false);
    setF({ vehicle: "", plate: "", driver: "", driver_phone: "", target: "", origin: origin0, dest: f.dest });
    ui.openTrip(t.id);
    toast(`Loading ${plate}. Add consignments.`);
  }

  return (
    <section>
      <div className="sectionhead">
        <div><h1>Loading bay</h1><div className="sub">Load consignments onto a truck, dispatch it, and notify every receiver.</div></div>
        {can("load") && <button className={`btn${ui.tripFormOpen ? "" : " primary"}`} onClick={() => ui.setTripFormOpen(!ui.tripFormOpen)}>{ui.tripFormOpen ? "Cancel" : "Start loading a truck"}</button>}
      </div>
      <div className="waitbar"><Icon name="box" /><span><b className="num">{waiting.length}</b> consignment{waiting.length === 1 ? "" : "s"} · <b className="num">{pkgsOf(waiting)}</b> packages · TZS <b className="num">{tzs(sumCharge(waiting))}</b> waiting at the office to be loaded</span></div>

      {can("load") && ui.tripFormOpen && (
        <form noValidate onSubmit={start} style={{ marginTop: 14 }}>
          <fieldset><legend>Start loading a vehicle</legend>
            <div className="fields four">
              <label className="f">Saved vehicle<select value={f.vehicle} onChange={(e) => pickVehicle(e.target.value)}>
                <option value="">— Type details —</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} · {v.driver}</option>)}
              </select></label>
              <label className="f">Plate number<input value={f.plate} onChange={(e) => set("plate", e.target.value)} placeholder="T 123 ABC" /></label>
              <label className="f">Driver<input value={f.driver} onChange={(e) => set("driver", e.target.value)} /></label>
              <label className="f">Driver phone<input value={f.driver_phone} onChange={(e) => set("driver_phone", e.target.value)} inputMode="tel" /></label>
              <label className="f">Target collection (TZS) <small>{can("target") ? "per trip" : "set by Admin or CEO"}</small>
                <input type="number" min={0} step={10000} value={f.target} readOnly={!can("target")} onChange={(e) => set("target", e.target.value)} placeholder={can("target") ? "e.g. 2000000" : "Pick a saved vehicle"} /></label>
              <label className="f">From<select value={f.origin} onChange={(e) => set("origin", e.target.value)}>{REGIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
              <label className="f">To<select value={f.dest} onChange={(e) => set("dest", e.target.value)}>{REGIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
              <div style={{ display: "flex", alignItems: "end" }}><button className="btn primary" type="submit" style={{ width: "100%" }}>Start loading</button></div>
            </div>
            <div className="err" role="alert">{err}</div>
          </fieldset>
        </form>
      )}

      {can("target") && (
        <details className="panel" style={{ marginTop: 14 }}>
          <summary><span><b style={{ fontFamily: "var(--f-display)", fontSize: 16 }}>Truck targets</b> <span className="sub">· {vehicles.length} saved truck{vehicles.length === 1 ? "" : "s"}</span></span></summary>
          <p className="sub" style={{ margin: "0 0 8px" }}>Target collection in TZS per trip. Cashiers see these but can&apos;t change them.</p>
          {vehicles.map((v) => <TargetRow key={v.id + v.target} v={v} />)}
          {!vehicles.length && <p className="sub">No saved vehicles.{can("settings") ? " Add them in Settings." : " Ask the Admin to add them."}</p>}
        </details>
      )}

      {TSTATUS.map(([k, l]) => {
        const list = trips.filter((t) => t.status === k);
        return (
          <div key={k}>
            <div className="group-h"><h2>{k === "loading" ? "Loading now" : l}</h2><span className="sub">{list.length}</span></div>
            {list.length
              ? <div className="trips">{(k === "arrived" ? list.slice(0, 9) : list).map((t) => <TripCard key={t.id} trip={t} onOpen={ui.openTrip} />)}</div>
              : <p className="quiet">{k === "loading" ? "No truck is loading." : k === "departed" ? "No trucks on the road." : "No arrivals yet."}</p>}
          </div>
        );
      })}
    </section>
  );
}
