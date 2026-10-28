"use client";
import { useState, useTransition } from "react";
import { useStore } from "../store";
import { RegionOptions } from "../RegionOptions";
import { REGIONS, ROLES, officesOf, fmtDay, tzs, type Profile, type Role, type Vehicle } from "@/lib/domain";
import { createStaff, setStaffActive, setStaffPassword, setStaffRole } from "@/app/app/actions";
import { ACTIVE_DAYS, dayLabel, feeWorking, planLabel, type Subscription } from "@/lib/billing";
import { downloadSubscriptionReceipt } from "../billingPdf";

const SUB_LABEL = { trial: "Free trial", active: "Active", overdue: "Overdue", suspended: "Suspended" } as const;
function SubscriptionCard({ sub }: { sub: Subscription }) {
  const { company } = useStore();
  return (
    <fieldset><legend>Shehena subscription</legend>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className={`pill acc-${sub.status}`}>{SUB_LABEL[sub.status]}</span>
        <span className="sub">
          {sub.status === "trial" && sub.due ? `Trial ends ${dayLabel(sub.due)}` : sub.paid_until ? `Paid until ${dayLabel(sub.paid_until)}` : "No payment recorded yet"}
          {sub.status === "overdue" && sub.suspend_on ? ` · access pauses on ${dayLabel(sub.suspend_on)}` : ""}
        </span>
      </div>
      <dl className="kv" style={{ marginTop: 12 }}>
        <dt>Active trucks</dt><dd>{sub.trucks}{sub.plates.length > 0 && <span className="sub mono"> · {sub.plates.join(", ")}</span>}</dd>
        <dt>Monthly fee</dt><dd className="num">TZS {tzs(sub.fee)} <span className="sub">· {sub.custom ? "agreed price" : feeWorking(sub, sub.trucks)}</span></dd>
        <dt>How to pay</dt><dd>{sub.instructions || "Contact Serengeti Labs."}</dd>
      </dl>
      <p className="note">You pay TZS {tzs(sub.truck_price)} a month for each truck that made a trip in Shehena in the last {ACTIVE_DAYS} days{sub.min_fee > 0 ? <>, with a minimum of TZS {tzs(sub.min_fee)}</> : null}. Trucks that sit idle aren&apos;t charged; hired trucks count while they carry your goods. The fee is worked out when you pay.</p>
      {sub.payments.length > 0 && (
        <div className="ledger" style={{ marginTop: 10 }}><table className="small" style={{ minWidth: 0 }}>
          <thead><tr><th>Paid</th><th>Period</th><th className="r">TZS</th><th /></tr></thead>
          <tbody>{sub.payments.map((p) => (
            <tr key={p.id}>
              <td>{dayLabel(p.paid_on)}<div className="sub">{[p.method, p.reference].filter(Boolean).join(" · ")}</div></td>
              <td>{dayLabel(p.period_from)} – {dayLabel(p.period_to)}<div className="sub">{p.months} month{p.months === 1 ? "" : "s"}</div></td>
              <td className="r num">{tzs(p.amount)}</td>
              <td className="r"><button className="btn sm" onClick={() => downloadSubscriptionReceipt(p, company.name, p.trucks != null ? planLabel(p.trucks) : undefined)}>Receipt</button></td>
            </tr>))}
          </tbody>
        </table></div>
      )}
    </fieldset>
  );
}

