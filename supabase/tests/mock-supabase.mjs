// Minimal in-memory stand-in for Supabase Auth + PostgREST, for local UI testing only.
// Not used in production. Run: node supabase/tests/mock-supabase.mjs (port 54321)
import http from "node:http";
import crypto from "node:crypto";

const db = { companies: [], profiles: [], vehicles: [], trips: [], shipments: [], company_accounts: [], owner_audit: [], leads: [], platform_settings: [{ id: 1, signup_open: true, announcement: "", announcement_updated_at: null, trial_days: 14, grace_days: 7, auto_suspend: true, billing_instructions: "", truck_price: 50000, min_fee: 80000 }],
  billing_bands: [[0, 1, 80000], [2, 3, 150000], [4, 6, 250000], [7, 10, 350000], [11, null, 450000]].map(([min_trucks, max_trucks, monthly_fee], i) => ({ id: i + 1, min_trucks, max_trucks, monthly_fee })),
  billing_payments: [], sales_agents: [], commissions: [], agent_payouts: [],
  bill_accounts: [], bill_payments: [], claims: [], claim_payments: [] };
const ymd = (d = new Date()) => new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 10);
const plusDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const SERVICE_ONLY = ["company_accounts", "owner_audit", "leads", "billing_bands", "billing_payments", "sales_agents", "commissions", "agent_payouts"];
const PK = { company_accounts: "company_id", platform_settings: "id" };
const suspended = (cid) => db.company_accounts.find((a) => a.company_id === cid)?.status === "suspended";
const users = []; // {id,email,password,banned}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" })}.sig`;
const sessions = new Map(); // token -> userId
const userObj = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
const session = (u) => {
  const t = jwt(u.id); sessions.set(t, u.id);
  const r = crypto.randomUUID(); sessions.set("r:" + r, u.id);
  return { access_token: t, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: r, user: userObj(u) };
};
const SERVICE = "service-role-key";

function caller(req) {
  const tok = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (tok === SERVICE) return { service: true };
  const uid = sessions.get(tok);
  if (!uid) return null;
  const p = db.profiles.find((x) => x.id === uid && x.active && !suspended(x.company_id));
  return { uid, profile: p };
}
const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const readBody = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d ? JSON.parse(d) : {})); });

function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (["select", "order", "limit", "columns", "on_conflict"].includes(k)) continue;
    if (v === "is.null") out = out.filter((r) => r[k] == null);
    else if (v.startsWith("eq.")) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith("gte.")) out = out.filter((r) => String(r[k]) >= v.slice(4) || Number(r[k]) >= Number(v.slice(4)));
    else if (v.startsWith("in.(")) { const set = v.slice(4, -1).split(",").map((x) => x.replace(/^"|"$/g, "")); out = out.filter((r) => set.includes(String(r[k]))); }
  }
  const order = params.get("order");
  if (order) { const [col, dir] = order.split("."); out = [...out].sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (dir === "desc" ? -1 : 1)); }
  const limit = params.get("limit");
  if (limit) out = out.slice(0, Number(limit));
  return out;
}
// Row visibility = same company (mirrors the RLS policies).
const visible = (c, table, rows) => c.service ? rows : SERVICE_ONLY.includes(table) ? [] : table === "platform_settings" ? rows : !c.profile ? [] :
  rows.filter((r) => (table === "companies" ? r.id : r.company_id) === c.profile.company_id).filter((r) => {
    // head-office cashiers don't see bills or claims (mirrors migration 0014)
    if (c.profile.role === "cashier") return !["bill_accounts", "bill_payments", "claims", "claim_payments"].includes(table);
    // branch staff (mirrors migration 0010)
    if (c.profile.role !== "agent") return true;
    const st = c.profile.station;
    if (table === "shipments") return r.created_by === c.profile.id || (r.status !== "received" && r.dest === st);
    if (table === "trips") return r.origin === st || r.dest === st;
    // bills and claims of their own office (mirrors migration 0012)
    if (table === "bill_accounts" || table === "claims") return r.station === st;
    if (table === "bill_payments") return db.bill_accounts.some((a) => a.id === r.account_id && a.station === st);
    if (table === "claim_payments") return db.claims.some((x) => x.id === r.claim_id && x.station === st);
    return true;
  });
