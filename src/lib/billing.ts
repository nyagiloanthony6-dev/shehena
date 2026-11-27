// Shehena subscriptions — how much each cargo company pays Serengeti Labs, and its account status.
// Pure helpers (safe in the browser) live here; database work is in billing-server.ts.

export type AccountStatus = "trial" | "active" | "overdue" | "suspended";
export interface BillingPayment {
  id: number | string; company_id: string; amount: number; months: number;
  period_from: string; period_to: string; method: string; reference: string; paid_on: string; recorded_by: string; created_at: string;
  setup_fee?: number; trucks?: number | null; trips?: number | null;
}
export interface BillingSettings { trial_days: number; grace_days: number; auto_suspend: boolean; billing_instructions: string; truck_price: number; min_fee: number; /** standard price per SMS, TZS (migration 0030) */ sms_price?: number }
export type Pricing = Pick<BillingSettings, "truck_price" | "min_fee">;
export interface BillingAccount {
  company_id: string; status: AccountStatus; trial_ends: string | null; paid_until: string | null;
  custom_fee: number | null; auto_status: boolean; status_changed_at?: string;
}
/** What a client company sees about its own subscription. */
export interface Subscription {
  status: AccountStatus; trucks: number; trips: number; plates: string[]; plan: string; fee: number; custom: boolean; truck_price: number; min_fee: number;
  /** how the fee was worked out, and the client's pricing in words */
  working: string; price: string; model: PriceModel;
  /** the client's rate for their pricing model (per trip / per truck / flat fee) and minimum per month */
  rate?: number; min_charge?: number;
  trial_ends: string | null; paid_until: string | null; due: string | null; suspend_on: string | null; days_left: number | null;
  instructions: string; payments: Pick<BillingPayment, "id" | "amount" | "setup_fee" | "trucks" | "trips" | "months" | "period_from" | "period_to" | "method" | "reference" | "paid_on">[];
}

export const BILLING_DEFAULTS: BillingSettings = { trial_days: 14, grace_days: 7, auto_suspend: true, billing_instructions: "", truck_price: 50000, min_fee: 80000 };
export const PAY_METHODS = ["M-Pesa", "Mixx by Yas", "Airtel Money", "HaloPesa", "Bank transfer", "Cash"];

