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

export const metadata: Metadata = {
  title: "Kipu — tu coach financiero",
  description:
    "Kipu calcula tu Margen Kipu: lo que puedes gastar tranquilo esta semana, ya descontados tus pagos, deudas, ahorro y meta.",
  applicationName: "Kipu",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Kipu",
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
