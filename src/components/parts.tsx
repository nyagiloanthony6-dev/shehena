"use client";
import { useStore } from "./store";
import {
  fmtDate, fmtDay, intlPhone, message, pkgsOf, prettyPhone, regName, regShort, stLabel, tLabel, tzs,
  type Company, type NoticeKind, type NoticeTo, type Shipment, type Trip,
} from "@/lib/domain";

export const StatusPill = ({ s }: { s: string }) => <span className={`pill st-${s}`}>{stLabel(s)}</span>;
export const TripPill = ({ s }: { s: string }) => <span className={`pill st-${s}`}>{tLabel(s)}</span>;
export const PayPill = ({ paid, long }: { paid: boolean; long?: boolean }) => (
  <span className={`pill pay-${paid ? "paid" : "unpaid"}`}>{paid ? "Paid" : long ? "Not paid – due on collection" : "Not paid"}</span>
);
export const Example = () => null;

export function tripTotals(list: Shipment[]) {
  const billed = list.reduce((a, x) => a + Number(x.charge || 0), 0);
  const paid = list.filter((x) => x.pay === "paid").reduce((a, x) => a + Number(x.charge || 0), 0);
  return {
    n: list.length, pkgs: pkgsOf(list), billed, paid, due: billed - paid,
    senders: new Set(list.map((x) => intlPhone(x.s_phone))).size,
    receivers: new Set(list.map((x) => intlPhone(x.r_phone))).size,
    unpaidN: list.filter((x) => x.pay !== "paid").length,
  };
}

export function Meter({ trip, compact }: { trip: Trip; compact?: boolean }) {
  const { tripShips } = useStore();
  const n = tripTotals(tripShips(trip)).billed;
  const tg = Number(trip.target) || 0;
  if (!tg) return <div className="meterlbl"><span>TZS <b className="num">{tzs(n)}</b> loaded</span><span>No target set</span></div>;
  const pct = Math.min(100, (n / tg) * 100);
  const full = n >= tg;
  return (
    <>
      <div className="meterlbl">
        <span>TZS <b className="num">{tzs(n)}</b> of <span className="num">{tzs(tg)}</span>{compact ? "" : " target"}</span>
        {full ? <span className="fullflag">TARGET REACHED</span>
          : <span>{Math.round((n / tg) * 100)}%{compact ? "" : ` · TZS ${tzs(tg - n)} to go`}</span>}
      </div>
      <div className={`meter${full ? " full" : ""}`} role="img" aria-label={`TZS ${tzs(n)} of ${tzs(tg)} target`}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </>
  );
}

