"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import { signUpCompany } from "./actions";
import type { FormState } from "../login/actions";

export default function SignupPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(signUpCompany, {});
  const [v, setV] = useState({ company: "", full_name: "", email: "" });
  const bind = (k: keyof typeof v) => ({ name: k, value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value }) });
  return (
    <AuthShell>
      <h2>Register your company</h2>
      <p className="sub">You become the Admin. After signing in you add your cashiers and CEO.</p>
      <form action={action} style={{ display: "grid", gap: 12, marginTop: 14 }}>
        <label className="f">Company name<input {...bind("company")} placeholder="e.g. Kilimanjaro Express Cargo" required /></label>
        <label className="f">Your full name<input {...bind("full_name")} autoComplete="name" required /></label>
        <label className="f">Email<input {...bind("email")} type="email" autoComplete="email" required /></label>
        <label className="f">Password <small>at least 8 characters</small><input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
        <div className="auth-err" role="alert">{state.error}</div>
        <button className="btn primary" type="submit" disabled={pending}>{pending ? "Creating…" : "Create company and sign in"}</button>
      </form>
      <div className="auth-links"><Link href="/login">I already have an account</Link></div>
    </AuthShell>
  );
}
