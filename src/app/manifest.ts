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
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
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
        name: "Mi margen de hoy",
        short_name: "Margen",
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
