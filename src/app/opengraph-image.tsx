import { ImageResponse } from "next/og";

export const alt = "Shehena — cargo management for regional transporters";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Preview card shown when the link is shared on WhatsApp, Facebook or X. */
export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#14213F", color: "#EEF2FA", padding: 64 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "#F0B25A", display: "flex", alignItems: "center", justifyContent: "center", color: "#14213F", fontSize: 38, fontWeight: 800 }}>S</div>
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 4 }}>SHEHENA</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 66, fontWeight: 800, lineHeight: 1.05, maxWidth: 1000 }}>Kila mzigo, kila gari, kila shilingi — mahali pamoja.</div>
          <div style={{ fontSize: 30, color: "#9DAAC6" }}>Risiti · Upakiaji wa magari · SMS na WhatsApp kwa wateja · Ripoti</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#9DAAC6" }}>
          <span style={{ color: "#F0B25A", fontWeight: 700 }}>shehenacargo.co.tz</span>
          <span>Developed by Serengeti Labs</span>
        </div>
      </div>
    ),
    size
  );
}
