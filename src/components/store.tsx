"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
type Change = RealtimePostgresChangesPayload<Record<string, unknown>>;
import { can as canRole, type Company, type Perm, type Profile, type Shipment, type Trip, type Vehicle } from "@/lib/domain";

type Row = { id: string };
type Table = "shipments" | "trips" | "vehicles";

interface Store {
  me: Profile;
  company: Company;
  shipments: Shipment[];
  trips: Trip[];
  vehicles: Vehicle[];
  staff: Profile[];
  ready: boolean;
  can: (p: Perm) => boolean;
  toast: (msg: string, error?: boolean) => void;
  insert: <T extends Row>(table: Table, row: Partial<T>) => Promise<T | null>;
  patch: <T extends Row>(table: Table, id: string, values: Partial<T>) => Promise<boolean>;
  patchMany: (table: Table, ids: string[], values: Partial<Shipment>) => Promise<boolean>;
  remove: (table: Table, id: string) => Promise<boolean>;
  patchCompany: (values: Partial<Company>) => Promise<boolean>;
  reloadStaff: () => Promise<void>;
  tripById: (id?: string | null) => Trip | undefined;
  shipById: (id?: string | null) => Shipment | undefined;
  tripShips: (t: Trip) => Shipment[];
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
};

const byNewest = (k: string) => (a: Record<string, unknown>, b: Record<string, unknown>) =>
  String(b[k] || "").localeCompare(String(a[k] || ""));
const SORT: Record<Table, string> = { shipments: "received_at", trips: "created_at", vehicles: "plate" };

function upsert<T extends Row>(list: T[], row: T, table: Table): T[] {
  const i = list.findIndex((x) => x.id === row.id);
  const next = i >= 0 ? list.map((x) => (x.id === row.id ? row : x)) : [row, ...list];
  if (table === "vehicles") return next.sort((a, b) => String((a as unknown as Vehicle).plate).localeCompare(String((b as unknown as Vehicle).plate)));
  return i >= 0 ? next : (next as unknown as Record<string, unknown>[]).sort(byNewest(SORT[table])) as unknown as T[];
}

