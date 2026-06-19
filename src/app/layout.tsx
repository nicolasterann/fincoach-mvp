import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://www.soykipu.com";
const KIPU_TITLE = "Kipu — tu coach financiero de bolsillo";
const KIPU_DESCRIPTION =
  "Kipu te dice cuánto puedes gastar tranquilo esta semana —ya descontados tus pagos, deudas, ahorro y metas— y te avisa antes de que algo te sorprenda. Le hablas como a un amigo que entiende de plata.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: KIPU_TITLE,
    template: "%s · Kipu",
  },
  description: KIPU_DESCRIPTION,
  applicationName: "Kipu",
  keywords: ["Kipu", "coach financiero", "finanzas personales", "Margen Kipu", "presupuesto", "Latinoamérica"],
  alternates: { canonical: "/" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Kipu",
  },
  openGraph: {
    type: "website",
    siteName: "Kipu",
    url: SITE_URL,
    title: KIPU_TITLE,
    description: KIPU_DESCRIPTION,
    locale: "es_419",
  },
  twitter: {
    card: "summary_large_image",
    title: KIPU_TITLE,
    description: KIPU_DESCRIPTION,
  },
};

// Native-feel mobile: edge-to-edge with safe-area support and a dark chrome
// that matches the app background.
export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full bg-zinc-950 antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
