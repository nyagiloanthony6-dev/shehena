"use client";
import { useStore } from "../store";
import { useUi } from "../CargoApp";
import { Icon } from "../Icon";
import { StatusPill, TripCard } from "../parts";
import { YearPanel } from "../charts";
import { regShort, stLabel, tzs } from "@/lib/domain";

export function Stats() {
  const { shipments } = useStore();
  const today = new Date().toDateString();
  const c = (k: string) => shipments.filter((s) => s.status === k).length;
  const unpaid = shipments.filter((s) => s.pay !== "paid");
  return (
    <div className="stats">
      <div className="stat"><div className="lbl">Received today</div><div className="v">{shipments.filter((s) => new Date(s.received_at).toDateString() === today).length}</div><div className="s">{shipments.length} on record</div></div>
      <div className="stat"><div className="lbl">At office</div><div className="v">{c("received") + c("loaded")}</div><div className="s">{c("loaded")} loaded, waiting to leave</div></div>
      <div className="stat"><div className="lbl">In transit</div><div className="v">{c("transit")}</div><div className="s">on the road</div></div>
      <div className="stat"><div className="lbl">Awaiting pickup</div><div className="v">{c("arrived")}</div><div className="s">arrived, not collected</div></div>
      <div className={`stat${unpaid.length ? " warn" : ""}`}><div className="lbl">Unpaid</div><div className="v">{tzs(unpaid.reduce((a, s) => a + Number(s.charge || 0), 0))}</div><div className="s">TZS on {unpaid.length} consignment{unpaid.length === 1 ? "" : "s"}</div></div>
    </div>
  );
}

export default function Overview() {
  const { me, company, shipments, trips, can } = useStore();
  const ui = useUi();
  const h = new Date().getHours();
  const first = (me.full_name || "").split(" ")[0];
  const T = trips.filter((t) => t.status !== "arrived").sort((a, b) => (a.status > b.status ? -1 : 1) || b.created_at.localeCompare(a.created_at));
  const A = shipments.filter((s) => s.status === "arrived").sort((a, b) => (a.arrived_at || "").localeCompare(b.arrived_at || ""));
  const U = shipments.filter((s) => s.pay !== "paid").sort((a, b) => Number(b.charge) - Number(a.charge));
  const R = shipments.slice(0, 6);
  const newTrip = () => { ui.setTripFormOpen(true); ui.go("trips"); };
  return (
    <section>
      <div className="hello">
        <div>
          <h1>{h < 12 ? "Habari za asubuhi" : h < 16 ? "Habari za mchana" : "Habari za jioni"}, {first}</h1>
          <div className="sub">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}{company.branch ? " · " + company.branch : ""}</div>
        </div>
        <div className="qa">
          {can("receive") && <button className="btn primary lg" onClick={() => ui.go("new")}><Icon name="new" />Receive goods</button>}
          {can("load") && <button className="btn lg" onClick={newTrip}><Icon name="trips" />Start loading a truck</button>}
          {!can("receive") && can("reports") && <button className="btn primary lg" onClick={() => ui.go("reports")}><Icon name="reports" />Open reports</button>}
        </div>
      </div>
      {me.role === "ceo" && <div className="panel ypanel" style={{ marginTop: 18 }}><YearPanel /></div>}
      <div style={{ marginTop: 18 }}><Stats /></div>
      <div className="hgrid">
        <div className="panel">
          <div className="ph"><h2>Trucks</h2><button className="link" onClick={() => ui.go("trips")}>Loading bay →</button></div>
          {T.length ? <div className="trips">{T.map((t) => <TripCard key={t.id} trip={t} onOpen={ui.openTrip} />)}</div>
            : <p className="quiet">No truck is loading or on the road.{can("load") && <> <button className="link" onClick={newTrip}>Start loading one</button></>}</p>}
        </div>
        <div className="col">
          <div className="panel">
            <div className="ph"><h2>Awaiting pickup</h2><button className="link" onClick={() => ui.go("arrivals")}>Arrivals →</button></div>
            {A.slice(0, 6).map((s) => {
              const d = Math.floor((Date.now() - new Date(s.arrived_at || s.received_at).getTime()) / 864e5);
              return (
                <button className="mrow" key={s.id} onClick={() => ui.openShip(s.id)}>
                  <div><b>{s.r_name}</b><div className="sub">{s.item} · {regShort(s.dest)}</div></div>
                  <div className="r"><div className="sub">{d < 1 ? "Arrived today" : d === 1 ? "Waiting 1 day" : `Waiting ${d} days`}</div>{s.pay !== "paid" && <div className="sub" style={{ color: "var(--bad)" }}>TZS {tzs(s.charge)} due{d >= 2 && !(s.notices || []).some((n) => n.kind === "reminder" && Date.now() - new Date(n.at).getTime() < 2 * 864e5) ? " · send reminder" : ""}</div>}</div>
                </button>
              );
            })}
            {!A.length && <p className="quiet">Nothing waiting for collection.</p>}
          </div>
          <div className="panel">
            <div className="ph"><h2>Unpaid</h2><button className="link" onClick={() => { ui.setListPay("unpaid"); ui.go("list"); }}>See all →</button></div>
            {U.slice(0, 5).map((s) => (
              <button className="mrow" key={s.id} onClick={() => ui.openShip(s.id)}>
                <div><b>{s.s_name}</b><div className="sub">{s.item} → {regShort(s.dest)} · {stLabel(s.status)}</div></div>
                <div className="r"><b style={{ color: "var(--bad)" }}>{tzs(s.charge)}</b><div className="sub">TZS</div></div>
              </button>
            ))}
            {!U.length && <p className="quiet">Every consignment is paid.</p>}
          </div>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="ph"><h2>Recent consignments</h2><button className="link" onClick={() => ui.go("list")}>All consignments →</button></div>
        {R.map((s) => (
          <button className="mrow" key={s.id} onClick={() => ui.openShip(s.id)}>
            <div><b>{s.item}</b> <span className="sub">· {s.pkgs} pkg</span><div className="sub"><span className="mono">{s.no}</span> · {s.s_name} → {s.r_name}</div></div>
            <div className="r"><StatusPill s={s.status} /></div>
          </button>
        ))}
        {!R.length && <p className="quiet">No consignments yet.{can("receive") && <> <button className="link" onClick={() => ui.go("new")}>Receive the first one</button></>}</p>}
      </div>
    </section>
  );
}
