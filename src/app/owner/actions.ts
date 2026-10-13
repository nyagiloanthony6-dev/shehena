"use server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentOwner, type AccountStatus } from "@/lib/owner";
import { billingSettings, refreshStatuses } from "@/lib/billing-server";
import { AGENT_DEFAULTS, addDays, dayLabel, bandsProblem, commissionLines, periodEnd, refSlug, today, type Band, type CommissionKind } from "@/lib/billing";

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
  name: string; branch: string; phone: string; admin_name: string; admin_email: string; password: string; status: AccountStatus; agent_id?: string;
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
      agent_id: input.agent_id || null, agent_since: input.agent_id ? today() : null,
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
  companyId: string; months: number; amount: number; setup_fee?: number; from: string; method: string; reference: string; paid_on: string;
}): Promise<Result> {
  try {
    const by = await owner();
    const months = Math.round(Number(input.months)), amount = Number(input.amount);
    if (!(months >= 1 && months <= 36)) return { error: "Choose 1 to 36 months." };
    if (!(amount > 0)) return { error: "Enter the amount received." };
    const setup_fee = Number(input.setup_fee || 0);
    if (!(setup_fee >= 0) || setup_fee > amount) return { error: "The setup fee can't be more than the amount received." };
    if (!input.from || !isDay(input.from) || !isDay(input.paid_on)) return { error: "Enter the start date and the date paid." };
    const admin = supabaseAdmin();
    const period_to = periodEnd(input.from, months);
    const { data: acc } = await admin.from("company_accounts").select("paid_until, agent_id, agent_since").eq("company_id", input.companyId).maybeSingle();
    const { data: earlier } = await admin.from("billing_payments").select("amount, setup_fee").eq("company_id", input.companyId);
    const paid_on = input.paid_on || today();
    const { data: pay, error } = await admin.from("billing_payments").insert({
      company_id: input.companyId, amount, setup_fee, months, period_from: input.from, period_to,
      method: input.method.trim().slice(0, 40), reference: input.reference.trim().slice(0, 80), paid_on, recorded_by: by,
    }).select("id").single();
    if (error || !pay) return { error: "Could not record the payment." };
    // The salesperson who brought this client earns on it, at their rates today.
    let earned = 0;
    if (acc?.agent_id) {
      const { data: agent } = await admin.from("sales_agents").select("*").eq("id", acc.agent_id).maybeSingle();
      if (agent) {
        const first = !(earlier || []).some((p) => Number(p.amount) - Number(p.setup_fee || 0) > 0);
        const lines = commissionLines(
          { signing_pct: Number(agent.signing_pct), setup_pct: Number(agent.setup_pct), commission_pct: Number(agent.commission_pct), commission_months: Number(agent.commission_months) },
          { amount, setup_fee, months, paid_on }, first, acc.agent_since || paid_on);
        if (lines.length) {
          await admin.from("commissions").insert(lines.map((l) => ({ ...l, agent_id: agent.id, company_id: input.companyId, payment_id: pay.id, earned_on: paid_on })));
          earned = lines.reduce((a, l) => a + l.amount, 0);
          await audit(by, "agent.earned", input.companyId, { agent: agent.name, amount: earned });
        }
      }
    }
    const paid_until = acc?.paid_until && acc.paid_until > period_to ? acc.paid_until : period_to;
    // A payment puts the account back on automatic status.
    await admin.from("company_accounts").update({ paid_until, auto_status: true }).eq("company_id", input.companyId);
    await audit(by, "billing.payment", input.companyId, { amount, months, from: input.from, to: period_to, reference: input.reference.trim() });
    await refreshStatuses(input.companyId);
    revalidatePath("/owner");
    return { ok: `Payment of TZS ${amount.toLocaleString("en-US")} recorded. Paid until ${dayLabel(paid_until)}.` + (earned ? ` Commission TZS ${earned.toLocaleString("en-US")} added for the salesperson.` : "") };
  } catch (e) { return fail(e); }
}

