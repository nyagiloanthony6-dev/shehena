"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import { signIn, sendReset, type FormState } from "./actions";

export default function LoginPage() {
  const [forgot, setForgot] = useState(false);
  const [email, setEmail] = useState("");
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {});
  const [rState, rAction, rPending] = useActionState<FormState, FormData>(sendReset, {});
  return (
    <AuthShell>
      {!forgot ? (
        <>
          <h2>Sign in</h2>
          <p className="sub">Use the email and password your Admin gave you.</p>
          <form action={action} style={{ display: "grid", gap: 12, marginTop: 14 }}>
            <label className="f">Email<input name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="f">Password<input name="password" type="password" autoComplete="current-password" required /></label>
            <div className="auth-err" role="alert">{state.error}</div>
            <button className="btn primary" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
          </form>
          <div className="auth-links">
            <a href="#" onClick={(e) => { e.preventDefault(); setForgot(true); }}>Forgot password?</a>
            <Link href="/signup">Register a new company</Link>
          </div>
        </>
      ) : (
        <>
          <h2>Reset your password</h2>
          <p className="sub">We&apos;ll email you a link to choose a new password.</p>
          <form action={rAction} style={{ display: "grid", gap: 12, marginTop: 14 }}>
            <label className="f">Email<input name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <div className="auth-err" role="alert">{rState.error}</div>
            {rState.ok && <div className="auth-ok">{rState.ok}</div>}
            <button className="btn primary" type="submit" disabled={rPending}>{rPending ? "Sending…" : "Send reset link"}</button>
          </form>
          <div className="auth-links"><a href="#" onClick={(e) => { e.preventDefault(); setForgot(false); }}>Back to sign in</a></div>
        </>
      )}
    </AuthShell>
  );
}
