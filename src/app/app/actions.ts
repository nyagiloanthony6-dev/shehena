"use server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Profile, Role } from "@/lib/domain";

type Result = { ok?: string; error?: string };
const ROLES: Role[] = ["admin", "cashier", "ceo"];

/** The signed-in user's profile, only if they are an active Admin. */
async function requireAdmin(): Promise<Profile> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("Sign in again.");
  const { data: me } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!me || !me.active || me.role !== "admin") throw new Error("Only the Admin can manage staff.");
  return me as Profile;
}

/** A staff member in the caller's own company (never another company's). */
async function colleague(me: Profile, id: string) {
  const { data } = await supabaseAdmin().from("profiles").select("*").eq("id", id).maybeSingle();
  if (!data || data.company_id !== me.company_id) throw new Error("Staff member not found.");
  return data as Profile;
}

export async function createStaff(input: { full_name: string; email: string; role: Role; password: string }): Promise<Result> {
  try {
    const me = await requireAdmin();
    const full_name = input.full_name.trim();
    const email = input.email.trim().toLowerCase();
    if (!full_name) return { error: "Enter the staff member's full name." };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address." };
    if (!ROLES.includes(input.role)) return { error: "Choose a role." };
    if (input.password.length < 8) return { error: "The password must be at least 8 characters." };
    const admin = supabaseAdmin();
    const { data, error } = await admin.auth.admin.createUser({
      email, password: input.password, email_confirm: true, user_metadata: { full_name },
    });
    if (error || !data.user) {
      return { error: /already|registered|exists/i.test(error?.message || "") ? `${email} already has an account.` : "Could not create the account." };
    }
    const { error: pErr } = await admin.from("profiles").insert({
      id: data.user.id, company_id: me.company_id, full_name, email, role: input.role,
    });
    if (pErr) {
      await admin.auth.admin.deleteUser(data.user.id);
      return { error: "Could not save the staff member." };
    }
    return { ok: `${full_name} can now sign in with ${email}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setStaffPassword(id: string, password: string): Promise<Result> {
  try {
    const me = await requireAdmin();
    const p = await colleague(me, id);
    if (password.length < 8) return { error: "The password must be at least 8 characters." };
    const { error } = await supabaseAdmin().auth.admin.updateUserById(id, { password });
    if (error) return { error: "Could not change the password." };
    return { ok: `Password changed for ${p.full_name}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setStaffActive(id: string, active: boolean): Promise<Result> {
  try {
    const me = await requireAdmin();
    if (id === me.id) return { error: "You can't disable your own account." };
    const p = await colleague(me, id);
    const admin = supabaseAdmin();
    await admin.from("profiles").update({ active }).eq("id", id);
    // A ban also ends their current session at the next token refresh.
    await admin.auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
    return { ok: `${p.full_name} ${active ? "can sign in again" : "is disabled"}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setStaffRole(id: string, role: Role): Promise<Result> {
  try {
    const me = await requireAdmin();
    if (id === me.id) return { error: "You can't change your own role." };
    if (!ROLES.includes(role)) return { error: "Choose a role." };
    const p = await colleague(me, id);
    await supabaseAdmin().from("profiles").update({ role }).eq("id", id);
    return { ok: `${p.full_name} is now ${role === "ceo" ? "CEO" : role === "admin" ? "Admin" : "Cashier"}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
