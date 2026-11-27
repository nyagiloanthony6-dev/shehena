"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mark, Wordmark } from "./Icon";
import {
  addAgentLine, assignAgent, deleteAgentLine, deletePayout, recordPayout, saveAgent,
  addSmsBundle, setSmsSender, saveSmsPrice, ownerTestSms, createCompany, deletePayment, recordPayment, resetStaffPassword, savePricing, saveBillingSettings, setAccountBilling, setAnnouncement,
  setAutoStatus, setCompanyNotes, setCompanyStatus, setLeadStatus, setSignupOpen, truckActivity, deleteCompany, type TruckRow,
} from "@/app/owner/actions";
import {
  AGENT_DEFAULTS, KIND_LABEL, refSlug, type Agent, type Commission, type Payout,
  ACTIVE_DAYS, PAY_METHODS, PRICE_MODELS, monthStart, perTripFee, dayLabel, feeFor, feeWorking, listFee, periodEnd, planLabel, priceLabel, priceOf, statusFor, today, addDays, type PriceModel,
  type BillingPayment, type BillingSettings,
} from "@/lib/billing";
import { downloadAgentStatement, downloadSubscriptionReceipt } from "./billingPdf";
import { signOut } from "@/app/login/actions";
import { ROLES, fmtDate, tzs, type Role } from "@/lib/domain";

type Status = "trial" | "active" | "overdue" | "suspended";
type Company = { id: string; name: string; branch: string; phone: string; created_at: string; mode?: string; account_no?: string };
type Account = { company_id: string; status: Status; notes: string; status_changed_at: string; trial_ends: string | null; paid_until: string | null; custom_fee: number | null; auto_status: boolean; agent_id: number | string | null; agent_since: string | null; price_model?: PriceModel | null; price_rate?: number | null; price_min?: number | null; sms_balance?: number | null; sms_price?: number | null };
type Stat = { company_id: string; staff: number; active_staff: number; vehicles: number; trips_month: number; ship_month: number; billed_month: number; paid_month: number; ship_total: number; last_activity: string | null };
type Staff = { id: string; company_id: string; full_name: string; email: string; role: Role; active: boolean; created_at: string };
type Lead = { id: number; created_at: string; name: string; company: string; phone: string; email: string; region: string; trucks: string; message: string; source: string; status: string };
type Audit = { id: number; at: string; owner_email: string; company_id: string | null; action: string; detail: Record<string, unknown> };
export interface OwnerData {
  sms?: { configured: boolean; balance: number | null; test: boolean; sender: string };
  me: string; hasCompany: boolean; error: string;
  companies: Company[]; accounts: Account[]; stats: Stat[]; staff: Staff[]; audit: Audit[]; leads: Lead[]; siteUrl: string;
  settings: { signup_open: boolean; announcement: string; announcement_updated_at: string | null } & BillingSettings;
  active: Record<string, string[]>; trips?: Record<string, number>; monthTrips?: Record<string, Record<string, number>>; payments: BillingPayment[]; agents: Agent[]; commissions: Commission[]; payouts: Payout[];
}
type Bill = { plan: string; price: string; model: PriceModel; trips: number; byMonth: Record<string, number>; tripsWhen?: string; trucks: number; plates: string[]; working: string; fee: number; due: string | null; suspend_on: string | null; pays: BillingPayment[] };
type Row = Company & { acc: Account; st: Stat; admins: Staff[]; people: Staff[]; bill: Bill };
type Run = (fn: () => Promise<{ ok?: string; error?: string }>, after?: () => void) => void;

const STATUS_LABEL: Record<Status, string> = { trial: "Trial", active: "Active", overdue: "Overdue", suspended: "Suspended" };
const ACTIONS: Record<string, string> = {
  "company.create": "Created company", "company.status": "Changed status", "company.notes": "Updated notes", "company.delete": "Deleted a company",
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

type Page = "overview" | "clients" | "billing" | "sales" | "demos" | "settings" | "activity";
type Attn = { tone: "bad" | "warn" | "info" | "good"; icon: string; title: string; sub: string; act: string; go: () => void };
type IconName = "home" | "clients" | "money" | "people" | "chat" | "gear" | "clock";

/** "2026-11" for this month (0), last month (-1)… in Tanzania time. */
function monthKey(offset = 0) {
  const d = new Date(Date.now() + 3 * 3600e3);
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  return m.toISOString().slice(0, 7);
}
const mName = (key: string, style: "long" | "short" = "long") => new Date(key + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: style });
/** 184,600,000 → "184.6M"; 950,000 → "950K". */
const short = (n: number) => n >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n));
const initials = (name: string) => name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
const AV = ["#23409A", "#B86A00", "#1D7A46", "#7A3FB8", "#0E7490", "#B42318", "#3F5BA9", "#8A5200"];
const avatarColor = (name: string) => AV[[...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % AV.length];

function OcIcon({ name }: { name: IconName }) {
  const d: Record<IconName, React.ReactNode> = {
    home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
    clients: <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />,
    money: <path d="M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6" />,
    people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" /></>,
    chat: <path d="M4 4h16v12H8l-4 4z" />,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
    clock: <path d="M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{d[name]}</svg>;
}

/** "▲ 18% vs October" — or nothing when there is no earlier figure to compare with. */
function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return <div className={`oc-delta ${pct >= 0 ? "up" : "down"}`}>{pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}% vs {label}</div>;
}

/** Small trend line of the last months' money received. */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values);
  if (!max) return null;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 150, 50 - (v / max) * 42]);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="oc-spark" width="150" height="54" viewBox="0 0 150 54" aria-hidden="true">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="#F2A23A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="4" fill="#F2A23A" />
    </svg>
  );
}

/** Money received per month; this month in amber. */
function MonthBars({ months, values }: { months: string[]; values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="oc-bars" role="img" aria-label={months.map((m, i) => `${mName(m)} TZS ${tzs(values[i])}`).join(", ")}>
      {months.map((m, i) => (
        <div key={m} className={`b${i === months.length - 1 ? " cur" : ""}`} title={`${mName(m)}: TZS ${tzs(values[i])}`}>
          <span className="v">{values[i] ? short(values[i]) : "–"}</span>
          <span className="bar" style={{ height: `${Math.max(3, (values[i] / max) * 130)}px` }} />
          <span className="x">{mName(m, "short")}</span>
        </div>))}
    </div>
  );
}

/** "12 trips × 10,000", "flat", "3 trucks" — the plan in a few words for lists. */
/** Total line for several months of per-trip billing. */
const l2 = (n: number) => (n > 1 ? " (total above)" : "");

