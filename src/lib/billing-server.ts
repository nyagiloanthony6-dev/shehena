import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  BILLING_DEFAULTS, bandFor, bandLabel, daysBetween, feeFor, statusFor, today,
  type Band, type BillingAccount, type BillingSettings, type Subscription,
} from "./billing";

export async function billingSettings(): Promise<BillingSettings> {
  const { data } = await supabaseAdmin().from("platform_settings").select("trial_days, grace_days, auto_suspend, billing_instructions").eq("id", 1).maybeSingle();
  return { ...BILLING_DEFAULTS, ...(data || {}) } as BillingSettings;
}

export async function billingBands(): Promise<Band[]> {
  const { data } = await supabaseAdmin().from("billing_bands").select("*").order("min_trucks");
  return (data || []).map((b) => ({ ...b, min_trucks: Number(b.min_trucks), max_trucks: b.max_trucks == null ? null : Number(b.max_trucks), monthly_fee: Number(b.monthly_fee) }));
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
    const [{ data: acc }, { data: vs }, bands, s, { data: pays }] = await Promise.all([
      admin.from("company_accounts").select("company_id, status, trial_ends, paid_until, custom_fee, auto_status").eq("company_id", companyId).maybeSingle(),
      admin.from("vehicles").select("id").eq("company_id", companyId),
      billingBands(), billingSettings(),
      admin.from("billing_payments").select("id, amount, months, period_from, period_to, method, reference, paid_on").eq("company_id", companyId).order("period_to", { ascending: false }).limit(24),
    ]);
    if (!acc) return null;
    const a = acc as BillingAccount;
    const trucks = vs?.length || 0;
    const { due, suspend_on } = statusFor(a, s);
    return {
      status: a.status, trucks, band: bandLabel(bandFor(bands, trucks)), fee: feeFor(a, bands, trucks), custom: a.custom_fee != null,
      trial_ends: a.trial_ends, paid_until: a.paid_until, due, suspend_on: a.auto_status ? suspend_on : null,
      days_left: due ? daysBetween(today(), due) : null,
      instructions: s.billing_instructions,
      payments: (pays || []).map((p) => ({ ...p, amount: Number(p.amount) })),
    };
  } catch { return null; }
}
