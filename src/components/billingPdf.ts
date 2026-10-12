import { dayLabel } from "@/lib/billing";

/** A4 receipt from Serengeti Labs to a client company for a Shehena subscription payment. */
export async function downloadSubscriptionReceipt(p: {
  id: number | string; amount: number; months: number; period_from: string; period_to: string; method: string; reference: string; paid_on: string;
}, company: string, band?: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = 20, R = 190;
  doc.setFillColor(20, 33, 61); doc.rect(0, 0, 210, 34, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("Shehena", L, 17);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.text("Cargo management · Developed by Serengeti Labs", L, 25);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text("PAYMENT RECEIPT", R, 17, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.text(`No. SH-${String(p.id).slice(0, 8).toUpperCase()}`, R, 25, { align: "right" });
  doc.setTextColor(20, 24, 31);
  let y = 50;
  const row = (k: string, v: string, bold = false) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(95, 104, 120); doc.text(k, L, y);
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setTextColor(20, 24, 31); doc.text(v, L + 52, y); y += 8;
  };
  row("Received from", company, true);
  row("Date paid", dayLabel(p.paid_on));
  row("For", `Shehena subscription${band ? ` · ${band}` : ""}`);
  row("Period", `${dayLabel(p.period_from)} to ${dayLabel(p.period_to)} (${p.months} month${p.months === 1 ? "" : "s"})`);
  if (p.method) row("Paid by", p.method);
  if (p.reference) row("Reference", p.reference);
  y += 4; doc.setDrawColor(220, 224, 232); doc.line(L, y, R, y); y += 12;
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("Amount received", L, y);
  doc.setFontSize(16); doc.text(`TZS ${Number(p.amount).toLocaleString("en-US")}`, R, y, { align: "right" });
  y += 18; doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(95, 104, 120);
  doc.text("Thank you for using Shehena. Asante kwa kutumia Shehena.", L, y);
  doc.text("Serengeti Labs · Dar es Salaam, Tanzania · www.shehenacargo.co.tz", L, 282);
  doc.save(`Shehena-receipt-${p.paid_on}.pdf`);
}
