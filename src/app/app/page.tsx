import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import CargoApp from "@/components/CargoApp";
import AuthShell from "@/components/AuthShell";
import { signOut } from "../login/actions";
import type { Company, Profile } from "@/lib/domain";
import { accountFor, isOwnerEmail } from "@/lib/owner";
import { subscriptionFor } from "@/lib/billing-server";
import { dayLabel } from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const isOwner = isOwnerEmail(user.email);
  const { profile: me, status } = await accountFor(user.id);
  if (!me && isOwner) redirect("/owner");
  if (me && me.active && status === "suspended") {
    const sub = me.role === "cashier" ? null : await subscriptionFor(me.company_id);
    return (
      <AuthShell>
        <h2>Account suspended</h2>
        <p className="sub">Access for your company is paused. Your records are safe and nothing has been deleted.</p>
        {sub && sub.fee > 0 && sub.due && (
          <p className="sub">Your Shehena subscription was due on <b>{dayLabel(sub.due)}</b>. The monthly fee is <b>TZS {sub.fee.toLocaleString("en-US")}</b> for {sub.plan}.</p>
        )}
        {sub?.instructions && <p className="sub"><b>How to pay:</b> {sub.instructions}</p>}
        <p className="sub">{me.role === "cashier" ? "Please tell your Admin or CEO." : "Access comes back as soon as Serengeti Labs records your payment."}</p>
        <form action={signOut} style={{ marginTop: 14 }}><button className="btn primary" type="submit">Sign out</button></form>
      </AuthShell>
    );
  }
  if (!me || !me.active) {
    return (
      <AuthShell>
        <h2>No access</h2>
        <p className="sub">This account isn&apos;t linked to an active staff profile. Ask your company&apos;s Admin.</p>
        <form action={signOut} style={{ marginTop: 14 }}><button className="btn primary" type="submit">Sign out</button></form>
      </AuthShell>
    );
  }
  const { data: company } = await sb.from("companies").select("*").eq("id", me.company_id).single();
  const { data: settings } = await sb.from("platform_settings").select("announcement").eq("id", 1).maybeSingle();
  const subscription = me.role === "cashier" ? null : await subscriptionFor(me.company_id);
  return <CargoApp me={me as Profile} initialCompany={company as Company} isOwner={isOwner} announcement={settings?.announcement || ""} status={status || "active"} subscription={subscription} />;
}
