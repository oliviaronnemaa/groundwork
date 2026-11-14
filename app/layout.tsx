import type { Metadata } from "next";
import { Inter, Nunito } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const nunito = Nunito({ subsets: ["latin"], weight: ["700", "800", "900"], variable: "--font-round", display: "swap" });

export const metadata: Metadata = {
  title: "Groundwork",
  description: "A research desk for angel and pre-seed investors, built on Cala's sourced public data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${nunito.variable}`}>
      <body>{children}</body>
    </html>
  );
}
