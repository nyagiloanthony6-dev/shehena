"use client";
import { useMemo, useRef, useState } from "react";
import { useStore } from "./store";
import { niceStep, tzs } from "@/lib/domain";

type Bar = { label: string; value: number; tip: string; tone?: "now" | "dim" };

/** Single-series bar chart with gridlines, rounded data ends and a hover/tap tooltip. */
function BarChart({ bars, aria, labelEvery = 1, showBest }: { bars: Bar[]; aria: string; labelEvery?: number; showBest?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; t: string } | null>(null);
  const W = 760, H = 250, pl = 58, pr = 8, pt = 20, pb = 28;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const bw = (W - pl - pr) / bars.length;
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / top);
  const best = Math.max(...bars.map((b) => b.value));
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  const fmt = (v: number) => (v >= 1e6 ? +(v / 1e6).toFixed(1) + "M" : v >= 1000 ? Math.round(v / 1000) + "k" : String(v));
  const show = (i: number, e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const b = bars[i];
    setTip({ x: Math.min(box.width - 120, Math.max(120, ((pl + i * bw + bw / 2) / W) * box.width)), y: (Math.min(y(b.value), H - pb - 10) / H) * box.height, t: b.tip });
    e.stopPropagation();
  };
  return (
    <div className="chart" ref={ref} onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}>
        {ticks.map((v) => (
          <g key={v}>
            <line className="grid" x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} />
            <text className="axis" x={pl - 8} y={y(v) + 4} textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const bx = pl + i * bw + bw * 0.2, w = bw * 0.6, by = y(b.value), h = Math.max(0, H - pb - by), r = Math.min(4, w / 2, h);
          return (
            <g key={i}>
              {b.value > 0 && <path className={`bar${b.tone ? " " + b.tone : ""}`} d={`M${bx},${H - pb} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + w - r} Q${bx + w},${by} ${bx + w},${by + r} V${H - pb} Z`} />}
              {showBest && b.value > 0 && b.value === best && <text className="vlab" x={bx + w / 2} y={by - 6} textAnchor="middle">{fmt(b.value)}</text>}
              <rect className="hit" x={pl + i * bw} y={pt} width={bw} height={H - pt - pb} onPointerMove={(e) => show(i, e)} onPointerDown={(e) => show(i, e)} />
              {i % labelEvery === labelEvery - 1 || labelEvery === 1 ? <text className="axis" x={pl + i * bw + bw / 2} y={H - 10} textAnchor="middle">{b.label}</text> : null}
            </g>
          );
        })}
      </svg>
      {tip && <div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.t}</div>}
    </div>
  );
}

const monthShort = (m: number) => new Date(2000, m, 1).toLocaleDateString("en-GB", { month: "short" });
const monthLong = (m: number) => new Date(2000, m, 1).toLocaleDateString("en-GB", { month: "long" });

/** Monthly collections for a chosen year (CEO overview + reports). */
export function YearPanel() {
  const { shipments } = useStore();
  const now = new Date();
  const years = useMemo(() => [...new Set([now.getFullYear(), ...shipments.map((s) => new Date(s.received_at).getFullYear())])].sort((a, b) => b - a), [shipments]); // eslint-disable-line react-hooks/exhaustive-deps
  const [year, setYear] = useState(now.getFullYear());
  const M = useMemo(() => {
    const m = Array.from({ length: 12 }, (_, i) => ({ m: i, billed: 0, collected: 0, n: 0 }));
    shipments.forEach((s) => {
      const r = new Date(s.received_at);
      if (r.getFullYear() === year) { m[r.getMonth()].billed += Number(s.charge || 0); m[r.getMonth()].n++; }
      if (s.pay === "paid") { const d = new Date(s.paid_at || s.received_at); if (d.getFullYear() === year) m[d.getMonth()].collected += Number(s.charge || 0); }
    });
    return m;
  }, [shipments, year]);
  const isNow = year === now.getFullYear();
  const curM = isNow ? now.getMonth() : -1;
  const tb = M.reduce((a, x) => a + x.billed, 0), tc = M.reduce((a, x) => a + x.collected, 0);
  const best = M.reduce((a, x) => (x.collected > a.collected ? x : a), M[0]);
  return (
    <>
      <div className="yh">
        <div><h2>Monthly collections</h2><div className="sub">TZS received from paid consignments, by the month payment was recorded.{isNow ? " This month in amber." : ""}</div></div>
        <div className="chips">{years.map((y) => <button key={y} className="chip" aria-pressed={y === year} onClick={() => setYear(y)}>{y}</button>)}</div>
      </div>
      <div className="ykpi">
        <div><div className="lbl">Collected {year}</div><div className="v">{tzs(tc)}</div><div className="sub">TZS</div></div>
        <div><div className="lbl">Billed {year}</div><div className="v">{tzs(tb)}</div><div className="sub">TZS · {M.reduce((a, x) => a + x.n, 0)} consignments</div></div>
        <div className={tb - tc > 0 ? "due" : ""}><div className="lbl">Not yet collected</div><div className="v">{tzs(Math.max(0, tb - tc))}</div><div className="sub">TZS</div></div>
        <div><div className="lbl">Best month</div><div className="v">{best.collected ? monthLong(best.m) : "—"}</div><div className="sub">{best.collected ? "TZS " + tzs(best.collected) : "No collections yet"}</div></div>
      </div>
      <BarChart aria={`Collected TZS per month in ${year}`} showBest
        bars={M.map((x) => ({ label: monthShort(x.m), value: x.collected, tone: x.m === curM ? "now" : undefined, tip: `${monthLong(x.m)} ${year}: collected TZS ${tzs(x.collected)} · billed TZS ${tzs(x.billed)}` }))} />
      <details className="ytable">
        <summary className="link" style={{ listStyle: "none", display: "inline-block", cursor: "pointer" }}>Show month-by-month table</summary>
        <div className="ledger"><table>
          <thead><tr><th>Month</th><th className="r">Consignments</th><th className="r">Billed TZS</th><th className="r">Collected TZS</th><th className="r">Collected %</th></tr></thead>
          <tbody>{M.map((x) => (
            <tr key={x.m} className={x.m === curM ? "cur" : ""}><td>{monthLong(x.m)}</td><td className="r num">{x.n}</td><td className="r num">{tzs(x.billed)}</td><td className="r num">{tzs(x.collected)}</td><td className="r num">{x.billed ? Math.round((x.collected / x.billed) * 100) + "%" : "—"}</td></tr>
          ))}</tbody>
          <tfoot><tr><td>Total</td><td className="r num">{M.reduce((a, x) => a + x.n, 0)}</td><td className="r num">{tzs(tb)}</td><td className="r num">{tzs(tc)}</td><td className="r num">{tb ? Math.round((tc / tb) * 100) + "%" : "—"}</td></tr></tfoot>
        </table></div>
      </details>
    </>
  );
}

/** Billed TZS per day for the last 14 days. */
export function DailyChart() {
  const { shipments } = useStore();
  const bars = useMemo(() => {
    const out: Bar[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const L = shipments.filter((s) => new Date(s.received_at).toDateString() === d.toDateString());
      const v = L.reduce((a, s) => a + Number(s.charge || 0), 0);
      out.push({
        label: String(d.getDate()), value: v, tone: L.some((s) => s.pay !== "paid") ? "dim" : undefined,
        tip: `${d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}: TZS ${tzs(v)} · ${L.length} consignment${L.length === 1 ? "" : "s"}`,
      });
    }
    return out;
  }, [shipments]);
  return <BarChart bars={bars} aria="Billed TZS per day for the last 14 days" />;
}
