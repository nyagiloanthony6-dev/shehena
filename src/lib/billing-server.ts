import { allRows } from "./all-rows";
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ACTIVE_DAYS, BILLING_DEFAULTS, daysBetween, feeFor, feeWorking, normPlate, planLabel, priceLabel, priceOf, statusFor, today,
  type BillingAccount, type BillingSettings, type ClientPrice, type Subscription,
} from "./billing";

export async function billingSettings(): Promise<BillingSettings> {
  // select * so this still works before migration 0013 adds the price columns (defaults apply).
  const { data } = await supabaseAdmin().from("platform_settings").select("*").eq("id", 1).maybeSingle();
  const s = { ...BILLING_DEFAULTS, ...(data || {}) } as BillingSettings;
  return { ...s, truck_price: Number(s.truck_price ?? BILLING_DEFAULTS.truck_price), min_fee: Number(s.min_fee ?? BILLING_DEFAULTS.min_fee) };
}

/**
 * Trucks each company used in the last ACTIVE_DAYS days: every distinct plate loaded for a trip,
 * whether saved under Vehicles or hired for one trip. Returns company id → plates.
 */
export async function activeTrucks(companyId?: string): Promise<Record<string, string[]>> {
  const use = await usage(companyId);
  return Object.fromEntries(Object.entries(use).map(([c, u]) => [c, u.plates]));
}

/** Each company's use in the last ACTIVE_DAYS days: the trucks (plates) and the number of trips. */
export async function usage(companyId?: string): Promise<Record<string, { plates: string[]; trips: number }>> {
  const since = new Date(Date.now() - ACTIVE_DAYS * 864e5).toISOString();
  const { data } = await allRows<{ company_id: string; plate: string }>((a, b) => {
    let q = supabaseAdmin().from("trips").select("company_id, plate, id").gte("created_at", since);
    if (companyId) q = q.eq("company_id", companyId);
    return q.order("id").range(a, b);
  });
  const plates: Record<string, Map<string, string>> = {}, trips: Record<string, number> = {};
  for (const t of (data || []) as { company_id: string; plate: string }[]) {
    trips[t.company_id] = (trips[t.company_id] || 0) + 1;
    const k = normPlate(t.plate);
    if (!k) continue;
    (plates[t.company_id] ||= new Map()).has(k) || plates[t.company_id].set(k, t.plate.trim().toUpperCase());
  }
  return Object.fromEntries(Object.keys(trips).map((c) => [c, { plates: [...(plates[c]?.values() || [])].sort(), trips: trips[c] }]));
}

/**
 * Bring stored statuses in line with paid-until / trial dates. Runs daily (cron), when the owner
 * console opens, and when a client's staff open the app. Changes are written to the owner log.
 * Returns the companies whose status changed. Never throws: billing problems must not lock anyone out.
 */
export async function refreshStatuses(companyId?: string) {
  try {
    const admin = supabaseAdmin();
    let q = admin.from("company_accounts").select("company_id, status, trial_ends, paid_until, custom_fee, auto_status");
    if (companyId) q = q.eq("company_id", companyId);
    const [{ data: accs, error }, s] = await Promise.all([q, billingSettings()]);
    if (error || !accs) return [];
    const changed: { company_id: string; from: string; to: string }[] = [];
    const on = today();
    for (const a of accs as BillingAccount[]) {
      if (a.auto_status === false) continue;
      const { status } = statusFor({ ...a, auto_status: true }, s, on);
      if (status === a.status) continue;
      const { error: e } = await admin.from("company_accounts").update({ status, status_changed_at: new Date().toISOString() }).eq("company_id", a.company_id);
      if (e) continue;
      changed.push({ company_id: a.company_id, from: a.status, to: status });
      await admin.from("owner_audit").insert({ owner_email: "automatic", action: "company.status", company_id: a.company_id, detail: { from: a.status, to: status, auto: true } });
    }
    return changed;
  } catch { return []; }
}

/** The subscription summary shown to a client's Admin and CEO (and on the suspended screen). */
export async function subscriptionFor(companyId: string): Promise<Subscription | null> {
  try {
    const admin = supabaseAdmin();
    const [{ data: acc }, use, s, { data: pays }] = await Promise.all([
      // select * so this works before and after migration 0023 (per-client pricing).
      admin.from("company_accounts").select("*").eq("company_id", companyId).maybeSingle(),
      usage(companyId), billingSettings(),
      admin.from("billing_payments").select("*").eq("company_id", companyId).order("period_to", { ascending: false }).limit(24),
    ]);
    if (!acc) return null;
    const a = acc as BillingAccount & ClientPrice;
    const plates = use[companyId]?.plates || [];
    const trucks = plates.length, trips = use[companyId]?.trips || 0;
    const { due, suspend_on } = statusFor(a, s);
    return {
      status: a.status, trucks, trips, plates, plan: planLabel(trucks), fee: feeFor(a, s, { trucks, trips }), custom: priceOf(a).model !== "list",
      working: feeWorking(s, { trucks, trips }, a), price: priceLabel(a, s), model: priceOf(a).model,
      truck_price: s.truck_price, min_fee: s.min_fee,
      trial_ends: a.trial_ends, paid_until: a.paid_until, due, suspend_on: a.auto_status ? suspend_on : null,
      days_left: due ? daysBetween(today(), due) : null,
      instructions: s.billing_instructions,
      payments: (pays || []).map(({ id, amount, setup_fee, trucks, trips, months, period_from, period_to, method, reference, paid_on }) => ({ id, trucks: trucks ?? null, trips: trips ?? null, months, period_from, period_to, method, reference, paid_on, amount: Number(amount), setup_fee: Number(setup_fee || 0) })),
    };
  } catch { return null; }
}