export function TripCard({ trip, onOpen }: { trip: Trip; onOpen: (id: string) => void }) {
  const { tripShips } = useStore();
  const x = tripTotals(tripShips(trip));
  return (
    <div className="trip" tabIndex={0} role="button" onClick={() => onOpen(trip.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(trip.id)}>
      <div className="top"><span className="plate">{trip.plate}</span><TripPill s={trip.status} /></div>
      <div className="route">{regShort(trip.origin)}<i>→</i>{regShort(trip.dest)}</div>
      <div className="sub">{trip.no} · {trip.driver || "No driver"}</div>
      <div className="tline">
        <span><b>{x.senders}</b> customer{x.senders === 1 ? "" : "s"}</span>
        <span><b>{x.pkgs}</b> pkgs</span>
        <span>TZS <b>{tzs(x.billed)}</b></span>
        {x.due > 0 && <span style={{ color: "var(--bad)" }}>TZS <b style={{ color: "inherit" }}>{tzs(x.due)}</b> unpaid</span>}
      </div>
      <Meter trip={trip} compact />
      <div className="sub">
        {trip.status === "loading" ? `Started ${fmtDate(trip.created_at)}` : trip.status === "departed" ? `Left ${fmtDate(trip.departed_at)}` : `Arrived ${fmtDate(trip.arrived_at)}`}
      </div>
    </div>
  );
}

export function TripSummary({ trip }: { trip: Trip }) {
  const { tripShips } = useStore();
  const x = tripTotals(tripShips(trip));
  return (
    <div className="tsum" aria-label="Load summary">
      <div><div className="lbl">Customers</div><div className="v">{x.senders}</div><div className="s">{x.receivers} receiver{x.receivers === 1 ? "" : "s"} · {x.n} consignment{x.n === 1 ? "" : "s"}</div></div>
      <div><div className="lbl">Packages</div><div className="v">{x.pkgs}</div><div className="s">on this truck</div></div>
      <div><div className="lbl">Total collections</div><div className="v">{tzs(x.billed)}</div><div className="s">TZS · {tzs(x.paid)} paid</div></div>
      <div className={x.due ? "due" : ""}><div className="lbl">To collect</div><div className="v">{tzs(x.due)}</div><div className="s">TZS on delivery · {x.unpaidN} unpaid</div></div>
    </div>
  );
}

export function Slip({ s, company, servedBy }: { s: Partial<Shipment>; company: Company; servedBy?: string }) {
  const paid = s.pay === "paid";
  const head = [company.branch, company.phone ? "Tel " + company.phone : ""].filter(Boolean).join(" · ");
  return (
    <div className="slip">
      <div className="co">{company.name || "Your company"}</div>
      {head && <div className="sub">{head}</div>}
      <div className="lbl" style={{ marginTop: 12 }}>Cargo receipt · Waybill no.</div>
      <div className="no">{s.no || "—"}</div>
      <dl>
        <dt>Date</dt><dd>{fmtDate(s.received_at || new Date().toISOString())}</dd>
        <dt>Sender</dt><dd>{s.s_name || "—"}<br /><span className="mono sub">{prettyPhone(s.s_phone)}</span></dd>
        <dt>Receiver</dt><dd>{s.r_name || "—"}<br /><span className="mono sub">{prettyPhone(s.r_phone)}</span></dd>
        <dt>Route</dt><dd>{regName(s.origin || "")} → {regName(s.dest || "")}</dd>
      </dl>
      <hr />
      <dl>
        <dt>Item</dt><dd>{s.item || "—"}</dd>
        <dt>Packages</dt><dd className="num">{s.pkgs || "—"}</dd>
        {s.kg ? <><dt>Weight</dt><dd className="num">{s.kg} kg</dd></> : null}
        {s.notes ? <><dt>Notes</dt><dd>{s.notes}</dd></> : null}
      </dl>
      <hr />
      <div className="big"><span>Charge</span><b>TZS {tzs(s.charge)}</b></div>
      <div className="big" style={{ marginTop: 6 }}><span>Payment</span>
        <span className={`pill pay-${paid ? "paid" : "unpaid"}`}>{paid ? "Paid" + (s.method ? " · " + s.method : "") : "Not paid – due on collection"}</span>
      </div>
      <p className="sub" style={{ margin: "12px 0 0" }}>Served by {s.created_by_name || servedBy || "—"}. Keep this receipt. The receiver collects with ID and the waybill number.</p>
    </div>
  );
}

export async function downloadReceipt(s: Shipment, company: Company) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: [80, 160] });
  let y = 10;
  const L = 6, W = 68;
  const line = (t: string, sz = 9, b = false) => {
    doc.setFont("helvetica", b ? "bold" : "normal"); doc.setFontSize(sz);
    const w = doc.splitTextToSize(String(t), W); doc.text(w, L, y); y += w.length * sz * 0.42 + 1.6;
  };
  const pair = (k: string, v: string) => {
    doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.text(k, L, y);
    const w = doc.splitTextToSize(String(v), 44); doc.setFont("helvetica", "bold"); doc.text(w, L + 24, y); y += w.length * 3.8 + 1.2;
  };
  const dash = () => { doc.setLineDashPattern([1, 1], 0); doc.line(L, y, L + W, y); y += 4; };
  line((company.name || "Shehena").toUpperCase(), 13, true);
  line([company.branch, company.phone ? "Tel " + company.phone : ""].filter(Boolean).join(" · ") || " ", 8); y += 2;
  line("CARGO RECEIPT", 8, true); line(s.no, 12, true); y += 1;
  pair("Date", fmtDate(s.received_at)); pair("Sender", `${s.s_name}, ${prettyPhone(s.s_phone)}`);
  pair("Receiver", `${s.r_name}, ${prettyPhone(s.r_phone)}`); pair("Route", `${regName(s.origin)} to ${regName(s.dest)}`); dash();
  pair("Item", s.item); pair("Packages", String(s.pkgs)); if (s.kg) pair("Weight", s.kg + " kg"); if (s.notes) pair("Notes", s.notes); dash();
  pair("Charge", "TZS " + tzs(s.charge)); pair("Payment", s.pay === "paid" ? "PAID" + (s.method ? ` (${s.method})` : "") : "NOT PAID - due on collection");
  pair("Served by", s.created_by_name || "-"); dash();
  line("Keep this receipt. The receiver collects with ID and the waybill number.", 7.5);
  doc.save(`Receipt-${s.no}.pdf`);
}

async function copy(text: string, toast: (m: string, e?: boolean) => void) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Copy isn't available here.", true); }
}

