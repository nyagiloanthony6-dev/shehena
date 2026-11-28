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
/** NextSMS server. NEXTSMS_HOST only for testing (e.g. http://localhost:54400). */
const HOST = (process.env.NEXTSMS_HOST || "https://messaging-service.co.tz").replace(/\/+$/, "");
/** Newer NextSMS accounts use Bearer tokens on /api/v2; older ones Basic login on /api/sms/v1. */
const isV2 = (header: string) => /^bearer\s/i.test(header);
const balancePaths = (header: string) => (isV2(header) ? ["/api/v2/balance", "/api/mobile/v2/balance", "/api/sms/v1/balance"] : ["/api/sms/v1/balance", "/api/v2/balance"]);
/** Sending addresses to try, in order. Only an address that doesn't exist (404/405) moves on, so an SMS is never sent twice. */
const sendPaths = (header: string) => {
  const own = env("NEXTSMS_SEND_PATH");
  const test = env("NEXTSMS_TEST") === "1";
  const v1 = test ? "/api/sms/v1/test/text/single" : "/api/sms/v1/text/single";
  // NextSMS v2 (Bearer token): POST /api/mobile/v2/text/single (test mode: /api/mobile/v2/test/text/single).
  const v2 = test ? ["/api/mobile/v2/test/text/single", "/api/v2/test/text/single"] : ["/api/mobile/v2/text/single", "/api/v2/text/single"];
  return [...(own ? [own] : []), ...(isV2(header) ? [...v2, v1] : [v1, ...v2])];
};
let workingSend: string | null = null;
/** Values pasted into Vercel often carry spaces, quotes or a line break: remove them. */
const env = (k: string) => (process.env[k] || "").trim().replace(/^["']|["']$/g, "").trim();
const b64 = (u: string, p: string) => Buffer.from(`${u.trim()}:${p}`).toString("base64");
type Creds = { header: string; source: "owner" | "vercel" };
let cache: { at: number; c: Creds | null } | null = null;
/** Forget the cached login (after connecting or disconnecting in the owner console). */
export const clearSmsLogin = () => { cache = null; };
/** The NextSMS login: the one saved in the owner console (table sms_provider), else Vercel. */
async function creds(): Promise<Creds | null> {
  // Remember a working login for 30 seconds; never remember "not connected" (it may have just been connected).
  if (cache?.c && Date.now() - cache.at < 30_000) return cache.c;
  let c: Creds | null = null;
  try {
    const { data } = await supabaseAdmin().from("sms_provider").select("username,password").eq("id", 1).maybeSingle();
    if (data?.username && data?.password) c = {
      header: data.username === "__bearer__" ? "Bearer " + data.password : data.username === "__key__" ? "Basic " + data.password : "Basic " + b64(data.username, data.password),
      source: "owner",
    };
  } catch { /* table not created yet */ }
  if (!c) {
    const t = env("NEXTSMS_TOKEN");
    if (t) c = { header: /^(basic|bearer)\s/i.test(t) ? t : "Bearer " + t, source: "vercel" };
    else if (env("NEXTSMS_USERNAME") && env("NEXTSMS_PASSWORD")) c = { header: "Basic " + b64(env("NEXTSMS_USERNAME"), env("NEXTSMS_PASSWORD")), source: "vercel" };
  }
  cache = { at: Date.now(), c };
  return c;
}
export const smsConfigured = async () => !!(await creds());
export const smsSource = async () => (await creds())?.source || null;
/** The company's own approved sender name, or the shared one. */
export const senderFor = (c?: Pick<Company, "sms_sender"> | null) => c?.sms_sender?.trim() || env("NEXTSMS_SENDER_ID") || "SHEHENA";

type Sent = { ok: boolean; id: string; error: string };
/** Clients see Serengeti Labs, never the SMS supplier: strip its name from error texts they can read. */
const neutral = (t: string) => t.replace(/next\s*-?\s*sms|messaging-service\.co\.tz/gi, "Serengeti Labs SMS").slice(0, 300);

/** Send one SMS. Phone in 255XXXXXXXXX form. */
async function nextSms(from: string, phone: string, text: string, reference: string): Promise<Sent> {
  const c = await creds();
  if (!c) return { ok: false, id: "", error: "SMS is not connected." };
  try {
    const paths = workingSend ? [workingSend] : sendPaths(c.header);
    let res: Response | null = null, used = "";
    for (const path of paths) {
      res = await fetch(HOST + path, {
        method: "POST",
        headers: { Authorization: c.header, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ from, to: phone, text, reference }),
        cache: "no-store",
      });
      used = path;
      if (res.status !== 404 && res.status !== 405) break; // the address exists: stop here, whatever the answer
    }
    if (!res) return { ok: false, id: "", error: "No sending address." };
    if (res.ok) workingSend = used;
    const body = await res.json().catch(() => ({}));
    const m = (body?.messages || body?.data?.messages || [])[0] || body?.data || {};
    const group = String(m?.status?.groupName || "").toUpperCase();
    if (!res.ok || group === "REJECTED" || group === "UNDELIVERABLE") {
      return { ok: false, id: String(m?.messageId || ""), error: neutral(String(m?.status?.description || body?.message || body?.error || `Serengeti Labs SMS answered ${res.status}`)) };
    }
    return { ok: true, id: String(m?.messageId || m?.message_id || m?.id || ""), error: "" };
  } catch (e) {
    return { ok: false, id: "", error: neutral((e as Error).message || "Could not reach Serengeti Labs SMS") };
  }
}

/** Owner console: send one test SMS (not charged to any client). */
export async function sendTestSms(phone: string, text: string, from?: string) {
  if (!(await smsConfigured())) return { ok: false, id: "", error: "Not connected: connect NextSMS on the owner Billing page." };
  return nextSms(from || senderFor(null), phone, text, `test-${Date.now()}`);
}

/** The NextSMS account balance (SMS left), for the owner console. */
export async function providerBalance(header?: string): Promise<{ balance: number | null; error: string }> {
  const t = header || (await creds())?.header;
  if (!t) return { balance: null, error: "" };
  try {
    let res: Response | null = null;
    for (const path of balancePaths(t)) {
      res = await fetch(HOST + path, { headers: { Authorization: t, Accept: "application/json" }, cache: "no-store" });
      if (res.status !== 404 && res.status !== 405) break;
    }
    if (!res) return { balance: null, error: "No balance address." };
    const b = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) return { balance: null, error: `NextSMS refused the login (${b?.message || b?.error || "Not Authorized"}). Check the username and password.` };
    const n = Number(b?.sms_balance ?? b?.sms_remaining ?? b?.data?.sms_balance ?? b?.data?.sms_remaining ?? b?.balance ?? b?.data?.balance);
    return Number.isFinite(n) ? { balance: n, error: "" } : { balance: null, error: res.ok ? "" : `NextSMS answered ${res.status}` };
  } catch (e) { return { balance: null, error: `Could not reach NextSMS: ${(e as Error).message}` }; }
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
    if (!(await smsConfigured())) { await log("not_configured"); out.push({ id: s.id, to: j.to, status: "not_configured" }); continue; }
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

/** Test a NextSMS username and password (owner console). */
export const testSmsLogin = (username: string, password: string) => providerBalance("Basic " + b64(username, password));
/** Test a NextSMS API key (the Base64 "Basic" key some NextSMS accounts are given). */
export async function testSmsKey(key: string): Promise<{ balance: number | null; error: string; scheme: "bearer" | "basic" }> {
  const k = key.trim().replace(/^(basic|bearer)\s+/i, "");
  const asked = /^basic\s/i.test(key.trim()) ? "basic" : "bearer";
  // Try the style NextSMS shows in the dashboard first (Bearer), then the older Basic style.
  const order: ("bearer" | "basic")[] = asked === "basic" ? ["basic", "bearer"] : ["bearer", "basic"];
  let last = { balance: null as number | null, error: "" };
  for (const sc of order) {
    last = await providerBalance((sc === "bearer" ? "Bearer " : "Basic ") + k);
    if (!last.error && last.balance !== null) return { ...last, scheme: sc };
  }
  return { ...last, scheme: order[0] };
}
