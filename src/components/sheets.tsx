"use client";
import { useEffect, useState } from "react";
import { useStore } from "./store";
import { useUi } from "./CargoApp";
import { STICKER_SIZES, downloadReceiptAndStickers, downloadStickers, packages, saveStickerPrefs, stickerPrefs, type StickerPrefs } from "./stickers";
import { downloadManifest } from "./manifest";
import { DeliveryNoteCard, ReleaseForm } from "./release";
import { useArriveTrip, BulkNotices, Meter, NotifyBlock, PayPill, Slip, StatusPill, TripSummary, downloadReceipt, tripTotals } from "./parts";
import { PAY_LABEL, canRecordFound, settled } from "@/lib/domain";
import { METHODS, STATUS, TSTATUS, goodsLabel, fmtDate, fmtDay, pkgsOf, prettyPhone, regShort, tzs, type Shipment, type Trip } from "@/lib/domain";

export function ShipmentSheet({ id }: { id: string }) {
  const { shipById, tripById, can, patch, remove, me, company, toast } = useStore();
  const ui = useUi();
  const [releasing, setReleasing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const s = shipById(id);
  if (!s) return <div className="sheet-h"><p className="sub">This consignment no longer exists.</p><button className="btn sm" onClick={ui.close}>Close</button></div>;
  const idx = STATUS.findIndex((x) => x[0] === s.status);
  const t = tripById(s.trip_id);
  const times: Record<string, string | null> = { received: s.received_at, loaded: s.loaded_at, transit: s.transit_at, arrived: s.arrived_at, collected: s.collected_at };
  const now = () => new Date().toISOString();
  const P = (v: Partial<Shipment>) => patch<Shipment>("shipments", s.id, v);

  return (
    <>
      <div className="sheet-h">
        <div><div className="lbl">Waybill</div><h2 style={{ fontFamily: "var(--f-mono)" }}>{s.no}</h2></div>
        <button className="btn sm" onClick={ui.close}>Close</button>
      </div>

      {s.found_on_arrival && <FoundCard s={s} />}

      <div className="card"><h3>Delivery status</h3>
        <div className="steps">{STATUS.map(([k, l], i) => <div key={k} className={i <= idx ? "done" : ""}>{l}<small>{times[k] ? fmtDay(times[k]) : " "}</small></div>)}</div>
        {t && <p className="note">Vehicle <b className="mono">{t.plate}</b> · trip <a href="#" onClick={(e) => { e.preventDefault(); ui.openTrip(t.id); }}>{t.no}</a> · driver {t.driver || "—"}</p>}
        <div className="actions">
          {s.status === "received" && can("load") && <button className="btn" onClick={() => ui.go("trips")}>Load onto a vehicle</button>}
          {s.status === "arrived" && can("dispatch") && (settled(s) || can("pay")) && !releasing && <button className="btn primary" onClick={() => setReleasing(true)}>{s.pay === "unpaid" ? `Take TZS ${tzs(s.charge)} & release` : "Release goods to customer"}</button>}
          {s.status === "collected" && can("undo") && <button className="btn sm" onClick={() => P({ status: "arrived", collected_at: null, collected_by: null })}>Undo collected</button>}
        </div>
        {releasing && s.status === "arrived" && <ReleaseForm s={s} onDone={() => setReleasing(false)} />}
        {s.status === "collected" && <p className="note">Collected {fmtDate(s.collected_at)}{s.collected_by ? " · released by " + s.collected_by : ""}</p>}
      </div>
      <DeliveryNoteCard s={s} />

      <PaymentCard s={s} />

      {s.status === "arrived" && s.pay === "unpaid" && (
        <div className="card"><h3>Payment reminder</h3>
          <p className="note" style={{ marginTop: 0 }}>Waiting since {fmtDate(s.arrived_at)}. Send this if the customer hasn&apos;t come to pay and collect.</p>
          <NotifyBlock s={s} kind="reminder" to="receiver" />
        </div>
      )}
      {(s.status === "arrived" || s.status === "collected") && (
        <div className="card"><h3>Arrival notice</h3><NotifyBlock s={s} kind="arrived" to="receiver" />
          <details style={{ marginTop: 10 }}><summary className="sub" style={{ cursor: "pointer" }}>Also tell the sender</summary><NotifyBlock s={s} kind="arrived" to="sender" /></details>
        </div>
      )}
      {["transit", "arrived", "collected"].includes(s.status) && <div className="card"><h3>Departure notice</h3><NotifyBlock s={s} kind="departed" to="receiver" /></div>}
      <div className="card"><h3>Goods received notice</h3><NotifyBlock s={s} kind="received" to="receiver" />
        <details style={{ marginTop: 10 }}><summary className="sub" style={{ cursor: "pointer" }}>Send receipt to the sender</summary><NotifyBlock s={s} kind="received" to="sender" /></details>
      </div>
      <div className="card"><h3>Receipt and stickers</h3><Slip s={s} company={company} />
        <PrintActions s={s} />
      </div>
      <ShipmentClaims s={s} />
      {can("delete") && (
        <div className="card"><h3>Record</h3>
          {confirmDel
            ? <div className="confirm">Delete {s.no} permanently? <button className="btn sm danger" onClick={async () => { ui.close(); if (await remove("shipments", s.id)) toast("Consignment deleted"); }}>Delete</button><button className="btn sm" onClick={() => setConfirmDel(false)}>Keep</button></div>
            : <button className="btn sm danger" onClick={() => setConfirmDel(true)}>Delete consignment</button>}
        </div>
      )}
    </>
  );
}

export function TripSheet({ id }: { id: string }) {
  const { tripById, tripShips, shipments, can, patch, patchMany, remove, me, toast, company } = useStore();
  const ui = useUi();
  const [confirm, setConfirm] = useState<"" | "depart" | "arrive" | "del">("");
  const arriveTrip = useArriveTrip();
  const t = tripById(id);
  const [target, setTarget] = useState(String(t?.target || ""));
  const [rent, setRent] = useState(String(t?.rent_cost || ""));
  if (!t) return <div className="sheet-h"><p className="sub">This trip no longer exists.</p><button className="btn sm" onClick={ui.close}>Close</button></div>;
  const list = tripShips(t);
  const idx = TSTATUS.findIndex((x) => x[0] === t.status);
  const times: Record<string, string | null> = { loading: t.created_at, departed: t.departed_at, arrived: t.arrived_at };
  const n = pkgsOf(list);
  const full = t.target > 0 && tripTotals(list).billed >= t.target;
  const now = () => new Date().toISOString();
  const waiting = shipments.filter((s) => s.status === "received" && s.origin === t.origin)
    .sort((a, b) => (a.dest === t.dest ? 0 : 1) - (b.dest === t.dest ? 0 : 1) || a.received_at.localeCompare(b.received_at));

  const depart = async () => {
    setConfirm("");
    const at = now();
    if (await patch<Trip>("trips", t.id, { status: "departed", departed_at: at, departed_by: me.full_name })) {
      await patchMany("shipments", list.map((s) => s.id), { status: "transit", transit_at: at });
      toast(`${t.plate} departed. Send the departure notices.`);
    }
  };
  const arrive = async () => { setConfirm(""); await arriveTrip(t); };

  return (
    <>
      <div className="sheet-h">
        <div><div className="lbl">Trip {t.no}</div><h2><span className="mono">{t.plate}</span> · {regShort(t.origin)} → {regShort(t.dest)}</h2></div>
        <button className="btn sm" onClick={ui.close}>Close</button>
      </div>
      <div className="card">
        <div className="steps">{TSTATUS.map(([k, l], i) => <div key={k} className={i <= idx ? "done" : ""}>{l}<small>{times[k] ? fmtDay(times[k]) : " "}</small></div>)}</div>
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Driver</dt><dd>{t.driver || "—"} {t.driver_phone && <>· <span className="mono">{prettyPhone(t.driver_phone)}</span></>}</dd>
          <dt>Loaded by</dt><dd>{t.created_by_name || "—"}</dd>
          {t.departed_by && <><dt>Dispatched by</dt><dd>{t.departed_by}</dd></>}
          {t.ownership && <><dt>Truck</dt><dd>{t.ownership === "rental" ? <>Rental{t.owner_name ? ` · owner ${t.owner_name}` : ""} · rent TZS {tzs(t.rent_cost || 0)} this trip</> : "Our own truck"}</dd></>}
        </dl>
        {t.ownership === "rental" && can("settings") && (
          <div className="actions" style={{ alignItems: "center" }}>
            <span className="sub">Rent this trip TZS</span>
            <input type="number" min={0} step={10000} value={rent} onChange={(e) => setRent(e.target.value)} style={{ width: 140 }} aria-label="Trip rent cost" />
            <button className="btn sm" onClick={async () => { if (await patch<Trip>("trips", t.id, { rent_cost: Number(rent) || 0 })) toast("Rent saved"); }}>Save rent</button>
          </div>
        )}
        <div style={{ marginTop: 12 }}><Meter trip={t} /></div>
        {can("target") && (
          <div className="actions" style={{ alignItems: "center" }}>
            <span className="sub">Target TZS</span>
            <input type="number" min={0} step={10000} value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 150 }} aria-label="Trip target" />
            <button className="btn sm primary" onClick={async () => { if (await patch<Trip>("trips", t.id, { target: Number(target) || 0, target_set_by: me.full_name })) toast("Trip target saved"); }}>Save target</button>
          </div>
        )}
        {t.target_set_by && <p className="note">Target set by {t.target_set_by}</p>}
      </div>
      <TripSummary trip={t} />

      {t.status === "loading" && can("dispatch") && (
        <div className="card"><h3>Dispatch</h3>
          {full ? <p style={{ margin: "0 0 8px" }}><b>This truck has reached its collection target.</b> Close loading and send departure notices.</p>
            : <p className="sub" style={{ margin: "0 0 8px" }}>You can dispatch before the target is reached.</p>}
          {confirm === "depart"
            ? <div className="confirm go">Mark {t.plate} as departed with {list.length} consignment{list.length === 1 ? "" : "s"}? <button className="btn sm go" onClick={depart}>Yes, departed</button><button className="btn sm" onClick={() => setConfirm("")}>Not yet</button></div>
            : <button className="btn go" onClick={() => setConfirm("depart")} disabled={!list.length}>Close loading &amp; mark departed</button>}
          {!list.length && can("delete") && (
            <div className="actions">
              {confirm === "del"
                ? <div className="confirm">Delete this empty trip? <button className="btn sm danger" onClick={async () => { ui.close(); await remove("trips", t.id); }}>Delete</button><button className="btn sm" onClick={() => setConfirm("")}>Keep</button></div>
                : <button className="btn sm danger" onClick={() => setConfirm("del")}>Delete empty trip</button>}
            </div>
          )}
        </div>
      )}
      {t.status === "departed" && can("dispatch") && (
        <div className="card"><h3>Arrival</h3>
          {confirm === "arrive"
            ? <div className="confirm go">Mark {t.plate} as arrived in {regShort(t.dest)}? <button className="btn sm primary" onClick={arrive}>Yes, arrived</button><button className="btn sm" onClick={() => setConfirm("")}>Not yet</button></div>
            : <button className="btn primary" onClick={() => setConfirm("arrive")}>Mark arrived in {regShort(t.dest)}</button>}
          <p className="note">All consignments on this vehicle move to &quot;Arrived&quot; and arrival notices become ready.</p>
        </div>
      )}
      {t.status === "arrived" && <FoundOnTrip trip={t} />}
      {t.status === "arrived" && <BulkNotices trip={t} kind="arrived" />}
      {t.status !== "loading" && <BulkNotices trip={t} kind="departed" />}

      {t.status === "loading" && (
        <>
          <div className="card"><h3>On this vehicle · {list.length}</h3>
            {list.map((s) => (
              <div className="lrow" key={s.id}>
                <div><span className="mono">{s.no}</span> · <b>{goodsLabel(s)}</b> · {s.pkgs} pkg · TZS {tzs(s.charge)}
                  <div className="sub">{s.r_name} · {regShort(s.dest)}{s.dest !== t.dest && <span style={{ color: "var(--amber)" }}> · drop on the way</span>}</div>
                </div>
                {can("load") && <button className="btn sm" onClick={() => patch<Shipment>("shipments", s.id, { status: "received", trip_id: null, loaded_at: null })}>Unload</button>}
              </div>
            ))}
            {!list.length && <p className="sub">Nothing loaded yet. Add consignments from the list below.</p>}
          </div>
          {can("load") && (
            <div className="card"><h3>Waiting at {regShort(t.origin)} · {waiting.length}</h3>
              {waiting.map((s) => (
                <div className="lrow" key={s.id}>
                  <div><span className="mono">{s.no}</span> · <b>{goodsLabel(s)}</b> · {s.pkgs} pkg · TZS {tzs(s.charge)}
                    <div className="sub">{s.r_name} · <b style={{ color: s.dest === t.dest ? "var(--good)" : "var(--muted)" }}>{regShort(s.dest)}</b> · {PAY_LABEL[s.pay]}</div>
                  </div>
                  <button className="btn sm primary" onClick={() => patch<Shipment>("shipments", s.id, { status: "loaded", trip_id: t.id, loaded_at: now() })}>Load</button>
                </div>
              ))}
              {!waiting.length && <p className="sub">No consignments waiting at this office.</p>}
            </div>
          )}
        </>
      )}
      {t.status !== "loading" && (
        <div className="card"><h3>Manifest · {list.length} consignments, {n} packages</h3>
          <div className="actions" style={{ marginTop: 0 }}><button className="btn sm" onClick={() => downloadManifest(t, list, company)}>Manifest (PDF)</button></div>
          <div className="ledger" style={{ border: 0 }}><table className="small manifest" style={{ minWidth: 0 }}>
            <thead><tr><th>Waybill</th><th>Sender → receiver</th><th>Goods</th><th className="r">Pkgs</th><th className="r">TZS</th><th>Payment</th></tr></thead>
            <tbody>{list.map((s) => (
              <tr key={s.id} className="row" onClick={() => ui.openShip(s.id)}>
                <td className="mono wb">{s.no}{s.found_on_arrival && <span className="tag-found">Found</span>}<div className="sub"><StatusPill s={s.status} /></div></td>
                <td>{s.s_name || "—"} → <b>{s.r_name}</b><div className="sub mono">{prettyPhone(s.r_phone)} · {regShort(s.dest)}</div></td>
                <td>{goodsLabel(s)}</td>
                <td className="r num">{s.pkgs}</td>
                <td className="r num">{tzs(s.charge)}</td>
                <td><PayPill pay={s.pay} /></td>
              </tr>))}</tbody>
            <tfoot><tr><td colSpan={3}>Total</td><td className="r num">{n}</td><td className="r num">{tzs(list.reduce((a, s) => a + Number(s.charge || 0), 0))}</td><td /></tr></tfoot>
          </table></div>
        </div>
      )}
    </>
  );
}

