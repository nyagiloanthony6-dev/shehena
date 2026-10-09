"use server";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import type { FormState } from "../login/actions";

/** Registers a new cargo company and its first Admin account. */
export async function signUpCompany(_: FormState, fd: FormData): Promise<FormState> {
  const { data: ps } = await supabaseAdmin().from("platform_settings").select("signup_open").eq("id", 1).maybeSingle();
  if (process.env.ALLOW_COMPANY_SIGNUP === "false" || ps?.signup_open === false) return { error: "New registrations are closed. Contact Serengeti Labs to get an account." };
  const company = String(fd.get("company") || "").trim();
  const fullName = String(fd.get("full_name") || "").trim();
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const password = String(fd.get("password") || "");
  if (!company || !fullName) return { error: "Enter the company name and your full name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Choose a password of at least 8 characters." };

  const admin = supabaseAdmin();
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName },
  });
  if (error || !created.user) {
    return { error: /already|registered|exists/i.test(error?.message || "") ? "An account with this email already exists. Sign in instead." : "Could not create the account. Try again." };
  }
  const { data: co, error: coErr } = await admin.from("companies").insert({ name: company }).select("id").single();
  if (coErr || !co) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: "Could not create the company. Try again." };
  }
  const { error: pErr } = await admin.from("profiles").insert({
    id: created.user.id, company_id: co.id, full_name: fullName, email, role: "admin",
  });
  if (pErr) {
    await admin.from("companies").delete().eq("id", co.id);
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: "Could not finish setting up the account. Try again." };
  }
  const sb = await supabaseServer();
  await sb.auth.signInWithPassword({ email, password });
  redirect("/app");
}
