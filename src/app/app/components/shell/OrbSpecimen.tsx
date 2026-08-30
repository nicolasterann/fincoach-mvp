"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createOrbRenderer,
  type OrbDrawCall,
  type OrbRenderer,
  type OrbRgb,
} from "./orb-shader";
import { ORB_REFERENCE_FRAGMENT_SOURCE } from "./orb-reference-shader";
import {
  ORB_KINDS,
  orbFieldPlacements,
  orbPresentationMaterial,
  orbMatter,
  orbWaterline,
  type OrbFill,
  type OrbKind,
  type OrbMatter,
} from "./shell-orb-contract";
import {
  advanceOrbWater,
  createOrbWaterState,
  orbFieldDrive,
  orbFieldSpeed,
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

// N3C · Y EL PORTE FIEL DEL ORBE DE ELLOS ENTRA POR ACÁ.
//
// Se INYECTA en el renderer en vez de importarse desde `orb-shader.ts`, y eso
// no es una preferencia de estilo: `orb-shader.ts` viaja en el paquete del
// santuario y `OrbSpecimen` no. Con la inyección, el shader de la comparación
// existe sólo en las páginas de dev. En producción `createOrbRenderer` se llama
// sin opciones y el programa no llega a compilarse.
function ensureRenderer(): OrbRenderer | null {
  if (sharedFailed) return null;
  if (!sharedCanvas) {
    sharedCanvas = document.createElement("canvas");
    sharedRenderer = createOrbRenderer(sharedCanvas, {
      referenceFragmentSource: ORB_REFERENCE_FRAGMENT_SOURCE,
      // N3C r10 · La mesa de luz enciende el fluido aunque producción lo tenga
      // apagado. Ése es el punto de apagarlo: seguir trabajándolo acá, y no en
      // el teléfono del founder.
      forceFluid: true,
    });
    if (!sharedRenderer) {
      sharedFailed = true;
      return null;
    }
  }
  return sharedRenderer;
}

// N3C r6 · CUÁNTOS SEGUNDOS DE FLUIDO SE ADELANTAN ANTES DE LA PRIMERA FOTO.
// Una probeta pinta un cuadro, y un fluido recién arrancado está QUIETO: sin
// esto la mesa de luz mostraría el material sin nada de movimiento, que es
// justo lo que hay que juzgar. Es determinista, así que dos rondas se pueden
// comparar.
const FLUID_WARM_SECONDS = 6;
let fluidWarmed = false;

/**
 * N3C r20 · EL CONTADOR DE CUADROS, porque el reloj de pared no alcanzaba.
 *
 * La r16 decidía «esto es un cuadro nuevo» por separación temporal: más de 4 ms
 * desde el último paso. Con cinco probetas funcionaba; con DIEZ —la hoja de
 * colores— los dibujos de un mismo cuadro se estiran más allá de esos 4 ms y se
 * cuelan pasos de más. Medido con la MISMA paleta: el fluido corría 11 % más
 * rápido en la hoja de diez (0,0204 contra 0,0184). El founder lo vio: «el
 * movimiento es un poco más rápido y brusco que el que ya habíamos aprobado».
 *
 * Un cuadro no es un intervalo de tiempo: es un cuadro. Se cuenta con su propio
 * `requestAnimationFrame`, y sólo la primera pintada de cada número avanza.
 */
let cuadroActual = 0;
if (typeof window !== "undefined") {
  const contar = () => {
    cuadroActual += 1;
    requestAnimationFrame(contar);
  };
  requestAnimationFrame(contar);
}

/**
 * N3C r16 · EL FLUIDO AVANZA UNA VEZ POR CUADRO, NO UNA POR PROBETA.
 *
 * Cinco probetas comparten UN renderer, y cada una llamaba a `draw`, que
 * avanzaba el fluido. Medido en el Chrome del founder: **5 pasos por cuadro**,
 * con los cinco empujones repetidos casi en el mismo instante y en el mismo
 * sitio. Él miraba una simulación cinco veces más violenta que la que yo medía
 * — y por eso él veía olas duras donde mis números decían que ya casi no había.
 *
 * El reloj de pared decide: la primera probeta del cuadro avanza, las otras
 * cuatro dibujan el mismo estado. `forzarPaso` existe para el instrumento
 * headless, que llama en un bucle apretado y necesita avanzar igual.
 */
let ultimoPasoEn = -1;
let ultimoPasoMs = -1;

function paint(
  target: HTMLCanvasElement,
  width: number,
  height: number,
  orbs: OrbDrawCall[],
  day: number,
  time: number,
  voice = 0,
  forzarPaso = false,
): 1 | 2 | null {
  const renderer = ensureRenderer();
  if (!renderer || !sharedCanvas) return null;
  const source = sharedCanvas;
  if (!fluidWarmed) {
    fluidWarmed = true;
    renderer.warmFluid(FLUID_WARM_SECONDS);
  }
  // Que se pueda MEDIR si el fluido corrió o si estamos en el degradado: sin
  // esto, «hay fluido» sería una suposición mirando una foto.
  target.dataset.fluid = renderer.hasFluid() ? "1" : "0";
  const info = renderer.resize(width, height, window.devicePixelRatio || 1);
  const ahora = typeof performance !== "undefined" ? performance.now() : 0;
  const transcurrido = ultimoPasoMs < 0 ? 1 / 60 : (ahora - ultimoPasoMs) / 1000;
  // el NÚMERO de cuadro, no el tiempo: otra probeta del mismo cuadro no avanza
  const avanzar = forzarPaso || ultimoPasoEn !== cuadroActual;
  if (avanzar) {
    ultimoPasoEn = cuadroActual;
    ultimoPasoMs = ahora;
  }
  renderer.draw({
    time,
    day,
    tier: 3,
    voice,
    wave: 0,
    // el paso real del reloj, acotado: un cuadro perdido no puede teletransportar
    // el fluido, y el instrumento headless pide 1/60 exacto para ser comparable
    dtSeconds: forzarPaso ? 1 / 60 : Math.min(1 / 20, Math.max(1 / 240, transcurrido)),
    stepFluid: avanzar,
    orbs,
  });
  target.width = info.width;
  target.height = info.height;
  const ctx = target.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(source, 0, 0);
  ultimaPintada = { target, width, height, orbs, day };
  return info.glVersion;
}

/**
 * N3C r12 · EL INSTRUMENTO QUE FALTABA: repintar SIN `requestAnimationFrame`.
 *
 * En este entorno el panel está oculto y el navegador suspende
 * `requestAnimationFrame`, así que no se compone ningún cuadro y el movimiento
 * del fluido es literalmente inobservable. Once rondas de esta etapa se pagaron
 * ahí: yo no podía ver lo que entregaba, y el founder terminaba siendo el
 * instrumento en producción.
 *
 * Esto NO simula nada. Llama al mismo `draw` real del mismo renderer real, que
 * es el que avanza el fluido; sólo lo hace desde un temporizador en vez de
 * desde el reloj de cuadros. Es dev: `OrbSpecimen` sólo lo importan las páginas
 * de `/dev`.
 */
let ultimaPintada: {
  target: HTMLCanvasElement;
  width: number;
  height: number;
  orbs: OrbDrawCall[];
  day: number;
} | null = null;

declare global {
  interface Window {
    __kipuOrbRepaint?: (time: number, voice?: number) => boolean;
  }
}

if (typeof window !== "undefined") {
  window.__kipuOrbRepaint = (time: number, voice = 0) => {
    if (!ultimaPintada) return false;
    const { target, width, height, orbs, day } = ultimaPintada;
    return paint(target, width, height, orbs, day, time, voice) !== null;
  };
}

/**
 * N3C · LA PROBETA TIENE QUE SEGUIR AL TEMA.
 *
 * Estas probetas pintan UN cuadro y se quedan quietas —es lo que las hace
 * medibles—, así que un cambio de tema no las tocaba: la página quedaba con
 * orbes del tema anterior y la comparación pasaba a mentir sin avisar. Lo
 * descubrí midiendo: el porte fiel daba el MISMO histograma en claro y en
 * oscuro, que es imposible si `uInverted` llega.
 *
 * Es el mismo `MutationObserver` sobre `data-*` del documento que usa su
 * componente para lo mismo.
 */
function useThemeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setTick((value) => value + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return tick;
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
  voice = 0,
  animado = false,
  paleta,
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
  /** N3C · 0 apaga el campo de color. Es el instrumento del antes/después. */
  env?: number;
  /** N3C · el volumen de M5, para fotografiar la onda de la voz sobre el agua. */
  voice?: number;
  /** N3C r13 · la probeta avanza su reloj con el del navegador, para JUZGAR movimiento. */
  animado?: boolean;
  /**
   * N3C r19 · TRES COLORES A LA FUERZA, para poder PROPONER una paleta sin
   * tocar los tokens de producción.
   *
   * Sin esto, comparar «lo que hay» contra «lo que propongo» exigiría cambiar
   * las variables CSS y mirar una cosa a la vez — y una paleta se juzga al lado
   * de la otra, no de memoria.
   */
  paleta?: { liquid: OrbRgb; deep: OrbRgb; accent: OrbRgb };
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const themeTick = useThemeTick();
  /**
   * N3C r13 · LA PROBETA QUE SE MUEVE.
   *
   * Las probetas pintan UN cuadro a propósito: es lo que las hace medibles y
   * comparables entre rondas. Pero el founder abrió la mesa de luz para juzgar
   * el MOVIMIENTO y vio fotos — «solo veo fotos». Un instrumento que no muestra
   * lo que hay que juzgar no sirve, por medible que sea.
   *
   * Con `animado` la misma probeta redibuja en el reloj de cuadros. El reloj NO
   * pasa por el estado de React: cinco orbes re-renderizando el árbol sesenta
   * veces por segundo se ve a tirones, y un instrumento que agrega su propio
   * tirón al movimiento que hay que juzgar miente. Se llama al mismo `paint`.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const theme = document.documentElement.dataset.theme ?? "dark";
    const dibujar = (tiempo: number) => paint(
      canvas,
      size,
      size,
      [
        {
          seed: Math.max(0, ORB_KINDS.indexOf(kind)),
          centerX: size / 2,
          centerY: size / 2,
          radius: (size / 2) / 1.62,
          presence: 1,
          waterline: orbWaterline(level),
          energy: 0,
          voice,
          tiltX: tilt,
          tiltZ: 0,
          spin: 0,
          wave,
          bob,
          depth: 0,
          env,
          // Un cuadro fijo, pero con el MISMO reloj que el santuario: la
          // velocidad sale de `orbFieldSpeed`, no de un número escrito acá.
          field: tiempo * orbFieldSpeed(orbFieldDrive(voice, wave)),
          material: orbPresentationMaterial({ kind, matter, fill }),
          liquid: paleta?.liquid ?? readCssColor(canvas, `--kipu-liquid-${kind}`),
          deep: paleta?.deep ?? readCssColor(canvas, `--kipu-deep-${kind}`),
          accent: paleta?.accent ?? readCssColor(canvas, `--layer-${kind}`),
        },
      ],
      theme === "light" ? 1 : 0,
      tiempo,
      voice,
    );
    const glVersion = dibujar(time);
    if (glVersion == null) {
      setFailure("sin contexto WebGL");
      return;
    }
    canvas.dataset.glVersion = String(glVersion);
    canvas.dataset.drawn = "1";
    if (!animado) return;
    let vivo = true;
    let id = 0;
    const t0 = performance.now();
    const paso = () => {
      if (!vivo) return;
      dibujar(time + (performance.now() - t0) / 1000);
      id = requestAnimationFrame(paso);
    };
    id = requestAnimationFrame(paso);
    return () => {
      vivo = false;
      cancelAnimationFrame(id);
    };
  }, [kind, level, matter, fill, size, time, tilt, wave, bob, env, voice, animado, paleta, themeTick]);

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
  const themeTick = useThemeTick();

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
          seed: slot.index,
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
          field: 0,
          material: orbPresentationMaterial({ kind, matter, fill: "nivel" }),
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
  }, [position, levels, width, height, themeTick]);

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

/**
 * N3C · LA COMPARACIÓN QUE DECIDE LA ETAPA (G6).
 *
 * Su orbe y el nuestro, EN EL MISMO LIENZO: el mismo contexto WebGL, el mismo
 * reloj, el mismo diámetro en píxeles y las mismas dos parejas de color. Es la
 * única forma honesta de responder la pregunta de la etapa —«¿igualamos el
 * look?»— porque cualquier diferencia de tamaño, de exposición o de momento
 * decidiría la respuesta antes que el ojo.
 *
 * `variant: "referencia"` dibuja con el porte fiel de su shader; `"kipu"`, con
 * el nuestro. La única asimetría es la que la etapa existe para mostrar: el
 * suyo es sólido y el nuestro tiene nivel y aire.
 */
export function OrbCompareSpecimen({
  slots,
  size = 200,
  gap = 18,
  animate = true,
  time = 6.5,
}: {
  slots: readonly {
    variant: "referencia" | "kipu";
    kind: OrbKind;
    level?: number | null;
    fill?: OrbFill;
    voice?: number;
    energy?: number;
  }[];
  size?: number;
  gap?: number;
  animate?: boolean;
  time?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const themeTick = useThemeTick();
  // El bucle de animación tiene que leer las viñetas VIGENTES sin volver a
  // suscribirse en cada render. La ref se sincroniza en un efecto y no durante
  // el render: tocarla mientras React renderiza es leer estado a mitad de una
  // pasada que puede reintentarse.
  const slotsRef = useRef(slots);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  const width = slots.length * size + Math.max(0, slots.length - 1) * gap;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let stopped = false;
    const startedAt = performance.now();

    const frame = (clock: number) => {
      const theme = document.documentElement.dataset.theme ?? "dark";
      const now = animate ? time + (clock - startedAt) / 1_000 : time;
      const glVersion = paint(
        canvas,
        width,
        size,
        slotsRef.current.map((slot, index) => {
          const voice = slot.voice ?? 0;
          const energy = slot.energy ?? 0.3;
          return {
            seed: index,
            centerX: index * (size + gap) + size / 2,
            centerY: size / 2,
            radius: size / 2 / 1.62,
            presence: 1,
            waterline: orbWaterline(slot.level ?? null),
            energy,
            voice,
            tiltX: 0,
            tiltZ: 0,
            spin: 0,
            wave: 0,
            bob: 0,
            depth: 0,
            env: 1,
            field: now * orbFieldSpeed(orbFieldDrive(voice, 0)),
            material: orbPresentationMaterial({
              kind: slot.kind,
              matter: orbMatter(slot.kind),
              fill: slot.fill ?? "nivel",
            }),
            liquid: readCssColor(canvas, `--kipu-liquid-${slot.kind}`),
            deep: readCssColor(canvas, `--kipu-deep-${slot.kind}`),
            accent: readCssColor(canvas, `--layer-${slot.kind}`),
            reference: slot.variant === "referencia",
          };
        }),
        theme === "light" ? 1 : 0,
        now,
      );
      if (glVersion == null) {
        setFailure("sin contexto WebGL");
        return;
      }
      canvas.dataset.glVersion = String(glVersion);
      canvas.dataset.drawn = "1";
      if (animate && !stopped) raf = requestAnimationFrame(frame);
    };

    frame(startedAt);
    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [width, size, gap, animate, time, themeTick]);

  return (
    <figure className="kipu-orb-compare">
      <canvas
        ref={canvasRef}
        data-orb-compare={slots.map((slot) => slot.variant).join("+")}
        style={{ width, height: size, maxWidth: "100%" }}
      />
      {failure && <figcaption>{failure}</figcaption>}
    </figure>
  );
}