/** Print the receipt for the sender and one sticker per package (no amounts, names or phone numbers). */
export function PrintActions({ s }: { s: Shipment }) {
  const { company, toast } = useStore();
  const [prefs, setPrefs] = useState<StickerPrefs>({ size: "100x75", showItem: true, auto: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPrefs(stickerPrefs()); }, []);
  const set = (p: Partial<StickerPrefs>) => { const n = { ...prefs, ...p }; setPrefs(n); saveStickerPrefs(n); };
  const n = packages(s).length;
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch { toast("Couldn't make the PDF. Try again.", true); } setBusy(false); };
  return (
    <>
      <div className="actions" style={{ marginTop: 20 }}>
        <button className="btn primary" disabled={busy} onClick={() => run(() => downloadReceiptAndStickers(s, company))}>Receipt + {n} sticker{n === 1 ? "" : "s"} (PDF)</button>
        <button className="btn" disabled={busy} onClick={() => run(() => downloadReceipt(s, company))}>Receipt only</button>
        <button className="btn" disabled={busy} onClick={() => run(() => downloadStickers(s, company))}>Stickers only</button>
      </div>
      <p className="note">Stickers show the waybill number, route, package number and a QR code. No amount, names or phone numbers.</p>
      <details style={{ marginTop: 8 }}><summary className="sub" style={{ cursor: "pointer" }}>Sticker settings for this device</summary>
        <div className="fields" style={{ marginTop: 10 }}>
          <label className="f">Sticker size<select value={prefs.size} onChange={(e) => set({ size: e.target.value as StickerPrefs["size"] })}>{STICKER_SIZES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <div className="f" style={{ justifyContent: "end", gap: 8 }}>
            <label className="check"><input type="checkbox" checked={prefs.showItem} onChange={(e) => set({ showItem: e.target.checked })} /> Show the goods description</label>
            <label className="check"><input type="checkbox" checked={prefs.auto} onChange={(e) => set({ auto: e.target.checked })} /> Download receipt + stickers when goods are saved</label>
          </div>
        </div>
      </details>
    </>
  );
}

