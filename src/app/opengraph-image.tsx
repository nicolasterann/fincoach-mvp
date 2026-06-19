import { ImageResponse } from "next/og";

// Branded social-share card for Kipu (1200×630). Generated at build/edge with
// next/og + system fonts (no external fetch) so it's robust. Honest, on-brand.

export const alt = "Kipu — tu coach financiero de bolsillo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "84px",
          background: "linear-gradient(135deg, #0a0f0c 0%, #09090b 60%)",
          color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              border: "3px solid #34d399",
              display: "flex",
            }}
          />
          <div style={{ fontSize: 40, fontWeight: 800, color: "#34d399", letterSpacing: -1 }}>Kipu</div>
        </div>
        <div style={{ marginTop: 44, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 78, fontWeight: 800, lineHeight: 1.04, letterSpacing: -2 }}>Gasta tranquilo.</div>
          <div style={{ fontSize: 78, fontWeight: 800, lineHeight: 1.04, letterSpacing: -2, color: "#34d399" }}>
            Kipu hace las cuentas.
          </div>
        </div>
        <div style={{ marginTop: 34, fontSize: 30, color: "#a1a1aa", maxWidth: 940, lineHeight: 1.35 }}>
          Cuánto puedes gastar esta semana, ya descontados tus pagos, deudas, ahorro y metas.
        </div>
      </div>
    ),
    size,
  );
}
