"use server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { senderFor, sendNotices, smsConfigured, type SmsResult } from "@/lib/sms-server";
import { cleanSender, SMS_EVENTS, type Company, type NoticeKind, type NoticeTo, type Profile, type Shipment, type SmsAuto } from "@/lib/domain";

/** The signed-in staff member and their company. */
async function caller() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("Sign in again.");
  const { data: me } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!me || !me.active) throw new Error("Your account is not active.");
  const { data: co } = await supabaseAdmin().from("companies").select("*").eq("id", me.company_id).maybeSingle();
  if (!co) throw new Error("Company not found.");
  return { sb, me: me as Profile, company: co as Company };
}

/** Load the consignments the caller can see (RLS), with their truck plates. */
async function shipmentsFor(sb: Awaited<ReturnType<typeof supabaseServer>>, ids: string[]) {
  const { data } = await sb.from("shipments").select("*").in("id", ids.slice(0, 300));
  const L = (data || []) as Shipment[];
  const tripIds = [...new Set(L.map((s) => s.trip_id).filter(Boolean))] as string[];
  const plates: Record<string, string> = {};
  if (tripIds.length) { const { data: ts } = await sb.from("trips").select("id, plate").in("id", tripIds); for (const t of ts || []) plates[t.id] = t.plate; }
  return { L, plates };
}

/**
 * Automatic SMS after something happens in the app (goods saved, truck departed or arrived, goods collected).
 * Only the messages the company switched on are sent. Never throws: SMS must not block the work.
 */
export async function autoSms(ids: string[], kind: NoticeKind): Promise<{ sent: number; noCredit: number; failed: number }> {
  const none = { sent: 0, noCredit: 0, failed: 0 };
  try {
    if (!ids.length) return none;
    const { sb, me, company } = await caller();
    const a0: SmsAuto = company.sms_auto || {};
    const auto: SmsAuto = { ...a0, collected_receiver: a0.collected_receiver ?? a0.collected_sender };
    const wanted = SMS_EVENTS.filter((e) => e.kind === kind && auto[e.key]).map((e) => e.to);
    if (!wanted.length) return none;
    const { L, plates } = await shipmentsFor(sb, ids);
    // Don't send the same automatic message twice for a consignment.
    const already = (s: Shipment, to: NoticeTo) => (s.notices || []).some((n) => n.kind === kind && n.to === to && (n as { auto?: boolean }).auto);
    const jobs = L.flatMap((s) => wanted.filter((to) => !already(s, to)).map((to) => ({ shipment: s, kind, to, auto: true, by: me.full_name, plate: s.trip_id ? plates[s.trip_id] : "" })));
    const r = await sendNotices(company, jobs);
    return { sent: r.filter((x) => x.status === "sent").length, noCredit: r.filter((x) => x.status === "no_credit").length, failed: r.filter((x) => x.status === "failed").length };
  } catch { return none; }
}

/** "Send SMS" button: one message to the sender or receiver, sent by Shehena now. */
export async function sendSmsNow(id: string, kind: NoticeKind, to: NoticeTo): Promise<{ ok?: string; error?: string }> {
  try {
    const { sb, me, company } = await caller();
    if (me.role === "ceo") return { error: "Your role can't send messages." };
    if (!smsConfigured()) return { error: "SMS sending isn't set up yet. Contact Serengeti Labs." };
    const { L, plates } = await shipmentsFor(sb, [id]);
    const s = L[0];
    if (!s) return { error: "Consignment not found." };
    const [r] = await sendNotices(company, [{ shipment: s, kind, to, auto: false, by: me.full_name, plate: s.trip_id ? plates[s.trip_id] : "" }]);
    return msg(r);
  } catch (e) { return { error: (e as Error).message }; }
}