/** Head office and the towns the company delivers to (its branches). */
function OfficesForm() {
  const { company, patchCompany, toast, staff } = useStore();
  const [head, setHead] = useState(company.default_origin || "DAR");
  const [list, setList] = useState<string[]>(() => officesOf(company).filter((x) => x !== (company.default_origin || "DAR")));
  const [pick, setPick] = useState("");
  if (!("offices" in company)) return null;
  const name = (c: string) => REGIONS.find(([r]) => r === c)?.[1] || c;
  const staffAt = (c: string) => staff.filter((p) => p.role === "agent" && p.station === c && p.active).length;
  const changed = head !== company.default_origin || [head, ...list].join() !== officesOf(company).join();
  return (
    <fieldset><legend>Offices and routes</legend>
      <p className="sub" style={{ marginTop: 0 }}>Where you send goods from, and the towns you deliver to. These are your branches: branch staff are assigned to one, and they are listed first when receiving goods and loading trucks.</p>
      <div className="fields">
        <label className="f">Head office <small>where you send goods from</small>
          <select value={head} onChange={(e) => { const v = e.target.value; setHead(v); setList((L) => L.filter((x) => x !== v)); }} aria-label="Head office">{REGIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
        <label className="f">Add a town you deliver to
          <div style={{ display: "flex", gap: 6 }}>
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add office"><option value="">Choose…</option>{REGIONS.filter(([c]) => c !== head && !list.includes(c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
            <button type="button" className="btn sm" disabled={!pick} onClick={() => { setList((L) => [...L, pick]); setPick(""); }}>Add</button>
          </div></label>
      </div>
      <div className="officelist">
        <span className="office head">{name(head)} <small>head office{staffAt(head) ? ` · ${staffAt(head)} branch staff` : ""}</small></span>
        {list.map((c) => (
          <span className="office" key={c}>{name(c)}{staffAt(c) ? <small> · {staffAt(c)} branch staff</small> : null}
            <button type="button" onClick={() => setList((L) => L.filter((x) => x !== c))} aria-label={`Remove ${name(c)}`} title={staffAt(c) ? "Branch staff still work here" : "Remove"}>✕</button></span>
        ))}
        {!list.length && <span className="sub">No destinations yet. Add the towns you deliver to.</span>}
      </div>
      <div className="actions"><button className="btn primary" disabled={!changed} onClick={async () => {
        if (await patchCompany({ default_origin: head, offices: [head, ...list] })) toast("Offices saved");
      }}>Save offices</button></div>
    </fieldset>
  );
}

function CompanyForm() {
  const { company, patchCompany, toast } = useStore();
  const [f, setF] = useState({ name: company.name, branch: company.branch, phone: company.phone, default_origin: company.default_origin, message_lang: company.message_lang, payment_instructions: company.payment_instructions || "", found_goods_by: company.found_goods_by || "all" });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!f.name.trim()) return toast("Enter your company name.", true);
      // Before migration 0007 the column doesn't exist; only send it when it's in use.
      const extra = company.found_goods_by === undefined && f.found_goods_by === "all" ? { found_goods_by: undefined } : {};
      if (await patchCompany({ ...f, ...extra, name: f.name.trim(), branch: f.branch.trim(), phone: f.phone.trim(), payment_instructions: f.payment_instructions.trim() } as never)) toast("Company details saved");
    }}>
      <fieldset><legend>Company on receipts and messages</legend>
        <div className="fields">
          <label className="f full">Company name<input value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
          <label className="f">Branch<input value={f.branch} onChange={(e) => set("branch", e.target.value)} placeholder="e.g. Kariakoo, Dar es Salaam" /></label>
          <label className="f">Office phone<input value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" /></label>
          {!("offices" in company) && <label className="f">Default origin<select value={f.default_origin} onChange={(e) => set("default_origin", e.target.value)}>{REGIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>}
          <label className="f">Message language<select value={f.message_lang} onChange={(e) => set("message_lang", e.target.value)}><option value="sw">Kiswahili</option><option value="en">English</option></select></label>
          <label className="f full">Goods found on arrival <small>found on a truck but not recorded at loading</small>
            <select value={f.found_goods_by} onChange={(e) => set("found_goods_by", e.target.value)}>
              <option value="all">Admin and cashiers can record them (the Admin checks each one)</option>
              <option value="admin">Only the Admin can record them</option>
            </select></label>
          <label className="f full">How customers pay <small>sent to receivers who still owe money</small>
            <textarea rows={2} value={f.payment_instructions} onChange={(e) => set("payment_instructions", e.target.value)} placeholder="e.g. M-Pesa Lipa Namba 123456 (Kilimanjaro Express Cargo) au CRDB A/C 0150XXXXXXX" /></label>
        </div>
        <div className="actions"><button className="btn primary" type="submit">Save company details</button></div>
      </fieldset>
    </form>
  );
}

