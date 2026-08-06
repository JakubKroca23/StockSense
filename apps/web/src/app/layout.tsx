import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, Source_Serif_4, Space_Grotesk } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const body = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body-loaded",
});

const display = Source_Serif_4({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700"],
  variable: "--font-display-loaded",
});

const brand = Space_Grotesk({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700"],
  variable: "--font-brand-loaded",
});

export const metadata: Metadata = {
  title: "StockSense",
  description: "Osobní analytický rádce pro akcie, komodity a crypto — Sense AI",
  applicationName: "StockSense",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "StockSense",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1220",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="cs">
      <body className={`${body.variable} ${display.variable} ${brand.variable} antialiased`}>
        <style>{`
          :root {
            --font-body: var(--font-body-loaded), "IBM Plex Sans", sans-serif;
            --font-display: var(--font-display-loaded), "Source Serif 4", serif;
            --font-brand: var(--font-brand-loaded), "Space Grotesk", sans-serif;
            --font-nav: var(--font-brand-loaded), "Space Grotesk", sans-serif;
          }
        `}</style>
        <AppShell>{children}</AppShell>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
