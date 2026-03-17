import type { Metadata } from "next";
import { Instrument_Serif, Manrope } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import Footer from "@/components/footer";
import MobileNav from "@/components/mobile-nav";

import "./globals.css";

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
});

const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://0509.in"),
  title: {
    default: "0509 — Competitor Ad Research",
    template: "%s | 0509",
  },
  description:
    "0509 helps growth teams scan competitor ads, compare angles, and spot patterns faster.",
  openGraph: {
    description:
      "Search competitor ads, compare angles, and review Meta Ad Library signal with less noise.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "0509 — Competitor Ad Research" }],
    siteName: "0509",
    title: "0509 — Competitor Ad Research",
    type: "website",
    url: "https://0509.in",
  },
  twitter: {
    card: "summary_large_image",
    description:
      "Search competitor ads, compare angles, and review Meta Ad Library signal with less noise.",
    images: ["/opengraph-image"],
    site: "@0509in",
    title: "0509 — Competitor Ad Research",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${display.variable}`}>
          <MobileNav />
          <AuthProvider>{children}</AuthProvider>
          <Footer />
        </body>
    </html>
  );
}