function StaffRow({ p }: { p: Profile }) {
  const { me, toast, reloadStaff, company } = useStore();
  const [pw, setPw] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<Role | null>(null);
  const [station, setStation] = useState<string>("");
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
        <div className="sub">{p.email}{p.role === "agent" && p.station ? ` · ${ROLES.agent}, ${REGIONS.find(([c]) => c === p.station)?.[1] || p.station}` : ""}{!p.active && " · Disabled"}</div>
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
            <select value={roleDraft ?? p.role} disabled={self || pending} onChange={(e) => {
              const r = e.target.value as Role;
              if (r === "agent") { setRoleDraft("agent"); setStation(p.station || ""); } else { setRoleDraft(null); run(() => setStaffRole(p.id, r)); }
            }} style={{ width: "auto" }} aria-label={`Role of ${p.full_name}`}>
              {(Object.keys(ROLES) as Role[]).map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
            </select>
            {(roleDraft === "agent" || p.role === "agent") && (
              <>
                <select value={station || p.station || ""} disabled={pending} onChange={(e) => setStation(e.target.value)} style={{ width: "auto" }} aria-label={`Office of ${p.full_name}`}>
                  <option value="">Office…</option><RegionOptions offices={officesOf(company)} onlyOffices />
                </select>
                {(roleDraft === "agent" || (station && station !== p.station)) && <button className="btn sm primary" disabled={pending || !(station || p.station)} onClick={() => run(() => setStaffRole(p.id, "agent", station || p.station))}>Save</button>}
              </>
            )}
            <button className="btn sm" onClick={() => setPw("")}>Set password</button>
            {!self && <button className={`btn sm${p.active ? " danger" : ""}`} disabled={pending} onClick={() => run(() => setStaffActive(p.id, !p.active))}>{p.active ? "Disable" : "Enable"}</button>}
          </>
        )}
      </div>
    </div>
  );
}

function AddStaff() {
  const { toast, reloadStaff, company } = useStore();
  const [f, setF] = useState({ full_name: "", email: "", role: "cashier" as Role, password: "", station: "" });
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return (
    <form noValidate style={{ marginTop: 14 }} onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await createStaff(f);
        if (r.error) return setErr(r.error);
        setErr(""); toast(r.ok || "Staff member added");
        setF({ full_name: "", email: "", role: "cashier", password: "", station: "" });
        await reloadStaff();
      });
    }}>
      <div className="lbl" style={{ marginBottom: 8 }}>Add a staff member</div>
      <div className="fields four">
        <label className="f">Full name<input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></label>
        <label className="f">Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" /></label>
        <label className="f">Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}><option value="cashier">Cashier</option><option value="agent">Branch staff (one office)</option><option value="admin">Admin</option><option value="ceo">CEO</option></select></label>
        <label className="f">Password <small>8+ characters</small><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></label>
        {f.role === "agent" && <label className="f">Office <small>where they work</small><select value={f.station} onChange={(e) => setF({ ...f, station: e.target.value })} aria-label="Branch office"><option value="">Choose…</option><RegionOptions offices={officesOf(company)} onlyOffices /></select></label>}
      </div>
      {f.role === "agent" && <p className="note" style={{ marginTop: 6 }}>Branch staff see only goods loaded to their office and goods they receive themselves. They receive goods at their office, load and dispatch trucks leaving it, mark trucks arriving, notify customers, take payment and release goods with a delivery note. They can also open monthly bill accounts and record claims for their office. They don&apos;t see reports or settings.</p>}
      <div className="err" role="alert">{err}</div>
      <div className="actions"><button className="btn primary" type="submit" disabled={pending}>{pending ? "Adding…" : "Add staff member"}</button></div>
      <p className="note">Give the person their email and password. They can change the password with &quot;Forgot password?&quot; on the sign-in page.</p>
    </form>
  );
}

