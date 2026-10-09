import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Serengeti Labs owner accounts, from the OWNER_EMAILS environment variable (comma-separated). */
export function isOwnerEmail(email?: string | null) {
  if (!email) return false;
  const list = (process.env.OWNER_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

/** The signed-in user's email if they are a platform owner, otherwise null. */
export async function currentOwner(): Promise<string | null> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  return user && isOwnerEmail(user.email) ? user.email!.toLowerCase() : null;
}

export type AccountStatus = "trial" | "active" | "overdue" | "suspended";

/** Profile + company account status read on the server, bypassing RLS (used to explain suspensions). */
export async function accountFor(userId: string) {
  const admin = supabaseAdmin();
  const { data: profile } = await admin.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (!profile) return { profile: null, status: null as AccountStatus | null };
  const { data: acc } = await admin.from("company_accounts").select("status").eq("company_id", profile.company_id).maybeSingle();
  return { profile, status: ((acc?.status as AccountStatus) || "active") };
}
