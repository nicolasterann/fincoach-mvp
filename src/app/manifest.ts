import type { MetadataRoute } from "next";

// PWA manifest: lets Kipu install to the home screen and run standalone, so
// the mobile experience feels like an app, not a browser tab. The share
// target makes Kipu appear in the OS share sheet: sharing text from any app
// (an SMS, a bank alert, an email body) lands in the chat as a capture.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kipu — tu coach financiero",
    short_name: "Kipu",
    description:
      "Tu Saldo Kipu: lo que puedes gastar tranquilo, ya descontados pagos, deudas, ahorro y meta.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#060a10",
    theme_color: "#060a10",
    icons: [
      {
        src: "/pwa/icon/192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon/maskable",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Registrar un gasto",
        short_name: "Registrar",
        url: "/app/chat",
      },
      {
        name: "Mi Saldo de hoy",
        short_name: "Saldo",
        url: "/app",
      },
    ],
    share_target: {
      action: "/app/chat",
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      params: {
        text: "share",
        title: "share_title",
        url: "share_url",
      },
    },
  };
}
