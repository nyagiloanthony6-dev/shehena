"use server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentOwner, type AccountStatus } from "@/lib/owner";
import { billingSettings, refreshStatuses } from "@/lib/billing-server";
import { addDays, bandsProblem, periodEnd, today, type Band } from "@/lib/billing";

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
    const s = await billingSettings();
    // Trial: ends after the trial days. Active: no dates until you record their first payment.
    await admin.from("company_accounts").upsert({
      company_id: co.id, status: input.status, status_changed_at: new Date().toISOString(),
      trial_ends: input.status === "trial" ? addDays(today(), s.trial_days) : null, paid_until: null, auto_status: true,
    });
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
    // A status set by hand stays until you switch the account back to automatic.
    const { error } = await admin.from("company_accounts").upsert({ company_id: companyId, status, status_changed_at: new Date().toISOString(), auto_status: false });
    if (error) return { error: "Could not change the status." };
    await audit(by, "company.status", companyId, { from: before?.status || "active", to: status, manual: true });
    revalidatePath("/owner");
    return { ok: (status === "suspended" ? "Company suspended. Its staff can no longer see or change records." : `Status changed to ${status}.`) + " Automatic status is off for this company." };
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

const LEAD_STATUSES = ["new", "contacted", "demo", "won", "lost"];
export async function setLeadStatus(id: number, status: string): Promise<Result> {
  try {
    const by = await owner();
    if (!LEAD_STATUSES.includes(status)) return { error: "Unknown status." };
    const { error } = await supabaseAdmin().from("leads").update({ status }).eq("id", id);
    if (error) return { error: "Could not update the request." };
    await audit(by, "lead.status", null, { lead: id, status });
    revalidatePath("/owner");
    return { ok: "Request updated." };
  } catch (e) { return fail(e); }
}

// ---------------- billing

export async function setAutoStatus(companyId: string): Promise<Result> {
  try {
    const by = await owner();
    const { error } = await supabaseAdmin().from("company_accounts").update({ auto_status: true }).eq("company_id", companyId);
    if (error) return { error: "Could not switch to automatic." };
    await audit(by, "billing.auto", companyId);
    const ch = await refreshStatuses(companyId);
    revalidatePath("/owner");
    return { ok: ch.length ? `Automatic again. Status is now ${ch[0].to}.` : "Automatic again. Status follows payments and the trial date." };
  } catch (e) { return fail(e); }
}

const isDay = (s: string | null | undefined) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function setAccountBilling(companyId: string, input: { custom_fee: number | null; trial_ends: string | null; paid_until: string | null }): Promise<Result> {
  try {
    const by = await owner();
    if (input.custom_fee != null && !(input.custom_fee >= 0)) return { error: "The custom fee must be 0 or more." };
    if (!isDay(input.trial_ends) || !isDay(input.paid_until)) return { error: "Enter dates as day / month / year." };
    const admin = supabaseAdmin();
    const { data: before } = await admin.from("company_accounts").select("custom_fee, trial_ends, paid_until").eq("company_id", companyId).maybeSingle();
    const next = { custom_fee: input.custom_fee, trial_ends: input.trial_ends || null, paid_until: input.paid_until || null };
    const { error } = await admin.from("company_accounts").update(next).eq("company_id", companyId);
    if (error) return { error: "Could not save the billing details." };
    await audit(by, "billing.account", companyId, { before, after: next });
    const ch = await refreshStatuses(companyId);
    revalidatePath("/owner");
    return { ok: "Billing details saved." + (ch.length ? ` Status is now ${ch[0].to}.` : "") };
  } catch (e) { return fail(e); }
}

