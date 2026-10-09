"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mark } from "./Icon";
import { createCompany, resetStaffPassword, setAnnouncement, setCompanyNotes, setCompanyStatus, setLeadStatus, setSignupOpen } from "@/app/owner/actions";
import { signOut } from "@/app/login/actions";
import { ROLES, fmtDate, tzs, type Role } from "@/lib/domain";

type Status = "trial" | "active" | "overdue" | "suspended";
type Company = { id: string; name: string; branch: string; phone: string; created_at: string };
type Account = { company_id: string; status: Status; notes: string; status_changed_at: string };
type Stat = { company_id: string; staff: number; active_staff: number; vehicles: number; trips_month: number; ship_month: number; billed_month: number; paid_month: number; ship_total: number; last_activity: string | null };
type Staff = { id: string; company_id: string; full_name: string; email: string; role: Role; active: boolean; created_at: string };
type Lead = { id: number; created_at: string; name: string; company: string; phone: string; email: string; region: string; trucks: string; message: string; source: string; status: string };
type Audit = { id: number; at: string; owner_email: string; company_id: string | null; action: string; detail: Record<string, unknown> };
export interface OwnerData {
  me: string; hasCompany: boolean; error: string;
  companies: Company[]; accounts: Account[]; stats: Stat[]; staff: Staff[]; audit: Audit[]; leads: Lead[]; siteUrl: string;
  settings: { signup_open: boolean; announcement: string; announcement_updated_at: string | null };
}
type Row = Company & { acc: Account; st: Stat; admins: Staff[]; people: Staff[] };

