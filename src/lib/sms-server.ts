import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { intlPhone, message, smsParts, type Company, type NoticeKind, type NoticeTo, type Shipment } from "@/lib/domain";

/**
 * SMS through NextSMS (messaging-service.co.tz).
 * Vercel environment variables:
 *   NEXTSMS_USERNAME, NEXTSMS_PASSWORD  - the NextSMS login (never sent to the browser)
 *   NEXTSMS_SENDER_ID                   - the shared sender name (default SHEHENA (registered)
 *   NEXTSMS_TEST=1                      - optional: use NextSMS test mode (nothing is delivered)
 */
const BASE = process.env.NEXTSMS_BASE_URL || "https://messaging-service.co.tz/api/sms/v1";
export const smsConfigured = () => !!(process.env.NEXTSMS_USERNAME && process.env.NEXTSMS_PASSWORD);
const auth = () => "Basic " + Buffer.from(`${process.env.NEXTSMS_USERNAME}:${process.env.NEXTSMS_PASSWORD}`).toString("base64");
/** The company's own approved sender name, or the shared one. */
export const senderFor = (c?: Pick<Company, "sms_sender"> | null) => c?.sms_sender?.trim() || process.env.NEXTSMS_SENDER_ID || "SHEHENA";

type Sent = { ok: boolean; id: string; error: string };
/** Clients see Serengeti Labs, never the SMS supplier: strip its name from error texts they can read. */
const neutral = (t: string) => t.replace(/next\s*-?\s*sms|messaging-service\.co\.tz/gi, "Serengeti Labs SMS").slice(0, 300);

/** Send one SMS. Phone in 255XXXXXXXXX form. */
async function nextSms(from: string, phone: string, text: string, reference: string): Promise<Sent> {
  const url = `${BASE}/${process.env.NEXTSMS_TEST === "1" ? "test/" : ""}text/single`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: auth(), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ from, to: phone, text, reference }),
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    const m = (body?.messages || [])[0] || {};
    const group = String(m?.status?.groupName || "").toUpperCase();
    if (!res.ok || group === "REJECTED" || group === "UNDELIVERABLE") {
      return { ok: false, id: String(m?.messageId || ""), error: neutral(String(m?.status?.description || body?.message || body?.error || `Serengeti Labs SMS answered ${res.status}`)) };
    }
    return { ok: true, id: String(m?.messageId || ""), error: "" };
  } catch (e) {
    return { ok: false, id: "", error: neutral((e as Error).message || "Could not reach Serengeti Labs SMS") };
  }
}

/** Owner console: send one test SMS (not charged to any client). */
export async function sendTestSms(phone: string, text: string, from?: string) {
  if (!smsConfigured()) return { ok: false, id: "", error: "Not connected: add NEXTSMS_USERNAME and NEXTSMS_PASSWORD in Vercel and redeploy." };
  return nextSms(from || senderFor(null), phone, text, `test-${Date.now()}`);
}

/** The NextSMS account balance (SMS left), for the owner console. */
export async function providerBalance(): Promise<number | null> {
  if (!smsConfigured()) return null;
  try {
    const res = await fetch(`${BASE}/balance`, { headers: { Authorization: auth(), Accept: "application/json" }, cache: "no-store" });
    const b = await res.json();
    const n = Number(b?.sms_balance ?? b?.balance ?? b?.data?.sms_balance);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

export type SmsJob = { shipment: Shipment; kind: NoticeKind; to: NoticeTo; auto: boolean; by: string; plate?: string };
export type SmsResult = { id: string; to: NoticeTo; status: "sent" | "failed" | "no_credit" | "not_configured" | "skipped"; error?: string; parts?: number };

/**
 * Send customer notices for one company: builds each message, takes the SMS off the company's
 * balance first (given back if NextSMS rejects it), logs every attempt and marks the consignment.
 */
export async function sendNotices(company: Company, jobs: SmsJob[]): Promise<SmsResult[]> {
  const admin = supabaseAdmin();
  const out: SmsResult[] = [];
  for (const j of jobs) {
    const s = j.shipment;
    const phone = intlPhone(j.to === "sender" ? s.s_phone : s.r_phone);
    if (!/^255[67]\d{8}$/.test(phone)) { out.push({ id: s.id, to: j.to, status: "skipped", error: "No valid phone number" }); continue; }
    const text = message(s, j.kind, j.to, company, j.plate || "");
    const parts = smsParts(text);
    const log = (status: SmsResult["status"], provider_id = "", error = "") => admin.from("sms_log").insert({
      company_id: company.id, shipment_id: s.id, kind: j.kind, to_role: j.to, phone, body: text, parts: status === "sent" ? parts : 0,
      status, provider_id, error, auto: j.auto, sent_by: j.by,
    });
    if (!smsConfigured()) { await log("not_configured"); out.push({ id: s.id, to: j.to, status: "not_configured" }); continue; }
    const { data: left } = await admin.rpc("sms_take", { p_company: company.id, p_n: parts });
    if (left === null || left === undefined) { await log("no_credit"); out.push({ id: s.id, to: j.to, status: "no_credit", parts }); continue; }
    const r = await nextSms(senderFor(company), phone, text, `${s.no}-${j.kind}-${j.to}`.slice(0, 60));
    if (!r.ok) {
      await admin.rpc("sms_give", { p_company: company.id, p_n: parts });
      await log("failed", r.id, r.error);
      out.push({ id: s.id, to: j.to, status: "failed", error: r.error, parts });
      continue;
    }
    await log("sent", r.id);
    // Mark the consignment so the app shows "✓ SMS sent" (same list the WhatsApp/SMS buttons use).
    const { data: cur } = await admin.from("shipments").select("notices").eq("id", s.id).maybeSingle();
    const notices = [...((cur?.notices as unknown[]) || []), { kind: j.kind, to: j.to, channel: "SMS", auto: true, at: new Date().toISOString(), by: j.auto ? "Shehena (automatic)" : j.by }];
    await admin.from("shipments").update({ notices }).eq("id", s.id);
    out.push({ id: s.id, to: j.to, status: "sent", parts });
  }
  return out;
}
