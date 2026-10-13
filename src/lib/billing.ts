// Shehena subscriptions — how much each cargo company pays Serengeti Labs, and its account status.
// Pure helpers (safe in the browser) live here; database work is in billing-server.ts.

export type AccountStatus = "trial" | "active" | "overdue" | "suspended";
export interface Band { id?: number | string; min_trucks: number; max_trucks: number | null; monthly_fee: number }
export interface BillingPayment {
  id: number | string; company_id: string; amount: number; months: number;
  period_from: string; period_to: string; method: string; reference: string; paid_on: string; recorded_by: string; created_at: string;
  setup_fee?: number;
}
export interface BillingSettings { trial_days: number; grace_days: number; auto_suspend: boolean; billing_instructions: string }
export interface BillingAccount {
  company_id: string; status: AccountStatus; trial_ends: string | null; paid_until: string | null;
  custom_fee: number | null; auto_status: boolean; status_changed_at?: string;
}
/** What a client company sees about its own subscription. */
export interface Subscription {
  status: AccountStatus; trucks: number; band: string; fee: number; custom: boolean;
  trial_ends: string | null; paid_until: string | null; due: string | null; suspend_on: string | null; days_left: number | null;
  instructions: string; payments: Pick<BillingPayment, "id" | "amount" | "setup_fee" | "months" | "period_from" | "period_to" | "method" | "reference" | "paid_on">[];
}

export const BILLING_DEFAULTS: BillingSettings = { trial_days: 14, grace_days: 7, auto_suspend: true, billing_instructions: "" };
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

// ---- bands and fees
export const sortBands = (b: Band[]) => [...b].sort((x, y) => x.min_trucks - y.min_trucks);
export const bandFor = (bands: Band[], trucks: number) => {
  const s = sortBands(bands);
  return s.find((b) => trucks >= b.min_trucks && (b.max_trucks == null || trucks <= b.max_trucks)) || (trucks < (s[0]?.min_trucks ?? 0) ? s[0] : s[s.length - 1]) || null;
};
export const bandLabel = (b: Band | null) => {
  if (!b) return "No plan";
  const lo = Math.max(1, b.min_trucks);
  if (b.max_trucks == null) return `${lo}+ trucks`;
  return lo === b.max_trucks ? `${lo} truck${lo === 1 ? "" : "s"}` : `${lo}–${b.max_trucks} trucks`;
};
export const feeFor = (acc: Pick<BillingAccount, "custom_fee">, bands: Band[], trucks: number) =>
  acc.custom_fee != null ? Number(acc.custom_fee) : Number(bandFor(bands, trucks)?.monthly_fee || 0);

/** Problems with a set of bands, or "" if they're fine. */
export function bandsProblem(bands: Band[]) {
  if (!bands.length) return "Add at least one band.";
  const s = sortBands(bands);
  for (const [i, b] of s.entries()) {
    if (!Number.isInteger(b.min_trucks) || b.min_trucks < 0) return "Truck numbers must be whole numbers of 0 or more.";
    if (b.max_trucks != null && (!Number.isInteger(b.max_trucks) || b.max_trucks < b.min_trucks)) return `The band starting at ${b.min_trucks} trucks ends before it starts.`;
    if (!(Number(b.monthly_fee) >= 0)) return "Each band needs a monthly fee.";
    if (b.max_trucks == null && i < s.length - 1) return "Only the last band can be open-ended (\"and more\").";
    const next = s[i + 1];
    if (next && b.max_trucks != null && next.min_trucks !== b.max_trucks + 1) return `Bands must follow on: after ${b.max_trucks} truck${b.max_trucks === 1 ? "" : "s"} the next band should start at ${b.max_trucks + 1}.`;
  }
  return "";
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