const STATUS_LABEL: Record<Status, string> = { trial: "Trial", active: "Active", overdue: "Overdue", suspended: "Suspended" };
const ACTIONS: Record<string, string> = {
  "company.create": "Created company", "company.status": "Changed status", "company.notes": "Updated notes",
  "staff.password_reset": "Reset a password", "signup.open": "Opened self sign-up", "signup.close": "Closed self sign-up",
  "announcement.set": "Posted announcement", "announcement.clear": "Removed announcement", "lead.status": "Updated a demo request",
};
const daysAgo = (iso?: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null);
const ago = (iso?: string | null) => { const d = daysAgo(iso); return d === null ? "—" : d < 1 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`; };
function tempPassword() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const r = new Uint32Array(8); crypto.getRandomValues(r);
  return "Shehena-" + Array.from(r, (n) => a[n % a.length]).join("");
}
const StatusPill = ({ s }: { s: Status }) => <span className={`pill acc-${s}`}>{STATUS_LABEL[s]}</span>;

export default function OwnerConsole({ data }: { data: OwnerData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<{ m: string; e?: boolean } | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"" | Status | "quiet">("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok?: string; error?: string }>, after?: () => void) => start(async () => {
    const r = await fn();
    setToast(r.error ? { m: r.error, e: true } : { m: r.ok || "Done" });
    setTimeout(() => setToast(null), r.error ? 5000 : 3000);
    if (!r.error) { after?.(); router.refresh(); }
  });

  const rows: Row[] = useMemo(() => data.companies.map((c) => {
    const people = data.staff.filter((s) => s.company_id === c.id);
    return {
      ...c,
      acc: data.accounts.find((a) => a.company_id === c.id) || { company_id: c.id, status: "active", notes: "", status_changed_at: c.created_at },
      st: data.stats.find((s) => s.company_id === c.id) || { company_id: c.id, staff: people.length, active_staff: 0, vehicles: 0, trips_month: 0, ship_month: 0, billed_month: 0, paid_month: 0, ship_total: 0, last_activity: c.created_at },
      admins: people.filter((p) => p.role === "admin"),
      people,
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
          <div className={`stat${count("overdue") ? " warn" : ""}`}><div className="lbl">Overdue</div><div className="v">{count("overdue")}</div><div className="s">need to pay</div></div>
          <div className="stat"><div className="lbl">Suspended</div><div className="v">{count("suspended")}</div><div className="s">no access</div></div>
          <div className="stat"><div className="lbl">This month</div><div className="v">{tzs(sum("ship_month"))}</div><div className="s">consignments, all clients</div></div>
          <div className="stat"><div className="lbl">Billed this month</div><div className="v">{tzs(sum("billed_month"))}</div><div className="s">TZS through Shehena</div></div>
        </div>

        {adding && <AddCompany busy={pending} onSubmit={(v) => run(() => createCompany(v), () => setAdding(false))} />}

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

        <div className="filters" style={{ marginTop: 22 }}>
          <div className="chips">
            {([["", `All · ${rows.length}`], ["active", `Active · ${count("active")}`], ["trial", `Trial · ${count("trial")}`], ["overdue", `Overdue · ${count("overdue")}`], ["suspended", `Suspended · ${count("suspended")}`], ["quiet", `Quiet 14+ days · ${quiet.length}`]] as [typeof filter, string][])
              .map(([k, l]) => <button key={k || "all"} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
          </div>
          <div className="searchbox" style={{ flex: "1 1 220px" }}><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company, staff name or email" aria-label="Search companies" style={{ paddingLeft: 11 }} /></div>
        </div>
        <div className="ledger" style={{ marginTop: 12 }}><table>
          <thead><tr><th>Company</th><th>Admin</th><th className="r">Staff</th><th className="r">Trucks</th><th className="r">This month</th><th>Last activity</th><th>Status</th></tr></thead>
          <tbody>
            {shown.map((r) => {
              const d = daysAgo(r.st.last_activity) ?? 0;
              return (
                <tr key={r.id} className="row" tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(r.id)}>
                  <td><b>{r.name}</b><div className="sub">{[r.branch, r.phone].filter(Boolean).join(" · ") || "No branch set"} · joined {fmtDate(r.created_at).slice(0, 11)}</div></td>
                  <td>{r.admins[0] ? <>{r.admins[0].full_name}<div className="sub">{r.admins[0].email}</div></> : <span className="sub">No admin</span>}</td>
                  <td className="r num">{r.st.active_staff}<span className="sub">/{r.st.staff}</span></td>
                  <td className="r num">{r.st.vehicles}</td>
                  <td className="r num">{r.st.ship_month} cons.<div className="sub">TZS {tzs(r.st.billed_month)}</div></td>
                  <td><span style={d >= 14 && r.acc.status !== "suspended" ? { color: "var(--bad)", fontWeight: 600 } : undefined}>{ago(r.st.last_activity)}</span></td>
                  <td><StatusPill s={r.acc.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
          {!rows.length && <div className="empty"><h3>No client companies yet</h3><p>Add your first company, or open self sign-up so companies can register.</p></div>}
          {rows.length > 0 && !shown.length && <div className="empty"><p>No companies match.</p></div>}
        </div>

        <Leads leads={data.leads} siteUrl={data.siteUrl} busy={pending} run={run} />

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
            <CompanySheet key={open.id} r={open} audit={data.audit.filter((a) => a.company_id === open.id)} busy={pending} run={run} close={() => setOpenId(null)} />
          </aside>
        </>
      )}
      {toast && <div className={`toast${toast.e ? " err" : ""}`} role="status">{toast.m}</div>}
    </div>
  );
}

function AddCompany({ busy, onSubmit }: { busy: boolean; onSubmit: (v: Parameters<typeof createCompany>[0]) => void }) {
  const [f, setF] = useState({ name: "", branch: "", phone: "", admin_name: "", admin_email: "", password: tempPassword(), status: "trial" as Status });
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

function CompanySheet({ r, audit, busy, run, close }: {
  r: Row; audit: Audit[]; busy: boolean; close: () => void;
  run: (fn: () => Promise<{ ok?: string; error?: string }>, after?: () => void) => void;
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

      <div className="card"><h3>Account status</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <StatusPill s={r.acc.status} /><span className="sub">since {fmtDate(r.acc.status_changed_at)}</span>
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
        <p className="note">Overdue only flags the account here. Suspended blocks all access for that company&apos;s staff.</p>
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
function Leads({ leads, siteUrl, busy, run }: {
  leads: Lead[]; siteUrl: string; busy: boolean;
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
          <div><h2>Demo requests {newN > 0 && <span className="nbadge" style={{ marginLeft: 6 }}>{newN} new</span>}</h2><div className="sub">From the form on your marketing page.</div></div>
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
              <div className="sub" style={{ marginTop: 3 }}>{fmtDate(l.created_at)} · from <b>{l.source || "direct"}</b></div>
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
        {!list.length && <p className="quiet">{leads.length ? "No open requests." : "No requests yet. Share your marketing link to get some."}</p>}
      </div>
      <div className="panel">
        <h2>Marketing links</h2>
        <p className="sub" style={{ marginTop: 4 }}>Make a separate link for each place you share it. Requests show where they came from.</p>
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
