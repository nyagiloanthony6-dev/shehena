"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
type Change = RealtimePostgresChangesPayload<Record<string, unknown>>;
import { can as canRole, type BillAccount, type BillPayment, type Claim, type ClaimPayment, type ShipPayment, type Company, type Perm, type Profile, type Shipment, type Trip, type Vehicle } from "@/lib/domain";

type Row = { id: string };
type Table = "shipments" | "trips" | "vehicles" | "bill_accounts" | "bill_payments" | "claims" | "claim_payments" | "shipment_payments";
/** Tables added by migration 0008; if it hasn't been run yet they just stay empty. */
const EXTRA: Table[] = ["bill_accounts", "bill_payments", "claims", "claim_payments"];

interface Store {
  me: Profile;
  company: Company;
  shipments: Shipment[];
  trips: Trip[];
  vehicles: Vehicle[];
  accounts: BillAccount[];
  billPayments: BillPayment[];
  claims: Claim[];
  claimPayments: ClaimPayment[];
  /** every payment towards consignments (part or full) */
  shipPayments: ShipPayment[];
  /** false until migration 0017 (part payments) has been run */
  hasPart: boolean;
  /** false until migration 0019 (delivery people) has been run */
  hasRunners: boolean;
  /** Take a payment (part or full) for a consignment; completes it when the balance reaches 0. */
  takePayment: (s: Shipment, amount: number, method: string, extra?: Partial<Shipment>) => Promise<boolean>;
  /** Only record a payment line (the consignment was already saved as paid / part paid). */
  logPayment: (s: Shipment, amount: number, method: string) => Promise<void>;
  /** false until migration 0008 has been run in Supabase */
  hasExtras: boolean;
  /** false until migration 0009 (delivery notes, rental trucks) has been run */
  hasV9: boolean;
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
const SORT: Record<Table, string> = {
  shipments: "received_at", trips: "created_at", vehicles: "plate",
  bill_accounts: "name", bill_payments: "paid_on", claims: "created_at", claim_payments: "paid_on", shipment_payments: "paid_at",
};
const ASC = new Set<Table>(["vehicles", "bill_accounts"]);

function upsert<T extends Row>(list: T[], row: T, table: Table): T[] {
  const i = list.findIndex((x) => x.id === row.id);
  const next = i >= 0 ? list.map((x) => (x.id === row.id ? row : x)) : [row, ...list];
  if (ASC.has(table)) return next.sort((a, b) => String((a as unknown as Record<string, unknown>)[SORT[table]]).localeCompare(String((b as unknown as Record<string, unknown>)[SORT[table]])));
  return i >= 0 ? next : (next as unknown as Record<string, unknown>[]).sort(byNewest(SORT[table])) as unknown as T[];
}

export function StoreProvider({ me: initialMe, initialCompany, children }: { me: Profile; initialCompany: Company; children: React.ReactNode }) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const [me, setMe] = useState(initialMe);
  const [company, setCompany] = useState(initialCompany);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [accounts, setAccounts] = useState<BillAccount[]>([]);
  const [billPayments, setBillPayments] = useState<BillPayment[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [claimPayments, setClaimPayments] = useState<ClaimPayment[]>([]);
  const [shipPayments, setShipPayments] = useState<ShipPayment[]>([]);
  const [hasPart, setHasPart] = useState(false);
  const [hasRunners, setHasRunners] = useState(false);
  const [hasExtras, setHasExtras] = useState(false);
  const [hasV9, setHasV9] = useState(false);
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
    bill_accounts: setAccounts as React.Dispatch<React.SetStateAction<Row[]>>,
    bill_payments: setBillPayments as React.Dispatch<React.SetStateAction<Row[]>>,
    claims: setClaims as React.Dispatch<React.SetStateAction<Row[]>>,
    claim_payments: setClaimPayments as React.Dispatch<React.SetStateAction<Row[]>>,
    shipment_payments: setShipPayments as React.Dispatch<React.SetStateAction<Row[]>>,
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
    const extra = await Promise.all(EXTRA.map((tb) => sb.from(tb).select("*").order(SORT[tb], { ascending: ASC.has(tb) }).limit(5000)));
    const num = (r: Record<string, unknown>) => ({ ...r, ...(["amount", "goods_value", "compensation"].reduce((o, k) => (k in r ? { ...o, [k]: Number(r[k]) } : o), {})) });
    EXTRA.forEach((tb, i) => setters[tb](((extra[i].data || []) as Record<string, unknown>[]).map(num) as unknown as Row[]));
    setHasExtras(!extra[0].error);
    const v9 = await sb.from("trips").select("rent_cost").limit(1);
    setHasV9(!v9.error);
    const sp = await sb.from("shipment_payments").select("*").order("paid_at", { ascending: false }).limit(20000);
    setHasPart(!sp.error);
    const rn = await sb.from("shipments").select("runner_name").limit(1);
    setHasRunners(!rn.error);
    setShipPayments(((sp.data || []) as Record<string, unknown>[]).map((r) => ({ ...r, amount: Number(r.amount) })) as unknown as ShipPayment[]);
    setReady(true);
  }, [sb, initialCompany.id, toast, setters]);

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
    (["shipments", "trips", "vehicles", "shipment_payments", ...EXTRA] as Table[]).forEach((table) => {
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

  const logPayment = useCallback(async (s: Shipment, amount: number, method: string, at = new Date().toISOString()) => {
    if (!hasPart || !(amount > 0)) return;
    // Where the money was taken: the branch's office, or the origin before the goods leave, else the destination.
    const station = me.station || (["arrived", "collected"].includes(String(s.status)) ? s.dest : s.origin);
    const { data, error } = await sb.from("shipment_payments").insert({ company_id: company.id, shipment_id: s.id, amount: Math.round(amount), method, station, paid_at: at, paid_by: me.full_name }).select().single();
    if (!error && data) setShipPayments((l) => upsert(l as unknown as Row[], { ...(data as Row), amount: Number((data as { amount: number }).amount) } as Row, "shipment_payments") as unknown as ShipPayment[]);
  }, [sb, company.id, me.full_name, me.station, hasPart]);

  const takePayment = useCallback(async (s: Shipment, amount: number, method: string, extra: Partial<Shipment> = {}) => {
    const charge = Number(extra.charge ?? s.charge ?? 0);
    const before = s.pay === "unpaid" ? Number(s.paid_amount || 0) : 0;
    const amt = Math.round(Math.min(amount, charge - before));
    if (!(amt > 0)) { toast("Enter an amount more than 0 and no more than the balance.", true); return false; }
    const at = new Date().toISOString();
    const full = before + amt >= charge;
    // Before migration 0017 only full payments are possible.
    if (!hasPart && !full) { toast("Part payments need an update in Supabase (migration 0017). Ask Serengeti Labs.", true); return false; }
    const ok = await patch<Shipment>("shipments", s.id, {
      ...extra, method, paid_by: me.full_name,
      ...(hasPart ? { paid_amount: before + amt } : {}),
      ...(full ? { pay: "paid" as const, paid_at: at } : {}),
    });
    if (!ok) return false;
    await logPayment({ ...s, ...extra } as Shipment, amt, method, at);
    return true;
  }, [me.full_name, hasPart, patch, toast, logPayment]);

  const patchCompany = useCallback(async (values: Partial<Company>) => {
    setCompany((c) => ({ ...c, ...values }));
    const { error } = await sb.from("companies").update(values).eq("id", company.id);
    if (error) { fail(error.message); return false; }
    return true;
  }, [sb, company.id, fail]);

  const value = useMemo<Store>(() => ({
    me, company, shipments, trips, vehicles, accounts, billPayments, claims, claimPayments, shipPayments, hasPart, hasRunners, takePayment, logPayment, hasExtras, hasV9, staff, ready,
    can: (p) => canRole(me.role, p),
    toast, insert, patch, patchMany, remove, patchCompany, reloadStaff,
    tripById: (id) => (id ? trips.find((t) => t.id === id) : undefined),
    shipById: (id) => (id ? shipments.find((s) => s.id === id) : undefined),
    tripShips: (t) => shipments.filter((s) => s.trip_id === t.id),
  }), [me, company, shipments, trips, vehicles, accounts, billPayments, claims, claimPayments, shipPayments, hasPart, hasRunners, takePayment, logPayment, hasExtras, hasV9, staff, ready, toast, insert, patch, patchMany, remove, patchCompany, reloadStaff]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg && <div className={`toast${toastMsg.e ? " err" : ""}`} role="status">{toastMsg.m}</div>}
    </Ctx.Provider>
  );
}
