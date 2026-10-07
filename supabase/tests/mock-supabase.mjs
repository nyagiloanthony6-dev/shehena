// Minimal in-memory stand-in for Supabase Auth + PostgREST, for local UI testing only.
// Not used in production. Run: node supabase/tests/mock-supabase.mjs (port 54321)
import http from "node:http";
import crypto from "node:crypto";

const db = { companies: [], profiles: [], vehicles: [], trips: [], shipments: [] };
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
  const p = db.profiles.find((x) => x.id === uid && x.active);
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
    if (v.startsWith("eq.")) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith("in.(")) { const set = v.slice(4, -1).split(",").map((x) => x.replace(/^"|"$/g, "")); out = out.filter((r) => set.includes(String(r[k]))); }
  }
  const order = params.get("order");
  if (order) { const [col, dir] = order.split("."); out = [...out].sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (dir === "desc" ? -1 : 1)); }
  const limit = params.get("limit");
  if (limit) out = out.slice(0, Number(limit));
  return out;
}
// Row visibility = same company (mirrors the RLS policies).
const visible = (c, table, rows) => c.service ? rows : !c.profile ? [] :
  rows.filter((r) => (table === "companies" ? r.id : r.company_id) === c.profile.company_id);
const DEFAULTS = {
  vehicles: { driver: "", driver_phone: "", target: 0, target_set_by: null, target_set_at: null },
  trips: { driver: "", driver_phone: "", target: 0, target_set_by: null, status: "loading", departed_at: null, departed_by: null, arrived_at: null, arrived_by: null },
  shipments: { kg: null, method: null, paid_at: null, paid_by: null, notes: "", status: "received", trip_id: null, loaded_at: null, transit_at: null, arrived_at: null, collected_at: null, collected_by: null, notices: [] },
  companies: { branch: "", phone: "", default_origin: "DAR", message_lang: "sw", payment_instructions: "" },
  profiles: { active: true },
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
      if (!c.service) {
        const allowed = { shipments: ["admin", "cashier"], trips: ["admin", "cashier"], vehicles: ["admin"] }[table] || [];
        if (!allowed.includes(role) || list.some((r) => r.company_id !== c.profile.company_id)) return send(res, 403, { message: "new row violates row-level security policy" });
        if (table === "trips" && role === "cashier") list.forEach((r) => { const v = db.vehicles.find((x) => x.company_id === r.company_id && x.plate === r.plate); r.target = v?.target || 0; });
      }
      db[table].push(...list);
      return wantRows || single ? out(list) : send(res, 201);
    }
    if (req.method === "PATCH") {
      const b = await readBody(req);
      if (!c.service) {
        const allowed = { shipments: ["admin", "cashier"], trips: ["admin", "cashier", "ceo"], vehicles: ["admin", "ceo"], companies: ["admin"] }[table] || [];
        if (!allowed.includes(role)) return out([]);
        if (role === "cashier" && "target" in b) return send(res, 400, { message: "Only the Admin or CEO can change a target" });
        if (role === "ceo" && Object.keys(b).some((k) => !["target", "target_set_by", "target_set_at"].includes(k))) return send(res, 400, { message: "The CEO can only change targets" });
      }
      const rows = applyFilters(visible(c, table, db[table]), url.searchParams);
      if (table === "shipments" && rows.some((r) => ({ ...r, ...b }).status === "collected" && ({ ...r, ...b }).pay !== "paid"))
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
