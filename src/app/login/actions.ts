"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";

export type FormState = { error?: string; ok?: string };

export async function signIn(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const password = String(fd.get("password") || "");
  if (!email || !password) return { error: "Enter your email and password." };
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (/banned/i.test(error.message)) return { error: "This account has been disabled. Ask your Admin." };
    return { error: "Wrong email or password." };
  }
  const { data: profile } = await sb.from("profiles").select("active").eq("id", data.user.id).maybeSingle();
  if (!profile || !profile.active) {
    await sb.auth.signOut();
    return { error: "This account has been disabled. Ask your Admin." };
  }
  redirect("/app");
}

export async function sendReset(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") || "").trim().toLowerCase();
  if (!email) return { error: "Enter the email you sign in with." };
  const h = await headers();
  const origin = h.get("origin") || `https://${h.get("host")}`;
  const sb = await supabaseServer();
  await sb.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/reset` });
  // Same reply whether or not the address exists, so nobody can probe for accounts.
  return { ok: "If that email has an account, a reset link is on its way." };
}

export async function signOut() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}
