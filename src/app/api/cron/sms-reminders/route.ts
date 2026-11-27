import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendNotices, smsConfigured, type SmsJob } from "@/lib/sms-server";
import { balanceOf, type Company, type Shipment } from "@/lib/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Every morning: remind receivers whose goods are waiting and not paid, for companies that
 * switched reminders on (sms_auto.reminder_days). One reminder every N days per consignment.
 * Called by Vercel Cron.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  if (!smsConfigured()) return NextResponse.json({ ok: true, skipped: "SMS not configured" });
  const admin = supabaseAdmin();
  const { data: cos, error } = await admin.from("companies").select("*");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const now = Date.now();
  const summary: Record<string, number> = {};
  for (const co of (cos || []) as Company[]) {
    const days = Number(co.sms_auto?.reminder_days || 0);
    if (!days) continue;
    const cutoff = new Date(now - days * 864e5).toISOString();
    const { data: ships } = await admin.from("shipments").select("*").eq("company_id", co.id).eq("status", "arrived").eq("pay", "unpaid").lte("arrived_at", cutoff).limit(500);
    const { data: trips } = await admin.from("trips").select("id, plate").eq("company_id", co.id).in("id", [...new Set((ships || []).map((s) => s.trip_id).filter(Boolean))] as string[]);
    const plate = Object.fromEntries((trips || []).map((t) => [t.id, t.plate]));
    const jobs: SmsJob[] = [];
    for (const s of (ships || []) as Shipment[]) {
      if (balanceOf(s) <= 0) continue;
      const last = (s.notices || []).filter((n) => n.kind === "reminder" || (n.kind === "arrived" && n.to === "receiver")).map((n) => n.at).sort().pop();
      if (last && now - new Date(last).getTime() < days * 864e5 - 36e5) continue; // told recently (1 h slack)
      jobs.push({ shipment: s, kind: "reminder", to: "receiver", auto: true, by: "Shehena (automatic)", plate: s.trip_id ? plate[s.trip_id] : "" });
    }
    if (!jobs.length) continue;
    const r = await sendNotices(co, jobs.slice(0, 200));
    summary[co.name] = r.filter((x) => x.status === "sent").length;
  }
  return NextResponse.json({ ok: true, sent: summary });
}
