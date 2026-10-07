// Shared types, reference data and helpers for Shehena.

export type Role = "admin" | "cashier" | "ceo";
export type ShipStatus = "received" | "loaded" | "transit" | "arrived" | "collected";
export type TripStatus = "loading" | "departed" | "arrived";
export type NoticeKind = "received" | "departed" | "arrived" | "reminder";
export type NoticeTo = "sender" | "receiver";

export interface Company {
  id: string;
  name: string;
  branch: string;
  phone: string;
  default_origin: string;
  message_lang: "sw" | "en";
  payment_instructions: string;
}
export interface Profile {
  id: string;
  company_id: string;
  full_name: string;
  email: string;
  role: Role;
  active: boolean;
  created_at?: string;
}
export interface Vehicle {
  id: string;
  company_id: string;
  plate: string;
  driver: string;
  driver_phone: string;
  target: number;
  target_set_by: string | null;
  target_set_at: string | null;
}
export interface Trip {
  id: string;
  company_id: string;
  no: string;
  plate: string;
  driver: string;
  driver_phone: string;
  target: number;
  target_set_by: string | null;
  origin: string;
  dest: string;
  status: TripStatus;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  departed_at: string | null;
  departed_by: string | null;
  arrived_at: string | null;
  arrived_by: string | null;
}
export interface Notice {
  kind: NoticeKind;
  to: NoticeTo;
  channel: "WhatsApp" | "SMS";
  at: string;
  by: string;
}
export interface Shipment {
  id: string;
  company_id: string;
  no: string;
  s_name: string;
  s_phone: string;
  r_name: string;
  r_phone: string;
  item: string;
  pkgs: number;
  kg: number | null;
  origin: string;
  dest: string;
  charge: number;
  pay: "paid" | "unpaid";
  method: string | null;
  paid_at: string | null;
  paid_by: string | null;
  notes: string;
  status: ShipStatus;
  trip_id: string | null;
  received_at: string;
  loaded_at: string | null;
  transit_at: string | null;
  arrived_at: string | null;
  collected_at: string | null;
  collected_by: string | null;
  notices: Notice[];
  created_by: string | null;
  created_by_name: string | null;
}

export const SYSTEM = "Shehena";

export const REGIONS: [string, string][] = [
  ["ARU", "Arusha"], ["DAR", "Dar es Salaam"], ["DOD", "Dodoma"], ["GEI", "Geita"], ["IRI", "Iringa"],
  ["KAG", "Kagera (Bukoba)"], ["KAT", "Katavi (Mpanda)"], ["KIG", "Kigoma"], ["KLM", "Kilimanjaro (Moshi)"],
  ["LIN", "Lindi"], ["MNY", "Manyara (Babati)"], ["MAR", "Mara (Musoma)"], ["MBY", "Mbeya"], ["MOR", "Morogoro"],
  ["MTW", "Mtwara"], ["MWZ", "Mwanza"], ["NJO", "Njombe"], ["PWA", "Pwani (Kibaha)"], ["RUK", "Rukwa (Sumbawanga)"],
  ["RUV", "Ruvuma (Songea)"], ["SHY", "Shinyanga"], ["SIM", "Simiyu (Bariadi)"], ["SIN", "Singida"],
  ["SON", "Songwe (Vwawa)"], ["TAB", "Tabora"], ["TAN", "Tanga"], ["ZNZ", "Zanzibar"],
];
export const METHODS = ["Cash", "M-Pesa", "Mixx by Yas", "Airtel Money", "HaloPesa", "Bank"];
export const STATUS: [ShipStatus, string][] = [
  ["received", "At office"], ["loaded", "Loaded"], ["transit", "In transit"], ["arrived", "Arrived"], ["collected", "Collected"],
];
export const TSTATUS: [TripStatus, string][] = [["loading", "Loading"], ["departed", "On the road"], ["arrived", "Arrived"]];
export const ROLES: Record<Role, string> = { admin: "Admin", cashier: "Cashier", ceo: "CEO" };

export type Perm = "receive" | "pay" | "load" | "dispatch" | "notify" | "delete" | "settings" | "undo" | "reports" | "target";
const PERMS: Record<Role, Perm[]> = {
  admin: ["receive", "pay", "load", "dispatch", "notify", "delete", "settings", "undo", "reports", "target"],
  cashier: ["receive", "pay", "load", "dispatch", "notify"],
  ceo: ["reports", "target"],
};
export const can = (role: Role | undefined, p: Perm) => !!role && PERMS[role].includes(p);

export const regName = (c: string) => (REGIONS.find((r) => r[0] === c) || [c, c])[1];
export const regShort = (c: string) => regName(c).replace(/ \(.*\)/, "");
export const stLabel = (s: string) => (STATUS.find((x) => x[0] === s) || [s, s])[1];
export const tLabel = (s: string) => (TSTATUS.find((x) => x[0] === s) || [s, s])[1];

export const tzs = (n: number | string | null | undefined) => Number(n || 0).toLocaleString("en-US");
export function fmtDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) + " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
export const fmtDay = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "";

