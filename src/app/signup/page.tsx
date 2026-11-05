"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import { signUpCompany } from "./actions";
import { REGIONS, INTL } from "@/lib/domain";
import type { FormState } from "../login/actions";

export default function SignupPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(signUpCompany, {});
  const [v, setV] = useState({ company: "", full_name: "", email: "", password: "" });
  const [mode, setMode] = useState<"road" | "air">("road");
  const [origin, setOrigin] = useState("DAR");
  const air = mode === "air";
  // Air companies see international origins first; road companies only Tanzanian regions.
  const places = air ? [...REGIONS.filter(([c]) => INTL.has(c)), ...REGIONS.filter(([c]) => !INTL.has(c))] : REGIONS.filter(([c]) => !INTL.has(c));
  const pickMode = (m: "road" | "air") => { setMode(m); const o = m === "air" ? "CAN" : "DAR"; setOrigin(o); setDests(m === "air" ? ["DAR"] : []); };
  const [dests, setDests] = useState<string[]>([]);
  const toggle = (c: string) => setDests((d) => (d.includes(c) ? d.filter((x) => x !== c) : [...d, c]));
  const bind = (k: keyof typeof v) => ({ name: k, value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value }) });
  return (
    <AuthShell>
      <h2>Register your company</h2>
      <p className="sub">You become the Admin. After signing in you add your cashiers and CEO.</p>
      <form action={action} style={{ display: "grid", gap: 12, marginTop: 14 }}>
        <label className="f">Company name<input {...bind("company")} placeholder="e.g. Kilimanjaro Express Cargo" required /></label>
        <div className="f">Type of business
          <div className="seg" role="radiogroup" aria-label="Type of business">
            <label><input type="radio" name="mode" value="road" checked={!air} onChange={() => pickMode("road")} /><span>Road transport (trucks)</span></label>
            <label><input type="radio" name="mode" value="air" checked={air} onChange={() => pickMode("air")} /><span>Air cargo (flights)</span></label>
          </div>
        </div>
        <label className="f">{air ? "We receive goods at" : "We send goods from"} <small>{air ? "your main origin warehouse, e.g. Guangzhou" : "your head office"}</small>
          <select name="origin" value={origin} onChange={(e) => { setOrigin(e.target.value); setDests((d) => d.filter((x) => x !== e.target.value)); }}>{places.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
        <div className="f">{air ? "Our other offices and warehouses" : "We deliver to"} <small>{air ? "tick where goods arrive (e.g. Dar es Salaam) and any other origin warehouses" : "tick every town you deliver to; you can change this later"}</small>
          <div className="regiongrid" role="group" aria-label="Towns you deliver to">
            {places.filter(([c]) => c !== origin).map(([c, n]) => (
              <label key={c}><input type="checkbox" name="dest" value={c} checked={dests.includes(c)} onChange={() => toggle(c)} />{n}</label>
            ))}
          </div>
          {dests.length > 0 && <span className="sub">{dests.length} selected</span>}
        </div>
        <label className="f">Your full name<input {...bind("full_name")} autoComplete="name" required /></label>
        <label className="f">Email<input {...bind("email")} type="email" autoComplete="email" required /></label>
        <label className="f">Password <small>at least 8 characters</small><input {...bind("password")} type="password" autoComplete="new-password" minLength={8} required /></label>
        <div className="auth-err" role="alert">{state.error}</div>
        <button className="btn primary" type="submit" disabled={pending}>{pending ? "Creating…" : "Create company and sign in"}</button>
      </form>
      <div className="auth-links"><Link href="/login">I already have an account</Link></div>
    </AuthShell>
  );
}