// ---- dates as YYYY-MM-DD in Tanzania time (UTC+3), so "today" flips at local midnight
export const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const D = (s: string) => new Date(s + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const daysBetween = (a: string, b: string) => Math.round((D(b).getTime() - D(a).getTime()) / 864e5);
/** Same day n months later, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(s: string, n: number) {
  const d = D(s), day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return iso(t);
}
/** A payment of n months starting `from` covers up to the day before the same date n months later. */
export const periodEnd = (from: string, months: number) => addDays(addMonths(from, months), -1);
export const dayLabel = (s?: string | null) => s ? D(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

// ---- price per active truck
/** A truck is active if it was loaded for a trip in Shehena in the last ACTIVE_DAYS days. */
export const ACTIVE_DAYS = 30;
/** "T 123 ABC", "t123abc" and "T-123-ABC" are the same truck. */
export const normPlate = (p: string) => (p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const planLabel = (trucks: number) => trucks ? `${trucks} active truck${trucks === 1 ? "" : "s"}` : "no truck trips yet";
/** Price list fee: trucks × price per truck, but never below the minimum monthly fee. */
export const listFee = (p: Pricing, trucks: number) => Math.max(Number(p.min_fee) || 0, trucks * (Number(p.truck_price) || 0));

// ---- a price for each client (migration 0023)
export type PriceModel = "list" | "per_truck" | "per_trip" | "flat";
export const PRICE_MODELS: Record<PriceModel, string> = {
  list: "Standard price list", per_truck: "Own price per active truck", per_trip: "Price per trip", flat: "Flat monthly fee",
};
export type ClientPrice = Pick<BillingAccount, "custom_fee"> & { price_model?: PriceModel | null; price_rate?: number | null; price_min?: number | null };
/** Last ACTIVE_DAYS days of use: distinct trucks and number of trips. */
export type Usage = { trucks: number; trips: number; /** e.g. "November so far" — per-trip clients are counted by calendar month */ tripsWhen?: string };

/** "2026-11" for a timestamp, in Tanzania time. */
export const monthOf = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3600e3).toISOString().slice(0, 7);
export const monthLabel = (key: string) => new Date(key + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
/** First day of the month a date falls in. */
export const monthStart = (day: string) => day.slice(0, 8) + "01";
/**
 * Per-trip fee for a payment covering `months` calendar months from `from` (a 1st of the month):
 * each month is its trips × rate (never below the minimum). Returns the total and the lines.
 */
export function perTripFee(byMonth: Record<string, number>, from: string, months: number, rate: number, min = 0) {
  const lines = Array.from({ length: Math.max(1, months) }, (_, i) => {
    const key = addMonths(monthStart(from), i).slice(0, 7);
    const trips = byMonth[key] || 0;
    return { key, trips, fee: Math.max(min, trips * rate) };
  });
  return { total: lines.reduce((a, l) => a + l.fee, 0), lines };
}
/** The pricing a client is on. Before migration 0023, a custom fee means a flat fee. */
export function priceOf(acc: ClientPrice): { model: PriceModel; rate: number; min: number } {
  const model = (acc.price_model || (acc.custom_fee != null ? "flat" : "list")) as PriceModel;
  const rate = Number(acc.price_rate ?? (model === "flat" ? acc.custom_fee : 0)) || 0;
  return { model, rate, min: Number(acc.price_min) || 0 };
}
/** Monthly fee for a client, from their pricing and last month's use. */
export function feeFor(acc: ClientPrice, p: Pricing, use: Usage | number): number {
  const u = typeof use === "number" ? { trucks: use, trips: 0 } : use;
  const { model, rate, min } = priceOf(acc);
  if (model === "flat") return rate;
  if (model === "per_truck") return Math.max(min, u.trucks * rate);
  if (model === "per_trip") return Math.max(min, u.trips * rate);
  return listFee(p, u.trucks);
}
const n0 = (x: number) => Math.round(x).toLocaleString("en-US");
/** How the fee was worked out, in words. */
export function feeWorking(p: Pricing, use: Usage | number, acc: ClientPrice = { custom_fee: null }) {
  const u = typeof use === "number" ? { trucks: use, trips: 0 } : use;
  const { model, rate, min } = priceOf(acc);
  if (model === "flat") return "flat monthly fee";
  if (model === "per_truck" || model === "per_trip") {
    const [k, word] = model === "per_truck" ? [u.trucks, "truck"] : [u.trips, "trip"];
    const when = model === "per_trip" && u.tripsWhen ? ` in ${u.tripsWhen}` : "";
    const per = k * rate;
    if (per >= min) return `${k} ${word}${k === 1 ? "" : "s"}${when} × TZS ${n0(rate)}`;
    return `minimum fee (${k} ${word}${k === 1 ? "" : "s"}${when} × ${n0(rate)} = ${n0(per)})`;
  }
  const per = u.trucks * Number(p.truck_price);
  if (per >= Number(p.min_fee)) return `${u.trucks} truck${u.trucks === 1 ? "" : "s"} × TZS ${n0(p.truck_price)}`;
  return `minimum fee${u.trucks ? ` (${u.trucks} × ${n0(p.truck_price)} = ${n0(per)})` : ""}`;
}
/** Short label of the client's pricing, e.g. "TZS 10,000 per trip". */
export function priceLabel(acc: ClientPrice, p: Pricing) {
  const { model, rate, min } = priceOf(acc);
  const m = min ? `, min ${n0(min)}` : "";
  if (model === "flat") return `TZS ${n0(rate)} a month, flat`;
  if (model === "per_truck") return `TZS ${n0(rate)} per truck${m}`;
  if (model === "per_trip") return `TZS ${n0(rate)} per trip${m}`;
  return `Price list: ${n0(p.truck_price)} per truck, min ${n0(p.min_fee)}`;
}

/**
 * The status an account should have today.
 * Due date = the later of paid-until and trial end. Before it: Active (paid) or Trial.
 * After it: Overdue for the grace days, then Suspended (if auto-suspend is on).
 * An account with no dates at all (an older client before its first payment) keeps its status.
 */
export function statusFor(acc: BillingAccount, s: BillingSettings, on = today()): { status: AccountStatus; due: string | null; suspend_on: string | null } {
  const dates = [acc.paid_until, acc.trial_ends].filter(Boolean) as string[];
  const due = dates.length ? dates.sort().pop()! : null;
  const suspend_on = due && s.auto_suspend ? addDays(due, s.grace_days + 1) : null;
  if (!acc.auto_status || !due) return { status: acc.status, due, suspend_on: acc.auto_status ? suspend_on : null };
  if (on <= due) return { status: acc.paid_until && on <= acc.paid_until ? "active" : "trial", due, suspend_on };
  if (!s.auto_suspend || on < suspend_on!) return { status: "overdue", due, suspend_on };
  return { status: "suspended", due, suspend_on };
}

// ---- sales team

export interface Agent {
  id: number | string; name: string; phone: string; email: string; ref_code: string; active: boolean;
  signing_pct: number; setup_pct: number; commission_pct: number; commission_months: number; notes: string; created_at: string;
}
export type CommissionKind = "signing" | "setup" | "monthly" | "allowance" | "adjustment";
export interface Commission {
  id: number | string; agent_id: number | string; company_id: string | null; payment_id: number | string | null;
  kind: CommissionKind; amount: number; note: string; earned_on: string; payout_id: number | string | null; created_at: string;
}
export interface Payout { id: number | string; agent_id: number | string; amount: number; paid_on: string; method: string; reference: string; recorded_by: string; created_at: string }

export const KIND_LABEL: Record<CommissionKind, string> = {
  signing: "Signing bonus", setup: "Setup fee share", monthly: "Monthly commission", allowance: "Allowance", adjustment: "Adjustment",
};
export const AGENT_DEFAULTS = { signing_pct: 100, setup_pct: 30, commission_pct: 10, commission_months: 12 };
export const refSlug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/**
 * What an agent earns from one client payment.
 * - Signing bonus: signing_pct of one month's fee, on the client's first subscription payment.
 * - Setup share: setup_pct of any setup fee in the payment.
 * - Monthly commission: commission_pct of the rest of the subscription money, while the payment
 *   falls within commission_months of the date the agent signed the client.
 */
export function commissionLines(
  agent: Pick<Agent, "signing_pct" | "setup_pct" | "commission_pct" | "commission_months">,
  pay: { amount: number; setup_fee: number; months: number; paid_on: string },
  firstSubscription: boolean, agentSince: string,
): { kind: CommissionKind; amount: number; note: string }[] {
  const out: { kind: CommissionKind; amount: number; note: string }[] = [];
  const r = (n: number) => Math.round(n);
  const sub = Math.max(0, Number(pay.amount) - Number(pay.setup_fee || 0));
  const month = pay.months > 0 ? sub / pay.months : 0;
  if (pay.setup_fee > 0 && agent.setup_pct > 0) out.push({ kind: "setup", amount: r(pay.setup_fee * agent.setup_pct / 100), note: `${agent.setup_pct}% of setup fee ${r(pay.setup_fee).toLocaleString("en-US")}` });
  let rest = sub;
  if (firstSubscription && sub > 0 && agent.signing_pct > 0) {
    out.push({ kind: "signing", amount: r(month * agent.signing_pct / 100), note: `${agent.signing_pct}% of first month ${r(month).toLocaleString("en-US")}` });
    rest = sub - month;
  }
  const until = addMonths(agentSince, agent.commission_months);
  if (rest > 0 && agent.commission_pct > 0 && pay.paid_on < until) out.push({ kind: "monthly", amount: r(rest * agent.commission_pct / 100), note: `${agent.commission_pct}% of ${r(rest).toLocaleString("en-US")}` });
  return out.filter((l) => l.amount > 0);
}
