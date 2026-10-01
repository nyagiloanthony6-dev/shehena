"use client";
import { useState, useTransition } from "react";
import { useStore } from "../store";
import { REGIONS, ROLES, fmtDay, type Profile, type Role, type Vehicle } from "@/lib/domain";
import { createStaff, setStaffActive, setStaffPassword, setStaffRole } from "@/app/app/actions";

function CompanyForm() {
  const { company, patchCompany, toast } = useStore();
  const [f, setF] = useState({ name: company.name, branch: company.branch, phone: company.phone, default_origin: company.default_origin, message_lang: company.message_lang });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!f.name.trim()) return toast("Enter your company name.", true);
      if (await patchCompany({ ...f, name: f.name.trim(), branch: f.branch.trim(), phone: f.phone.trim() } as never)) toast("Company details saved");
    }} style={{ maxWidth: 760 }}>
      <fieldset><legend>Company on receipts and messages</legend>
        <div className="fields">
          <label className="f full">Company name<input value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
          <label className="f">Branch<input value={f.branch} onChange={(e) => set("branch", e.target.value)} placeholder="e.g. Kariakoo, Dar es Salaam" /></label>
          <label className="f">Office phone<input value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" /></label>
          <label className="f">Default origin<select value={f.default_origin} onChange={(e) => set("default_origin", e.target.value)}>{REGIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
          <label className="f">Message language<select value={f.message_lang} onChange={(e) => set("message_lang", e.target.value)}><option value="sw">Kiswahili</option><option value="en">English</option></select></label>
        </div>
        <div className="actions"><button className="btn primary" type="submit">Save company details</button></div>
      </fieldset>
    </form>
  );
}

function StaffRow({ p }: { p: Profile }) {
  const { me, toast, reloadStaff } = useStore();
  const [pw, setPw] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const self = p.id === me.id;
  const run = (fn: () => Promise<{ ok?: string; error?: string }>) => start(async () => {
    const r = await fn();
    if (r.error) toast(r.error, true); else { toast(r.ok || "Saved"); setPw(null); await reloadStaff(); }
  });
  return (
    <div className="lrow" style={{ flexWrap: "wrap" }}>
      <div>
        <b>{p.full_name}</b> {self && <span className="sub">(you)</span>}
        <div className="sub">{p.email}{!p.active && " · Disabled"}</div>
      </div>
      <div className="pwrow" style={{ justifyContent: "end" }}>
        {pw !== null ? (
          <>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (8+)" style={{ width: 170 }} autoComplete="new-password" aria-label={`New password for ${p.full_name}`} />
            <button className="btn sm primary" disabled={pending} onClick={() => run(() => setStaffPassword(p.id, pw))}>Save password</button>
            <button className="btn sm" onClick={() => setPw(null)}>Cancel</button>
          </>
        ) : (
          <>
            <select value={p.role} disabled={self || pending} onChange={(e) => run(() => setStaffRole(p.id, e.target.value as Role))} style={{ width: "auto" }} aria-label={`Role of ${p.full_name}`}>
              {(Object.keys(ROLES) as Role[]).map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
            </select>
            <button className="btn sm" onClick={() => setPw("")}>Set password</button>
            {!self && <button className={`btn sm${p.active ? " danger" : ""}`} disabled={pending} onClick={() => run(() => setStaffActive(p.id, !p.active))}>{p.active ? "Disable" : "Enable"}</button>}
          </>
        )}
      </div>
    </div>
  );
}

function AddStaff() {
  const { toast, reloadStaff } = useStore();
  const [f, setF] = useState({ full_name: "", email: "", role: "cashier" as Role, password: "" });
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return (
    <form noValidate style={{ marginTop: 14 }} onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await createStaff(f);
        if (r.error) return setErr(r.error);
        setErr(""); toast(r.ok || "Staff member added");
        setF({ full_name: "", email: "", role: "cashier", password: "" });
        await reloadStaff();
      });
    }}>
      <div className="lbl" style={{ marginBottom: 8 }}>Add a staff member</div>
      <div className="fields four">
        <label className="f">Full name<input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
        <label className="f">Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" /></label>
        <label className="f">Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}><option value="cashier">Cashier</option><option value="admin">Admin</option><option value="ceo">CEO</option></select></label>
        <label className="f">Password <small>8+ characters</small><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></label>
      </div>
      <div className="err" role="alert">{err}</div>
      <div className="actions"><button className="btn primary" type="submit" disabled={pending}>{pending ? "Adding…" : "Add staff member"}</button></div>
      <p className="note">Give the person their email and password. They can change the password with &quot;Forgot password?&quot; on the sign-in page.</p>
    </form>
  );
}

