// Truck manifest (A4 landscape): every consignment on a trip, for the driver and the destination office.
import { goodsLabel, prettyPhone, regShort, tLabel, tzs, PAY_LABEL, type Company, type Shipment, type Trip } from "@/lib/domain";

const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export async function downloadManifest(t: Trip, list: Shipment[], company: Company) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const L = 12, R = 285;
  const head = () => {
    doc.setTextColor(20, 24, 31); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text((company.name || "Shehena").toUpperCase(), L, 15);
    doc.setFontSize(11); doc.text("TRUCK MANIFEST", R, 15, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(80, 88, 104);
    doc.text(`${t.plate}  ·  ${regShort(t.origin)} to ${regShort(t.dest)}  ·  trip ${t.no}  ·  driver ${t.driver || "—"}${t.driver_phone ? " " + prettyPhone(t.driver_phone) : ""}`, L, 21);
    doc.text(`Status: ${tLabel(t.status)}  ·  loaded ${when(t.created_at)}  ·  departed ${when(t.departed_at)}  ·  arrived ${when(t.arrived_at)}`, L, 26);
  };
  const cols: [string, number, "left" | "right"][] = [
    ["#", L, "left"], ["Waybill", L + 7, "left"], ["Sender", L + 45, "left"], ["Receiver", L + 92, "left"], ["Phone", L + 139, "left"],
    ["To", L + 168, "left"], ["Goods", L + 188, "left"], ["Pkgs", L + 232, "right"], ["TZS", L + 252, "right"], ["Payment", R, "right"],
  ];
  let y = 0;
  const tableHead = () => {
    y = 34; doc.setFillColor(232, 236, 242); doc.rect(L - 2, y - 5, R - L + 4, 7, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(20, 24, 31);
    cols.forEach(([h, x, a]) => doc.text(h, x, y, { align: a })); y += 7;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  };
  const cut = (s: string, w: number) => { let o = s || ""; while (o.length > 1 && doc.getTextWidth(o) > w) o = o.slice(0, -1); return o === s ? o : o.slice(0, -1) + "…"; };
  head(); tableHead();
  list.forEach((s, i) => {
    if (y > 190) { doc.addPage(); head(); tableHead(); }
    const v = [String(i + 1), s.no, cut(s.s_name || "—", 44), cut(s.r_name, 44), prettyPhone(s.r_phone), regShort(s.dest), cut(goodsLabel(s), 40), String(s.pkgs), tzs(s.charge), PAY_LABEL[s.pay] + (s.found_on_arrival ? " · found" : "")];
    cols.forEach(([, x, a], j) => doc.text(v[j], x, y, { align: a }));
    doc.setDrawColor(225, 229, 236); doc.line(L - 2, y + 2, R + 2, y + 2); y += 6.5;
  });
  const tot = (f: (s: Shipment) => boolean) => list.filter(f).reduce((a, s) => a + Number(s.charge || 0), 0);
  y += 4; if (y > 185) { doc.addPage(); head(); y = 36; }
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text(`${list.length} consignments · ${list.reduce((a, s) => a + Number(s.pkgs || 0), 0)} packages`, L, y);
  doc.text(`Total TZS ${tzs(tot(() => true))}  ·  paid ${tzs(tot((s) => s.pay === "paid"))}  ·  on bills ${tzs(tot((s) => s.pay === "bill"))}  ·  to collect ${tzs(tot((s) => s.pay === "unpaid"))}`, R, y, { align: "right" });
  y += 16; doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(80, 88, 104);
  doc.text("Loaded by: ____________________", L, y); doc.text("Driver: ____________________", L + 95, y); doc.text("Received at destination: ____________________", L + 180, y);
  doc.save(`Manifest-${t.plate.replace(/\s+/g, "")}-${t.no}.pdf`);
}