export async function deletePayment(id: number | string): Promise<Result> {
  try {
    const by = await owner();
    const admin = supabaseAdmin();
    const { data: p } = await admin.from("billing_payments").select("*").eq("id", id).maybeSingle();
    if (!p) return { error: "Payment not found." };
    // Commission earned on this payment: drop it if not yet paid out, otherwise take it back from the next payout.
    const { data: lines } = await admin.from("commissions").select("*").eq("payment_id", id);
    for (const l of lines || []) {
      if (l.payout_id == null) await admin.from("commissions").delete().eq("id", l.id);
      else await admin.from("commissions").insert({ agent_id: l.agent_id, company_id: l.company_id, kind: "adjustment", amount: -Number(l.amount), note: `Payment removed (was ${l.kind})`, earned_on: today() });
    }
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

// ---------------- sales team

type AgentInput = { name: string; phone: string; email: string; ref_code: string; signing_pct: number; setup_pct: number; commission_pct: number; commission_months: number; notes: string; active?: boolean };
function cleanAgent(a: AgentInput) {
  const v = {
    name: a.name.trim().slice(0, 80), phone: a.phone.trim().slice(0, 30), email: a.email.trim().toLowerCase().slice(0, 120),
    ref_code: refSlug(a.ref_code || a.name), notes: (a.notes || "").trim().slice(0, 2000),
    signing_pct: Number(a.signing_pct), setup_pct: Number(a.setup_pct), commission_pct: Number(a.commission_pct), commission_months: Math.round(Number(a.commission_months)),
    ...(a.active === undefined ? {} : { active: !!a.active }),
  };
  if (!v.name) return { error: "Enter the salesperson's name." };
  if (v.ref_code.length < 2) return { error: "The link code needs at least 2 letters or numbers." };
  if (!(v.signing_pct >= 0 && v.signing_pct <= 300)) return { error: "Signing bonus must be 0–300% of the first month." };
  if (!(v.setup_pct >= 0 && v.setup_pct <= 100) || !(v.commission_pct >= 0 && v.commission_pct <= 100)) return { error: "Percentages must be 0–100." };
  if (!(v.commission_months >= 0 && v.commission_months <= 120)) return { error: "Commission months must be 0–120." };
  return { v };
}

export async function saveAgent(id: number | string | null, input: AgentInput): Promise<Result> {
  try {
    const by = await owner();
    const c = cleanAgent({ ...AGENT_DEFAULTS, ...input });
    if ("error" in c) return { error: c.error };
    const admin = supabaseAdmin();
    const { data: clash } = await admin.from("sales_agents").select("id").eq("ref_code", c.v!.ref_code).maybeSingle();
    if (clash && String(clash.id) !== String(id)) return { error: `The link code "${c.v!.ref_code}" is already used by another salesperson.` };
    const { error } = id == null
      ? await admin.from("sales_agents").insert(c.v!)
      : await admin.from("sales_agents").update(c.v!).eq("id", id);
    if (error) return { error: "Could not save the salesperson." };
    await audit(by, id == null ? "agent.create" : "agent.update", null, { name: c.v!.name, ref: c.v!.ref_code });
    revalidatePath("/owner");
    return { ok: id == null ? `${c.v!.name} added. Share their link so their demo requests and sign-ups are credited to them.` : "Salesperson saved." };
  } catch (e) { return fail(e); }
}

export async function assignAgent(companyId: string, agentId: number | string | null): Promise<Result> {
  try {
    const by = await owner();
    const admin = supabaseAdmin();
    const { data: acc } = await admin.from("company_accounts").select("agent_id").eq("company_id", companyId).maybeSingle();
    if (String(acc?.agent_id ?? "") === String(agentId ?? "")) return { ok: "No change." };
    const { error } = await admin.from("company_accounts").update({ agent_id: agentId, agent_since: agentId == null ? null : today() }).eq("company_id", companyId);
    if (error) return { error: "Could not change the salesperson." };
    await audit(by, "agent.assign", companyId, { agent: agentId });
    revalidatePath("/owner");
    return { ok: agentId == null ? "No salesperson for this client now." : "Salesperson set. They earn on payments recorded from today." };
  } catch (e) { return fail(e); }
}

export async function addAgentLine(agentId: number | string, kind: CommissionKind, amount: number, note: string): Promise<Result> {
  try {
    const by = await owner();
    if (kind !== "allowance" && kind !== "adjustment") return { error: "Choose allowance or adjustment." };
    const n = Number(amount);
    if (!n || (kind === "allowance" && n < 0)) return { error: "Enter an amount." };
    const { error } = await supabaseAdmin().from("commissions").insert({ agent_id: agentId, kind, amount: n, note: note.trim().slice(0, 200), earned_on: today() });
    if (error) return { error: "Could not add the line." };
    await audit(by, "agent.line", null, { agent: agentId, kind, amount: n, note });
    revalidatePath("/owner");
    return { ok: `${kind === "allowance" ? "Allowance" : "Adjustment"} added.` };
  } catch (e) { return fail(e); }
}

export async function deleteAgentLine(id: number | string): Promise<Result> {
  try {
    const by = await owner();
    const admin = supabaseAdmin();
    const { data: l } = await admin.from("commissions").select("*").eq("id", id).maybeSingle();
    if (!l) return { error: "Line not found." };
    if (l.payout_id != null) return { error: "That line is already paid out. Add an adjustment instead." };
    if (l.payment_id != null) return { error: "That line comes from a client payment. Remove the payment instead, or add an adjustment." };
    await admin.from("commissions").delete().eq("id", id);
    await audit(by, "agent.line_removed", null, { agent: l.agent_id, kind: l.kind, amount: Number(l.amount) });
    revalidatePath("/owner");
    return { ok: "Line removed." };
  } catch (e) { return fail(e); }
}

/** Pay an agent everything they're owed: every unpaid line is settled by this payout. */
export async function recordPayout(agentId: number | string, input: { method: string; reference: string; paid_on: string }): Promise<Result> {
  try {
    const by = await owner();
    if (!isDay(input.paid_on)) return { error: "Enter the date paid." };
    const admin = supabaseAdmin();
    const { data: open } = await admin.from("commissions").select("id, amount").eq("agent_id", agentId).is("payout_id", null);
    const total = (open || []).reduce((a, l) => a + Number(l.amount), 0);
    if (!open?.length || total <= 0) return { error: "Nothing is owed to this salesperson right now." };
    const { data: po, error } = await admin.from("agent_payouts").insert({
      agent_id: agentId, amount: total, paid_on: input.paid_on || today(), method: input.method.trim().slice(0, 40), reference: input.reference.trim().slice(0, 80), recorded_by: by,
    }).select("id").single();
    if (error || !po) return { error: "Could not record the payout." };
    await admin.from("commissions").update({ payout_id: po.id }).in("id", open.map((l) => l.id));
    await audit(by, "agent.payout", null, { agent: agentId, amount: total });
    revalidatePath("/owner");
    return { ok: `Payout of TZS ${total.toLocaleString("en-US")} recorded. Download the statement for their records.` };
  } catch (e) { return fail(e); }
}

export async function deletePayout(id: number | string): Promise<Result> {
  try {
    const by = await owner();
    const admin = supabaseAdmin();
    const { data: po } = await admin.from("agent_payouts").select("*").eq("id", id).maybeSingle();
    if (!po) return { error: "Payout not found." };
    await admin.from("commissions").update({ payout_id: null }).eq("payout_id", id);
    await admin.from("agent_payouts").delete().eq("id", id);
    await audit(by, "agent.payout_removed", null, { agent: po.agent_id, amount: Number(po.amount) });
    revalidatePath("/owner");
    return { ok: "Payout removed. Its lines are owed again." };
  } catch (e) { return fail(e); }
}
