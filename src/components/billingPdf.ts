import { dayLabel } from "@/lib/billing";

/** A4 receipt from Serengeti Labs to a client company for a Shehena subscription payment. */
export async function downloadSubscriptionReceipt(p: {
  id: number | string; amount: number; months: number; period_from: string; period_to: string; method: string; reference: string; paid_on: string; setup_fee?: number;
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
  if (p.setup_fee) { row("Subscription", `TZS ${(Number(p.amount) - Number(p.setup_fee)).toLocaleString("en-US")}`); row("Setup and training", `TZS ${Number(p.setup_fee).toLocaleString("en-US")}`); }
  y += 4; doc.setDrawColor(220, 224, 232); doc.line(L, y, R, y); y += 12;
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("Amount received", L, y);
  doc.setFontSize(16); doc.text(`TZS ${Number(p.amount).toLocaleString("en-US")}`, R, y, { align: "right" });
  y += 18; doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(95, 104, 120);
  doc.text("Thank you for using Shehena. Asante kwa kutumia Shehena.", L, y);
  doc.text("Serengeti Labs · Dar es Salaam, Tanzania · www.shehenacargo.co.tz", L, 282);
  doc.save(`Shehena-receipt-${p.paid_on}.pdf`);
}

/** Statement for a salesperson: the lines settled by one payout (or everything still owed). */
export async function downloadAgentStatement(agent: { name: string; phone: string; ref_code: string },
  lines: { kind: string; amount: number; note: string; earned_on: string; company: string }[],
  payout: { amount: number; paid_on: string; method: string; reference: string } | null) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = 20, R = 190;
  doc.setFillColor(20, 33, 61); doc.rect(0, 0, 210, 34, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("Shehena", L, 17);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.text("Serengeti Labs · Sales commission", L, 25);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text(payout ? "COMMISSION STATEMENT" : "COMMISSION OWED", R, 17, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.text(payout ? `Paid ${dayLabel(payout.paid_on)}` : `As of ${dayLabel(new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10))}`, R, 25, { align: "right" });
  doc.setTextColor(20, 24, 31);
  let y = 48;
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text(agent.name, L, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(95, 104, 120);
  doc.text([agent.phone, `link code: ${agent.ref_code}`].filter(Boolean).join("  ·  "), L, y + 6); y += 18;
  doc.setTextColor(95, 104, 120); doc.setFontSize(9); doc.setFont("helvetica", "bold");
  doc.text("DATE", L, y); doc.text("CLIENT", L + 26, y); doc.text("TYPE", L + 82, y); doc.text("TZS", R, y, { align: "right" }); y += 3;
  doc.setDrawColor(220, 224, 232); doc.line(L, y, R, y); y += 6;
  doc.setTextColor(20, 24, 31); doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  for (const l of lines) {
    if (y > 265) { doc.addPage(); y = 20; }
    doc.text(dayLabel(l.earned_on), L, y);
    doc.text(doc.splitTextToSize(l.company || "—", 52)[0], L + 26, y);
    doc.text(l.kind, L + 82, y);
    doc.text(Math.round(l.amount).toLocaleString("en-US"), R, y, { align: "right" });
    if (l.note) { doc.setFontSize(8); doc.setTextColor(95, 104, 120); doc.text(doc.splitTextToSize(l.note, 70)[0], L + 82, y + 4); doc.setFontSize(9.5); doc.setTextColor(20, 24, 31); y += 4; }
    y += 7;
  }
  const total = lines.reduce((a, l) => a + l.amount, 0);
  y += 2; doc.line(L, y, R, y); y += 9;
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text(payout ? "Total paid" : "Total owed", L, y);
  doc.text(`TZS ${Math.round(total).toLocaleString("en-US")}`, R, y, { align: "right" });
  if (payout) {
    y += 8; doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(95, 104, 120);
    doc.text([payout.method, payout.reference].filter(Boolean).join(" · ") || " ", L, y);
  }
  doc.setTextColor(95, 104, 120); doc.setFontSize(9); doc.text("Serengeti Labs · Dar es Salaam, Tanzania · www.shehenacargo.co.tz", L, 282);
  doc.save(`Commission-${agent.ref_code}-${payout ? payout.paid_on : "owed"}.pdf`);
}
