import type { Metadata } from "next";
import Landing from "@/components/Landing";

export const metadata: Metadata = {
  title: "Shehena — Mfumo wa mizigo kwa wasafirishaji wa mikoani",
  description: "Pokea mizigo na utoe risiti, pakia magari kwa lengo la makusanyo, na wajulishe wateja kwa SMS na WhatsApp. Cargo management for Tanzania's regional transporters. Developed by Serengeti Labs.",
  openGraph: {
    title: "Shehena — kila mzigo, kila gari, kila shilingi mahali pamoja",
    description: "Risiti, upakiaji wa magari, SMS na WhatsApp kwa wateja, na ripoti kwa Mkurugenzi. Omba maonyesho ya bure.",
    siteName: "Shehena",
    locale: "sw_TZ",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function Home() {
  return <Landing />;
}
