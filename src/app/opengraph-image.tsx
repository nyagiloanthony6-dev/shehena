import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROUTE_PATH } from "@/lib/brand";

export const alt = "Shehena — cargo management for regional transporters";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Preview card shown when the link is shared on WhatsApp, Facebook or X. */
export default async function OgImage() {
  const grotesk = await readFile(join(process.cwd(), "node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff")).catch(() => null);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#14213F", color: "#EEF2FA", padding: 64 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="84" height="84" viewBox="0 0 100 100">
            <rect width="100" height="100" rx="24" fill="#F2A23A" />
            <path d={ROUTE_PATH} fill="none" stroke="#14213F" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="30" cy="72" r="6.5" fill="#F2A23A" stroke="#14213F" strokeWidth="3.5" />
            <circle cx="70" cy="20" r="7" fill="#14213F" />
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1, fontFamily: grotesk ? "Space Grotesk" : undefined, letterSpacing: 3 }}>SHEHENA</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 66, fontWeight: 800, lineHeight: 1.05, maxWidth: 1000 }}>Kila mzigo, kila gari, kila shilingi — mahali pamoja.</div>
          <div style={{ fontSize: 30, color: "#9DAAC6" }}>Risiti · Upakiaji wa magari · SMS na WhatsApp kwa wateja · Ripoti</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#9DAAC6" }}>
          <span style={{ color: "#F2A23A", fontWeight: 700 }}>shehenacargo.co.tz</span>
          <span>Developed by Serengeti Labs</span>
        </div>
      </div>
    ),
    { ...size, fonts: grotesk ? [{ name: "Space Grotesk", data: grotesk, weight: 700 as const, style: "normal" as const }] : undefined }
  );
}
