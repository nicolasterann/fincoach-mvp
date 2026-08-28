import { ImageResponse } from "next/og";

const DARK = "#060a10";
const SALDO = "#2dd4bf";
const SALDO_DEEP = "#0f766e";
const GLASS = "#dffcf7";

export function createKipuIcon(size: number, maskable = false) {
  const orbSize = Math.round(size * (maskable ? 0.56 : 0.7));
  const line = Math.max(3, Math.round(size * 0.018));

  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: DARK,
          display: "flex",
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            background: "linear-gradient(145deg, #17232d 0%, #091118 58%, #061019 100%)",
            border: `${line}px solid rgba(223,252,247,0.62)`,
            borderRadius: "999px",
            boxShadow: `0 0 ${Math.round(size * 0.1)}px rgba(45,212,191,0.3)`,
            display: "flex",
            height: orbSize,
            justifyContent: "center",
            overflow: "hidden",
            position: "relative",
            width: orbSize,
          }}
        >
          <div
            style={{
              background: `linear-gradient(180deg, ${SALDO} 0%, ${SALDO_DEEP} 100%)`,
              bottom: 0,
              display: "flex",
              height: "48%",
              left: 0,
              position: "absolute",
              width: "100%",
            }}
          />
          <div
            style={{
              background: GLASS,
              borderRadius: "999px",
              display: "flex",
              height: Math.max(3, Math.round(size * 0.022)),
              left: "25%",
              opacity: 0.72,
              position: "absolute",
              top: "20%",
              transform: "rotate(-24deg)",
              width: "32%",
            }}
          />
          <div
            style={{
              background: "rgba(223,252,247,0.5)",
              borderRadius: "999px",
              display: "flex",
              height: Math.max(3, Math.round(size * 0.014)),
              position: "absolute",
              top: "48%",
              width: "78%",
            }}
          />
        </div>
      </div>
    ),
    { height: size, width: size },
  );
}