/** On a consignment that was found on an arrived truck: where it came from and the Admin's check. */
export function FoundCard({ s }: { s: Shipment }) {
  const { tripById, me, patch, toast } = useStore();
  const ui = useUi();
  const t = tripById(s.trip_id);
  const checked = !!s.checked_at;
  return (
    <div className={`card found${checked ? "" : " unchecked"}`}>
      <h3>Found on arrival</h3>
      <p style={{ margin: 0 }}>Not recorded at loading. Found on {t ? <a href="#" className="mono" onClick={(e) => { e.preventDefault(); ui.openTrip(t.id); }}>{t.plate}</a> : "the truck"} in {regShort(s.dest)} and recorded by <b>{s.created_by_name || "—"}</b> on {fmtDate(s.received_at)}.</p>
      {s.found_note && <p className="sub" style={{ margin: "6px 0 0" }}>&ldquo;{s.found_note}&rdquo;</p>}
      <div className="actions" style={{ alignItems: "center" }}>
        {checked
          ? <span className="pill pay-paid">Checked by {s.checked_by || "Admin"} · {fmtDay(s.checked_at!)}</span>
          : <span className="pill pay-unpaid">Not yet checked by the Admin</span>}
        {me.role === "admin" && !checked && (
          <button className="btn sm primary" onClick={async () => { if (await patch<Shipment>("shipments", s.id, { checked_by: me.full_name, checked_at: new Date().toISOString() })) toast("Marked as checked"); }}>Mark checked</button>
        )}
        {me.role === "admin" && checked && (
          <button className="btn sm" onClick={() => patch<Shipment>("shipments", s.id, { checked_by: null, checked_at: null })}>Undo check</button>
        )}
      </div>
      {me.role === "admin" && !checked && <p className="note">Check the goods, receiver and charge. If the charge is wrong, delete this record and key it in again.</p>}
    </div>
  );
}

