"use server";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type LeadState = { ok?: boolean; error?: string };

/** Demo request from the public marketing page. Stored for the owner console. */
export async function submitLead(_: LeadState, fd: FormData): Promise<LeadState> {
  if (String(fd.get("website") || "")) return { ok: true }; // hidden field: bots fill it, people don't
  const v = (k: string, max = 200) => String(fd.get(k) || "").trim().slice(0, max);
  const name = v("name"), phone = v("phone", 40);
  if (!name || phone.replace(/\D/g, "").length < 9) return { error: "missing" };
  const h = await headers();
  const { error } = await supabaseAdmin().from("leads").insert({
    name, phone, company: v("company"), email: v("email"), region: v("region"), trucks: v("trucks", 20),
    message: v("message", 1000), source: v("source", 80) || (h.get("referer") ? "web" : "direct"),
  });
  if (error) return { error: "server" };
  return { ok: true };
}
