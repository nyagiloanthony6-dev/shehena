import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isOwnerEmail } from "@/lib/owner";
import { billingBands, refreshStatuses } from "@/lib/billing-server";
import { BILLING_DEFAULTS } from "@/lib/billing";
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
  const [companies, accounts, stats, staff, settings, audit, own, leads, bands, payments, agents, commissions, payouts] = await Promise.all([
    admin.from("companies").select("id, name, branch, phone, created_at").order("created_at", { ascending: false }),
    admin.from("company_accounts").select("*"),
    admin.rpc("owner_company_stats"),
    admin.from("profiles").select("id, company_id, full_name, email, role, active, created_at").order("created_at"),
    admin.from("platform_settings").select("*").eq("id", 1).maybeSingle(),
    admin.from("owner_audit").select("*").order("at", { ascending: false }).limit(60),
    admin.from("profiles").select("id").eq("id", user.id).maybeSingle(),
    admin.from("leads").select("*").order("created_at", { ascending: false }).limit(300),
    billingBands(),
    admin.from("billing_payments").select("*").order("paid_on", { ascending: false }).limit(1000),
    admin.from("sales_agents").select("*").order("name"),
    admin.from("commissions").select("*").order("earned_on", { ascending: false }).limit(3000),
    admin.from("agent_payouts").select("*").order("paid_on", { ascending: false }).limit(500),
  ]);
  const n = <T extends Record<string, unknown>>(rows: T[] | null, keys: string[]) => (rows || []).map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, Number(r[k])])) }));
  const data: OwnerData = {
    me: user.email!,
    hasCompany: !!own.data,
    companies: companies.data || [],
    accounts: accounts.data || [],
    stats: stats.data || [],
    staff: staff.data || [],
    settings: { signup_open: true, announcement: "", announcement_updated_at: null, ...BILLING_DEFAULTS, ...(settings.data || {}) },
    bands,
    payments: n(payments.data, ["amount", "setup_fee"]) as never,
    agents: n(agents.data, ["signing_pct", "setup_pct", "commission_pct", "commission_months"]) as never,
    commissions: n(commissions.data, ["amount"]) as never,
    payouts: n(payouts.data, ["amount"]) as never,
    audit: audit.data || [],
    leads: leads.data || [],
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://www.shehenacargo.co.tz",
    error: [companies, accounts, stats, staff].some((r) => r.error) ? "Some figures couldn't load. Check that migration 0003 has been run in Supabase."
      : payments.error ? "Billing isn't set up yet. Run migration 0006_billing.sql in Supabase." : "",
  };
  return <OwnerConsole data={data} />;
}