/** On an arrived trip: goods found on the truck that weren't recorded at loading, and a button to add more. */
function FoundOnTrip({ trip }: { trip: Trip }) {
  const { tripShips, me, company } = useStore();
  const ui = useUi();
  const found = tripShips(trip).filter((s) => s.found_on_arrival);
  const allowed = canRecordFound(me.role, company);
  if (!allowed && !found.length) return null;
  return (
    <div className="card"><h3>Goods found on this truck{found.length ? ` · ${found.length}` : ""}</h3>
      {found.map((s) => (
        <div className="lrow" key={s.id}>
          <div><a href="#" className="mono" onClick={(e) => { e.preventDefault(); ui.openShip(s.id); }}>{s.no}</a> · {goodsLabel(s)} · {s.pkgs} pkg · TZS {tzs(s.charge)}<div className="sub">{s.r_name} · by {s.created_by_name}</div></div>
          <span className={`pill ${s.checked_at ? "pay-paid" : "pay-unpaid"}`}>{s.checked_at ? "Checked" : "To check"}</span>
        </div>
      ))}
      {allowed
        ? <><button className="btn" onClick={() => ui.recordFound(trip.id)}>Record goods found on this truck</button>
          <p className="note">For goods that came off {trip.plate} but were never recorded at loading. You enter the receiver and the proper charge; {me.role === "admin" ? "your records count as checked." : "the Admin checks each one."}</p></>
        : <p className="note">Only the Admin can record found goods.</p>}
    </div>
  );
}

