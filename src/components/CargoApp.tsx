"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { StoreProvider, useStore } from "./store";
import { Icon, Mark } from "./Icon";
import { ShipmentSheet, TripSheet } from "./sheets";
import Overview from "./views/Overview";
import Consignments from "./views/Consignments";
import Receive from "./views/Receive";
import Loading from "./views/Loading";
import Arrivals from "./views/Arrivals";
import Reports from "./views/Reports";
import Settings from "./views/Settings";
import { signOut } from "@/app/login/actions";
import { initials, ROLES, SYSTEM, type Company, type Perm, type Profile } from "@/lib/domain";

export type View = "home" | "list" | "new" | "trips" | "arrivals" | "reports" | "set";
const TABS: [View, string, Perm | null, string][] = [
  ["home", "Overview", null, "Home"],
  ["list", "Consignments", null, "Cargo"],
  ["new", "Receive goods", "receive", "Receive"],
  ["trips", "Loading bay", null, "Loading"],
  ["arrivals", "Arrivals", null, "Arrivals"],
  ["reports", "Reports", "reports", "Reports"],
  ["set", "Settings", "settings", "Settings"],
];

interface Ui {
  view: View;
  go: (v: View) => void;
  openShip: (id: string) => void;
  openTrip: (id: string) => void;
  close: () => void;
  listPay: "" | "paid" | "unpaid";
  setListPay: (p: "" | "paid" | "unpaid") => void;
  tripFormOpen: boolean;
  setTripFormOpen: (b: boolean) => void;
}
const UiCtx = createContext<Ui | null>(null);
export const useUi = () => {
  const u = useContext(UiCtx);
  if (!u) throw new Error("useUi outside CargoApp");
  return u;
};

export default function CargoApp({ me, initialCompany }: { me: Profile; initialCompany: Company }) {
  return <StoreProvider me={me} initialCompany={initialCompany}><Shell /></StoreProvider>;
}

function Shell() {
  const st = useStore();
  const [view, setView] = useState<View>("home");
  const [sheet, setSheet] = useState<{ type: "ship" | "trip"; id: string } | null>(null);
  const [listPay, setListPay] = useState<"" | "paid" | "unpaid">("");
  const [tripFormOpen, setTripFormOpen] = useState(false);

  const allowed = useCallback((v: View) => {
    const t = TABS.find((x) => x[0] === v);
    return !!t && (!t[2] || st.can(t[2]));
  }, [st]);

  const go = useCallback((v: View) => {
    const next = allowed(v) ? v : "home";
    setSheet(null);
    setView(next);
    if (window.location.hash !== "#" + next) window.history.pushState(null, "", "#" + next);
    window.scrollTo(0, 0);
  }, [allowed]);

  // Back/forward buttons and deep links (#trips, #reports …)
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1) as View;
      setView(allowed(h) ? h : "home");
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [allowed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.title = st.company.name ? `${st.company.name} · ${SYSTEM}` : "Shehena Cargo";
  }, [st.company.name]);

  const ui: Ui = {
    view, go,
    openShip: (id) => setSheet({ type: "ship", id }),
    openTrip: (id) => setSheet({ type: "trip", id }),
    close: () => setSheet(null),
    listPay, setListPay, tripFormOpen, setTripFormOpen,
  };
  const loadingN = st.trips.filter((t) => t.status === "loading").length;
  const roadN = st.trips.filter((t) => t.status === "departed").length;
  const items = TABS.filter(([, , need]) => !need || st.can(need));
  const navBtn = (k: View, label: string) => (
    <button key={k} onClick={() => go(k)} aria-current={view === k ? "page" : undefined}>
      <Icon name={k} /><span>{label}</span>{k === "trips" && loadingN > 0 && <span className="nbadge">{loadingN}</span>}{k === "arrivals" && roadN > 0 && <span className="nbadge">{roadN}</span>}
    </button>
  );
  const needsSetup = st.can("settings") && (!st.company.phone || !st.company.branch);

  return (
    <UiCtx.Provider value={ui}>
      <div className="shell">
        <aside className="side">
          <div className="side-brand">
            <div className="brandrow"><Mark /><div className="sys">{SYSTEM}</div></div>
            <div className="co">{st.company.name}</div>
            <div className="br">{st.company.branch}</div>
          </div>
          <nav className="side-nav" aria-label="Main">{items.map(([k, l]) => navBtn(k, l))}</nav>
          <div className="side-user">
            <div className="avatar">{initials(st.me.full_name)}</div>
            <div style={{ minWidth: 0 }}><div className="nm">{st.me.full_name}</div><span className="role">{ROLES[st.me.role]}</span></div>
            <form action={signOut} style={{ marginLeft: "auto" }}><button className="iconbtn" type="submit" title="Sign out" aria-label="Sign out"><Icon name="logout" /></button></form>
          </div>
          <div className="credit">Developed by <b>Serengeti Labs</b></div>
        </aside>
        <div style={{ minWidth: 0 }}>
          <header className="mtop">
            <div className="brandrow" style={{ minWidth: 0 }}><Mark /><div style={{ minWidth: 0 }}><div className="mco">{st.company.name}</div><div className="sub">{st.company.branch}</div></div></div>
            <div className="mtop-r">
              <span className="role">{ROLES[st.me.role]}</span>
              {st.can("settings") && <button className="iconbtn" onClick={() => go("set")} title="Settings" aria-label="Settings"><Icon name="set" /></button>}
              <form action={signOut}><button className="iconbtn" type="submit" title="Sign out" aria-label="Sign out"><Icon name="logout" /></button></form>
            </div>
          </header>
          <main className="wrap">
            {needsSetup && view !== "set" && (
              <div className="banner" style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", background: "var(--accent-soft)", color: "var(--fg)" }}>
                <span><b>Finish your company details.</b> Add your branch and office phone. They appear on receipts and customer messages.</span>
                <button className="btn sm primary" onClick={() => go("set")}>Open settings</button>
              </div>
            )}
            {!st.ready ? <div className="loading-screen" style={{ minHeight: 300 }}>Loading your records…</div> : (
              <>
                {view === "home" && <Overview />}
                {view === "list" && <Consignments />}
                {view === "new" && <Receive />}
                {view === "trips" && <Loading />}
                {view === "arrivals" && <Arrivals />}
                {view === "reports" && <Reports />}
                {view === "set" && <Settings />}
              </>
            )}
            <div className="mcredit">{SYSTEM} · Developed by <b>Serengeti Labs</b></div>
          </main>
        </div>
        <nav className="bottomnav" aria-label="Main">{items.filter(([k]) => k !== "set").map(([k, , , short]) => navBtn(k, short))}</nav>
      </div>
      {sheet && (
        <>
          <div className="scrim" onClick={() => setSheet(null)} />
          <aside className="sheet" aria-label="Details">
            {sheet.type === "ship" ? <ShipmentSheet id={sheet.id} /> : <TripSheet id={sheet.id} />}
          </aside>
        </>
      )}
    </UiCtx.Provider>
  );
}
