import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { providerBalance, smsConfigured, smsSource } from "@/lib/sms-server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isOwnerEmail } from "@/lib/owner";
import { billingSettings, refreshStatuses, tripsByMonth, usage } from "@/lib/billing-server";
import { BILLING_DEFAULTS } from "@/lib/billing";
import { allRows } from "@/lib/all-rows";
import AuthShell from "@/components/AuthShell";
import OwnerConsole, { type OwnerData } from "@/components/OwnerConsole";
import { signOut } from "../login/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Owner console · Shehena" };

export default async function OwnerPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  if (!isOwnerEmail(user.email)) {
    return (
      <AuthShell>
        <h2>Not authorised</h2>
        <p className="sub">The owner console is only for Serengeti Labs. You&apos;re signed in as {user.email}.</p>
        <div className="actions">
          <a className="btn primary" href="/app">Go to my company</a>
          <form action={signOut}><button className="btn" type="submit">Sign out</button></form>
        </div>
      </AuthShell>
    );
  }
  const admin = supabaseAdmin();
  await refreshStatuses();
  const [companies, accounts, stats, staff, settings, audit, own, leads, active, pricing, payments, agents, commissions, payouts, monthTrips] = await Promise.all([
    allRows((a, b) => admin.from("companies").select("*").order("created_at", { ascending: false }).order("id").range(a, b)),
    allRows((a, b) => admin.from("company_accounts").select("*").order("company_id").range(a, b)),
    admin.rpc("owner_company_stats"),
    allRows((a, b) => admin.from("profiles").select("id, company_id, full_name, email, role, active, created_at").order("created_at").order("id").range(a, b)),
    admin.from("platform_settings").select("*").eq("id", 1).maybeSingle(),
    admin.from("owner_audit").select("*").order("at", { ascending: false }).limit(60),
    admin.from("profiles").select("id").eq("id", user.id).maybeSingle(),
    admin.from("leads").select("*").order("created_at", { ascending: false }).limit(300),
    usage(),
    billingSettings(),
    allRows((a, b) => admin.from("billing_payments").select("*").order("paid_on", { ascending: false }).order("id").range(a, b)),
    admin.from("sales_agents").select("*").order("name"),
    allRows((a, b) => admin.from("commissions").select("*").order("earned_on", { ascending: false }).order("id").range(a, b)),
    admin.from("agent_payouts").select("*").order("paid_on", { ascending: false }).limit(500),
    tripsByMonth(),
  ]);
  const smsProvider = await providerBalance();
  const smsKeys = await admin.from("sms_client_logins").select("company_id").then((r) => (r.error ? null : (r.data || []).map((x) => x.company_id as string)), () => null);
  const n = <T extends Record<string, unknown>>(rows: T[] | null, keys: string[]) => (rows || []).map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, Number(r[k])])) }));
  const data: OwnerData = {
    me: user.email!,
    hasCompany: !!own.data,
    companies: companies.data || [],
    accounts: (accounts.data || []).map((a) => ({ ...a, ...(a.sms_price != null ? { sms_price: Number(a.sms_price) } : {}) })),
    stats: stats.data || [],
    staff: staff.data || [],
    settings: { signup_open: true, announcement: "", announcement_updated_at: null, ...BILLING_DEFAULTS, ...(settings.data || {}), truck_price: pricing.truck_price, min_fee: pricing.min_fee, sms_price: settings.data?.sms_price != null ? Number(settings.data.sms_price) : undefined },
    active: Object.fromEntries(Object.entries(active).map(([c, u]) => [c, u.plates])),
    trips: Object.fromEntries(Object.entries(active).map(([c, u]) => [c, u.trips])),
    monthTrips,
    payments: n(payments.data, ["amount", "setup_fee"]) as never,
    agents: n(agents.data, ["signing_pct", "setup_pct", "commission_pct", "commission_months"]) as never,
    commissions: n(commissions.data, ["amount"]) as never,
    payouts: n(payouts.data, ["amount"]) as never,
    audit: audit.data || [],
    leads: leads.data || [],
    sms: { source: await smsSource(), configured: await smsConfigured(), balance: smsProvider.balance, error: smsProvider.error, test: process.env.NEXTSMS_TEST === "1", sender: process.env.NEXTSMS_SENDER_ID || "SHEHENA", keys: smsKeys },
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://www.shehenacargo.co.tz",
    error: [companies, accounts, stats, staff].some((r) => r.error) ? "Some figures couldn't load. Check that migration 0003 has been run in Supabase."
      : payments.error ? "Billing isn't set up yet. Run migration 0006_billing.sql in Supabase." : "",
  };
  return <OwnerConsole data={data} />;
}
