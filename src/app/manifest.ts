import type { MetadataRoute } from "next";

// PWA manifest: lets Kipu install to the home screen and run standalone, so
// the mobile experience feels like an app, not a browser tab.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kipu — tu coach financiero",
    short_name: "Kipu",
    description:
      "Tu Margen Kipu: lo que puedes gastar tranquilo, ya descontados pagos, deudas, ahorro y meta.",
    start_url: "/app",
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
  };
}
