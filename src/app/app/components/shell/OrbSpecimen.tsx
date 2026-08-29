"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createOrbRenderer,
  type OrbDrawCall,
  type OrbRenderer,
  type OrbRgb,
} from "./orb-shader";
import {
  ORB_KINDS,
  orbFieldPlacements,
  orbMaterialCode,
  orbMatter,
  orbWaterline,
  type OrbFill,
  type OrbKind,
  type OrbMatter,
} from "./shell-orb-contract";
import {
  advanceOrbWater,
  createOrbWaterState,
  orbWaveEnergy,
  type OrbWaterState,
} from "./orb-water-sim";

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
  fill = "nivel",
  size = 160,
  time = 4.2,
  tilt = 0,
  wave = 0,
  bob = 0,
  env = 1,
  label,
}: {
  kind: OrbKind;
  level: number | null;
  matter?: OrbMatter;
  /** N3B · `gota` es una MATERIA, no un nivel bajo. Por acá se la puede mirar. */
  fill?: OrbFill;
  size?: number;
  time?: number;
  tilt?: number;
  /** N3B · la energía del chapoteo, para fotografiar el agua quieta y la agitada. */
  wave?: number;
  bob?: number;
  /** N3B · 0 apaga el cuarto. Es el instrumento de F3. */
  env?: number;
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
          wave,
          bob,
          depth: 0,
          env,
          material: orbMaterialCode({ kind, matter, fill }),
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
  }, [kind, level, matter, fill, size, time, tilt, wave, bob, env]);

  return (
    <figure className="kipu-orb-specimen" data-orb-kind={kind}>
      <canvas
        ref={canvasRef}
        className="kipu-orb-specimen__canvas"
        data-specimen={`${kind}:${fill === "gota" ? "gota" : (level ?? "sin-nivel")}`}
        data-orb-wave={wave}
        data-orb-env={env}
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
          wave: 0,
          bob: 0,
          depth: slot.depth,
          env: 1,
          material: orbMaterialCode({ kind, matter, fill: "nivel" }),
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
    canvas.dataset.depths = placements.map((p) => p.depth.toFixed(3)).join(",");
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

/**
 * EL CHAPOTEO, EN UNA TIRA DE CUADROS — la prueba de F4.
 *
 * El criterio dice: «se demuestra que responde a un impulso: inclinar, soltar, y
 * que oscila y se aquieta». En un entorno que no compone cuadros eso no se puede
 * mostrar con un video, así que se muestra como lo que es: una integración
 * DETERMINISTA del mismo `advanceOrbWater` que corre en el santuario, muestreada
 * a tiempos fijos. Cada viñeta es el líquido en ese instante, dibujado por el
 * renderer real.
 *
 * Y prueba lo que un video no probaría: que la superficie está QUIETA en t=0,
 * que el golpe la mueve, que **cruza el cero varias veces** —eso es oscilar, y
 * es lo que separa un líquido de un amortiguador— y que vuelve al reposo sola.
 */
export function OrbSloshStrip({
  kind = "saldo",
  level = 0.55,
  impulse = 0.9,
  times = [0, 0.12, 0.28, 0.45, 0.9, 2.2],
  size = 132,
}: {
  kind?: OrbKind;
  level?: number;
  impulse?: number;
  times?: readonly number[];
  size?: number;
}) {
  // La simulación es PURA y determinista: no hay nada que sincronizar con el
  // mundo, así que no es un efecto. Se calcula al renderizar, y el mismo
  // `advanceOrbWater` que corre en el santuario produce estos cuadros.
  const frames = useMemo(() => {
    const dt = 1 / 120;
    const wanted = [...times].sort((a, b) => a - b);
    const last = wanted[wanted.length - 1] ?? 1;
    let state: OrbWaterState = createOrbWaterState(orbWaterline(level));
    const out: { t: number; tiltX: number; wave: number; bob: number }[] = [];
    let cursor = 0;
    for (let step = 0; step * dt <= last + dt; step += 1) {
      const t = step * dt;
      while (cursor < wanted.length && t >= (wanted[cursor] ?? Infinity)) {
        out.push({
          t: wanted[cursor]!,
          tiltX: state.tiltX,
          wave: orbWaveEnergy(state),
          bob: state.bob,
        });
        cursor += 1;
      }
      // El golpe entra UNA vez, en el primer paso, y nada lo sostiene después:
      // todo lo que se ve a partir de ahí es el líquido solo.
      state = advanceOrbWater(
        state,
        {
          tiltX: 0,
          tiltZ: 0,
          travel: step === 0 ? impulse : 0,
          waterline: orbWaterline(level),
          impulse: 0,
        },
        dt,
      );
    }
    return out;
  }, [level, impulse, times]);

  return (
    <div className="kipu-sistema-row" data-slosh-frames={frames.length}>
      {frames.map((frame) => (
        <div key={frame.t} className="kipu-sistema-slot" data-slot-shape="orbe">
          <p className="kipu-sistema-slot__name">
            t = {frame.t.toFixed(2)}s · inclinación {frame.tiltX.toFixed(3)}
          </p>
          <OrbSpecimen
            kind={kind}
            level={level}
            size={size}
            time={4.2 + frame.t}
            tilt={frame.tiltX}
            wave={frame.wave}
            bob={frame.bob}
            label={`ola ${frame.wave.toFixed(2)}`}
          />
        </div>
      ))}
    </div>
  );
}