const DEFAULTS = {
  vehicles: { driver: "", driver_phone: "", target: 0, target_set_by: null, target_set_at: null, ownership: "own", owner_name: "", owner_phone: "", rent_amount: 0, rent_basis: "trip" },
  trips: { driver: "", driver_phone: "", target: 0, target_set_by: null, status: "loading", departed_at: null, departed_by: null, arrived_at: null, arrived_by: null, ownership: "own", owner_name: "", rent_cost: 0 },
  shipments: { kg: null, method: null, paid_at: null, paid_by: null, notes: "", status: "received", trip_id: null, loaded_at: null, transit_at: null, arrived_at: null, collected_at: null, collected_by: null, notices: [], items: [], found_on_arrival: false, found_note: "", checked_by: null, checked_at: null, account_id: null, gross_charge: null, discount: 0, discount_reason: "", discount_by: null, discount_at: null, dn_no: null, collector_name: "", collector_phone: "", collector_id: "", collect_note: "" },
  bill_accounts: { phone: "", notes: "", active: true, station: null },
  bill_payments: { method: "", reference: "", note: "" },
  claims: { station: null, shipment_id: null, waybill: "", customer_phone: "", description: "", goods_value: 0, compensation: 0, closed: false },
  claim_payments: { method: "", reference: "" },
  companies: { branch: "", phone: "", default_origin: "DAR", message_lang: "sw", payment_instructions: "", found_goods_by: "all", offices: [] },
  profiles: { active: true, station: null },
};

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204);
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  // ---------------- auth
  if (p === "/auth/v1/token") {
    const b = await readBody(req);
    if (url.searchParams.get("grant_type") === "password") {
      const u = users.find((x) => x.email === b.email && x.password === b.password);
      if (!u) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", msg: "Invalid login credentials" });
      if (u.banned) return send(res, 400, { error: "user_banned", msg: "User is banned" });
      return send(res, 200, session(u));
    }
    const uid = sessions.get("r:" + b.refresh_token);
    const u = users.find((x) => x.id === uid);
    return u ? send(res, 200, session(u)) : send(res, 400, { error: "invalid_grant", msg: "Invalid Refresh Token" });
  }
  if (p === "/auth/v1/user") {
    const c = caller(req);
    const u = c && users.find((x) => x.id === c.uid);
    if (req.method === "PUT" && u) { const b = await readBody(req); if (b.password) u.password = b.password; }
    return u ? send(res, 200, userObj(u)) : send(res, 401, { msg: "invalid JWT" });
  }
  if (p === "/auth/v1/logout") return send(res, 204);
  if (p === "/auth/v1/recover") return send(res, 200, {});
  if (p === "/auth/v1/admin/users" && req.method === "POST") {
    if (!caller(req)?.service) return send(res, 401, { msg: "not admin" });
    const b = await readBody(req);
    if (users.some((x) => x.email === b.email)) return send(res, 422, { msg: "A user with this email address has already been registered", code: "email_exists" });
    const u = { id: crypto.randomUUID(), email: b.email, password: b.password };
    users.push(u);
    return send(res, 200, userObj(u));
  }
  const m = p.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
  if (m) {
    if (!caller(req)?.service) return send(res, 401, { msg: "not admin" });
    const u = users.find((x) => x.id === m[1]);
    if (!u) return send(res, 404, { msg: "not found" });
    if (req.method === "DELETE") { users.splice(users.indexOf(u), 1); return send(res, 200, {}); }
    const b = await readBody(req);
    if (b.password) u.password = b.password;
    if (b.ban_duration) u.banned = b.ban_duration !== "none";
    return send(res, 200, userObj(u));
  }
  // ---------------- rpc
  if (p === "/rest/v1/rpc/owner_company_stats") {
    if (!caller(req)?.service) return send(res, 401, { message: "permission denied" });
    const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0); const inM = (d) => d && new Date(d) >= m0;
    return send(res, 200, db.companies.map((c) => {
      const S = db.shipments.filter((x) => x.company_id === c.id), T = db.trips.filter((x) => x.company_id === c.id), P = db.profiles.filter((x) => x.company_id === c.id);
      return { company_id: c.id, staff: P.length, active_staff: P.filter((x) => x.active).length, vehicles: db.vehicles.filter((x) => x.company_id === c.id).length,
        trips_month: T.filter((x) => inM(x.created_at)).length, ship_month: S.filter((x) => inM(x.received_at)).length,
        billed_month: S.filter((x) => inM(x.received_at)).reduce((a, x) => a + Number(x.charge || 0), 0),
        paid_month: S.filter((x) => x.pay === "paid" && inM(x.paid_at)).reduce((a, x) => a + Number(x.charge || 0), 0),
        ship_total: S.length, last_activity: [...S.map((x) => x.received_at), ...T.map((x) => x.created_at), c.created_at].sort().pop() };
    }));
  }
  // ---------------- rest
  const t = p.match(/^\/rest\/v1\/(\w+)$/);
  if (t && db[t[1]]) {
    const table = t[1];
    const c = caller(req);
    if (!c) return send(res, 401, { message: "JWT required" });
    const single = (req.headers.accept || "").includes("vnd.pgrst.object");
    const role = c.profile?.role;
    const wantRows = (req.headers.prefer || "").includes("return=representation");
    const out = (rows) => single ? (rows.length === 1 ? send(res, 200, rows[0]) : send(res, 406, { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" })) : send(res, 200, rows);
    if (req.method === "GET") return out(applyFilters(visible(c, table, db[table]), url.searchParams));
    if (req.method === "POST") {
      const b = await readBody(req);
      const list = (Array.isArray(b) ? b : [b]).map((r) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...DEFAULTS[table], ...r }));
      if (SERVICE_ONLY.includes(table) && !c.service) return send(res, 403, { message: "permission denied" });
      if ((req.headers.prefer || "").includes("merge-duplicates") && PK[table]) {
        const out2 = list.map((r) => { const ex = db[table].find((x) => x[PK[table]] === r[PK[table]]); if (ex) { Object.assign(ex, r); return ex; } db[table].push(r); return r; });
        return wantRows || single ? out(out2) : send(res, 201);
      }
      if (!c.service) {
        const allowed = { shipments: ["admin", "cashier", "agent"], trips: ["admin", "cashier", "agent"], vehicles: ["admin"], bill_accounts: ["admin", "agent"], bill_payments: ["admin", "agent"], claims: ["admin", "agent"], claim_payments: ["admin", "agent"] }[table] || [];
        if (role === "agent" && (table === "bill_accounts" || table === "claims")) list.forEach((r) => { r.station = c.profile.station; });
        if (!allowed.includes(role) || list.some((r) => r.company_id !== c.profile.company_id)) return send(res, 403, { message: "new row violates row-level security policy" });
        if (role === "agent" && list.some((r) => (table === "shipments" && r.origin !== c.profile.station && !(r.found_on_arrival && r.dest === c.profile.station)) || (table === "trips" && r.origin !== c.profile.station)))
          return send(res, 403, { message: "new row violates row-level security policy" });
        if (table === "shipments" && role === "cashier" && list.some((r) => r.pay === "bill")) return send(res, 400, { message: "Monthly bills are handled at the destination office or by the Admin" });
        if (table === "trips" && role === "cashier") list.forEach((r) => { const v = db.vehicles.find((x) => x.company_id === r.company_id && x.plate === r.plate); r.target = v?.target || 0; });
      }
      db[table].push(...list);
      if (table === "companies") list.forEach((co) => db.company_accounts.push({ company_id: co.id, status: "trial", trial_ends: plusDays(ymd(), db.platform_settings[0].trial_days), paid_until: null, custom_fee: null, auto_status: true, notes: "", status_changed_at: new Date().toISOString(), created_at: new Date().toISOString() }));
      if (table === "leads") list.forEach((r, i) => { r.id = db.leads.length + i; r.created_at = new Date().toISOString(); r.status = r.status || "new"; });
      if (table === "owner_audit") list.forEach((r, i) => { r.id = db.owner_audit.length + i; r.at = new Date().toISOString(); });
      if (table === "billing_bands") list.forEach((r, i) => { r.id = Date.now() + i; });
      if (table === "billing_payments") list.forEach((r, i) => { r.id = db.billing_payments.length + 1 + i + Math.floor(Math.random() * 1e6) * 100; r.paid_on = r.paid_on || ymd(); r.setup_fee = r.setup_fee || 0; });
      if (["sales_agents", "commissions", "agent_payouts"].includes(table)) list.forEach((r, i) => { r.id = Date.now() * 10 + i; });
      if (table === "sales_agents") list.forEach((r) => Object.assign(r, { active: true, signing_pct: 100, setup_pct: 30, commission_pct: 10, commission_months: 12, notes: "", phone: "", email: "", ...r }));
      if (table === "commissions") list.forEach((r) => { r.payout_id = r.payout_id ?? null; r.payment_id = r.payment_id ?? null; r.note = r.note || ""; r.earned_on = r.earned_on || ymd(); });
      return wantRows || single ? out(list) : send(res, 201);
    }
    if (req.method === "PATCH") {
      const b = await readBody(req);
      if (!c.service) {
        const allowed = { shipments: ["admin", "cashier", "agent"], trips: ["admin", "cashier", "ceo", "agent"], vehicles: ["admin", "ceo"], companies: ["admin"], bill_accounts: ["admin"], bill_payments: ["admin"], claims: ["admin"], claim_payments: ["admin"] }[table] || [];
        if (SERVICE_ONLY.includes(table) || table === "platform_settings") return send(res, 403, { message: "permission denied" });
        if (!allowed.includes(role)) return out([]);
        if (table === "shipments" && role === "cashier" && b.pay === "bill") return send(res, 400, { message: "Monthly bills are handled at the destination office or by the Admin" });
        if (role === "cashier" && "target" in b) return send(res, 400, { message: "Only the Admin or CEO can change a target" });
        if (role === "ceo" && Object.keys(b).some((k) => !["target", "target_set_by", "target_set_at"].includes(k))) return send(res, 400, { message: "The CEO can only change targets" });
      }
      const rows = applyFilters(visible(c, table, db[table]), url.searchParams);
      if (table === "shipments" && rows.some((r) => ({ ...r, ...b }).status === "collected" && !["paid", "bill"].includes(({ ...r, ...b }).pay)))
        return send(res, 400, { message: "Record the payment before releasing the goods" });
      rows.forEach((r) => Object.assign(r, b));
      return wantRows || single ? out(rows) : send(res, 204);
    }
    if (req.method === "DELETE") {
      if (!c.service && role !== "admin") return send(res, 204);
      const rows = applyFilters(visible(c, table, db[table]), url.searchParams);
      db[table] = db[table].filter((r) => !rows.includes(r));
      return send(res, 204);
    }
  }
  send(res, 404, { message: "not found " + p });
}).listen(54321, () => console.log("mock supabase on :54321"));
