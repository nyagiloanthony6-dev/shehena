"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mark } from "./Icon";
import {
  addAgentLine, assignAgent, deleteAgentLine, deletePayout, recordPayout, saveAgent,
  createCompany, deletePayment, recordPayment, resetStaffPassword, savePricing, saveBillingSettings, setAccountBilling, setAnnouncement,
  setAutoStatus, setCompanyNotes, setCompanyStatus, setLeadStatus, setSignupOpen,
} from "@/app/owner/actions";
import {
  AGENT_DEFAULTS, KIND_LABEL, refSlug, type Agent, type Commission, type Payout,
  ACTIVE_DAYS, PAY_METHODS, dayLabel, feeFor, feeWorking, listFee, periodEnd, planLabel, statusFor, today, addDays,
  type BillingPayment, type BillingSettings,
} from "@/lib/billing";
import { downloadAgentStatement, downloadSubscriptionReceipt } from "./billingPdf";
import { signOut } from "@/app/login/actions";
import { ROLES, fmtDate, tzs, type Role } from "@/lib/domain";

type Status = "trial" | "active" | "overdue" | "suspended";
type Company = { id: string; name: string; branch: string; phone: string; created_at: string };
type Account = { company_id: string; status: Status; notes: string; status_changed_at: string; trial_ends: string | null; paid_until: string | null; custom_fee: number | null; auto_status: boolean; agent_id: number | string | null; agent_since: string | null };
type Stat = { company_id: string; staff: number; active_staff: number; vehicles: number; trips_month: number; ship_month: number; billed_month: number; paid_month: number; ship_total: number; last_activity: string | null };
type Staff = { id: string; company_id: string; full_name: string; email: string; role: Role; active: boolean; created_at: string };
type Lead = { id: number; created_at: string; name: string; company: string; phone: string; email: string; region: string; trucks: string; message: string; source: string; status: string };
type Audit = { id: number; at: string; owner_email: string; company_id: string | null; action: string; detail: Record<string, unknown> };
export interface OwnerData {
  me: string; hasCompany: boolean; error: string;
  companies: Company[]; accounts: Account[]; stats: Stat[]; staff: Staff[]; audit: Audit[]; leads: Lead[]; siteUrl: string;
  settings: { signup_open: boolean; announcement: string; announcement_updated_at: string | null } & BillingSettings;
  active: Record<string, string[]>; payments: BillingPayment[]; agents: Agent[]; commissions: Commission[]; payouts: Payout[];
}
type Bill = { plan: string; trucks: number; plates: string[]; working: string; fee: number; due: string | null; suspend_on: string | null; pays: BillingPayment[] };
type Row = Company & { acc: Account; st: Stat; admins: Staff[]; people: Staff[]; bill: Bill };
type Run = (fn: () => Promise<{ ok?: string; error?: string }>, after?: () => void) => void;