function msg(r?: SmsResult): { ok?: string; error?: string } {
  if (!r) return { error: "Nothing was sent." };
  if (r.status === "sent") return { ok: `SMS sent${r.parts && r.parts > 1 ? ` (${r.parts} SMS)` : ""}.` };
  if (r.status === "no_credit") return { error: "No SMS left. Buy an SMS bundle from Serengeti Labs." };
  if (r.status === "skipped") return { error: "This customer has no valid phone number." };
  if (r.status === "not_configured") return { error: "SMS sending isn't set up yet. Contact Serengeti Labs." };
  return { error: `SMS not sent: ${r.error || "the SMS network refused it"}. Nothing was charged.` };
}

/** Admin: choose which SMS go out automatically. */
export async function saveSmsAuto(auto: SmsAuto): Promise<{ ok?: string; error?: string }> {
  try {
    const { me, company } = await caller();
    if (me.role !== "admin") return { error: "Only the Admin can change this." };
    const clean: SmsAuto = {};
    for (const e of SMS_EVENTS) clean[e.key] = !!auto[e.key] as never;
    clean.reminder_days = Math.max(0, Math.min(14, Math.round(Number(auto.reminder_days) || 0)));
    const { error } = await supabaseAdmin().from("companies").update({ sms_auto: clean }).eq("id", company.id);
    if (error) return { error: /sms_auto/.test(error.message) ? "Run database update 0027 in Supabase first." : "Could not save." };
    return { ok: "SMS settings saved." };
  } catch (e) { return { error: (e as Error).message }; }
}

/** SMS balance and recent messages, for the Settings screen. */
export async function requestSender(name: string): Promise<{ ok?: string; error?: string }> {
  try {
    const { me, company } = await caller();
    if (me.role !== "admin") return { error: "Only the Admin can request a sender name." };
    const n = cleanSender(name);
    if (!n) return { error: "Use 3 to 11 letters or numbers, e.g. G2K TRANS." };
    const { error } = await supabaseAdmin().from("companies").update({ sms_sender_request: n, sms_sender_requested_at: new Date().toISOString() }).eq("id", company.id);
    if (error) return { error: /sms_sender/.test(error.message) ? "Run database update 0028 in Supabase first." : "Could not save." };
    return { ok: `Requested "${n}". Serengeti Labs will register it and tell you when it is ready.` };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function smsOverview(): Promise<{ sender: string; shared: boolean; ready: boolean; configured: boolean; balance: number; log: { id: string; created_at: string; kind: string; to_role: string; phone: string; body: string; parts: number; status: string; error: string; auto: boolean; sent_by: string }[]; monthSent: number; topups: { paid_on: string; sms: number; amount: number }[] }> {
  try {
    const { me, company } = await caller();
    const admin = supabaseAdmin();
    const { data: acc, error } = await admin.from("company_accounts").select("sms_balance").eq("company_id", company.id).maybeSingle();
    const sender = senderFor(company), shared = !company.sms_sender?.trim();
    if (error && /sms_balance/.test(error.message)) return { sender, shared, ready: false, configured: smsConfigured(), balance: 0, log: [], monthSent: 0, topups: [] };
    const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
    const [{ data: log }, { data: month }, { data: tops }] = await Promise.all([
      admin.from("sms_log").select("id, created_at, kind, to_role, phone, body, parts, status, error, auto, sent_by").eq("company_id", company.id).order("created_at", { ascending: false }).limit(60),
      admin.from("sms_log").select("parts").eq("company_id", company.id).eq("status", "sent").gte("created_at", start.toISOString()),
      me.role === "admin" || me.role === "ceo" ? admin.from("sms_topups").select("paid_on, sms, amount").eq("company_id", company.id).order("created_at", { ascending: false }).limit(12) : Promise.resolve({ data: [] }),
    ]);
    return { sender, shared, ready: true, configured: smsConfigured(), balance: Number(acc?.sms_balance || 0), log: (log || []) as never, monthSent: (month || []).reduce((a, r) => a + Number(r.parts || 0), 0), topups: (tops || []) as never };
  } catch { return { sender: "", shared: true, ready: false, configured: false, balance: 0, log: [], monthSent: 0, topups: [] }; }
}
