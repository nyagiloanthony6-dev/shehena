import { ImageResponse } from "next/og";
import { S_PATH, TAG_PATH } from "@/lib/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon for iPhone / iPad: the Shehena tag on navy. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#14213F" }}>
        <svg width="180" height="180" viewBox="0 0 100 100">
          <g transform="rotate(-8 52 51)">
            <path d={TAG_PATH} fill="#F2A23A" />
            <circle cx="66" cy="32" r="5" fill="#14213F" />
            <path d={S_PATH} fill="none" stroke="#14213F" strokeWidth="7.5" strokeLinecap="round" />
          </g>
        </svg>
      </div>
    ),
    size
  );
}
