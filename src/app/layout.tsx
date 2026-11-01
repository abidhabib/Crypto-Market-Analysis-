import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://crypto.abidhabib.pro"),
  title: "FlowLens — Live Crypto Market Analysis",
  description: "Explore live crypto charts, liquidity heatmaps, footprint volume and whale activity. Market analysis tools built by Abid Habib.",
  applicationName: "FlowLens",
  authors: [{ name: "Abid Habib", url: "https://abidhabib.pro" }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "FlowLens",
    locale: "en_US",
    title: "FlowLens — Live Crypto Market Analysis",
    description: "See market liquidity, executed order flow and whale activity in one trading terminal. By Abid Habib.",
    images: [{ url: "/flowlens-share-v1.png", width: 1200, height: 630, type: "image/png", alt: "FlowLens by Abid Habib — liquidity heatmaps, footprint and whale flow" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FlowLens — Live Crypto Market Analysis",
    description: "Live crypto charts, liquidity heatmaps, footprint volume and whale activity. By Abid Habib.",
    images: [{ url: "/flowlens-share-v1.png", alt: "FlowLens crypto market analysis terminal" }],
  },
  icons: {
    icon: [{ url: "/flowlens.svg", type: "image/svg+xml" }, { url: "/flowlens-icon.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/flowlens-apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
