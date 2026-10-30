import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SiteChrome } from "@/components/SiteChrome";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://waitlyst.app"
  ),
  title: {
    default: "Waitlyst - Virtual Lines",
    template: "%s | Waitlyst",
  },
  description:
    "Virtual lines for restaurants, shops, product drops, and events. Join from your phone, wait anywhere, and trade spots with the person beside you.",
  openGraph: {
    title: "Waitlyst - Virtual Lines",
    description:
      "Virtual lines for restaurants, shops, product drops, and events. Join from your phone, wait anywhere, and trade spots with the person beside you.",
    siteName: "Waitlyst",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
  icons: {
    icon: "/icon",
    apple: "/apple-icon",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f3ee",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          <SiteChrome header={<Header />} footer={<Footer />}>
            {children}
          </SiteChrome>
        </Providers>
      </body>
    </html>
  );
}