export async function recordPayment(input: {
  companyId: string; months: number; amount: number; from: string; method: string; reference: string; paid_on: string;
}): Promise<Result> {
  try {
    const by = await owner();
    const months = Math.round(Number(input.months)), amount = Number(input.amount);
    if (!(months >= 1 && months <= 36)) return { error: "Choose 1 to 36 months." };
    if (!(amount > 0)) return { error: "Enter the amount received." };
    if (!input.from || !isDay(input.from) || !isDay(input.paid_on)) return { error: "Enter the start date and the date paid." };
    const admin = supabaseAdmin();
    const period_to = periodEnd(input.from, months);
    const { data: acc } = await admin.from("company_accounts").select("paid_until").eq("company_id", input.companyId).maybeSingle();
    const { error } = await admin.from("billing_payments").insert({
      company_id: input.companyId, amount, months, period_from: input.from, period_to,
      method: input.method.trim().slice(0, 40), reference: input.reference.trim().slice(0, 80), paid_on: input.paid_on || today(), recorded_by: by,
    });
    if (error) return { error: "Could not record the payment." };
    const paid_until = acc?.paid_until && acc.paid_until > period_to ? acc.paid_until : period_to;
    // A payment puts the account back on automatic status.
    await admin.from("company_accounts").update({ paid_until, auto_status: true }).eq("company_id", input.companyId);
    await audit(by, "billing.payment", input.companyId, { amount, months, from: input.from, to: period_to, reference: input.reference.trim() });
    await refreshStatuses(input.companyId);
    revalidatePath("/owner");
    return { ok: `Payment of TZS ${amount.toLocaleString("en-US")} recorded. Paid until ${paid_until}.` };
  } catch (e) { return fail(e); }
}

export async function deletePayment(id: number | string): Promise<Result> {
  try {
    const by = await owner();
    const admin = supabaseAdmin();
    const { data: p } = await admin.from("billing_payments").select("*").eq("id", id).maybeSingle();
    if (!p) return { error: "Payment not found." };
    const { error } = await admin.from("billing_payments").delete().eq("id", id);
    if (error) return { error: "Could not remove the payment." };
    // Paid-until goes back to the latest remaining payment.
    const { data: rest } = await admin.from("billing_payments").select("period_to").eq("company_id", p.company_id).order("period_to", { ascending: false }).limit(1);
    await admin.from("company_accounts").update({ paid_until: rest?.[0]?.period_to || null }).eq("company_id", p.company_id);
    await audit(by, "billing.payment_removed", p.company_id, { amount: Number(p.amount), months: p.months, from: p.period_from, to: p.period_to, reference: p.reference });
    await refreshStatuses(p.company_id);
    revalidatePath("/owner");
    return { ok: "Payment removed." };
  } catch (e) { return fail(e); }
}

export async function saveBands(bands: Band[]): Promise<Result> {
  try {
    const by = await owner();
    const clean = bands.map((b) => ({ min_trucks: Number(b.min_trucks), max_trucks: b.max_trucks == null || (b.max_trucks as unknown) === "" ? null : Number(b.max_trucks), monthly_fee: Number(b.monthly_fee) }));
    const problem = bandsProblem(clean);
    if (problem) return { error: problem };
    const admin = supabaseAdmin();
    const { data: old } = await admin.from("billing_bands").select("min_trucks, max_trucks, monthly_fee");
    const { error: dErr } = await admin.from("billing_bands").delete().gte("min_trucks", 0);
    if (dErr) return { error: "Could not save the price bands." };
    const { error } = await admin.from("billing_bands").insert(clean);
    if (error) { if (old?.length) await admin.from("billing_bands").insert(old); return { error: "Could not save the price bands." }; }
    await audit(by, "billing.bands", null, { bands: clean });
    revalidatePath("/owner");
    return { ok: "Price bands saved. New fees apply to the next payment you record." };
  } catch (e) { return fail(e); }
}

export async function saveBillingSettings(input: { trial_days: number; grace_days: number; auto_suspend: boolean; billing_instructions: string }): Promise<Result> {
  try {
    const by = await owner();
    const trial_days = Math.round(Number(input.trial_days)), grace_days = Math.round(Number(input.grace_days));
    if (!(trial_days >= 0 && trial_days <= 365)) return { error: "Trial days must be 0 to 365." };
    if (!(grace_days >= 0 && grace_days <= 90)) return { error: "Grace days must be 0 to 90." };
    const next = { trial_days, grace_days, auto_suspend: !!input.auto_suspend, billing_instructions: input.billing_instructions.trim().slice(0, 500) };
    const { error } = await supabaseAdmin().from("platform_settings").update(next).eq("id", 1);
    if (error) return { error: "Could not save the billing settings." };
    await audit(by, "billing.settings", null, next);
    await refreshStatuses();
    revalidatePath("/owner");
    return { ok: "Billing settings saved." };
  } catch (e) { return fail(e); }
}