function planShort(b: Bill) {
  if (b.model === "flat") return "flat fee";
  if (b.model === "per_trip") return `${b.trips} trip${b.trips === 1 ? "" : "s"} this month · per trip`;
  if (b.model === "per_truck") return `${b.trucks} truck${b.trucks === 1 ? "" : "s"} · own price`;
  return b.plan;
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
  const [page, setPage] = useState<Page>("overview");
  const [menu, setMenu] = useState(false);

  const run = (fn: () => Promise<{ ok?: string; error?: string }>, after?: () => void) => start(async () => {
    const r = await fn();
    setToast(r.error ? { m: r.error, e: true } : { m: r.ok || "Done" });
    setTimeout(() => setToast(null), r.error ? 5000 : 3000);
    if (!r.error) { after?.(); router.refresh(); }
  });

  const thisMonthKey = monthKey(0);
  const rows: Row[] = useMemo(() => data.companies.map((c) => {
    const people = data.staff.filter((s) => s.company_id === c.id);
    const acc: Account = data.accounts.find((a) => a.company_id === c.id) || { company_id: c.id, status: "active", notes: "", status_changed_at: c.created_at, trial_ends: null, paid_until: null, custom_fee: null, auto_status: true, agent_id: null, agent_since: null };
    const st = data.stats.find((s) => s.company_id === c.id) || { company_id: c.id, staff: people.length, active_staff: 0, vehicles: 0, trips_month: 0, ship_month: 0, billed_month: 0, paid_month: 0, ship_total: 0, last_activity: c.created_at };
    const { due, suspend_on } = statusFor(acc, data.settings);
    const plates = data.active[c.id] || [];
    // Per-trip clients are billed by calendar month (this month so far); others on the last 30 days.
    const byMonth = data.monthTrips?.[c.id] || {};
    const perTrip = priceOf(acc).model === "per_trip";
    const use = perTrip
      ? { trucks: plates.length, trips: byMonth[thisMonthKey] || 0, tripsWhen: `${mName(thisMonthKey)} so far` }
      : { trucks: plates.length, trips: data.trips?.[c.id] || 0 };
    return {
      ...c, acc, st,
      admins: people.filter((p) => p.role === "admin"),
      people,
      bill: { plan: planLabel(plates.length), price: priceLabel(acc, data.settings), model: priceOf(acc).model, trips: use.trips, byMonth, tripsWhen: use.tripsWhen, trucks: plates.length, plates,
        working: feeWorking(data.settings, use, acc), fee: feeFor(acc, data.settings, use), due, suspend_on: acc.auto_status ? suspend_on : null, pays: data.payments.filter((p) => p.company_id === c.id) },
    };
  }), [data]);
  const count = (s: Status) => rows.filter((r) => r.acc.status === s).length;
  const quiet = rows.filter((r) => r.acc.status !== "suspended" && (daysAgo(r.st.last_activity) ?? 0) >= 14);
  const ql = q.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (!filter || (filter === "quiet" ? quiet.includes(r) : r.acc.status === filter)) &&
    (!ql || [r.account_no || "", r.name, r.branch, r.phone, ...r.people.map((p) => p.email + " " + p.full_name)].join(" ").toLowerCase().includes(ql)));
  const open = rows.find((r) => r.id === openId) || null;
  const sum = (k: keyof Stat) => rows.reduce((a, r) => a + Number(r.st[k] || 0), 0);
  const month = today().slice(0, 7);
  const mrr = rows.filter((r) => r.acc.status === "active").reduce((a, r) => a + r.bill.fee, 0);
  const received = data.payments.filter((p) => p.paid_on.startsWith(month)).reduce((a, p) => a + p.amount, 0);
  const owed = rows.filter((r) => r.acc.status === "overdue").reduce((a, r) => a + r.bill.fee, 0);

  // ----- Overview figures -----
  const lastMonth = monthKey(-1);
  const receivedLast = data.payments.filter((p) => p.paid_on.startsWith(lastMonth)).reduce((a, p) => a + p.amount, 0);
  const months6 = Array.from({ length: 6 }, (_, i) => monthKey(i - 5));
  const byMonth = months6.map((m) => data.payments.filter((p) => p.paid_on.startsWith(m)).reduce((a, p) => a + p.amount, 0));
  const payingN = rows.filter((r) => r.acc.status === "active").length;
  const trucksN = rows.reduce((a, r) => a + r.bill.trucks, 0);
  const newLeads = data.leads.filter((l) => l.status === "new").length;
  const openLeads = data.leads.filter((l) => !["won", "lost"].includes(l.status)).length;
  const in7 = addDays(today(), 7), in5 = addDays(today(), 5);
  const attention: Attn[] = [
    ...rows.filter((r) => r.acc.status === "overdue").map((r): Attn => ({ tone: "bad", icon: "!", title: `${r.name} is overdue`, sub: `TZS ${tzs(r.bill.fee)} a month${r.bill.suspend_on ? ` · suspends on ${dayLabel(r.bill.suspend_on)}` : ""}`, act: "Record payment", go: () => setOpenId(r.id) })),
    ...rows.filter((r) => r.acc.status === "trial" && r.bill.due && r.bill.due <= in7).map((r): Attn => ({ tone: "info", icon: `${Math.max(0, daysAgo(r.bill.due) === null ? 0 : -(daysAgo(r.bill.due) as number))}d`, title: `${r.name}'s trial ends ${dayLabel(r.bill.due as string)}`, sub: `${r.bill.trucks} truck${r.bill.trucks === 1 ? "" : "s"} used · ${r.st.ship_month} consignments this month`, act: "Open", go: () => setOpenId(r.id) })),
    ...rows.filter((r) => r.acc.status === "active" && r.bill.due && r.bill.due <= in5).map((r): Attn => ({ tone: "warn", icon: "TZS", title: `${r.name} pays on ${dayLabel(r.bill.due as string)}`, sub: `TZS ${tzs(r.bill.fee)} due`, act: "Open", go: () => setOpenId(r.id) })),
    ...quiet.map((r): Attn => ({ tone: "warn", icon: "zz", title: `${r.name} quiet ${daysAgo(r.st.last_activity)} days`, sub: `last activity ${fmtDate(r.st.last_activity || r.created_at).slice(0, 11)}`, act: "Open", go: () => setOpenId(r.id) })),
    ...rows.filter((r) => { const c = r as unknown as { sms_sender?: string | null; sms_sender_request?: string | null }; return !!c.sms_sender_request && c.sms_sender_request !== c.sms_sender; })
      .map((r): Attn => ({ tone: "info", icon: "SMS", title: `${r.name} wants SMS sender "${(r as unknown as { sms_sender_request: string }).sms_sender_request}"`, sub: "Register it with NextSMS, then approve it", act: "Open", go: () => setOpenId(r.id) })),
    ...(newLeads ? [{ tone: "good", icon: "+", title: `${newLeads} new demo request${newLeads === 1 ? "" : "s"}`, sub: data.leads.filter((l) => l.status === "new").slice(0, 3).map((l) => l.company || l.name).join(", "), act: "View", go: () => setPage("demos") } as Attn] : []),
  ];
  const top = [...rows].filter((r) => r.acc.status !== "suspended").sort((x, y) => y.st.ship_month - x.st.ship_month || y.st.billed_month - x.st.billed_month).slice(0, 5);
  const topMax = Math.max(1, ...top.map((r) => r.st.ship_month));
  const billingDue = count("overdue") + rows.filter((r) => r.acc.status === "active" && r.bill.due && r.bill.due <= in5).length;
  const NAV: [Page, string, IconName, number?][] = [
    ["overview", "Overview", "home"], ["clients", "Clients", "clients", rows.length], ["billing", "Billing & payments", "money", billingDue || undefined],
    ["sales", "Sales team", "people"], ["demos", "Demo requests", "chat", openLeads || undefined], ["settings", "Settings", "gear"], ["activity", "Activity log", "clock"],
  ];
  const hour = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Dar_es_Salaam" }));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = (data.staff.find((p) => p.email === data.me)?.full_name || data.me.split("@")[0]).split(/[\s._-]+/)[0];
  const firstCap = first.charAt(0).toUpperCase() + first.slice(1);
  const goPage = (p: Page) => { setPage(p); setMenu(false); if (typeof window !== "undefined") window.scrollTo({ top: 0 }); };

  return (
    <div className="owner oc">
      <aside className={`oc-side${menu ? " open" : ""}`} aria-label="Owner console menu">
        <div className="oc-brand"><Mark /><div><Wordmark /><small>Owner console</small></div></div>
        <nav className="oc-nav">
          {NAV.map(([k, label, icon, n]) => (
            <button key={k} className={page === k ? "on" : ""} aria-current={page === k ? "page" : undefined} onClick={() => goPage(k)}>
              <OcIcon name={icon} />{label}{n ? <span className={`ct${k === "clients" ? " muted" : ""}`}>{n}</span> : null}
            </button>))}
        </nav>
        <div className="oc-foot">
          <div className="sub">{data.me}</div>
          <div className="oc-foot-actions">
            {data.hasCompany && <a className="btn sm" href="/app">My company</a>}
            <form action={signOut}><button className="btn sm" type="submit">Sign out</button></form>
          </div>
          <div className="sub">Developed by <b>Serengeti Labs</b></div>
        </div>
      </aside>
      {menu && <div className="oc-scrim" onClick={() => setMenu(false)} />}
      <header className="oc-mtop">
        <button className="btn sm" onClick={() => setMenu(true)} aria-label="Open menu">☰</button>
        <div className="brandrow"><Mark /><Wordmark /></div>
        <span className="sub" style={{ color: "var(--nav-muted)" }}>{NAV.find((n) => n[0] === page)?.[1]}</span>
      </header>

      <main className="oc-main">
        {data.error && <div className="banner">{data.error}</div>}

        {page === "overview" && <>
          <div className="oc-head">
            <div><div className="sub">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Dar_es_Salaam" })}</div><h1>{greet}, {firstCap}</h1></div>
            <div className="oc-head-actions">{data.hasCompany && <a className="btn" href="/app">My company</a>}<button className="btn primary" onClick={() => { goPage("clients"); setAdding(true); }}>+ Add a company</button></div>
          </div>
          <div className="oc-kpis">
            <div className="oc-card oc-hero">
              <div className="lbl">Monthly revenue</div>
              <div className="big">{tzs(mrr)}<small>TZS / month</small></div>
              <div className="sub">from {payingN} paying client{payingN === 1 ? "" : "s"} · {trucksN} active truck{trucksN === 1 ? "" : "s"}</div>
              <Spark values={byMonth} />
            </div>
            <div className="oc-card">
              <div className="lbl">Received this month</div>
              <div className="big">{tzs(received)}<small>TZS</small></div>
              <Delta now={received} before={receivedLast} label={mName(lastMonth)} />
              <div className="oc-prog" title="Received ÷ monthly revenue"><span style={{ width: `${mrr ? Math.min(100, Math.round((received / mrr) * 100)) : 0}%` }} /></div>
              <div className="sub">{!mrr ? "No paying clients yet" : received >= mrr ? "More than a month's revenue (includes advance or multi-month payments)" : `${Math.round((received / mrr) * 100)}% of monthly revenue · ${tzs(mrr - received)} still to come`}</div>
            </div>
            <div className="oc-card">
              <div className="lbl">Clients</div>
              <div className="big">{rows.length}</div>
              <div className="oc-seg" aria-hidden="true">{(["active", "trial", "overdue", "suspended"] as Status[]).map((k) => count(k) ? <span key={k} className={`s-${k}`} style={{ flex: count(k) }} /> : null)}</div>
              <div className="oc-legend">{(["active", "trial", "overdue", "suspended"] as Status[]).map((k) => <button key={k} onClick={() => { setFilter(k); goPage("clients"); }}><i className={`s-${k}`} />{count(k)} {STATUS_LABEL[k].toLowerCase()}</button>)}</div>
            </div>
            <div className="oc-card">
              <div className="lbl">Clients&apos; activity</div>
              <div className="big">{sum("ship_month").toLocaleString("en-US")}<small>consignments</small></div>
              <div className="sub">this month · {rows.reduce((t, r) => t + (r.bill.byMonth[thisMonthKey] || 0), 0).toLocaleString("en-US")} trips · TZS {short(sum("billed_month"))} billed by clients · {sum("active_staff")} active staff</div>
            </div>
          </div>
          <div className="oc-row2">
            <div className="oc-card">
              <div className="oc-hd"><h2>Money received</h2><span className="sub">Last 6 months, TZS</span></div>
              <MonthBars months={months6} values={byMonth} />
            </div>
            <div className="oc-card">
              <div className="oc-hd"><h2>Needs your attention</h2><span className="sub">{attention.length ? `${attention.length} item${attention.length === 1 ? "" : "s"}` : ""}</span></div>
              {attention.length ? (
                <ul className="oc-att">{attention.slice(0, 6).map((x, i) => (
                  <li key={i}><span className={`ic t-${x.tone}`}>{x.icon}</span><div className="t"><b>{x.title}</b><span className="sub">{x.sub}</span></div><button className="btn sm" onClick={x.go}>{x.act}</button></li>))}
                  {attention.length > 6 && <li className="sub">and {attention.length - 6} more on the Clients page</li>}
                </ul>
              ) : <div className="oc-allgood"><span>✓</span><div><b>All clear</b><div className="sub">No overdue clients, trials ending, quiet accounts or new requests.</div></div></div>}
            </div>
          </div>
          <div className="oc-card" style={{ marginTop: 14 }}>
            <div className="oc-hd"><h2>Top clients this month</h2><button className="linkbtn" onClick={() => goPage("clients")}>See all {rows.length} clients →</button></div>
            {top.length ? (
              <div className="ledger" style={{ border: 0, marginTop: 6 }}><table className="oc-top">
                <thead><tr><th>Company</th><th className="r">Active trucks</th><th className="r">Trips</th><th>Consignments</th><th className="r">Billed by them</th><th className="r">Pays you</th><th>Status</th></tr></thead>
                <tbody>{top.map((r) => (
                  <tr key={r.id} className="row" tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(r.id)}>
                    <td><span className="oc-av" style={{ background: avatarColor(r.name) }}>{initials(r.name)}</span><b>{r.name}</b>{r.account_no && <span className="mono sub"> {r.account_no}</span>}</td>
                    <td className="r num">{r.bill.trucks}</td>
                    <td className="r num">{r.bill.byMonth[thisMonthKey] || 0}</td>
                    <td className="num">{r.st.ship_month} <span className="oc-mbar"><span style={{ width: `${(r.st.ship_month / topMax) * 100}%` }} /></span></td>
                    <td className="r num">{tzs(r.st.billed_month)}</td>
                    <td className="r num">{tzs(r.bill.fee)}</td>
                    <td><StatusPill s={r.acc.status} /></td>
                  </tr>))}</tbody>
              </table></div>
            ) : <p className="sub">No clients yet. <button className="linkbtn" onClick={() => { goPage("clients"); setAdding(true); }}>Add your first company</button></p>}
          </div>
        </>}

        {page === "clients" && <>
          <div className="oc-head"><div><h1>Clients</h1><div className="sub">Every cargo company using Shehena. Tap a company for its details, billing and trucks.</div></div>
            <button className={`btn${adding ? "" : " primary"}`} onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add a company"}</button></div>
          {adding && <AddCompany agents={data.agents} busy={pending} onSubmit={(v) => run(() => createCompany(v), () => setAdding(false))} />}
          <div className="filters" style={{ marginTop: 6 }}>
            <div className="chips">
              {([["", `All · ${rows.length}`], ["active", `Active · ${count("active")}`], ["trial", `Trial · ${count("trial")}`], ["overdue", `Overdue · ${count("overdue")}`], ["suspended", `Suspended · ${count("suspended")}`], ["quiet", `Quiet 14+ days · ${quiet.length}`]] as [typeof filter, string][])
                .map(([k, l]) => <button key={k || "all"} className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
            </div>
            <div className="searchbox" style={{ flex: "1 1 220px" }}><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Account no., company, staff name or email" aria-label="Search companies" style={{ paddingLeft: 11 }} /></div>
          </div>
          <div className="ledger oc-card" style={{ marginTop: 12, padding: 0 }}><table>
            <thead><tr><th>Company</th><th>Admin</th><th className="r">Staff</th><th className="r">Trucks <span className="sub">saved · active</span></th><th className="r">This month</th><th>Last activity</th><th className="r">Plan</th><th>Status</th></tr></thead>
            <tbody>
              {shown.map((r) => {
                const d = daysAgo(r.st.last_activity) ?? 0;
                return (
                  <tr key={r.id} className="row" tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(r.id)}>
                    <td className="oc-co" title={`Joined ${fmtDate(r.created_at).slice(0, 11)}`}><div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}><span className="oc-av" style={{ background: avatarColor(r.name) }}>{initials(r.name)}</span><div><b>{r.name}</b> {r.mode === "air" ? <span className="tag-rental">Air</span> : <span className="tag-rental tag-road">Road</span>}<div className="sub">{[r.account_no, r.branch, r.phone].filter(Boolean).join(" · ")}</div></div></div></td>
                    <td>{r.admins[0] ? <>{r.admins[0].full_name}<div className="sub">{r.admins[0].email}</div></> : <span className="sub">No admin</span>}</td>
                    <td className="r num">{r.st.active_staff}<span className="sub">/{r.st.staff}</span></td>
                    <td className="r num">{r.st.vehicles} · <b>{r.bill.trucks}</b></td>
                    <td className="r num" title={`${mName(monthKey(-1))}: ${r.bill.byMonth[monthKey(-1)] || 0} trips`}><b>{r.bill.byMonth[thisMonthKey] || 0}</b> trip{(r.bill.byMonth[thisMonthKey] || 0) === 1 ? "" : "s"}<div>{r.st.ship_month} cons.</div><div className="sub">TZS {tzs(r.st.billed_month)}</div></td>
                    <td><span style={d >= 14 && r.acc.status !== "suspended" ? { color: "var(--bad)", fontWeight: 600 } : undefined}>{ago(r.st.last_activity)}</span></td>
                    <td className="r num">{tzs(r.bill.fee)}<div className="sub">{planShort(r.bill)}</div></td>
                    <td><StatusPill s={r.acc.status} /><div className="sub">{dueText(r)}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
            {!rows.length && <div className="empty"><h3>No client companies yet</h3><p>Add your first company, or open self sign-up in Settings so companies can register.</p></div>}
            {rows.length > 0 && !shown.length && <div className="empty"><p>No companies match.</p></div>}
          </div>
        </>}

        {page === "billing" && <>
          <div className="oc-head"><div><h1>Billing &amp; payments</h1><div className="sub">What clients pay you, and the rules for trials, due dates and suspension.</div></div></div>
          <div className="oc-kpis three">
            <div className="oc-card"><div className="lbl">Monthly revenue</div><div className="big">{tzs(mrr)}<small>TZS</small></div><div className="sub">{payingN} paying clients</div></div>
            <div className="oc-card"><div className="lbl">Received this month</div><div className="big">{tzs(received)}<small>TZS</small></div><Delta now={received} before={receivedLast} label={mName(lastMonth)} /></div>
            <div className={`oc-card${owed ? " warn" : ""}`}><div className="lbl">Overdue</div><div className="big">{count("overdue")}</div><div className="sub">{owed ? `TZS ${tzs(owed)} a month unpaid` : "Nobody is overdue"}</div></div>
          </div>
          <div className={`oc-card${data.sms && data.sms.configured && (data.sms.balance ?? 0) < 1000 ? " warn" : ""}`} style={{ marginTop: 14 }}>
            <div className="lbl">NextSMS account</div>
            {data.sms?.configured
              ? <><div className="big">{data.sms.balance != null ? data.sms.balance.toLocaleString("en-US") : "—"}<small>SMS left</small></div>
                  <div className="sub">Sender name {data.sms.sender || "not set (NEXTSMS_SENDER_ID)"}{data.sms.test ? " · TEST MODE: nothing is delivered" : ""} · clients hold {rows.reduce((a, r) => a + Number(r.acc.sms_balance || 0), 0).toLocaleString("en-US")} SMS in bundles</div></>
              : <div className="sub">Not connected. In Vercel, add NEXTSMS_USERNAME, NEXTSMS_PASSWORD and NEXTSMS_SENDER_ID, then redeploy.</div>}
            <TestSms busy={pending} run={run} sender={data.sms?.sender} />
          </div>
          <div className="oc-card" style={{ marginTop: 14 }}>
            <div className="oc-hd"><h2>Payments received</h2><span className="sub">Newest first · record new payments from a client&apos;s details</span></div>
            {data.payments.length ? (
              <div className="ledger" style={{ border: 0, marginTop: 6 }}><table>
                <thead><tr><th>Date</th><th>Client</th><th>Period</th><th>Method</th><th className="r">Amount (TZS)</th></tr></thead>
                <tbody>{[...data.payments].sort((x, y) => y.paid_on.localeCompare(x.paid_on)).slice(0, 50).map((p) => {
                  const r = rows.find((x) => x.id === p.company_id);
                  return (
                    <tr key={String(p.id)} className={r ? "row" : undefined} onClick={r ? () => setOpenId(r.id) : undefined}>
                      <td>{dayLabel(p.paid_on)}</td>
                      <td>{r ? <b>{r.name}</b> : <span className="sub">{(p as BillingPayment & { company_name?: string }).company_name || "Deleted company"}</span>}</td>
                      <td className="sub">{dayLabel(p.period_from)} – {dayLabel(p.period_to)}{p.months > 1 ? ` · ${p.months} months` : ""}</td>
                      <td>{p.method}{p.reference && <div className="sub mono">{p.reference}</div>}</td>
                      <td className="r num"><b>{tzs(p.amount)}</b></td>
                    </tr>);
                })}</tbody>
              </table></div>
            ) : <p className="sub">No payments recorded yet.</p>}
          </div>
          <Pricing settings={data.settings} rows={rows} busy={pending} run={run} />
        </>}

        {page === "sales" && <><div className="oc-head"><div><h1>Sales team</h1><div className="sub">Salespeople, the clients they brought, and what they earn.</div></div></div><SalesTeam data={data} rows={rows} busy={pending} run={run} open={(id) => setAgentId(id)} /></>}

        {page === "demos" && <><div className="oc-head"><div><h1>Demo requests</h1><div className="sub">Companies that asked to see Shehena, and the sign-up links you share.</div></div></div><Leads leads={data.leads} agents={data.agents} siteUrl={data.siteUrl} busy={pending} run={run} /></>}

        {page === "settings" && <>
          <div className="oc-head"><div><h1>Settings</h1><div className="sub">Sign-up and messages for all clients. Prices and billing rules are under Billing &amp; payments.</div></div></div>
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
        </>}

        {page === "activity" && <>
          <div className="oc-head"><div><h1>Activity log</h1><div className="sub">Everything done from this console, newest first.</div></div></div>
          <div className="panel"><AuditList items={data.audit} companies={data.companies} /></div>
        </>}
      </main>

      {open && (
        <>
          <div className="scrim" onClick={() => setOpenId(null)} />
          <aside className="sheet wide" aria-label={open.name}>
            <CompanySheet key={open.id} r={open} agents={data.agents} settings={data.settings} audit={data.audit.filter((a) => a.company_id === open.id)} busy={pending} run={run} close={() => setOpenId(null)} smsShared={data.sms?.sender} />
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
  const [f, setF] = useState({ name: "", branch: "", phone: "", admin_name: "", admin_email: "", password: tempPassword(), status: "trial" as Status, agent_id: "", mode: "road" as "road" | "air" });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(f); }} style={{ marginTop: 16 }}>
      <fieldset><legend>Add a company</legend>
        <div className="fields four">
          <label className="f">Company name<input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Mwanza Express Cargo" /></label>
          <label className="f">Type of business<select value={f.mode} onChange={(e) => set("mode", e.target.value)} aria-label="Type of business"><option value="road">Road cargo (trucks)</option><option value="air">Air cargo (flights)</option></select></label>
          <label className="f">Branch <small>optional</small><input value={f.branch} onChange={(e) => set("branch", e.target.value)} /></label>
          <label className="f">Office phone <small>optional</small><input value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" /></label>
          <label className="f">Admin&apos;s full name<input value={f.admin_name} onChange={(e) => set("admin_name", e.target.value)} /></label>
          <label className="f">Admin&apos;s email<input type="email" value={f.admin_email} onChange={(e) => set("admin_email", e.target.value)} autoComplete="off" /></label>
          <label className="f">Temporary password<input value={f.password} onChange={(e) => set("password", e.target.value)} autoComplete="off" /></label>
          <label className="f">Start as<select value={f.status} onChange={(e) => set("status", e.target.value)}><option value="trial">Trial</option><option value="active">Active</option></select></label>
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
        const extra = a.action === "company.status" ? `${String(d.from)} → ${String(d.to)}` : a.action === "staff.password_reset" ? String(d.email || "") : a.action === "announcement.set" ? `“${String(d.text || "").slice(0, 60)}”` : a.action === "company.delete" ? `${String(d.name)} (${String(d.staff)} staff, ${String(d.consignments)} consignments)` : "";
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

const monthName = (ym: string) => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
function lastMonths(n: number) {
  const t = today(); const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  return Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 - i, 1)); return d.toISOString().slice(0, 7); });
}

