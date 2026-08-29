"use client";

import { useEffect, useRef, useState } from "react";
import {
  createOrbRenderer,
  type OrbDrawCall,
  type OrbRenderer,
  type OrbRgb,
} from "./orb-shader";
import {
  ORB_KINDS,
  orbFieldPlacements,
  orbMatter,
  orbWaterline,
  type OrbKind,
  type OrbMatter,
} from "./shell-orb-contract";

// Bloque N3 · La probeta del orbe.
//
// Existe por una razón de MÉTODO: el criterio de aceptación de esta etapa es
// visual, y lo visual no se audita leyendo código. Esta probeta monta el
// renderer REAL —el mismo `createOrbRenderer` que corre en producción, con el
// mismo shader y los mismos uniformes— y pinta UN cuadro determinista, sin
// depender del bucle de animación. Así las cinco materias se pueden mirar lado
// a lado y el tope del vaso se puede comparar entre un lleno, un medio y un
// vacío, en la misma pantalla y con la misma luz.
//
// No dibuja nada que el santuario no dibuje, y no sabe nada de dinero: recibe
// un nivel de 0 a 1 y lo pasa por `orbWaterline`, igual que el orbe vivo.

// UN SOLO CONTEXTO PARA TODA LA PÁGINA.
//
// Cada probeta empezó con su propio contexto WebGL y la página se pasó del tope
// del navegador (~16): el primer orbe apareció MUERTO, con el cuadrito roto.
// Es un defecto de la probeta y no del santuario —que usa un contexto y ya—,
// pero se ve en `/dev/sistema`, que es justo donde se aprueba el acabado.
//
// Ahora hay un lienzo fuera de pantalla con UN renderer, y cada probeta recibe
// su cuadro copiado. De paso prueba algo que el santuario necesita: que el
// mismo renderer sirve para dibujar cualquier orbe, uno tras otro.
let sharedCanvas: HTMLCanvasElement | null = null;
let sharedRenderer: OrbRenderer | null = null;
let sharedFailed = false;

function paint(
  target: HTMLCanvasElement,
  width: number,
  height: number,
  orbs: OrbDrawCall[],
  day: number,
  time: number,
): 1 | 2 | null {
  if (sharedFailed) return null;
  if (!sharedCanvas) {
    sharedCanvas = document.createElement("canvas");
    sharedRenderer = createOrbRenderer(sharedCanvas);
    if (!sharedRenderer) {
      sharedFailed = true;
      return null;
    }
  }
  const renderer = sharedRenderer;
  if (!renderer) return null;
  const info = renderer.resize(width, height, window.devicePixelRatio || 1);
  renderer.draw({ time, day, tier: 3, orbs });
  target.width = info.width;
  target.height = info.height;
  const ctx = target.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(sharedCanvas, 0, 0);
  return info.glVersion;
}

const MATERIAL_BY_KIND: Record<OrbKind, number> = {
  saldo: 0,
  reserva: 1,
  metas: 2,
  patrimonio: 3,
  deuda: 4,
};

function readCssColor(element: HTMLElement, token: string): OrbRgb {
  const raw = getComputedStyle(element).getPropertyValue(token).trim();
  if (raw.startsWith("#")) {
    const normalized = raw.slice(1);
    const expanded = normalized.length === 3
      ? normalized.split("").map((part) => `${part}${part}`).join("")
      : normalized;
    const value = Number.parseInt(expanded, 16);
    if (expanded.length === 6 && Number.isFinite(value)) {
      return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
    }
  }
  const channels = raw.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (channels?.length === 3 && channels.every(Number.isFinite)) {
    return [channels[0]! / 255, channels[1]! / 255, channels[2]! / 255];
  }
  return [0, 0, 0];
}