export function StoreProvider({ me: initialMe, initialCompany, children }: { me: Profile; initialCompany: Company; children: React.ReactNode }) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const [me, setMe] = useState(initialMe);
  const [company, setCompany] = useState(initialCompany);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [ready, setReady] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ m: string; e?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((m: string, e?: boolean) => {
    setToastMsg({ m, e });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), e ? 5000 : 2800);
  }, []);

  const setters = useMemo(() => ({
    shipments: setShipments as React.Dispatch<React.SetStateAction<Row[]>>,
    trips: setTrips as React.Dispatch<React.SetStateAction<Row[]>>,
    vehicles: setVehicles as React.Dispatch<React.SetStateAction<Row[]>>,
  }), []);

  const loadAll = useCallback(async () => {
    const [s, t, v, p, c] = await Promise.all([
      sb.from("shipments").select("*").order("received_at", { ascending: false }).limit(10000),
      sb.from("trips").select("*").order("created_at", { ascending: false }).limit(5000),
      sb.from("vehicles").select("*").order("plate"),
      sb.from("profiles").select("*").order("created_at"),
      sb.from("companies").select("*").eq("id", initialCompany.id).single(),
    ]);
    if (s.error || t.error || v.error) toast("Could not load all records. Check your connection and reload.", true);
    setShipments((s.data as Shipment[]) || []);
    setTrips((t.data as Trip[]) || []);
    setVehicles((v.data as Vehicle[]) || []);
    setStaff((p.data as Profile[]) || []);
    if (c.data) setCompany(c.data as Company);
    setReady(true);
  }, [sb, initialCompany.id, toast]);

  const reloadStaff = useCallback(async () => {
    const { data } = await sb.from("profiles").select("*").order("created_at");
    if (data) {
      setStaff(data as Profile[]);
      const mine = (data as Profile[]).find((x) => x.id === me.id);
      if (mine) setMe(mine);
    }
  }, [sb, me.id]);

  // Initial load + live updates from colleagues.
  useEffect(() => {
    loadAll();
    const filter = `company_id=eq.${initialCompany.id}`;
    const ch = sb.channel(`company-${initialCompany.id}`);
    (["shipments", "trips", "vehicles"] as Table[]).forEach((table) => {
      ch.on("postgres_changes", { event: "*", schema: "public", table, filter }, (p: Change) => {
        const set = setters[table];
        if (p.eventType === "DELETE") set((l) => l.filter((x) => x.id !== (p.old as unknown as Row).id));
        else set((l) => upsert(l, p.new as unknown as Row, table));
      });
    });
    ch.on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter }, () => { reloadStaff(); });
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "companies", filter: `id=eq.${initialCompany.id}` },
      (p: Change) => setCompany(p.new as unknown as Company));
    ch.subscribe();
    return () => { sb.removeChannel(ch); };
  }, [sb, initialCompany.id, loadAll, reloadStaff, setters]);

  // A disabled account is signed out the moment the Admin disables it.
  useEffect(() => {
    if (!me.active) { sb.auth.signOut().finally(() => { window.location.href = "/login"; }); }
  }, [me.active, sb]);

  const fail = useCallback((msg?: string) => {
    toast(msg && !/JSON|fetch/i.test(msg) ? msg : "Could not save. Check your connection and try again.", true);
    loadAll();
  }, [toast, loadAll]);

  const insert = useCallback(async <T extends Row>(table: Table, row: Partial<T>) => {
    const { data, error } = await sb.from(table).insert({ ...row, company_id: company.id }).select().single();
    if (error) { fail(error.message); return null; }
    setters[table]((l) => upsert(l, data as Row, table));
    return data as T;
  }, [sb, company.id, setters, fail]);

  const patch = useCallback(async <T extends Row>(table: Table, id: string, values: Partial<T>) => {
    setters[table]((l) => l.map((x) => (x.id === id ? { ...x, ...values } : x)));
    const { data, error } = await sb.from(table).update(values).eq("id", id).select().single();
    if (error) { fail(error.message); return false; }
    setters[table]((l) => upsert(l, data as Row, table));
    return true;
  }, [sb, setters, fail]);

  const patchMany = useCallback(async (table: Table, ids: string[], values: Partial<Shipment>) => {
    if (!ids.length) return true;
    setters[table]((l) => l.map((x) => (ids.includes(x.id) ? { ...x, ...values } : x)));
    const { error } = await sb.from(table).update(values).in("id", ids);
    if (error) { fail(error.message); return false; }
    return true;
  }, [sb, setters, fail]);

  const remove = useCallback(async (table: Table, id: string) => {
    setters[table]((l) => l.filter((x) => x.id !== id));
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) { fail(error.message); return false; }
    return true;
  }, [sb, setters, fail]);

  const patchCompany = useCallback(async (values: Partial<Company>) => {
    setCompany((c) => ({ ...c, ...values }));
    const { error } = await sb.from("companies").update(values).eq("id", company.id);
    if (error) { fail(error.message); return false; }
    return true;
  }, [sb, company.id, fail]);

  const value = useMemo<Store>(() => ({
    me, company, shipments, trips, vehicles, staff, ready,
    can: (p) => canRole(me.role, p),
    toast, insert, patch, patchMany, remove, patchCompany, reloadStaff,
    tripById: (id) => (id ? trips.find((t) => t.id === id) : undefined),
    shipById: (id) => (id ? shipments.find((s) => s.id === id) : undefined),
    tripShips: (t) => shipments.filter((s) => s.trip_id === t.id),
  }), [me, company, shipments, trips, vehicles, staff, ready, toast, insert, patch, patchMany, remove, patchCompany, reloadStaff]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg && <div className={`toast${toastMsg.e ? " err" : ""}`} role="status">{toastMsg.m}</div>}
    </Ctx.Provider>
  );
}
