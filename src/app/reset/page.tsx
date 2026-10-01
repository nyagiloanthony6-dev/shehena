"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function ResetPage() {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const p1 = String(fd.get("p1")), p2 = String(fd.get("p2"));
    if (p1.length < 8) return setErr("Choose a password of at least 8 characters.");
    if (p1 !== p2) return setErr("The two passwords don't match.");
    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password: p1 });
    setBusy(false);
    if (error) return setErr("This reset link has expired. Request a new one from the sign-in page.");
    router.replace("/app");
  }
  return (
    <AuthShell>
      <h2>Choose a new password</h2>
      <form onSubmit={submit} style={{ display: "grid", gap: 12, marginTop: 14 }}>
        <label className="f">New password<input name="p1" type="password" autoComplete="new-password" required /></label>
        <label className="f">Repeat it<input name="p2" type="password" autoComplete="new-password" required /></label>
        <div className="auth-err" role="alert">{err}</div>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </AuthShell>
  );
}