/** Collected share of what was charged, e.g. 82%. Empty when nothing was charged. */
function collectPct(paid: number, charged: number) {
  return charged > 0 ? Math.round((paid / charged) * 100) : null;
}

/** "82%" with a small bar, green from 90%, amber from 60%, red below. */
function Collected({ paid, charged }: { paid: number; charged: number }) {
  const p = collectPct(paid, charged);
  if (p === null) return <span className="sub">–</span>;
  const tone = p >= 90 ? "good" : p >= 60 ? "mid" : "low";
  return (
    <span className={`colpct ${tone}`} title={`TZS ${tzs(paid)} paid of TZS ${tzs(charged)} charged`}>
      <b className="num">{p}%</b>
      <span className="colbar" aria-hidden="true"><span style={{ width: `${Math.min(100, p)}%` }} /></span>
    </span>
  );
}

/** Each truck's trips in a month, and what the goods on those trips were charged and collected. */
function Trucks({ companyId }: { companyId: string }) {
  const months = useMemo(() => lastMonths(6), []);
  const [month, setMonth] = useState(months[0]);
  const [rows, setRows] = useState<TruckRow[] | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (plate: string) => setOpen((o) => { const n = new Set(o); if (n.has(plate)) n.delete(plate); else n.add(plate); return n; });
  useEffect(() => {
    let live = true;
    setRows(null); setErr(""); setOpen(new Set());
    truckActivity(companyId, month).then((r) => { if (!live) return; if (r.error) setErr(r.error); else setRows(r.rows || []); });
    return () => { live = false; };
  }, [companyId, month]);
  const sum = (k: keyof TruckRow) => (rows || []).reduce((a, r) => a + Number(r[k] || 0), 0);
  return (
    <div className="card"><h3>Trucks and collections</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Truck month" style={{ width: "auto" }}>
          {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
        </select>
        {rows && <span className="sub">{rows.length} truck{rows.length === 1 ? "" : "s"} · {sum("trips")} trip{sum("trips") === 1 ? "" : "s"} · TZS {tzs(sum("charged"))} charged{collectPct(sum("paid"), sum("charged")) !== null && <> · <b>{collectPct(sum("paid"), sum("charged"))}% collected</b></>}</span>}
      </div>
      {err ? <p className="sub" style={{ color: "var(--bad)" }}>{err}</p> : !rows ? <p className="sub">Loading…</p> : !rows.length ? <p className="sub">No trucks loaded in {monthName(month)}.</p> : (
        <div className="ledger" style={{ border: 0, marginTop: 6 }}><table className="small trk-tbl" style={{ minWidth: 0 }}>
          <thead><tr><th>Truck</th><th className="r">Trips</th><th className="r">Charged</th><th className="r">Paid</th><th className="r">Owed</th><th className="r">Collected</th></tr></thead>
          {rows.map((r) => {
            const isOpen = open.has(r.plate);
            return (
              <tbody key={r.plate} className={isOpen ? "trk open" : "trk"}>
                <tr className="trk-row" onClick={() => toggle(r.plate)}>
                  <td>
                    <button type="button" className="trk-toggle" onClick={(e) => { e.stopPropagation(); toggle(r.plate); }} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} trips for ${r.plate}`}>
                      <span className="chev" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                      <b className="mono">{r.plate}</b>
                    </button>
                    <span className="sub"> {r.ownership === "rental" ? `Rental${r.rent ? ` ${tzs(r.rent)}` : ""}` : "Own"} · {r.consignments} cons</span>
                  </td>
                  <td className="r num">{r.trips}</td>
                  <td className="r num">{tzs(r.charged)}</td>
                  <td className="r num">{tzs(r.paid)}</td>
                  <td className="r num" title={r.bill > 0 ? `${tzs(r.bill)} on monthly bills` : undefined}>{tzs(r.bill + r.unpaid)}{r.bill > 0 && <span className="sub"> *</span>}</td>
                  <td className="r"><Collected paid={r.paid} charged={r.charged} /></td>
                </tr>
                {isOpen && r.list.map((t) => (
                  <tr key={t.id} className="trip-row">
                    <td><span className="trip-ln"><span className="mono">{t.no || "Trip"}</span><span className="sub"> · {new Date(t.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Dar_es_Salaam" })}{t.route ? ` · ${t.route}` : ""} · {t.consignments} cons{t.status ? ` · ${t.status}` : ""}</span></span></td>
                    <td className="r num sub"></td>
                    <td className="r num">{tzs(t.charged)}</td>
                    <td className="r num">{tzs(t.paid)}</td>
                    <td className="r num" title={t.bill > 0 ? `${tzs(t.bill)} on monthly bills` : undefined}>{tzs(t.bill + t.unpaid)}{t.bill > 0 && <span className="sub"> *</span>}</td>
                    <td className="r"><Collected paid={t.paid} charged={t.charged} /></td>
                  </tr>
                ))}
              </tbody>
            );
          })}
          <tfoot><tr><td>Total <span className="sub">· {sum("consignments")} cons</span></td><td className="r num">{sum("trips")}</td><td className="r num">{tzs(sum("charged"))}</td><td className="r num">{tzs(sum("paid"))}</td><td className="r num">{tzs(sum("bill") + sum("unpaid"))}</td><td className="r"><Collected paid={sum("paid")} charged={sum("charged")} /></td></tr></tfoot>
        </table></div>
      )}
      <p className="note">Collected = Paid ÷ Charged (green 90%+, amber 60–89%, red below 60%). * part of Owed is on monthly bills. Tap a truck for its trips. Trips count in the month loading started.</p>
    </div>
  );
}

/** Permanently delete a suspended client. The owner must type the company name. */
function DeleteCompany({ r, busy, run, close }: { r: Row; busy: boolean; run: Run; close: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const match = name.trim().toLowerCase() === r.name.trim().toLowerCase();
  return (
    <div className="card danger-zone"><h3>Delete company</h3>
      {!open ? (
        <>
          <p className="sub" style={{ marginTop: 0 }}>Remove {r.name} from Shehena for good: its {r.people.length} staff sign-in{r.people.length === 1 ? "" : "s"}, consignments, trips, vehicles, bills and claims. Your payment records and salesperson commissions are kept.</p>
          <div className="actions"><button className="btn sm danger" onClick={() => setOpen(true)}>Delete company…</button></div>
        </>
      ) : (
        <div className="confirm" style={{ width: "100%", flexDirection: "column", alignItems: "stretch" }}>
          <div><b>This can&apos;t be undone.</b> Everything {r.name} recorded is deleted and its staff can no longer sign in. Type <b>{r.name}</b> to confirm.</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={r.name} aria-label="Type the company name to confirm" autoComplete="off" />
          <div className="actions" style={{ margin: 0 }}>
            <button className="btn sm danger" disabled={busy || !match} onClick={() => run(() => deleteCompany(r.id, name), close)}>Delete {r.name}</button>
            <button className="btn sm" onClick={() => { setOpen(false); setName(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CompanySheet({ r, agents, settings, audit, busy, run, close, smsShared }: {
  r: Row; agents: Agent[]; settings: BillingSettings; audit: Audit[]; busy: boolean; close: () => void; run: Run; smsShared?: string;
}) {
  const [notes, setNotes] = useState(r.acc.notes || "");
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  return (
    <>
      <div className="sheet-h">
        <div><div className="lbl">Client company{r.account_no ? <> · account <span className="mono">{r.account_no}</span></> : null}</div><h2>{r.name}</h2><div className="sub">{[r.branch, r.phone].filter(Boolean).join(" · ")}</div></div>
        <button className="btn sm" onClick={close}>Close</button>
      </div>

      <Trucks companyId={r.id} />

      <div className="sheet-cols">
        <div className="sheet-col">
      <Billing r={r} agents={agents} settings={settings} busy={busy} run={run} />
      <SmsCard r={r} busy={busy} run={run} shared={smsShared} stdPrice={settings.sms_price} />
        </div>
        <div className="sheet-col">

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

      {r.acc.status === "suspended" && <DeleteCompany r={r} busy={busy} run={run} close={close} />}

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
        </div>
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
  const perTrip = r.bill.model === "per_trip";
  const price0 = priceOf(a);
  const start0 = a.paid_until && a.paid_until >= addDays(today(), -settings.grace_days - 31) ? addDays(a.paid_until, 1) : today();
  // Per-trip clients pay by calendar month, so their payments start on the 1st.
  const start = perTrip ? monthStart(start0) : start0;
  /** Suggested amount: per-trip = each covered month's trips × price; others = monthly fee × months. */
  const suggest = (from: string, m: number, setup: number) =>
    (perTrip ? perTripFee(r.bill.byMonth, from || start, m, price0.rate, price0.min).total : (r.bill.fee || 0) * m) + (setup || 0);
  const [pay, setPay] = useState({ months: "1", amount: String(suggest(start, 1, 0) || ""), setup: "", from: start, method: PAY_METHODS[0], reference: "", paid_on: today() });
  const [edit, setEdit] = useState(false);
  const cur = priceOf(a);
  const [f, setF] = useState({ model: cur.model, rate: cur.model === "list" ? "" : String(cur.rate || ""), min: cur.min ? String(cur.min) : "", trial_ends: a.trial_ends || "", paid_until: a.paid_until || "" });
  // What the fee would be with the pricing being edited, using this client's last 30 days.
  const draft = { custom_fee: null, price_model: f.model, price_rate: num(f.rate) || 0, price_min: num(f.min) || 0 };
  const mk = monthKey(0);
  const use = f.model === "per_trip"
    ? { trucks: r.bill.trucks, trips: r.bill.byMonth[mk] || 0, tripsWhen: `${mName(mk)} so far` }
    : { trucks: r.bill.trucks, trips: r.bill.model === "per_trip" ? 0 : r.bill.trips };
  const [undo, setUndo] = useState<string | number | null>(null);
  const months = Math.max(1, Math.round(num(pay.months) || 1));
  // When the price changes (new pricing saved), refresh the suggested amount.
  useEffect(() => { setPay((p) => ({ ...p, amount: String(suggest(p.from, Math.max(1, Math.round(num(p.months) || 1)), num(p.setup)) || "") })); }, [r.bill.fee, r.bill.model]); // eslint-disable-line react-hooks/exhaustive-deps
  const setMonths = (m: string) => setPay((p) => ({ ...p, months: m, amount: String(suggest(p.from, Math.max(1, Math.round(num(m) || 1)), num(p.setup)) || "") }));
  const tripLines = perTrip ? perTripFee(r.bill.byMonth, pay.from || start, months, price0.rate, price0.min).lines : [];
  return (
    <div className="card"><h3>Subscription</h3>
      <dl className="kv">
        <dt>Active trucks</dt><dd>{r.bill.trucks} <span className="sub">in the last {ACTIVE_DAYS} days{r.bill.plates.length ? `: ${r.bill.plates.join(", ")}` : ""}</span></dd>
        <dt>Trips</dt><dd>{mName(monthKey(0))}: <b>{r.bill.byMonth[monthKey(0)] || 0}</b> so far <span className="sub">· {mName(monthKey(-1))}: {r.bill.byMonth[monthKey(-1)] || 0}</span></dd>
        <dt>Pricing</dt><dd>{r.bill.price}</dd>
        <dt>Monthly fee</dt><dd className="num"><b>TZS {tzs(r.bill.fee)}</b> <span className="sub">· {r.bill.working}{r.bill.model !== "list" ? ` (price list would be ${tzs(listFee(settings, r.bill.trucks))})` : ""}</span></dd>
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
          <label className="f">Covers from{perTrip && <small>1st of the month</small>}<input type="date" value={pay.from} onChange={(e) => { const from = e.target.value; setPay((p) => ({ ...p, from, amount: perTrip ? String(suggest(from, months, num(p.setup)) || "") : p.amount })); }} aria-label="Covers from" /></label>
          <label className="f">Date paid<input type="date" value={pay.paid_on} onChange={(e) => setPay({ ...pay, paid_on: e.target.value })} /></label>
          <label className="f">Paid by<select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="f">Of which setup fee <small>optional</small><input inputMode="numeric" value={pay.setup} onChange={(e) => { const s = e.target.value; setPay((p) => ({ ...p, setup: s, amount: String(suggest(p.from, months, num(s))) })); }} placeholder="0" aria-label="Setup fee included" /></label>
          <label className="f">Reference <small>optional</small><input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="e.g. M-Pesa code" aria-label="Payment reference" /></label>
        </div>
        <p className="note" style={{ margin: "8px 0 0" }}>Covers {dayLabel(pay.from)} to <b>{pay.from ? dayLabel(periodEnd(pay.from, months)) : "—"}</b>. {perTrip
          ? <>{tripLines.map((l) => `${mName(l.key)}: ${l.trips} trip${l.trips === 1 ? "" : "s"} × ${tzs(price0.rate)}${l.fee > l.trips * price0.rate ? ` (minimum ${tzs(l.fee)})` : ` = ${tzs(l.fee)}`}`).join(" · ")}{l2(tripLines.length)}{perTrip && pay.from && pay.from.slice(8) !== "01" ? " · Tip: start on the 1st so each month's trips are counted in full." : ""}</>
          : <>Fee × months = TZS {tzs((r.bill.fee || 0) * months)}</>}{num(pay.setup) > 0 ? ` + setup ${tzs(num(pay.setup))}` : ""}; change the amount for a discount.</p>
        <div className="actions"><button className="btn primary sm" type="submit" disabled={busy}>Record payment</button></div>
      </form>

      {r.bill.pays.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="lbl">Payments</div>
          {r.bill.pays.map((p) => (
            <div className="lrow" key={p.id} style={{ flexWrap: "wrap" }}>
              <div><b className="num">TZS {tzs(p.amount)}</b>{p.setup_fee ? <span className="sub"> (incl. setup {tzs(p.setup_fee)})</span> : null} <span className="sub">· {p.trips != null && r.bill.model === "per_trip" ? `${p.trips} trips · ` : p.trucks != null ? `${planLabel(p.trucks)} · ` : ""}{p.months} mo · {dayLabel(p.period_from)} – {dayLabel(p.period_to)}</span>
                <div className="sub">Paid {dayLabel(p.paid_on)}{p.method && ` · ${p.method}`}{p.reference && ` · ${p.reference}`} · by {p.recorded_by}</div></div>
              {undo === p.id ? (
                <div className="confirm">Remove this payment? Paid-until goes back.
                  <button className="btn sm danger" disabled={busy} onClick={() => { setUndo(null); run(() => deletePayment(p.id)); }}>Remove</button>
                  <button className="btn sm" onClick={() => setUndo(null)}>Cancel</button></div>
              ) : (
                <div className="actions" style={{ margin: 0 }}>
                  <button className="btn sm" onClick={() => downloadSubscriptionReceipt(p, r.name, p.trucks != null ? planLabel(p.trucks) : undefined, r.account_no)}>Receipt</button>
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
          run(() => setAccountBilling(r.id, {
            price_model: f.model, price_rate: f.model === "list" ? null : num(f.rate),
            price_min: f.model === "per_truck" || f.model === "per_trip" ? (num(f.min) || null) : null,
            trial_ends: f.trial_ends || null, paid_until: f.paid_until || null,
          }), () => setEdit(false));
        }}>
          <div className="lbl" style={{ marginBottom: 8 }}>How {r.name} pays</div>
          <div className="pricepick" role="radiogroup" aria-label="Pricing">
            {(Object.keys(PRICE_MODELS) as PriceModel[]).map((m) => (
              <label key={m} className={f.model === m ? "on" : ""}>
                <input type="radio" name="price_model" checked={f.model === m} onChange={() => setF({ ...f, model: m })} />
                <b>{m === "list" ? "Price list" : m === "per_trip" ? "Per trip" : m === "per_truck" ? "Per truck" : "Flat monthly"}</b>
                <span className="sub">{m === "list" ? `${tzs(settings.truck_price)} per truck, min ${tzs(settings.min_fee)}` : m === "per_trip" ? "trips in each calendar month" : m === "per_truck" ? "each active truck" : "same every month"}</span>
              </label>))}
          </div>
          <div className="fields" style={{ marginTop: 10 }}>
            {f.model !== "list" && <label className="f">{f.model === "flat" ? "Monthly fee (TZS)" : f.model === "per_trip" ? "Price per trip (TZS)" : "Price per active truck (TZS)"}
              <input inputMode="numeric" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder={f.model === "per_trip" ? "e.g. 10000" : f.model === "flat" ? "e.g. 150000" : "e.g. 40000"} /></label>}
            {(f.model === "per_trip" || f.model === "per_truck") && <label className="f">Minimum a month <small>optional</small>
              <input inputMode="numeric" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} placeholder="0" /></label>}
          </div>
          <p className="note" style={{ margin: "6px 0 10px" }}>{f.model === "per_trip" ? <>Counted by calendar month (1st to last day). {mName(mk)} so far: {use.trips} trip{use.trips === 1 ? "" : "s"}: </> : <>With the last {ACTIVE_DAYS} days ({use.trucks} truck{use.trucks === 1 ? "" : "s"}): </>}<b>TZS {tzs(feeFor(draft, settings, use))} a month</b> · {feeWorking(settings, use, draft)}. Applies to the next payment you record.</p>
          <div className="fields">
            <label className="f">Trial ends<input type="date" value={f.trial_ends} onChange={(e) => setF({ ...f, trial_ends: e.target.value })} /></label>
            <label className="f">Paid until <small>correct by hand</small><input type="date" value={f.paid_until} onChange={(e) => setF({ ...f, paid_until: e.target.value })} /></label>
          </div>
          <div className="actions"><button className="btn sm primary" type="submit" disabled={busy}>Save</button><button className="btn sm" type="button" onClick={() => setEdit(false)}>Cancel</button></div>
        </form>
      ) : <div className="actions"><button className="btn sm" onClick={() => setEdit(true)}>Change price or dates</button>
        {!a.paid_until && <button className="btn sm" disabled={busy} onClick={() => run(() => setAccountBilling(r.id, { trial_ends: addDays(today(), settings.trial_days), paid_until: a.paid_until }))}>Give a {settings.trial_days}-day trial</button>}
      </div>}
    </div>
  );
}

/** SMS bundles: the client's balance and adding a bundle they paid for. */
function SmsCard({ r, busy, run, shared, stdPrice }: { r: Row; busy: boolean; run: Run; shared?: string; stdPrice?: number }) {
  const [own, setOwn] = useState(r.acc.sms_price != null ? String(r.acc.sms_price) : "");
  const price = Number(r.acc.sms_price ?? stdPrice ?? 0);
  const [f, setF] = useState({ sms: "", amount: "", method: "M-Pesa", reference: "", note: "" });
  const co = r as unknown as { sms_sender?: string | null; sms_sender_request?: string | null; sms_sender_requested_at?: string | null };
  const [snd, setSnd] = useState(co.sms_sender || co.sms_sender_request || "");
  const bal = r.acc.sms_balance;
  if (bal === undefined) return <div className="card"><h3>SMS</h3><p className="note">Run migration 0027_sms.sql in Supabase to sell SMS bundles.</p></div>;
  const auto = (r as unknown as { sms_auto?: Record<string, unknown> }).sms_auto || {};
  const on = Object.entries(auto).filter(([k, v]) => k !== "reminder_days" && v).length + (auto.reminder_days ? 1 : 0);
  const per = Number(f.sms) > 0 && Number(f.amount) > 0 ? Math.round(Number(f.amount) / Number(f.sms)) : 0;
  return (
    <div className="card"><h3>SMS · <span className="num">{Number(bal || 0).toLocaleString("en-US")}</span> left</h3>
      <p className="sub" style={{ marginTop: 0 }}>{on ? `${on} automatic message type${on === 1 ? "" : "s"} switched on by the client.` : "The client hasn't switched on automatic SMS yet."} Each SMS sent takes 1 off the balance (long messages take 2–3).</p>
      <p className="sub" style={{ margin: "0 0 8px" }}>Price: <b>TZS {price} per SMS</b>{r.acc.sms_price != null ? " (special price)" : " (standard)"}</p>
      <div className="chips" style={{ marginBottom: 8 }}>{[500, 1000, 2000, 5000].map((n) => <button key={n} type="button" className="chip" aria-pressed={Number(f.sms) === n} onClick={() => setF({ ...f, sms: String(n), amount: price ? String(Math.round(n * price)) : f.amount })}>{n.toLocaleString("en-US")} SMS{price ? ` · ${tzs(Math.round(n * price))}` : ""}</button>)}</div>
      <div className="fields">
        <label className="f">SMS to add<input inputMode="numeric" value={f.sms} onChange={(e) => { const sms = e.target.value.replace(/[^\d-]/g, ""); setF({ ...f, sms, amount: price && Number(sms) > 0 ? String(Math.round(Number(sms) * price)) : f.amount }); }} placeholder="e.g. 1000" /></label>
        <label className="f">Paid (TZS)<input inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d]/g, "") })} placeholder="e.g. 30000" /></label>
        <label className="f">Method<input value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} /></label>
        <label className="f">Reference<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="M-Pesa code" /></label>
      </div>
      {per > 0 && <p className="note">TZS {per} per SMS.</p>}
      <div className="actions"><button className="btn sm primary" disabled={busy || !Number(f.sms)} onClick={() => run(() => addSmsBundle(r.id, { sms: Number(f.sms), amount: Number(f.amount), method: f.method, reference: f.reference, note: f.note }), () => setF({ sms: "", amount: "", method: "M-Pesa", reference: "", note: "" }))}>Add SMS bundle</button></div>
      <p className="note">To correct a mistake, add a negative number (e.g. -500).</p>
      {"sms_price" in r.acc && (
        <div className="snd-owner">
          <div className="lbl" style={{ marginTop: 6 }}>Special SMS price</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <input inputMode="decimal" value={own} onChange={(e) => setOwn(e.target.value.replace(/[^\d.]/g, ""))} placeholder={`Standard: ${stdPrice ?? "—"}`} style={{ width: 160 }} aria-label="Special price per SMS" />
            <button className="btn sm" disabled={busy || own === (r.acc.sms_price != null ? String(r.acc.sms_price) : "")} onClick={() => run(() => saveSmsPrice(own ? Number(own) : (null as unknown as number), r.id))}>{own ? "Save special price" : "Use standard price"}</button>
          </div>
        </div>
      )}
      {"sms_sender_request" in r && (
        <div className="snd-owner">
          <div className="lbl" style={{ marginTop: 6 }}>Sender name</div>
          <p className="sub" style={{ margin: "2px 0 8px" }}>Now: <b>{co.sms_sender || `${shared || "shared"} (shared)`}</b>{co.sms_sender_request && co.sms_sender_request !== co.sms_sender ? <> · client requested <b>{co.sms_sender_request}</b>{co.sms_sender_requested_at ? ` on ${dayLabel(co.sms_sender_requested_at.slice(0, 10))}` : ""}</> : null}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={snd} onChange={(e) => setSnd(e.target.value.toUpperCase().slice(0, 11))} placeholder="e.g. G2K TRANS" maxLength={11} style={{ width: 180 }} aria-label="Approved sender name" />
            <button className="btn sm primary" disabled={busy || snd === (co.sms_sender || "")} onClick={() => run(() => setSmsSender(r.id, snd))}>{!snd ? "Use shared name" : co.sms_sender_request && snd === co.sms_sender_request ? "Approve requested name" : "Set sender name"}</button>
          </div>
          <p className="note">You can set a name for any client, with or without a request. Register it with NextSMS first and set it here only once NextSMS confirms it, or SMS from this client will be rejected.</p>
        </div>
      )}
    </div>
  );
}

function Pricing({ settings, rows, busy, run }: { settings: OwnerData["settings"]; rows: Row[]; busy: boolean; run: Run }) {
  const [p, setP] = useState({ truck_price: String(settings.truck_price), min_fee: String(settings.min_fee) });
  const [s, setS] = useState({ trial_days: String(settings.trial_days), grace_days: String(settings.grace_days), auto_suspend: settings.auto_suspend, billing_instructions: settings.billing_instructions });
  const draft = { truck_price: num(p.truck_price) || 0, min_fee: num(p.min_fee) || 0 };
  const listed = rows.filter((r) => r.bill.model === "list");
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
      <SmsPricePanel settings={settings} busy={busy} run={run} />
    </div>
  );
}

const SMS_PACKS = [500, 1000, 2000, 5000];
/** Send a test SMS to your own phone to check the connection and a sender name. */
function TestSms({ busy, run, sender }: { busy: boolean; run: Run; sender?: string }) {
  const [phone, setPhone] = useState("");
  const [from, setFrom] = useState("");
  return (
    <div className="testsms">
      <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Your phone, e.g. 0713 123 105" aria-label="Phone for test SMS" />
      <input value={from} onChange={(e) => setFrom(e.target.value.toUpperCase().slice(0, 11))} placeholder={`Sender (${sender || "SERENGETI"})`} aria-label="Sender name for test" style={{ width: 170 }} />
      <button className="btn sm" disabled={busy || phone.replace(/\D/g, "").length < 9} onClick={() => run(() => ownerTestSms(phone, from))}>Send test SMS</button>
    </div>
  );
}

/** Standard price per SMS, shown to every client in Settings > SMS. */
function SmsPricePanel({ settings, busy, run }: { settings: OwnerData["settings"]; busy: boolean; run: Run }) {
  const [v, setV] = useState(settings.sms_price != null ? String(settings.sms_price) : "");
  const price = Number(v) || 0;
  return (
    <form className="panel" noValidate onSubmit={(e) => { e.preventDefault(); run(() => saveSmsPrice(price)); }}>
      <h2>SMS price</h2>
      <p className="sub" style={{ marginTop: 4 }}>What clients pay you per SMS. They see this price and the bundle prices in Settings &gt; SMS. You can give a client a special price on their SMS card.</p>
      <div className="fields" style={{ marginTop: 8 }}>
        <label className="f">Price per SMS (TZS)<input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Price per SMS" /></label>
      </div>
      {price > 0 && <div className="ledger" style={{ border: 0, marginTop: 8 }}><table className="small" style={{ minWidth: 0 }}>
        <thead><tr><th>Bundle</th>{SMS_PACKS.map((n) => <th key={n} className="r">{n.toLocaleString("en-US")}</th>)}</tr></thead>
        <tbody><tr><td>TZS</td>{SMS_PACKS.map((n) => <td key={n} className="r num">{tzs(Math.round(n * price))}</td>)}</tr></tbody>
      </table></div>}
      <div className="actions"><button className="btn sm primary" type="submit" disabled={busy || !(price > 0) || price === Number(settings.sms_price)}>Save SMS price</button></div>
    </form>
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
