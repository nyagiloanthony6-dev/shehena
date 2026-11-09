import { ImageResponse } from "next/og";
import { ROUTE_PATH } from "@/lib/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon for iPhone / iPad: the Njia road on navy. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#14213F" }}>
        <svg width="180" height="180" viewBox="0 0 100 100">
          <path d={ROUTE_PATH} fill="none" stroke="#F2A23A" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="30" cy="72" r="6.5" fill="#14213F" stroke="#FFFFFF" strokeWidth="3.5" />
          <circle cx="70" cy="20" r="7" fill="#FFFFFF" />
        </svg>
      </div>
    ),
    size
  );
}
