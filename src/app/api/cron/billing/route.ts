import { NextResponse } from "next/server";
import { refreshStatuses } from "@/lib/billing-server";

export const dynamic = "force-dynamic";

/** Daily: move accounts to Overdue / Suspended (or back to Active) from their dates. Called by Vercel Cron. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const changed = await refreshStatuses();
  return NextResponse.json({ ok: true, changed });
}