/** WhatsApp / SMS / Copy buttons; tapping WhatsApp or SMS logs the notice on the consignment. */
export function SendButtons({ s, kind, to }: { s: Shipment; kind: NoticeKind; to: NoticeTo }) {
  const { company, me, can, patch, toast, tripById } = useStore();
  if (!can("notify")) return null;
  const phone = to === "sender" ? s.s_phone : s.r_phone;
  const txt = message(s, kind, to, company, tripById(s.trip_id)?.plate);
  const p = intlPhone(phone);
  const log = (channel: "WhatsApp" | "SMS") =>
    patch<Shipment>("shipments", s.id, { notices: [...(s.notices || []), { kind, to, channel, at: new Date().toISOString(), by: me.full_name }] });
  return (
    <>
      <a className="btn wa sm" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${p}?text=${encodeURIComponent(txt)}`} onClick={() => log("WhatsApp")}>WhatsApp</a>
      <a className="btn sm" href={`sms:+${p}?body=${encodeURIComponent(txt)}`} onClick={() => log("SMS")}>SMS</a>
      <button className="btn sm" onClick={() => copy(txt, toast)}>Copy</button>
    </>
  );
}

export const sentLog = (s: Shipment, kind: NoticeKind, to: NoticeTo) => (s.notices || []).filter((n) => n.kind === kind && n.to === to);

export function NotifyBlock({ s, kind, to }: { s: Shipment; kind: NoticeKind; to: NoticeTo }) {
  const { company, tripById } = useStore();
  const phone = to === "sender" ? s.s_phone : s.r_phone;
  const name = to === "sender" ? s.s_name : s.r_name;
  const logs = sentLog(s, kind, to);
  return (
    <>
      <div className="to"><b>{to === "sender" ? "Sender" : "Receiver"}:</b> {name} · <span className="mono">{prettyPhone(phone)}</span></div>
      <div className="msg">{message(s, kind, to, company, tripById(s.trip_id)?.plate)}</div>
      <div className="actions"><SendButtons s={s} kind={kind} to={to} /></div>
      {logs.length
        ? <ul className="log">{logs.map((n, i) => <li key={i}>✓ Opened in {n.channel} by {n.by || "staff"} · {fmtDate(n.at)}</li>)}</ul>
        : <p className="note">Not sent yet.</p>}
    </>
  );
}

export function BulkNotices({ trip, kind }: { trip: Trip; kind: "departed" | "arrived" }) {
  const { tripShips, can, toast } = useStore();
  const list = [...tripShips(trip)].sort((a, b) => (a.pay === "paid" ? 1 : 0) - (b.pay === "paid" ? 1 : 0));
  const done = list.filter((s) => sentLog(s, kind, "receiver").length).length;
  const unpaid = list.filter((s) => s.pay !== "paid");
  const unpaidAmt = unpaid.reduce((a, s) => a + Number(s.charge || 0), 0);
  return (
    <div className="card">
      <h3>{kind === "departed" ? "Departure notices" : "Arrival notices"} · <span className="num">{done} of {list.length}</span> sent</h3>
      {kind === "arrived" && unpaid.length > 0 && (
        <p style={{ margin: "0 0 8px", color: "var(--bad)" }}><b>{unpaid.length} receiver{unpaid.length === 1 ? " still owes" : "s still owe"} TZS {tzs(unpaidAmt)}.</b> Their message tells them the amount and how to pay before collecting.</p>
      )}
      <p className="note" style={{ marginTop: 0 }}>Tap WhatsApp or SMS for each receiver. The message opens ready to send.</p>
      {list.map((s) => {
        const l = sentLog(s, kind, "receiver");
        return (
          <div className="nrow" key={s.id}>
            <div style={{ minWidth: 0 }}>
              <b>{s.r_name}</b> <span className="mono sub">{prettyPhone(s.r_phone)}</span>
              <div className="sub"><span className="mono">{s.no}</span> · {s.item} · {s.pkgs} pkg{kind === "arrived" && <> · {s.pay === "paid" ? <span style={{ color: "var(--good)" }}>Paid</span> : <span style={{ color: "var(--bad)" }}>Owes TZS {tzs(s.charge)}</span>}</>}</div>
              {l.length ? <span className="tick">✓ Sent via {l[l.length - 1].channel}</span> : <span className="pending">Not sent</span>}
            </div>
            <div className="actions" style={{ margin: 0 }}><SendButtons s={s} kind={kind} to="receiver" /></div>
          </div>
        );
      })}
      {!list.length && <p className="sub">No consignments on this vehicle.</p>}
      {list.length > 0 && can("notify") && (
        <>
          <div className="actions"><button className="btn sm" onClick={() => copy(list.map((s) => "+" + intlPhone(s.r_phone)).join(", "), toast)}>Copy all receiver numbers</button></div>
          <p className="note">For a bulk SMS service, paste the numbers there and send one message.</p>
        </>
      )}
    </div>
  );
}

export { fmtDay };