export function OrbSpecimen({
  kind,
  level,
  matter = "liquido",
  size = 160,
  time = 4.2,
  tilt = 0,
  label,
}: {
  kind: OrbKind;
  level: number | null;
  matter?: OrbMatter;
  size?: number;
  time?: number;
  tilt?: number;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const theme = document.documentElement.dataset.theme ?? "dark";
    const glVersion = paint(
      canvas,
      size,
      size,
      [
        {
          centerX: size / 2,
          centerY: size / 2,
          radius: (size / 2) / 1.62,
          presence: 1,
          waterline: orbWaterline(level),
          energy: 0,
          voice: 0,
          tiltX: tilt,
          tiltZ: 0,
          spin: 0,
          material:
            matter === "cristal" ? MATERIAL_BY_KIND.patrimonio : MATERIAL_BY_KIND[kind],
          liquid: readCssColor(canvas, `--kipu-liquid-${kind}`),
          deep: readCssColor(canvas, `--kipu-deep-${kind}`),
          accent: readCssColor(canvas, `--layer-${kind}`),
        },
      ],
      theme === "light" ? 1 : 0,
      time,
    );
    if (glVersion == null) {
      setFailure("sin contexto WebGL");
      return;
    }
    canvas.dataset.glVersion = String(glVersion);
    canvas.dataset.drawn = "1";
  }, [kind, level, matter, size, time, tilt]);

  return (
    <figure className="kipu-orb-specimen" data-orb-kind={kind}>
      <canvas
        ref={canvasRef}
        className="kipu-orb-specimen__canvas"
        data-specimen={`${kind}:${level ?? "sin-nivel"}`}
        style={{ width: size, height: size }}
      />
      {label && <figcaption>{failure ?? label}</figcaption>}
    </figure>
  );
}

/**
 * EL CARRUSEL, CONGELADO EN UNA POSICIÓN — la prueba de D-N3.2.
 *
 * Pide la colocación a `orbFieldPlacements`, la MISMA función pura que usa el
 * santuario, y la dibuja con el MISMO renderer. Así la regla del founder
 * —durante el gesto las vecinas se ven sin cambios; en reposo, no— se puede
 * mirar en una imagen fija en vez de creerle a un párrafo: `position` entera es
 * el reposo, `position` a mitad de camino es el gesto.
 */
export function OrbFieldSpecimen({
  position,
  levels,
  width = 360,
  height = 190,
  label,
}: {
  position: number;
  levels: Partial<Record<OrbKind, number | null>>;
  width?: number;
  height?: number;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const radius = Math.min(height * 0.42, width * 0.17);
    const placements = orbFieldPlacements({
      count: ORB_KINDS.length,
      position,
      geometry: { centerX: width / 2, centerY: height / 2, radius, trackWidth: width },
    });
    const theme = document.documentElement.dataset.theme ?? "dark";
    const glVersion = paint(
      canvas,
      width,
      height,
      placements.map((slot) => {
        const kind = ORB_KINDS[slot.index]!;
        const matter = orbMatter(kind);
        return {
          centerX: slot.centerX,
          centerY: slot.centerY,
          radius: slot.radius,
          presence: slot.presence,
          waterline: orbWaterline(levels[kind] ?? 0.55),
          energy: 0,
          voice: 0,
          tiltX: 0,
          tiltZ: 0,
          spin: 0,
          material:
            matter === "cristal" ? MATERIAL_BY_KIND.patrimonio : MATERIAL_BY_KIND[kind],
          liquid: readCssColor(canvas, `--kipu-liquid-${kind}`),
          deep: readCssColor(canvas, `--kipu-deep-${kind}`),
          accent: readCssColor(canvas, `--layer-${kind}`),
        };
      }),
      theme === "light" ? 1 : 0,
      4.2,
    );
    if (glVersion == null) return;
    canvas.dataset.drawn = "1";
    canvas.dataset.presences = placements.map((p) => p.presence.toFixed(3)).join(",");
  }, [position, levels, width, height]);

  return (
    <figure className="kipu-orb-specimen" data-field-position={position}>
      <canvas
        ref={canvasRef}
        className="kipu-orb-specimen__canvas"
        data-field={`pos:${position}`}
        style={{ width, height }}
      />
      {label && <figcaption>{label}</figcaption>}
    </figure>
  );
}
