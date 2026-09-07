import type { Metadata } from "next";
import { Syne, Outfit } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import Footer from "@/components/footer";
import MobileNav from "@/components/mobile-nav";

import "./globals.css";

const sans = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  preload: true,
  adjustFontFallback: true,
});

const display = Syne({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  preload: true,
  adjustFontFallback: true,
});

export const metadata: Metadata = {
  metadataBase: new URL("https://0509.in"),
  title: {
    default: "0509 — Competitor Ad Research",
    template: "%s | 0509",
  },
  description:
    "Search competitor ads on Meta Ad Library by advertiser or keyword. Filter by country, platform, and creative type.",
  openGraph: {
    description:
      "Search competitor ads on Meta. Filter, compare, and research — faster than the native Ad Library.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "0509 — Competitor Ad Research" }],
    siteName: "0509",
    title: "0509 — Competitor Ad Research",
    type: "website",
    url: "https://0509.in",
  },
  twitter: {
    card: "summary_large_image",
    description:
      "Search competitor ads on Meta. Filter, compare, and research — faster than the native Ad Library.",
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