type Rent = { ownership: "own" | "rental"; owner_name: string; owner_phone: string; rent_amount: string; rent_basis: "trip" | "month" };
const rentOf = (v?: Vehicle): Rent => ({ ownership: v?.ownership || "own", owner_name: v?.owner_name || "", owner_phone: v?.owner_phone || "", rent_amount: v?.rent_amount ? String(v.rent_amount) : "", rent_basis: v?.rent_basis || "trip" });
const rentValues = (r: Rent): Partial<Vehicle> => r.ownership === "own"
  ? { ownership: "own", owner_name: "", owner_phone: "", rent_amount: 0, rent_basis: "trip" }
  : { ownership: "rental", owner_name: r.owner_name.trim(), owner_phone: r.owner_phone.trim(), rent_amount: Number(r.rent_amount) || 0, rent_basis: r.rent_basis };
/** Own truck, or rented: owner and rent per trip or per month. */
function RentalFields({ r, set }: { r: Rent; set: (r: Rent) => void }) {
  return (
    <div className="fields four" style={{ marginTop: 8 }}>
      <label className="f">Truck is<select value={r.ownership} onChange={(e) => set({ ...r, ownership: e.target.value as Rent["ownership"] })} aria-label="Ownership"><option value="own">Our own truck</option><option value="rental">Rental (hired)</option></select></label>
      {r.ownership === "rental" && <>
        <label className="f">Owner<input value={r.owner_name} onChange={(e) => set({ ...r, owner_name: e.target.value })} aria-label="Truck owner" /></label>
        <label className="f">Owner phone<input value={r.owner_phone} onChange={(e) => set({ ...r, owner_phone: e.target.value })} inputMode="tel" /></label>
        <label className="f">Rent (TZS)
          <div style={{ display: "flex", gap: 6 }}>
            <input type="number" min={0} step={10000} value={r.rent_amount} onChange={(e) => set({ ...r, rent_amount: e.target.value })} aria-label="Rent amount" />
            <select value={r.rent_basis} onChange={(e) => set({ ...r, rent_basis: e.target.value as Rent["rent_basis"] })} style={{ width: "auto" }} aria-label="Rent basis"><option value="trip">per trip</option><option value="month">per month</option></select>
          </div></label>
      </>}
    </div>
  );
}

function VehicleRow({ v }: { v: Vehicle }) {
  const { patch, remove, me, toast, hasV9 } = useStore();
  const [f, setF] = useState({ driver: v.driver, driver_phone: v.driver_phone, target: String(v.target || "") });
  const [r, setR] = useState<Rent>(rentOf(v));
  const [confirm, setConfirm] = useState(false);
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <div className="mono" style={{ fontWeight: 600, marginBottom: 6 }}>{v.plate}{v.ownership === "rental" && <span className="tag-rental">Rental</span>}</div>
      <div className="fields four">
        <label className="f">Driver<input value={f.driver} onChange={(e) => setF({ ...f, driver: e.target.value })} /></label>
        <label className="f">Driver phone<input value={f.driver_phone} onChange={(e) => setF({ ...f, driver_phone: e.target.value })} inputMode="tel" /></label>
        <label className="f">Target per trip (TZS)<input type="number" min={0} step={10000} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
        <div style={{ display: "flex", gap: 6, alignItems: "end", flexWrap: "wrap" }}>
          <button className="btn sm primary" onClick={async () => {
            const tg = Number(f.target) || 0;
            const vals: Partial<Vehicle> = { driver: f.driver.trim(), driver_phone: f.driver_phone.trim(), target: tg, ...(hasV9 ? rentValues(r) : {}) };
            if (tg !== Number(v.target || 0)) { vals.target_set_by = me.full_name; vals.target_set_at = new Date().toISOString(); }
            if (await patch<Vehicle>("vehicles", v.id, vals)) toast(`${v.plate} saved`);
          }}>Save</button>
          {confirm
            ? <><button className="btn sm danger" onClick={() => remove("vehicles", v.id)}>Remove</button><button className="btn sm" onClick={() => setConfirm(false)}>Keep</button></>
            : <button className="btn sm danger" onClick={() => setConfirm(true)}>Remove</button>}
        </div>
      </div>
      {hasV9 && <RentalFields r={r} set={setR} />}
      {v.target_set_by && <div className="sub" style={{ marginTop: 4 }}>Target set by {v.target_set_by} · {fmtDay(v.target_set_at)}</div>}
    </div>
  );
}