function VehicleRow({ v }: { v: Vehicle }) {
  const { patch, remove, me, toast } = useStore();
  const [f, setF] = useState({ driver: v.driver, driver_phone: v.driver_phone, target: String(v.target || "") });
  const [confirm, setConfirm] = useState(false);
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <div className="mono" style={{ fontWeight: 600, marginBottom: 6 }}>{v.plate}</div>
      <div className="fields four">
        <label className="f">Driver<input value={f.driver} onChange={(e) => setF({ ...f, driver: e.target.value })} /></label>
        <label className="f">Driver phone<input value={f.driver_phone} onChange={(e) => setF({ ...f, driver_phone: e.target.value })} inputMode="tel" /></label>
        <label className="f">Target per trip (TZS)<input type="number" min={0} step={10000} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
        <div style={{ display: "flex", gap: 6, alignItems: "end", flexWrap: "wrap" }}>
          <button className="btn sm primary" onClick={async () => {
            const tg = Number(f.target) || 0;
            const vals: Partial<Vehicle> = { driver: f.driver.trim(), driver_phone: f.driver_phone.trim(), target: tg };
            if (tg !== Number(v.target || 0)) { vals.target_set_by = me.full_name; vals.target_set_at = new Date().toISOString(); }
            if (await patch<Vehicle>("vehicles", v.id, vals)) toast(`${v.plate} saved`);
          }}>Save</button>
          {confirm
            ? <><button className="btn sm danger" onClick={() => remove("vehicles", v.id)}>Remove</button><button className="btn sm" onClick={() => setConfirm(false)}>Keep</button></>
            : <button className="btn sm danger" onClick={() => setConfirm(true)}>Remove</button>}
        </div>
      </div>
      {v.target_set_by && <div className="sub" style={{ marginTop: 4 }}>Target set by {v.target_set_by} · {fmtDay(v.target_set_at)}</div>}
    </div>
  );
}

function AddVehicle() {
  const { insert, me, toast, vehicles } = useStore();
  const [f, setF] = useState({ plate: "", driver: "", driver_phone: "", target: "" });
  const [err, setErr] = useState("");
  return (
    <form noValidate style={{ marginTop: 14 }} onSubmit={async (e) => {
      e.preventDefault();
      const plate = f.plate.trim().toUpperCase();
      if (!plate) return setErr("Enter the plate number.");
      if (vehicles.some((v) => v.plate === plate)) return setErr(`${plate} is already saved.`);
      const tg = Number(f.target) || 0;
      const v = await insert<Vehicle>("vehicles", { plate, driver: f.driver.trim(), driver_phone: f.driver_phone.trim(), target: tg, target_set_by: tg ? me.full_name : null, target_set_at: tg ? new Date().toISOString() : null });
      if (v) { setErr(""); setF({ plate: "", driver: "", driver_phone: "", target: "" }); toast(`${plate} added`); }
    }}>
      <div className="lbl" style={{ marginBottom: 8 }}>Add a vehicle</div>
      <div className="fields four">
        <label className="f">Plate number<input value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} placeholder="T 123 ABC" /></label>
        <label className="f">Driver<input value={f.driver} onChange={(e) => setF({ ...f, driver: e.target.value })} /></label>
        <label className="f">Driver phone<input value={f.driver_phone} onChange={(e) => setF({ ...f, driver_phone: e.target.value })} inputMode="tel" /></label>
        <label className="f">Target per trip (TZS)<input type="number" min={0} step={10000} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="e.g. 2000000" /></label>
      </div>
      <div className="err" role="alert">{err}</div>
      <div className="actions"><button className="btn primary" type="submit">Add vehicle</button></div>
    </form>
  );
}

export default function Settings() {
  const { staff, vehicles } = useStore();
  return (
    <section>
      <div className="sectionhead"><h1>Settings</h1></div>
      <CompanyForm />
      <fieldset style={{ maxWidth: 760 }}><legend>Staff accounts</legend>
        <p className="sub" style={{ marginTop: 0 }}>Everyone signs in with their own email and password. Admins manage staff and settings; cashiers receive goods, take payments and load trucks; the CEO sees reports and sets targets.</p>
        {staff.map((p) => <StaffRow key={p.id + p.role + p.active} p={p} />)}
        <AddStaff />
      </fieldset>
      <fieldset style={{ maxWidth: 760 }}><legend>Vehicles</legend>
        {vehicles.map((v) => <VehicleRow key={v.id + v.target} v={v} />)}
        {!vehicles.length && <p className="sub">No vehicles saved yet.</p>}
        <AddVehicle />
      </fieldset>
    </section>
  );
}