export function intlPhone(p?: string | null) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "255" + d.slice(1);
  else if (d.length === 9) d = "255" + d;
  return d;
}
export const validPhone = (p: string) => /^255[67]\d{8}$/.test(intlPhone(p));
export function prettyPhone(p?: string | null) {
  const d = intlPhone(p);
  return d.length === 12 ? `+${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}` : String(p || "");
}
export function ymd() {
  const t = new Date();
  return String(t.getFullYear()).slice(2) + String(t.getMonth() + 1).padStart(2, "0") + String(t.getDate()).padStart(2, "0");
}
export const pkgsOf = (list: Shipment[]) => list.reduce((a, s) => a + Number(s.pkgs || 0), 0);
export const sumCharge = (list: Shipment[]) => list.reduce((a, s) => a + Number(s.charge || 0), 0);
export const initials = (name: string) =>
  (name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/** Customer message text, Kiswahili or English, for each notice type. */
export function message(s: Shipment, kind: NoticeKind, to: NoticeTo, company: Company, plate = "") {
  const sw = company.message_lang !== "en";
  const co = company.name || SYSTEM;
  const ph = company.phone?.trim() || "";
  const items = `${s.item}, ${sw ? "vifurushi" : "packages"} ${s.pkgs}`;
  const payLine = s.pay === "paid"
    ? (sw ? "Malipo: IMELIPWA." : "Payment: PAID.")
    : (sw ? `Malipo: HAIJALIPWA - TZS ${tzs(s.charge)} ilipwe wakati wa kuchukua.` : `Payment: NOT PAID - TZS ${tzs(s.charge)} due on collection.`);
  const O = regShort(s.origin), D = regShort(s.dest);
  const day = fmtDay(s.transit_at || new Date().toISOString());
  if (kind === "received" && to === "sender") return sw
    ? `Habari ${s.s_name}, tumepokea mzigo wako (${items}) kwenda kwa ${s.r_name}, ${D}. Namba ya risiti: ${s.no}. ${payLine} Asante kwa kutumia ${co}.${ph ? " Simu: " + ph : ""}`
    : `Hello ${s.s_name}, we have received your goods (${items}) for ${s.r_name}, ${D}. Receipt no: ${s.no}. ${payLine} Thank you for using ${co}.${ph ? " Tel: " + ph : ""}`;
  if (kind === "received") return sw
    ? `Habari ${s.r_name}, mzigo wako (${items}) kutoka kwa ${s.s_name} umepokelewa ${O} na utasafirishwa kwenda ${D}. Namba ya mzigo: ${s.no}. ${payLine} ${co}${ph ? ", simu: " + ph : ""}`
    : `Hello ${s.r_name}, your goods (${items}) from ${s.s_name} have been received in ${O} and will be sent to ${D}. Waybill no: ${s.no}. ${payLine} ${co}${ph ? ", tel: " + ph : ""}`;
  if (kind === "departed") return sw
    ? `Habari ${s.r_name}, mzigo wako namba ${s.no} (${items}) umepakiwa kwenye gari ${plate} na umeondoka ${O} ${day} kuelekea ${D}. Tutakujulisha ukifika. ${co}${ph ? ", simu: " + ph : ""}`
    : `Hello ${s.r_name}, your goods, waybill ${s.no} (${items}), are loaded on vehicle ${plate} and left ${O} on ${day} for ${D}. We will notify you on arrival. ${co}${ph ? ", tel: " + ph : ""}`;
  if (kind === "arrived" && to === "sender") return sw
    ? `Habari ${s.s_name}, mzigo namba ${s.no} (${items}) uliotuma kwa ${s.r_name} umefika ${D}. ${co}${ph ? ", simu: " + ph : ""}`
    : `Hello ${s.s_name}, waybill ${s.no} (${items}) you sent to ${s.r_name} has arrived in ${D}. ${co}${ph ? ", tel: " + ph : ""}`;
  const due = `TZS ${tzs(s.charge)}`;
  const how = company.payment_instructions?.trim();
  if (kind === "reminder") return sw
    ? `Kumbusho: Habari ${s.r_name}, mzigo wako namba ${s.no} (${items}) upo ofisini ${D} tangu ${fmtDay(s.arrived_at)}. Kiasi cha kulipa ni ${due}.${how ? ` Lipa kupitia: ${how}.` : ""} Baada ya kulipa, fika na kitambulisho kuuchukua. ${co}${ph ? ", simu: " + ph : ""}`
    : `Reminder: Hello ${s.r_name}, your goods, waybill ${s.no} (${items}), have been waiting at our ${D} office since ${fmtDay(s.arrived_at)}. Amount due: ${due}.${how ? ` Pay via: ${how}.` : ""} After paying, come with ID to collect. ${co}${ph ? ", tel: " + ph : ""}`;
  if (s.pay !== "paid") return sw
    ? `Habari ${s.r_name}, mzigo wako namba ${s.no} (${items}) umefika ${D}${plate ? " kwa gari " + plate : ""}. Kiasi cha kulipa ni ${due}.${how ? ` Tafadhali lipia kupitia: ${how}.` : " Tafadhali lipia ofisini."} Baada ya kulipa, fika ofisini na kitambulisho na namba ya mzigo ili kuuchukua. ${co}${ph ? ", simu: " + ph : ""}`
    : `Hello ${s.r_name}, your goods, waybill ${s.no} (${items}), have arrived in ${D}${plate ? " on vehicle " + plate : ""}. Amount due: ${due}.${how ? ` Please pay via: ${how}.` : " Please pay at our office."} Once paid, come to our office with ID and this waybill number to collect. ${co}${ph ? ", tel: " + ph : ""}`;
  return sw
    ? `Habari ${s.r_name}, mzigo wako namba ${s.no} (${items}) umefika ${D}${plate ? " kwa gari " + plate : ""}. Malipo yamekamilika. Tafadhali fika ofisini kuuchukua ukiwa na kitambulisho na namba hii. ${co}${ph ? ", simu: " + ph : ""}`
    : `Hello ${s.r_name}, your goods, waybill ${s.no} (${items}), have arrived in ${D}${plate ? " on vehicle " + plate : ""}. Payment is complete. Please come to our office with ID and this number to collect. ${co}${ph ? ", tel: " + ph : ""}`;
}

export function niceStep(max: number) {
  const raw = max / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
