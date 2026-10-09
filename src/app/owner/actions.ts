"use server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentOwner, type AccountStatus } from "@/lib/owner";

type Result = { ok?: string; error?: string };
const STATUSES: AccountStatus[] = ["trial", "active", "overdue", "suspended"];

async function owner() {
  const email = await currentOwner();
  if (!email) throw new Error("Only Serengeti Labs owners can do this.");
  return email;
}
async function audit(by: string, action: string, company_id: string | null, detail: Record<string, unknown> = {}) {
  await supabaseAdmin().from("owner_audit").insert({ owner_email: by, action, company_id, detail });
}
const fail = (e: unknown): Result => ({ error: (e as Error).message || "Something went wrong." });

export async function createCompany(input: {
  name: string; branch: string; phone: string; admin_name: string; admin_email: string; password: string; status: AccountStatus;
}): Promise<Result> {
  try {
    const by = await owner();
    const name = input.name.trim(), admin_name = input.admin_name.trim(), email = input.admin_email.trim().toLowerCase();
    if (!name || !admin_name) return { error: "Enter the company name and the Admin's full name." };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email for the Admin." };
    if (input.password.length < 8) return { error: "The temporary password must be at least 8 characters." };
    if (!STATUSES.includes(input.status) || input.status === "suspended") return { error: "Choose Trial or Active." };
    const admin = supabaseAdmin();
    const { data: u, error } = await admin.auth.admin.createUser({ email, password: input.password, email_confirm: true, user_metadata: { full_name: admin_name } });
    if (error || !u.user) return { error: /already|registered|exists/i.test(error?.message || "") ? `${email} already has an account.` : "Could not create the Admin account." };
    const { data: co, error: cErr } = await admin.from("companies").insert({ name, branch: input.branch.trim(), phone: input.phone.trim() }).select("id").single();
    if (cErr || !co) { await admin.auth.admin.deleteUser(u.user.id); return { error: "Could not create the company." }; }
    await admin.from("company_accounts").upsert({ company_id: co.id, status: input.status, status_changed_at: new Date().toISOString() });
    const { error: pErr } = await admin.from("profiles").insert({ id: u.user.id, company_id: co.id, full_name: admin_name, email, role: "admin" });
    if (pErr) {
      await admin.from("companies").delete().eq("id", co.id);
      await admin.auth.admin.deleteUser(u.user.id);
      return { error: "Could not finish setting up the company." };
    }
    await audit(by, "company.create", co.id, { name, admin_email: email, status: input.status });
    revalidatePath("/owner");
    return { ok: `${name} is ready. Give ${admin_name} the email ${email} and the temporary password.` };
  } catch (e) { return fail(e); }
}

export async function setCompanyStatus(companyId: string, status: AccountStatus): Promise<Result> {
  try {
    const by = await owner();
    if (!STATUSES.includes(status)) return { error: "Unknown status." };
    const admin = supabaseAdmin();
    const { data: before } = await admin.from("company_accounts").select("status").eq("company_id", companyId).maybeSingle();
    const { error } = await admin.from("company_accounts").upsert({ company_id: companyId, status, status_changed_at: new Date().toISOString() });
    if (error) return { error: "Could not change the status." };
    await audit(by, "company.status", companyId, { from: before?.status || "active", to: status });
    revalidatePath("/owner");
    return { ok: status === "suspended" ? "Company suspended. Its staff can no longer see or change records." : `Status changed to ${status}.` };
  } catch (e) { return fail(e); }
}

export async function setCompanyNotes(companyId: string, notes: string): Promise<Result> {
  try {
    const by = await owner();
    const { error } = await supabaseAdmin().from("company_accounts").update({ notes: notes.slice(0, 4000) }).eq("company_id", companyId);
    if (error) return { error: "Could not save the notes." };
    await audit(by, "company.notes", companyId);
    revalidatePath("/owner");
    return { ok: "Notes saved." };
  } catch (e) { return fail(e); }
}

export async function resetStaffPassword(userId: string, password: string): Promise<Result> {
  try {
    const by = await owner();
    if (password.length < 8) return { error: "The temporary password must be at least 8 characters." };
    const admin = supabaseAdmin();
    const { data: p } = await admin.from("profiles").select("company_id, full_name, email").eq("id", userId).maybeSingle();
    if (!p) return { error: "Staff member not found." };
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return { error: "Could not set the password." };
    await audit(by, "staff.password_reset", p.company_id, { email: p.email });
    return { ok: `New temporary password set for ${p.full_name} (${p.email}).` };
  } catch (e) { return fail(e); }
}

export async function setSignupOpen(open: boolean): Promise<Result> {
  try {
    const by = await owner();
    const { error } = await supabaseAdmin().from("platform_settings").update({ signup_open: open }).eq("id", 1);
    if (error) return { error: "Could not change sign-up." };
    await audit(by, open ? "signup.open" : "signup.close", null);
    revalidatePath("/owner");
    return { ok: open ? "New companies can register themselves again." : "Self sign-up closed. Only you can add companies now." };
  } catch (e) { return fail(e); }
}

export async function setAnnouncement(text: string): Promise<Result> {
  try {
    const by = await owner();
    const announcement = text.trim().slice(0, 500);
    const { error } = await supabaseAdmin().from("platform_settings")
      .update({ announcement, announcement_updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) return { error: "Could not save the announcement." };
    await audit(by, announcement ? "announcement.set" : "announcement.clear", null, announcement ? { text: announcement } : {});
    revalidatePath("/owner");
    return { ok: announcement ? "Announcement shown to all clients." : "Announcement removed." };
  } catch (e) { return fail(e); }
}