const STATUS_LABEL: Record<Status, string> = { trial: "Trial", active: "Active", overdue: "Overdue", suspended: "Suspended" };
const ACTIONS: Record<string, string> = {
  "company.create": "Created company", "company.status": "Changed status", "company.notes": "Updated notes",
  "staff.password_reset": "Reset a password", "signup.open": "Opened self sign-up", "signup.close": "Closed self sign-up",
  "announcement.set": "Posted announcement", "announcement.clear": "Removed announcement", "lead.status": "Updated a demo request",
  "billing.payment": "Recorded a payment", "billing.payment_removed": "Removed a payment", "billing.account": "Changed billing details",
  "billing.auto": "Switched to automatic status", "billing.bands": "Changed price bands", "billing.pricing": "Changed the price per truck", "billing.settings": "Changed billing settings",
  "agent.create": "Added a salesperson", "agent.update": "Updated a salesperson", "agent.assign": "Changed a client's salesperson",
  "agent.earned": "Commission earned", "agent.line": "Added allowance / adjustment", "agent.line_removed": "Removed allowance / adjustment",
  "agent.payout": "Paid a salesperson", "agent.payout_removed": "Removed a payout",
};
const daysAgo = (iso?: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null);
const ago = (iso?: string | null) => { const d = daysAgo(iso); return d === null ? "—" : d < 1 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`; };
function tempPassword() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const r = new Uint32Array(8); crypto.getRandomValues(r);
  return "Shehena-" + Array.from(r, (n) => a[n % a.length]).join("");
}
const StatusPill = ({ s }: { s: Status }) => <span className={`pill acc-${s}`}>{STATUS_LABEL[s]}</span>;
/** One line under the status: when it's paid to, when the trial ends, or since when it's overdue. */
function dueText(r: Row) {
  const a = r.acc;
  if (!a.auto_status) return "set by hand";
  if (!r.bill.due) return "no payment yet";
  if (a.status === "trial") return `trial to ${dayLabel(r.bill.due)}`;
  if (a.status === "active") return `paid to ${dayLabel(r.bill.due)}`;
  if (a.status === "overdue") return `due ${dayLabel(r.bill.due)}${r.bill.suspend_on ? ` · off ${dayLabel(r.bill.suspend_on)}` : ""}`;
  return `due since ${dayLabel(r.bill.due)}`;
}

export default function OwnerConsole({ data }: { data: OwnerData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<{ m: string; e?: boolean } | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"" | Status | "quiet">("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok?: string; error?: string }>, after?: () => void) => start(async () => {
    const r = await fn();
    setToast(r.error ? { m: r.error, e: true } : { m: r.ok || "Done" });
    setTimeout(() => setToast(null), r.error ? 5000 : 3000);
    if (!r.error) { after?.(); router.refresh(); }
  });

  const rows: Row[] = useMemo(() => data.companies.map((c) => {
    const people = data.staff.filter((s) => s.company_id === c.id);
    const acc: Account = data.accounts.find((a) => a.company_id === c.id) || { company_id: c.id, status: "active", notes: "", status_changed_at: c.created_at, trial_ends: null, paid_until: null, custom_fee: null, auto_status: true, agent_id: null, agent_since: null };
    const st = data.stats.find((s) => s.company_id === c.id) || { company_id: c.id, staff: people.length, active_staff: 0, vehicles: 0, trips_month: 0, ship_month: 0, billed_month: 0, paid_month: 0, ship_total: 0, last_activity: c.created_at };
    const { due, suspend_on } = statusFor(acc, data.settings);
    const plates = data.active[c.id] || [];
    return {
      ...c, acc, st,
      admins: people.filter((p) => p.role === "admin"),
      people,
      bill: { plan: planLabel(plates.length), trucks: plates.length, plates, working: feeWorking(data.settings, plates.length), fee: feeFor(acc, data.settings, plates.length), due, suspend_on: acc.auto_status ? suspend_on : null, pays: data.payments.filter((p) => p.company_id === c.id) },
    };
  }), [data]);
  const count = (s: Status) => rows.filter((r) => r.acc.status === s).length;
  const quiet = rows.filter((r) => r.acc.status !== "suspended" && (daysAgo(r.st.last_activity) ?? 0) >= 14);
  const ql = q.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (!filter || (filter === "quiet" ? quiet.includes(r) : r.acc.status === filter)) &&
    (!ql || [r.name, r.branch, r.phone, ...r.people.map((p) => p.email + " " + p.full_name)].join(" ").toLowerCase().includes(ql)));
  const open = rows.find((r) => r.id === openId) || null;
  const sum = (k: keyof Stat) => rows.reduce((a, r) => a + Number(r.st[k] || 0), 0);
  const month = today().slice(0, 7);
  const mrr = rows.filter((r) => r.acc.status === "active").reduce((a, r) => a + r.bill.fee, 0);
  const received = data.payments.filter((p) => p.paid_on.startsWith(month)).reduce((a, p) => a + p.amount, 0);
  const owed = rows.filter((r) => r.acc.status === "overdue").reduce((a, r) => a + r.bill.fee, 0);

  return (
    <div className="owner">
      <header className="otop">
        <div className="brandrow"><Mark /><div><div className="sys">Shehena</div><div className="otitle">Owner console</div></div></div>
        <div className="mtop-r" style={{ gap: 8 }}>
          <span className="sub" style={{ color: "var(--nav-muted)" }}>{data.me}</span>
          {data.hasCompany && <a className="btn sm" href="/app">My company</a>}
          <form action={signOut}><button className="btn sm" type="submit">Sign out</button></form>
        </div>
      </header>
      <main className="wrap">
        {data.error && <div className="banner">{data.error}</div>}
        <div className="sectionhead"><div><h1>Client companies</h1><div className="sub">Every cargo company using Shehena. Developed by Serengeti Labs.</div></div>
          <button className={`btn${adding ? "" : " primary"}`} onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Add a company"}</button></div>

        <div className="stats six">
          <div className="stat"><div className="lbl">Clients</div><div className="v">{rows.length}</div><div className="s">{sum("active_staff")} active staff</div></div>
          <div className="stat"><div className="lbl">Active</div><div className="v">{count("active")}</div><div className="s">{count("trial")} on trial</div></div>
          <div className={`stat${count("overdue") ? " warn" : ""}`}><div className="lbl">Overdue</div><div className="v">{count("overdue")}</div><div className="s">{owed ? `TZS ${tzs(owed)} a month due` : "need to pay"}</div></div>
          <div className="stat"><div className="lbl">Suspended</div><div className="v">{count("suspended")}</div><div className="s">no access</div></div>
          <div className="stat"><div className="lbl">Monthly revenue</div><div className="v">{tzs(mrr)}</div><div className="s">TZS a month, paying clients</div></div>
          <div className="stat"><div className="lbl">Received this month</div><div className="v">{tzs(received)}</div><div className="s">TZS · {sum("ship_month")} consignments by clients</div></div>
        </div>

        {adding && <AddCompany agents={data.agents} busy={pending} onSubmit={(v) => run(() => createCompany(v), () => setAdding(false))} />}

        <div className="rgrid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)" }}>
          <div className="panel">
            <h2>New company sign-up</h2>
            <p className="sub" style={{ marginTop: 4 }}>{data.settings.signup_open
              ? "Open: anyone can register a company from the sign-in page."
              : "Closed: only you can add companies, from this console."}</p>
            <div className="actions">
              <button className={`btn${data.settings.signup_open ? "" : " primary"}`} disabled={pending} onClick={() => run(() => setSignupOpen(!data.settings.signup_open))}>
                {data.settings.signup_open ? "Close self sign-up" : "Open self sign-up"}</button>
            </div>
          </div>
          <Announcement current={data.settings.announcement} updated={data.settings.announcement_updated_at} busy={pending} onSave={(t) => run(() => setAnnouncement(t))} />
        </div>

        <Pricing settings={data.settings} rows={rows} busy={pending} run={run} />

        <div className="filters" style={{ marginTop: 22 }}>
          <div className="chips">
            {([["", `All · ${rows.length}`], ["active", `Active · ${count("active")}`], ["trial", `Trial · ${count("trial")}`], ["overdue", `Overdue · ${count("overdue")}`], ["suspended", `Suspended · ${count("suspended")}`], ["quiet", `Quiet 14+ days · ${quiet.length}`]] as [typeof filter, string][])
              .map(([k, l]) => <button key={k || "all"} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
          </div>
          <div className="searchbox" style={{ flex: "1 1 220px" }}><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company, staff name or email" aria-label="Search companies" style={{ paddingLeft: 11 }} /></div>
        </div>
        <div className="ledger" style={{ marginTop: 12 }}><table>
          <thead><tr><th>Company</th><th>Admin</th><th className="r">Staff</th><th className="r">Trucks <span className="sub">saved · active</span></th><th className="r">This month</th><th>Last activity</th><th className="r">Plan</th><th>Status</th></tr></thead>
          <tbody>
            {shown.map((r) => {
              const d = daysAgo(r.st.last_activity) ?? 0;
              return (
                <tr key={r.id} className="row" tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(r.id)}>
                  <td><b>{r.name}</b><div className="sub">{[r.branch, r.phone].filter(Boolean).join(" · ") || "No branch set"} · joined {fmtDate(r.created_at).slice(0, 11)}</div></td>
                  <td>{r.admins[0] ? <>{r.admins[0].full_name}<div className="sub">{r.admins[0].email}</div></> : <span className="sub">No admin</span>}</td>
                  <td className="r num">{r.st.active_staff}<span className="sub">/{r.st.staff}</span></td>
                  <td className="r num">{r.st.vehicles} · <b>{r.bill.trucks}</b></td>
                  <td className="r num">{r.st.ship_month} cons.<div className="sub">TZS {tzs(r.st.billed_month)}</div></td>
                  <td><span style={d >= 14 && r.acc.status !== "suspended" ? { color: "var(--bad)", fontWeight: 600 } : undefined}>{ago(r.st.last_activity)}</span></td>
                  <td className="r num">{tzs(r.bill.fee)}<div className="sub">{r.acc.custom_fee != null ? "custom fee" : r.bill.plan}</div></td>
                  <td><StatusPill s={r.acc.status} /><div className="sub">{dueText(r)}</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
          {!rows.length && <div className="empty"><h3>No client companies yet</h3><p>Add your first company, or open self sign-up so companies can register.</p></div>}
          {rows.length > 0 && !shown.length && <div className="empty"><p>No companies match.</p></div>}
        </div>

        <SalesTeam data={data} rows={rows} busy={pending} run={run} open={(id) => setAgentId(id)} />

        <Leads leads={data.leads} agents={data.agents} siteUrl={data.siteUrl} busy={pending} run={run} />

        <div className="panel" style={{ marginTop: 22 }}>
          <h2>Owner activity</h2><div className="sub">Everything done from this console, newest first.</div>
          <AuditList items={data.audit} companies={data.companies} />
        </div>
        <div className="mcredit" style={{ display: "block" }}>Shehena · Developed by <b>Serengeti Labs</b></div>
      </main>

      {open && (
        <>
          <div className="scrim" onClick={() => setOpenId(null)} />
          <aside className="sheet" aria-label={open.name}>
            <CompanySheet key={open.id} r={open} agents={data.agents} settings={data.settings} audit={data.audit.filter((a) => a.company_id === open.id)} busy={pending} run={run} close={() => setOpenId(null)} />
          </aside>
        </>
      )}
      {agentId && (() => {
        const a = data.agents.find((x) => String(x.id) === agentId);
        return a ? (
          <>
            <div className="scrim" onClick={() => setAgentId(null)} />
            <aside className="sheet" aria-label={a.name}>
              <AgentSheet key={agentId} a={a} data={data} rows={rows} busy={pending} run={run} close={() => setAgentId(null)} />
            </aside>
          </>
        ) : null;
      })()}
      {toast && <div className={`toast${toast.e ? " err" : ""}`} role="status">{toast.m}</div>}
    </div>
  );
}

function AddCompany({ agents, busy, onSubmit }: { agents: Agent[]; busy: boolean; onSubmit: (v: Parameters<typeof createCompany>[0]) => void }) {
  const [f, setF] = useState({ name: "", branch: "", phone: "", admin_name: "", admin_email: "", password: tempPassword(), status: "trial" as Status, agent_id: "" });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(f); }} style={{ marginTop: 16 }}>
      <fieldset><legend>Add a company</legend>
        <div className="fields four">
          <label className="f">Company name<input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Mwanza Express Cargo" /></label>
          <label className="f">Branch <small>optional</small><input value={f.branch} onChange={(e) => set("branch", e.target.value)} /></label>
          <label className="f">Office phone <small>optional</small><input value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" /></label>
          <label className="f">Start as<select value={f.status} onChange={(e) => set("status", e.target.value)}><option value="trial">Trial</option><option value="active">Active</option></select></label>
          <label className="f">Admin&apos;s full name<input value={f.admin_name} onChange={(e) => set("admin_name", e.target.value)} /></label>
          <label className="f">Admin&apos;s email<input type="email" value={f.admin_email} onChange={(e) => set("admin_email", e.target.value)} autoComplete="off" /></label>
          <label className="f">Temporary password<input value={f.password} onChange={(e) => set("password", e.target.value)} autoComplete="off" /></label>
          <label className="f">Brought in by<select value={f.agent_id} onChange={(e) => set("agent_id", e.target.value)}><option value="">No salesperson</option>{agents.filter((a) => a.active).map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}</select></label>
          <div style={{ display: "flex", alignItems: "end" }}><button className="btn primary" type="submit" disabled={busy} style={{ width: "100%" }}>{busy ? "Creating…" : "Create company"}</button></div>
        </div>
        <p className="note">Give the Admin their email and this temporary password. They can change it with &quot;Forgot password?&quot;, then add their own staff.</p>
      </fieldset>
    </form>
  );
}

function Announcement({ current, updated, busy, onSave }: { current: string; updated: string | null; busy: boolean; onSave: (t: string) => void }) {
  const [t, setT] = useState(current);
  return (
    <div className="panel">
      <h2>Announcement to all clients</h2>
      <p className="sub" style={{ marginTop: 4 }}>Shown at the top of every client&apos;s screen{current && updated ? ` · posted ${ago(updated).toLowerCase()}` : ""}.</p>
      <textarea rows={2} value={t} onChange={(e) => setT(e.target.value)} maxLength={500} placeholder="e.g. Mfumo utafanyiwa matengenezo Jumapili saa 4 usiku. / Maintenance on Sunday 10pm." style={{ marginTop: 8 }} />
      <div className="actions">
        <button className="btn primary" disabled={busy || t.trim() === current} onClick={() => onSave(t)}>Post announcement</button>
        {current && <button className="btn" disabled={busy} onClick={() => { setT(""); onSave(""); }}>Remove</button>}
      </div>
    </div>
  );
}

function AuditList({ items, companies }: { items: Audit[]; companies: Company[] }) {
  if (!items.length) return <p className="quiet">Nothing yet.</p>;
  return (
    <div style={{ marginTop: 8 }}>
      {items.map((a) => {
        const c = companies.find((x) => x.id === a.company_id);
        const d = a.detail || {};
        const extra = a.action === "company.status" ? `${String(d.from)} → ${String(d.to)}` : a.action === "staff.password_reset" ? String(d.email || "") : a.action === "announcement.set" ? `“${String(d.text || "").slice(0, 60)}”` : "";
        return (
          <div className="lrow" key={a.id}>
            <div><b>{ACTIONS[a.action] || a.action}</b>{c ? <> · {c.name}</> : null}{extra ? <span className="sub"> · {extra}</span> : null}<div className="sub">{a.owner_email}</div></div>
            <span className="sub" style={{ whiteSpace: "nowrap" }}>{fmtDate(a.at)}</span>
          </div>
        );
      })}
    </div>
  );
}

function CompanySheet({ r, agents, settings, audit, busy, run, close }: {
  r: Row; agents: Agent[]; settings: BillingSettings; audit: Audit[]; busy: boolean; close: () => void; run: Run;
}) {
  const [notes, setNotes] = useState(r.acc.notes || "");
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  return (
    <>
      <div className="sheet-h">
        <div><div className="lbl">Client company</div><h2>{r.name}</h2><div className="sub">{[r.branch, r.phone].filter(Boolean).join(" · ")}</div></div>
        <button className="btn sm" onClick={close}>Close</button>
      </div>

      <Billing r={r} agents={agents} settings={settings} busy={busy} run={run} />

      <div className="card"><h3>Account status</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <StatusPill s={r.acc.status} /><span className="sub">since {fmtDate(r.acc.status_changed_at)} · {r.acc.auto_status ? "automatic, from payments" : "set by hand"}</span>
          {!r.acc.auto_status && <button className="btn sm" disabled={busy} onClick={() => run(() => setAutoStatus(r.id))}>Make automatic</button>}
        </div>
        <div className="actions">
          {(["trial", "active", "overdue"] as Status[]).filter((s) => s !== r.acc.status).map((s) => (
            <button key={s} className="btn sm" disabled={busy} onClick={() => run(() => setCompanyStatus(r.id, s))}>Mark {STATUS_LABEL[s].toLowerCase()}</button>
          ))}
          {r.acc.status === "suspended" ? (
            <button className="btn sm primary" disabled={busy} onClick={() => run(() => setCompanyStatus(r.id, "active"))}>Reactivate</button>
          ) : confirmSuspend ? (
            <div className="confirm" style={{ width: "100%" }}>Suspend {r.name}? Their staff lose access until you reactivate. No data is deleted.
              <button className="btn sm danger" disabled={busy} onClick={() => { setConfirmSuspend(false); run(() => setCompanyStatus(r.id, "suspended")); }}>Suspend</button>
              <button className="btn sm" onClick={() => setConfirmSuspend(false)}>Cancel</button>
            </div>
          ) : <button className="btn sm danger" onClick={() => setConfirmSuspend(true)}>Suspend</button>}
        </div>
        <p className="note">Overdue warns the client&apos;s Admin and CEO. Suspended blocks all access for that company&apos;s staff. Changing the status by hand turns automatic status off until you record a payment or press &quot;Make automatic&quot;.</p>
      </div>

      <div className="card"><h3>This month</h3>
        <dl className="kv">
          <dt>Consignments</dt><dd className="num">{r.st.ship_month} <span className="sub">({r.st.ship_total} all time)</span></dd>
          <dt>Billed</dt><dd className="num">TZS {tzs(r.st.billed_month)}</dd>
          <dt>Collected</dt><dd className="num">TZS {tzs(r.st.paid_month)}</dd>
          <dt>Trips</dt><dd className="num">{r.st.trips_month}</dd>
          <dt>Trucks</dt><dd className="num">{r.st.vehicles}</dd>
          <dt>Last activity</dt><dd>{ago(r.st.last_activity)}</dd>
          <dt>Joined</dt><dd>{fmtDate(r.created_at)}</dd>
        </dl>
      </div>

      <div className="card"><h3>Staff · {r.people.length}</h3>
        {r.people.map((p) => (
          <div className="lrow" key={p.id} style={{ flexWrap: "wrap" }}>
            <div><b>{p.full_name}</b> <span className="role" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{ROLES[p.role]}</span>
              <div className="sub">{p.email}{!p.active && " · Disabled"}</div></div>
            {pwFor === p.id ? (
              <div className="pwrow">
                <input value={pw} onChange={(e) => setPw(e.target.value)} style={{ width: 190 }} aria-label={`Temporary password for ${p.full_name}`} />
                <button className="btn sm primary" disabled={busy} onClick={() => run(() => resetStaffPassword(p.id, pw), () => setPwFor(null))}>Set</button>
                <button className="btn sm" onClick={() => setPwFor(null)}>Cancel</button>
              </div>
            ) : <button className="btn sm" onClick={() => { setPw(tempPassword()); setPwFor(p.id); }}>Reset password</button>}
          </div>
        ))}
        {!r.people.length && <p className="sub">No staff.</p>}
        <p className="note">Use this when a company&apos;s Admin is locked out. Tell them the temporary password by phone; they can change it after signing in.</p>
      </div>

      <div className="card"><h3>Private notes</h3>
        <p className="sub" style={{ marginTop: 0 }}>Only Serengeti Labs sees these: contract terms, contact person, payment arrangements.</p>
        <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="actions"><button className="btn sm primary" disabled={busy || notes === (r.acc.notes || "")} onClick={() => run(() => setCompanyNotes(r.id, notes))}>Save notes</button></div>
      </div>

      <div className="card"><h3>History</h3>
        <AuditList items={audit} companies={[r]} />
      </div>
    </>
  );
}

const LEAD_LABEL: Record<string, string> = { new: "New", contacted: "Contacted", demo: "Demo done", won: "Won", lost: "Lost" };
function Leads({ leads, agents, siteUrl, busy, run }: {
  leads: Lead[]; agents: Agent[]; siteUrl: string; busy: boolean;
  run: (fn: () => Promise<{ ok?: string; error?: string }>, after?: () => void) => void;
}) {
  const [ref, setRef] = useState("whatsapp");
  const [show, setShow] = useState<"open" | "all">("open");
  const [copied, setCopied] = useState(false);
  const slug = ref.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  const link = `${siteUrl.replace(/\/$/, "")}/${slug ? `?ref=${slug}` : ""}`;
  const sources = Object.entries(leads.reduce<Record<string, { n: number; won: number }>>((a, l) => {
    const k = l.source || "direct"; a[k] = a[k] || { n: 0, won: 0 }; a[k].n++; if (l.status === "won") a[k].won++; return a;
  }, {})).sort((a, b) => b[1].n - a[1].n);
  const list = leads.filter((l) => show === "all" || !["won", "lost"].includes(l.status));
  const newN = leads.filter((l) => l.status === "new").length;
  const intl = (p: string) => { let d = p.replace(/\D/g, ""); if (d.startsWith("0")) d = "255" + d.slice(1); return d; };
  return (
    <div className="rgrid" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)", marginTop: 22 }}>
      <div className="panel">
        <div className="ph" style={{ flexWrap: "wrap" }}>
          <div><h2>Demo requests {newN > 0 && <span className="nbadge" style={{ marginLeft: 6 }}>{newN} new</span>}</h2><div className="sub">Earlier requests from the old marketing page (now removed).</div></div>
          <div className="chips">
            <button className="chip" aria-pressed={show === "open"} onClick={() => setShow("open")}>Open</button>
            <button className="chip" aria-pressed={show === "all"} onClick={() => setShow("all")}>All · {leads.length}</button>
          </div>
        </div>
        {list.map((l) => (
          <div className="nrow" key={l.id} style={{ alignItems: "start" }}>
            <div style={{ minWidth: 0 }}>
              <b>{l.name}</b>{l.company && <> · {l.company}</>}
              <div className="sub"><span className="mono">{l.phone}</span>{l.email && <> · {l.email}</>}{l.region && <> · {l.region}</>}{l.trucks && <> · {l.trucks} trucks</>}</div>
              {l.message && <div className="sub" style={{ marginTop: 3 }}>&ldquo;{l.message}&rdquo;</div>}
              <div className="sub" style={{ marginTop: 3 }}>{fmtDate(l.created_at)} · from <b>{l.source || "direct"}</b>{(() => { const a = agents.find((x) => x.ref_code === (l.source || "").toLowerCase()); return a ? <> · salesperson <b>{a.name}</b></> : null; })()}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "end" }}>
              <div className="actions" style={{ margin: 0 }}>
                <a className="btn sm" href={`tel:+${intl(l.phone)}`}>Call</a>
                <a className="btn wa sm" href={`https://wa.me/${intl(l.phone)}?text=${encodeURIComponent(`Habari ${l.name}, asante kwa kuomba maonyesho ya Shehena. Ni lini tunaweza kukutembelea au kukupigia?`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
              </div>
              <select value={l.status} disabled={busy} onChange={(e) => run(() => setLeadStatus(l.id, e.target.value))} style={{ width: "auto" }} aria-label={`Status of ${l.name}`}>
                {Object.entries(LEAD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
        ))}
        {!list.length && <p className="quiet">{leads.length ? "No open requests." : "No requests."}</p>}
      </div>
      <div className="panel">
        <h2>Sign-up links</h2>
        <p className="sub" style={{ marginTop: 4 }}>Each link opens the sign-in page. If the code belongs to a salesperson, a company that registers after opening it is credited to them.</p>
        <label className="f" style={{ marginTop: 10 }}>Where will you share it?
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="facebook, flyer-kariakoo, radio…" /></label>
        <div className="msg mono" style={{ marginTop: 8, fontSize: 13 }}>{link}</div>
        <div className="actions">
          <button className="btn sm primary" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select manually */ } }}>{copied ? "Copied" : "Copy link"}</button>
          <a className="btn sm" href={link} target="_blank" rel="noopener noreferrer">Open page</a>
        </div>
        <div className="chips" style={{ marginTop: 10 }}>
          {["whatsapp", "facebook", "instagram", "flyer", "referral"].map((x) => <button key={x} className="chip" aria-pressed={slug === x} onClick={() => setRef(x)}>{x}</button>)}
        </div>
        {sources.length > 0 && (
          <div className="ledger" style={{ marginTop: 12, border: 0 }}><table className="small" style={{ minWidth: 0 }}>
            <thead><tr><th>Source</th><th className="r">Requests</th><th className="r">Won</th></tr></thead>
            <tbody>{sources.map(([k, v]) => <tr key={k}><td>{k}</td><td className="r num">{v.n}</td><td className="r num">{v.won}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

// ---------------- billing

const num = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(/,/g, "")));

function Billing({ r, agents, settings, busy, run }: { r: Row; agents: Agent[]; settings: BillingSettings; busy: boolean; run: Run }) {
  const a = r.acc;
  // A new payment starts the day after the current paid-until date, or today if there is none / it lapsed long ago.
  const start = a.paid_until && a.paid_until >= addDays(today(), -settings.grace_days - 31) ? addDays(a.paid_until, 1) : today();
  const [pay, setPay] = useState({ months: "1", amount: String(r.bill.fee || ""), setup: "", from: start, method: PAY_METHODS[0], reference: "", paid_on: today() });
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ custom_fee: a.custom_fee == null ? "" : String(a.custom_fee), trial_ends: a.trial_ends || "", paid_until: a.paid_until || "" });
  const [undo, setUndo] = useState<string | number | null>(null);
  const months = Math.max(1, Math.round(num(pay.months) || 1));
  const setMonths = (m: string) => setPay((p) => ({ ...p, months: m, amount: String((r.bill.fee || 0) * Math.max(1, Math.round(num(m) || 1)) || "") }));
  return (
    <div className="card"><h3>Subscription</h3>
      <dl className="kv">
        <dt>Active trucks</dt><dd>{r.bill.trucks} <span className="sub">made trips in the last {ACTIVE_DAYS} days{r.bill.plates.length ? `: ${r.bill.plates.join(", ")}` : ""}</span></dd>
        <dt>Monthly fee</dt><dd className="num">TZS {tzs(r.bill.fee)} <span className="sub">· {a.custom_fee != null ? `custom (price list: TZS ${tzs(listFee(settings, r.bill.trucks))})` : r.bill.working}</span></dd>
        {a.trial_ends && <><dt>Trial ends</dt><dd>{dayLabel(a.trial_ends)}</dd></>}
        <dt>Paid until</dt><dd>{a.paid_until ? dayLabel(a.paid_until) : <span className="sub">No payment recorded</span>}</dd>
        {r.bill.suspend_on && a.status !== "suspended" && <><dt>Suspends on</dt><dd>{dayLabel(r.bill.suspend_on)} <span className="sub">if unpaid</span></dd></>}
        <dt>Brought in by</dt><dd>
          <select value={a.agent_id == null ? "" : String(a.agent_id)} disabled={busy} onChange={(e) => run(() => assignAgent(r.id, e.target.value || null))} aria-label="Salesperson" style={{ width: "auto", maxWidth: "100%" }}>
            <option value="">No salesperson</option>
            {agents.filter((x) => x.active || String(x.id) === String(a.agent_id)).map((x) => <option key={x.id} value={String(x.id)}>{x.name}</option>)}
          </select>
          {a.agent_since && <span className="sub"> since {dayLabel(a.agent_since)}</span>}
        </dd>
      </dl>

      <form noValidate onSubmit={(e) => { e.preventDefault(); run(() => recordPayment({ companyId: r.id, months, amount: num(pay.amount), setup_fee: num(pay.setup) || 0, from: pay.from, method: pay.method, reference: pay.reference, paid_on: pay.paid_on }), () => setPay((p) => ({ ...p, reference: "" }))); }}
        className="paybox">
        <div className="lbl" style={{ marginBottom: 8 }}>Record a payment</div>
        <div className="fields">
          <label className="f">Months<select value={pay.months} onChange={(e) => setMonths(e.target.value)} aria-label="Months paid">
            {[1, 2, 3, 6, 12].map((m) => <option key={m} value={m}>{m} month{m === 1 ? "" : "s"}</option>)}</select></label>
          <label className="f">Amount received (TZS)<input inputMode="numeric" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} aria-label="Amount received" /></label>
          <label className="f">Covers from<input type="date" value={pay.from} onChange={(e) => setPay({ ...pay, from: e.target.value })} aria-label="Covers from" /></label>
          <label className="f">Date paid<input type="date" value={pay.paid_on} onChange={(e) => setPay({ ...pay, paid_on: e.target.value })} /></label>
          <label className="f">Paid by<select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="f">Of which setup fee <small>optional</small><input inputMode="numeric" value={pay.setup} onChange={(e) => { const s = e.target.value; setPay((p) => ({ ...p, setup: s, amount: String((r.bill.fee || 0) * months + (num(s) || 0)) })); }} placeholder="0" aria-label="Setup fee included" /></label>
          <label className="f">Reference <small>optional</small><input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="e.g. M-Pesa code" aria-label="Payment reference" /></label>
        </div>
        <p className="note" style={{ margin: "8px 0 0" }}>Covers {dayLabel(pay.from)} to <b>{pay.from ? dayLabel(periodEnd(pay.from, months)) : "—"}</b>. Fee × months = TZS {tzs((r.bill.fee || 0) * months)}{num(pay.setup) > 0 ? ` + setup ${tzs(num(pay.setup))}` : ""}; change the amount for a discount.</p>
        <div className="actions"><button className="btn primary sm" type="submit" disabled={busy}>Record payment</button></div>
      </form>

      {r.bill.pays.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="lbl">Payments</div>
          {r.bill.pays.map((p) => (
            <div className="lrow" key={p.id} style={{ flexWrap: "wrap" }}>
              <div><b className="num">TZS {tzs(p.amount)}</b>{p.setup_fee ? <span className="sub"> (incl. setup {tzs(p.setup_fee)})</span> : null} <span className="sub">· {p.trucks != null ? `${planLabel(p.trucks)} · ` : ""}{p.months} mo · {dayLabel(p.period_from)} – {dayLabel(p.period_to)}</span>
                <div className="sub">Paid {dayLabel(p.paid_on)}{p.method && ` · ${p.method}`}{p.reference && ` · ${p.reference}`} · by {p.recorded_by}</div></div>
              {undo === p.id ? (
                <div className="confirm">Remove this payment? Paid-until goes back.
                  <button className="btn sm danger" disabled={busy} onClick={() => { setUndo(null); run(() => deletePayment(p.id)); }}>Remove</button>
                  <button className="btn sm" onClick={() => setUndo(null)}>Cancel</button></div>
              ) : (
                <div className="actions" style={{ margin: 0 }}>
                  <button className="btn sm" onClick={() => downloadSubscriptionReceipt(p, r.name, p.trucks != null ? planLabel(p.trucks) : undefined)}>Receipt</button>
                  <button className="btn sm" onClick={() => setUndo(p.id)} aria-label="Remove payment">Remove</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {edit ? (
        <form noValidate className="paybox" onSubmit={(e) => {
          e.preventDefault();
          const cf = f.custom_fee.trim() === "" ? null : num(f.custom_fee);
          run(() => setAccountBilling(r.id, { custom_fee: cf, trial_ends: f.trial_ends || null, paid_until: f.paid_until || null }), () => setEdit(false));
        }}>
          <div className="fields">
            <label className="f">Custom monthly fee <small>blank = price per truck</small><input inputMode="numeric" value={f.custom_fee} onChange={(e) => setF({ ...f, custom_fee: e.target.value })} placeholder={`Price list: TZS ${tzs(listFee(settings, r.bill.trucks))}`} /></label>
            <label className="f">Trial ends<input type="date" value={f.trial_ends} onChange={(e) => setF({ ...f, trial_ends: e.target.value })} /></label>
            <label className="f">Paid until <small>correct by hand</small><input type="date" value={f.paid_until} onChange={(e) => setF({ ...f, paid_until: e.target.value })} /></label>
          </div>
          <div className="actions"><button className="btn sm primary" type="submit" disabled={busy}>Save</button><button className="btn sm" type="button" onClick={() => setEdit(false)}>Cancel</button></div>
        </form>
      ) : <div className="actions"><button className="btn sm" onClick={() => setEdit(true)}>Change fee or dates</button>
        {!a.paid_until && <button className="btn sm" disabled={busy} onClick={() => run(() => setAccountBilling(r.id, { custom_fee: a.custom_fee, trial_ends: addDays(today(), settings.trial_days), paid_until: a.paid_until }))}>Give a {settings.trial_days}-day trial</button>}
      </div>}
    </div>
  );
}

function Pricing({ settings, rows, busy, run }: { settings: OwnerData["settings"]; rows: Row[]; busy: boolean; run: Run }) {
  const [p, setP] = useState({ truck_price: String(settings.truck_price), min_fee: String(settings.min_fee) });
  const [s, setS] = useState({ trial_days: String(settings.trial_days), grace_days: String(settings.grace_days), auto_suspend: settings.auto_suspend, billing_instructions: settings.billing_instructions });
  const draft = { truck_price: num(p.truck_price) || 0, min_fee: num(p.min_fee) || 0 };
  const listed = rows.filter((r) => r.acc.custom_fee == null);
  const examples = [1, 2, 3, 5, 10];
  return (
    <div className="rgrid" style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", marginTop: 16 }}>
      <form className="panel" noValidate onSubmit={(e) => { e.preventDefault(); run(() => savePricing(draft)); }}>
        <h2>Price per truck</h2>
        <p className="sub" style={{ marginTop: 4 }}>Clients pay for each truck that made a trip in Shehena in the last {ACTIVE_DAYS} days: every plate loaded, saved under Vehicles or hired for one trip. Never less than the minimum. Changes apply to the next payment you record.</p>
        <div className="fields" style={{ marginTop: 8 }}>
          <label className="f">Price per active truck (TZS a month)<input inputMode="numeric" value={p.truck_price} onChange={(e) => setP({ ...p, truck_price: e.target.value })} aria-label="Price per truck" /></label>
          <label className="f">Minimum monthly fee (TZS)<input inputMode="numeric" value={p.min_fee} onChange={(e) => setP({ ...p, min_fee: e.target.value })} aria-label="Minimum monthly fee" /></label>
        </div>
        <div className="ledger" style={{ border: 0, marginTop: 8 }}><table className="small" style={{ minWidth: 0 }}>
          <thead><tr><th>Active trucks</th>{examples.map((n) => <th key={n} className="r">{n}</th>)}</tr></thead>
          <tbody><tr><td>TZS a month</td>{examples.map((n) => <td key={n} className="r num">{tzs(listFee(draft, n))}</td>)}</tr></tbody>
        </table></div>
        <div className="actions"><button className="btn sm primary" type="submit" disabled={busy}>Save price</button></div>
        <p className="note">At this price, clients on the price list would pay TZS {tzs(listed.reduce((a, r) => a + listFee(draft, r.bill.trucks), 0))} a month in total ({listed.reduce((a, r) => a + r.bill.trucks, 0)} active trucks). Clients with a custom fee keep it.</p>
      </form>
      <form className="panel" noValidate onSubmit={(e) => { e.preventDefault(); run(() => saveBillingSettings({ trial_days: num(s.trial_days), grace_days: num(s.grace_days), auto_suspend: s.auto_suspend, billing_instructions: s.billing_instructions })); }}>
        <h2>Billing rules</h2>
        <div className="fields" style={{ marginTop: 8 }}>
          <label className="f">Free trial (days)<input inputMode="numeric" value={s.trial_days} onChange={(e) => setS({ ...s, trial_days: e.target.value })} /></label>
          <label className="f">Grace after due date (days)<input inputMode="numeric" value={s.grace_days} onChange={(e) => setS({ ...s, grace_days: e.target.value })} /></label>
          <label className="f full check"><input type="checkbox" checked={s.auto_suspend} onChange={(e) => setS({ ...s, auto_suspend: e.target.checked })} /> Suspend automatically when the grace days run out</label>
          <label className="f full">How clients pay you <small>shown to their Admin and CEO</small>
            <textarea rows={2} value={s.billing_instructions} onChange={(e) => setS({ ...s, billing_instructions: e.target.value })} placeholder="e.g. M-Pesa Lipa Namba 123456 (Serengeti Labs) or CRDB A/C 0150XXXXXXX. Send the code on WhatsApp 0712 000 000." /></label>
        </div>
        <div className="actions"><button className="btn sm primary" type="submit" disabled={busy}>Save billing rules</button></div>
        <p className="note">Clients see a reminder 5 days before the due date, then an overdue warning with the suspension date.</p>
      </form>
    </div>
  );
}

// ---------------- sales team

const agentOwed = (data: OwnerData, id: number | string) => data.commissions.filter((c) => String(c.agent_id) === String(id) && c.payout_id == null).reduce((a, c) => a + c.amount, 0);

function SalesTeam({ data, rows, busy, run, open }: { data: OwnerData; rows: Row[]; busy: boolean; run: Run; open: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const month = today().slice(0, 7);
  const owedAll = data.agents.reduce((a, x) => a + agentOwed(data, x.id), 0);
  return (
    <div className="panel" style={{ marginTop: 22 }}>
      <div className="ph" style={{ flexWrap: "wrap" }}>
        <div><h2>Sales team</h2><div className="sub">Each salesperson gets their own link. Clients they bring earn them a signing bonus and commission on payments. {owedAll > 0 && <b>Owed now: TZS {tzs(owedAll)}</b>}</div></div>
        <button className={`btn sm${adding ? "" : " primary"}`} onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Add salesperson"}</button>
      </div>
      {adding && <AgentForm busy={busy} onSave={(v) => run(() => saveAgent(null, v), () => setAdding(false))} />}
      {data.agents.length ? (
        <div className="ledger" style={{ border: 0, marginTop: 8 }}><table className="small" style={{ minWidth: 0 }}>
          <thead><tr><th>Salesperson</th><th className="r">Demo requests</th><th className="r">Clients</th><th className="r">Paying</th><th className="r">Earned this month</th><th className="r">Owed</th></tr></thead>
          <tbody>{data.agents.map((a) => {
            const mine = rows.filter((r) => String(r.acc.agent_id) === String(a.id));
            const leads = data.leads.filter((l) => (l.source || "").toLowerCase() === a.ref_code).length;
            const month$ = data.commissions.filter((c) => String(c.agent_id) === String(a.id) && c.earned_on.startsWith(month)).reduce((s, c) => s + c.amount, 0);
            const owed = agentOwed(data, a.id);
            return (
              <tr key={a.id} className="row" tabIndex={0} onClick={() => open(String(a.id))} onKeyDown={(e) => e.key === "Enter" && open(String(a.id))}>
                <td><b>{a.name}</b>{!a.active && <span className="sub"> · inactive</span>}<div className="sub mono">?ref={a.ref_code}</div></td>
                <td className="r num">{leads}</td>
                <td className="r num">{mine.length}</td>
                <td className="r num">{mine.filter((r) => r.acc.status === "active").length}</td>
                <td className="r num">{tzs(month$)}</td>
                <td className="r num" style={owed > 0 ? { fontWeight: 700 } : undefined}>{tzs(owed)}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      ) : !adding && <p className="quiet">No salespeople yet. Add one to give them a link and track what they earn.</p>}
    </div>
  );
}

type AgentDraft = { name: string; phone: string; email: string; ref_code: string; signing_pct: string; setup_pct: string; commission_pct: string; commission_months: string; notes: string };
function AgentForm({ a, busy, onSave }: { a?: Agent; busy: boolean; onSave: (v: Parameters<typeof saveAgent>[1]) => void }) {
  const d = { ...AGENT_DEFAULTS, ...(a || {}) };
  const [f, setF] = useState<AgentDraft>({ name: a?.name || "", phone: a?.phone || "", email: a?.email || "", ref_code: a?.ref_code || "", signing_pct: String(d.signing_pct), setup_pct: String(d.setup_pct), commission_pct: String(d.commission_pct), commission_months: String(d.commission_months), notes: a?.notes || "" });
  const [touched, setTouched] = useState(!!a);
  const set = (k: keyof AgentDraft, v: string) => setF((x) => ({ ...x, [k]: v, ...(k === "name" && !touched ? { ref_code: refSlug(v.split(" ")[0] || "") } : {}) }));
  return (
    <form noValidate className={a ? "" : "paybox"} onSubmit={(e) => { e.preventDefault(); onSave({ ...f, signing_pct: num(f.signing_pct), setup_pct: num(f.setup_pct), commission_pct: num(f.commission_pct), commission_months: num(f.commission_months) }); }}>
      <div className="fields four">
        <label className="f">Full name<input value={f.name} onChange={(e) => set("name", e.target.value)} aria-label="Salesperson name" /></label>
        <label className="f">Phone<input value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" /></label>
        <label className="f">Email <small>optional</small><input value={f.email} onChange={(e) => set("email", e.target.value)} /></label>
        <label className="f">Link code<input value={f.ref_code} onChange={(e) => { setTouched(true); set("ref_code", e.target.value); }} aria-label="Link code" /></label>
        <label className="f">Signing bonus <small>% of 1st month</small><input inputMode="numeric" value={f.signing_pct} onChange={(e) => set("signing_pct", e.target.value)} /></label>
        <label className="f">Setup fee share <small>%</small><input inputMode="numeric" value={f.setup_pct} onChange={(e) => set("setup_pct", e.target.value)} /></label>
        <label className="f">Commission <small>% of payments</small><input inputMode="numeric" value={f.commission_pct} onChange={(e) => set("commission_pct", e.target.value)} /></label>
        <label className="f">For <small>months after signing</small><input inputMode="numeric" value={f.commission_months} onChange={(e) => set("commission_months", e.target.value)} /></label>
        <label className="f full">Notes <small>agreement, allowance terms</small><textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></label>
      </div>
      <div className="actions"><button className="btn sm primary" type="submit" disabled={busy}>{a ? "Save" : "Add salesperson"}</button></div>
      <p className="note">Rates apply to client payments recorded from now on; what was already earned doesn&apos;t change.</p>
    </form>
  );
}

function AgentSheet({ a, data, rows, busy, run, close }: { a: Agent; data: OwnerData; rows: Row[]; busy: boolean; run: Run; close: () => void }) {
  const [edit, setEdit] = useState(false);
  const [line, setLine] = useState({ kind: "allowance" as "allowance" | "adjustment", amount: "", note: "" });
  const [po, setPo] = useState({ method: PAY_METHODS[0], reference: "", paid_on: today() });
  const [copied, setCopied] = useState(false);
  const [undo, setUndo] = useState<string | number | null>(null);
  const link = `${data.siteUrl.replace(/\/$/, "")}/?ref=${a.ref_code}`;
  const mine = rows.filter((r) => String(r.acc.agent_id) === String(a.id));
  const lines = data.commissions.filter((c) => String(c.agent_id) === String(a.id));
  const open = lines.filter((c) => c.payout_id == null);
  const owed = open.reduce((s, c) => s + c.amount, 0);
  const payouts = data.payouts.filter((p) => String(p.agent_id) === String(a.id));
  const co = (id: string | null) => data.companies.find((c) => c.id === id)?.name || "";
  const forPdf = (L: Commission[]) => L.map((c) => ({ kind: KIND_LABEL[c.kind], amount: c.amount, note: c.note, earned_on: c.earned_on, company: co(c.company_id) }));
  return (
    <>
      <div className="sheet-h">
        <div><div className="lbl">Salesperson</div><h2>{a.name}</h2><div className="sub">{[a.phone, a.email].filter(Boolean).join(" · ")}{!a.active && " · inactive"}</div></div>
        <button className="btn sm" onClick={close}>Close</button>
      </div>

      <div className="card"><h3>Their link</h3>
        <div className="msg mono" style={{ fontSize: 13 }}>{link}</div>
        <div className="actions">
          <button className="btn sm primary" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select manually */ } }}>{copied ? "Copied" : "Copy link"}</button>
          {a.phone && <a className="btn wa sm" href={`https://wa.me/${a.phone.replace(/\D/g, "").replace(/^0/, "255")}?text=${encodeURIComponent(`Habari ${a.name.split(" ")[0]}, hiki ndicho kiungo chako cha Shehena. Kitumie kwa wateja wote: ${link}`)}`} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>}
        </div>
        <p className="note">The link opens the sign-in page. A company that registers after opening it is credited to them automatically.</p>
      </div>

      <div className="card"><h3>Owed now</h3>
        <div className="big" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span className="sub">{open.length} line{open.length === 1 ? "" : "s"} not yet paid</span><b className="num" style={{ fontSize: 22 }}>TZS {tzs(owed)}</b></div>
        {open.map((c) => (
          <div className="lrow" key={c.id}>
            <div><b>{KIND_LABEL[c.kind]}</b>{co(c.company_id) && <> · {co(c.company_id)}</>}<div className="sub">{dayLabel(c.earned_on)}{c.note && ` · ${c.note}`}</div></div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="num">{tzs(c.amount)}</span>
              {c.payment_id == null && <button className="btn sm" disabled={busy} onClick={() => run(() => deleteAgentLine(c.id))} aria-label="Remove line">✕</button>}</div>
          </div>
        ))}
        <form noValidate className="paybox" onSubmit={(e) => { e.preventDefault(); run(() => addAgentLine(a.id, line.kind, num(line.amount), line.note), () => setLine({ ...line, amount: "", note: "" })); }}>
          <div className="fields">
            <label className="f">Add<select value={line.kind} onChange={(e) => setLine({ ...line, kind: e.target.value as "allowance" })}><option value="allowance">Allowance (transport, airtime)</option><option value="adjustment">Adjustment (+ or −)</option></select></label>
            <label className="f">Amount (TZS)<input inputMode="numeric" value={line.amount} onChange={(e) => setLine({ ...line, amount: e.target.value })} aria-label="Line amount" /></label>
            <label className="f full">Note<input value={line.note} onChange={(e) => setLine({ ...line, note: e.target.value })} placeholder="e.g. Transport, 4 field days" /></label>
          </div>
          <div className="actions"><button className="btn sm" type="submit" disabled={busy}>Add line</button></div>
        </form>
        {owed > 0 && (
          <form noValidate className="paybox" onSubmit={(e) => { e.preventDefault(); run(() => recordPayout(a.id, po)); }}>
            <div className="lbl" style={{ marginBottom: 8 }}>Pay {a.name.split(" ")[0]} TZS {tzs(owed)}</div>
            <div className="fields">
              <label className="f">Paid by<select value={po.method} onChange={(e) => setPo({ ...po, method: e.target.value })}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label className="f">Date paid<input type="date" value={po.paid_on} onChange={(e) => setPo({ ...po, paid_on: e.target.value })} /></label>
              <label className="f full">Reference <small>optional</small><input value={po.reference} onChange={(e) => setPo({ ...po, reference: e.target.value })} aria-label="Payout reference" /></label>
            </div>
            <div className="actions">
              <button className="btn sm primary" type="submit" disabled={busy}>Record payout</button>
              <button className="btn sm" type="button" onClick={() => downloadAgentStatement(a, forPdf(open), null)}>Statement of what&apos;s owed</button>
            </div>
          </form>
        )}
      </div>

      {payouts.length > 0 && (
        <div className="card"><h3>Payouts</h3>
          {payouts.map((p) => (
            <div className="lrow" key={p.id} style={{ flexWrap: "wrap" }}>
              <div><b className="num">TZS {tzs(p.amount)}</b><div className="sub">{dayLabel(p.paid_on)}{p.method && ` · ${p.method}`}{p.reference && ` · ${p.reference}`}</div></div>
              {undo === p.id ? (
                <div className="confirm">Remove this payout? Its lines become owed again.
                  <button className="btn sm danger" disabled={busy} onClick={() => { setUndo(null); run(() => deletePayout(p.id)); }}>Remove</button>
                  <button className="btn sm" onClick={() => setUndo(null)}>Cancel</button></div>
              ) : (
                <div className="actions" style={{ margin: 0 }}>
                  <button className="btn sm" onClick={() => downloadAgentStatement(a, forPdf(lines.filter((c) => String(c.payout_id) === String(p.id))), p)}>Statement</button>
                  <button className="btn sm" onClick={() => setUndo(p.id)}>Remove</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card"><h3>Clients · {mine.length}</h3>
        {mine.map((r) => {
          const earned = lines.filter((c) => c.company_id === r.id).reduce((s, c) => s + c.amount, 0);
          return (
            <div className="lrow" key={r.id}>
              <div><b>{r.name}</b> <StatusPill s={r.acc.status} /><div className="sub">since {dayLabel(r.acc.agent_since)} · {r.bill.plan} · TZS {tzs(r.bill.fee)}/mo</div></div>
              <span className="num sub">earned {tzs(earned)}</span>
            </div>
          );
        })}
        {!mine.length && <p className="sub">No clients yet. Set &quot;Brought in by&quot; on a client, or they&apos;re linked automatically when a company registers from their link.</p>}
      </div>

      <div className="card"><h3>Rates and details</h3>
        {edit ? <AgentForm a={a} busy={busy} onSave={(v) => run(() => saveAgent(a.id, { ...v, active: a.active }), () => setEdit(false))} /> : (
          <>
            <dl className="kv">
              <dt>Signing bonus</dt><dd>{a.signing_pct}% of the first month</dd>
              <dt>Setup fee share</dt><dd>{a.setup_pct}%</dd>
              <dt>Commission</dt><dd>{a.commission_pct}% of payments for {a.commission_months} months</dd>
              {a.notes && <><dt>Notes</dt><dd>{a.notes}</dd></>}
            </dl>
            <div className="actions">
              <button className="btn sm" onClick={() => setEdit(true)}>Edit</button>
              <button className="btn sm" disabled={busy} onClick={() => run(() => saveAgent(a.id, { ...a, active: !a.active }))}>{a.active ? "Mark inactive" : "Mark active"}</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