function AddVehicle() {
  const { insert, me, toast, vehicles, hasV9 } = useStore();
  const [f, setF] = useState({ plate: "", driver: "", driver_phone: "", target: "" });
  const [r, setR] = useState<Rent>(rentOf());
  const [err, setErr] = useState("");
  return (
    <form noValidate style={{ marginTop: 14 }} onSubmit={async (e) => {
      e.preventDefault();
      const plate = f.plate.trim().toUpperCase();
      if (!plate) return setErr("Enter the plate number.");
      if (vehicles.some((v) => v.plate === plate)) return setErr(`${plate} is already saved.`);
      const tg = Number(f.target) || 0;
      const v = await insert<Vehicle>("vehicles", { plate, driver: f.driver.trim(), driver_phone: f.driver_phone.trim(), target: tg, target_set_by: tg ? me.full_name : null, target_set_at: tg ? new Date().toISOString() : null, ...(hasV9 ? rentValues(r) : {}) });
      if (v) { setErr(""); setF({ plate: "", driver: "", driver_phone: "", target: "" }); setR(rentOf()); toast(`${plate} added`); }
    }}>
      <div className="lbl" style={{ marginBottom: 8 }}>Add a vehicle</div>
      <div className="fields four">
        <label className="f">Plate number<input value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} placeholder="T 123 ABC" /></label>
        <label className="f">Driver<input value={f.driver} onChange={(e) => setF({ ...f, driver: e.target.value })} /></label>
        <label className="f">Driver phone<input value={f.driver_phone} onChange={(e) => setF({ ...f, driver_phone: e.target.value })} inputMode="tel" /></label>
        <label className="f">Target per trip (TZS)<input type="number" min={0} step={10000} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="e.g. 2000000" /></label>
      </div>
      {hasV9 && <RentalFields r={r} set={setR} />}
      <div className="err" role="alert">{err}</div>
      <div className="actions"><button className="btn primary" type="submit">Add vehicle</button></div>
    </form>
  );
}

type SettingsTab = "company" | "staff" | "vehicles" | "subscription";
export default function Settings({ sub, initialTab = "company" }: { sub?: Subscription | null; initialTab?: SettingsTab }) {
  const { staff, vehicles } = useStore();
  const [tab, setTab] = useState<SettingsTab>(sub || initialTab !== "subscription" ? initialTab : "company");
  const tabs: [SettingsTab, string][] = [
    ["company", "Company & offices"], ["staff", `Staff · ${staff.length}`], ["vehicles", `Vehicles · ${vehicles.length}`],
    ...(sub ? [["subscription", "Shehena subscription"] as [SettingsTab, string]] : []),
  ];
  return (
    <section className="settings">
      <div className="sectionhead"><div><h1>Settings</h1><div className="sub">Company details, offices, staff, vehicles and your Shehena subscription.</div></div></div>
      <nav className="tabs" role="tablist" style={{ marginBottom: 16 }}>{tabs.map(([k, l]) =>
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</nav>
      {tab === "company" && (
        <div className="settings-grid">
          <CompanyForm />
          <OfficesForm />
        </div>
      )}
      {tab === "staff" && (
        <fieldset><legend>Staff accounts</legend>
          <p className="sub" style={{ marginTop: 0 }}>Everyone signs in with their own email and password. Admins manage staff and settings; cashiers receive goods, take payments and load trucks; the CEO sees reports and sets targets; branch staff work at one office.</p>
          <div className="staff-list">{staff.map((p) => <StaffRow key={p.id + p.role + p.active + (p.station || "")} p={p} />)}</div>
          <AddStaff />
        </fieldset>
      )}
      {tab === "vehicles" && (
        <fieldset><legend>Vehicles</legend>
          <div className="vehicle-list">{vehicles.map((v) => <VehicleRow key={v.id + v.target} v={v} />)}</div>
          {!vehicles.length && <p className="sub">No vehicles saved yet.</p>}
          <AddVehicle />
        </fieldset>
      )}
      {tab === "subscription" && sub && <SubscriptionCard sub={sub} />}
    </section>
  );
}