/** Payment of a consignment: paid / not paid / monthly bill, and discounts before payment. */
function PaymentCard({ s }: { s: Shipment }) {
  const { can, patch, me, toast, accounts, hasExtras } = useStore();
  const ui = useUi();
  const [method, setMethod] = useState(METHODS[0]);
  const [disc, setDisc] = useState<{ open: boolean; amount: string; reason: string }>({ open: false, amount: "", reason: "" });
  const [billTo, setBillTo] = useState("");
  const P = (v: Partial<Shipment>) => patch<Shipment>("shipments", s.id, v);
  const now = () => new Date().toISOString();
  const d = Number(s.discount || 0);
  const gross = Number(s.gross_charge ?? Number(s.charge) + d);
  const acct = accounts.find((a) => a.id === s.account_id);
  const active = accounts.filter((a) => a.active);
  const saveDiscount = async () => {
    const amt = Math.round(Number(disc.amount) || 0);
    if (amt < 0 || amt > gross) return toast(`The discount must be between 0 and TZS ${tzs(gross)}.`, true);
    if (amt > 0 && !disc.reason.trim()) return toast("Write the reason for the discount.", true);
    // The database works out the charge too; sending it keeps the screen right straight away.
    if (await P({ discount: amt, discount_reason: amt ? disc.reason.trim() : "", discount_by: amt ? me.full_name : null, discount_at: amt ? now() : null, gross_charge: gross, charge: gross - amt })) {
      toast(amt ? `Discount of TZS ${tzs(amt)} recorded. New total TZS ${tzs(gross - amt)}.` : "Discount removed.");
      setDisc({ open: false, amount: "", reason: "" });
    }
  };
  return (
    <div className="card"><h3>Payment</h3>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <span className="mono" style={{ fontSize: 17, fontWeight: 600 }}>TZS {tzs(s.charge)}</span> <PayPill pay={s.pay} />
          {d > 0 && <div className="sub">TZS {tzs(gross)} − discount TZS {tzs(d)}{s.discount_reason ? ` (“${s.discount_reason}”)` : ""}{s.discount_by ? ` · by ${s.discount_by}` : ""}</div>}
          {s.pay === "paid" && s.paid_at && <div className="sub">{s.method || ""} · {fmtDate(s.paid_at)}{s.paid_by ? " · by " + s.paid_by : ""}</div>}
          {s.pay === "bill" && <div className="sub">On the monthly bill of <a href="#" onClick={(e) => { e.preventDefault(); ui.openAccount(s.account_id!); }}>{acct?.name || "an account"}</a></div>}
        </div>
        {s.pay === "paid" && can("undo") && <button className="btn sm" onClick={() => P({ pay: "unpaid", paid_at: null, method: null, paid_by: null })}>Mark not paid</button>}
        {s.pay === "bill" && can("undo") && <button className="btn sm" onClick={() => P({ pay: "unpaid", account_id: null })}>Take off the bill</button>}
        {s.pay === "unpaid" && can("pay") && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: "auto" }} aria-label="Payment method">{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
            <button className="btn primary sm" onClick={async () => { if (await P({ pay: "paid", method, paid_at: now(), paid_by: me.full_name })) toast("Payment recorded"); }}>Record payment</button>
          </div>
        )}
      </div>
      {s.pay === "unpaid" && can("pay") && hasExtras && active.length > 0 && (
        <div className="actions" style={{ alignItems: "center" }}>
          <span className="sub">or put on a monthly bill:</span>
          <select value={billTo} onChange={(e) => setBillTo(e.target.value)} style={{ width: "auto" }} aria-label="Bill account"><option value="">Choose customer…</option>{active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <button className="btn sm" disabled={!billTo} onClick={async () => { if (await P({ pay: "bill", account_id: billTo })) toast("Put on the monthly bill"); }}>Put on bill</button>
        </div>
      )}
      {s.pay !== "paid" && can("pay") && hasExtras && (
        disc.open ? (
          <div className="paybox">
            <div className="fields">
              <label className="f">Discount (TZS)<input type="number" min={0} step={500} value={disc.amount} onChange={(e) => setDisc({ ...disc, amount: e.target.value })} aria-label="Discount amount" /></label>
              <label className="f">Reason<input value={disc.reason} onChange={(e) => setDisc({ ...disc, reason: e.target.value })} placeholder="e.g. Regular customer, asked at collection" aria-label="Discount reason" /></label>
            </div>
            <p className="note" style={{ margin: "6px 0 0" }}>Before discount TZS {tzs(gross)} → new total <b>TZS {tzs(Math.max(0, gross - (Number(disc.amount) || 0)))}</b></p>
            <div className="actions"><button className="btn sm primary" onClick={saveDiscount}>Save discount</button><button className="btn sm" onClick={() => setDisc({ open: false, amount: "", reason: "" })}>Cancel</button></div>
          </div>
        ) : <div className="actions"><button className="btn sm" onClick={() => setDisc({ open: true, amount: d ? String(d) : "", reason: s.discount_reason || "" })}>{d ? "Change discount" : "Give a discount"}</button></div>
      )}
    </div>
  );
}

/** Claims on this consignment, and a button to report lost / damaged / broken goods. */
function ShipmentClaims({ s }: { s: Shipment }) {
  const { claims, can, hasExtras } = useStore();
  const ui = useUi();
  if (!hasExtras) return null;
  const mine = claims.filter((c) => c.shipment_id === s.id || (c.waybill && c.waybill === s.no));
  if (!mine.length && !can("claims")) return null;
  return (
    <div className="card"><h3>Problems with these goods</h3>
      {mine.map((c) => (
        <div className="lrow" key={c.id}>
          <div><a href="#" onClick={(e) => { e.preventDefault(); ui.openClaim(c.id); }}><b>{c.customer_name}</b></a> · <span className={`pill claim-${c.kind}`}>{c.kind}</span><div className="sub">compensation TZS {tzs(c.compensation)}</div></div>
        </div>
      ))}
      {can("claims") && <button className="btn sm" onClick={() => ui.reportClaim(s.id)}>Report lost or damaged goods</button>}
    </div>
  );
}
