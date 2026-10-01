import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import CargoApp from "@/components/CargoApp";
import AuthShell from "@/components/AuthShell";
import { signOut } from "../login/actions";
import type { Company, Profile } from "@/lib/domain";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
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
  return <CargoApp me={me as Profile} initialCompany={company as Company} />;
}
