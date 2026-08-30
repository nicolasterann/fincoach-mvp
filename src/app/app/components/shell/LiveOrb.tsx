"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { ShellDawn } from "./shell-payload";
import {
  createOrbRenderer,
  type OrbBufferInfo,
  type OrbDrawCall,
  type OrbRenderer,
  type OrbRgb,
} from "./orb-shader";
import {
  orbActiveIndex,
  orbFieldPlacements,
  orbPresentationMaterial,
  orbMustRedraw,
  orbWaterline,
  type OrbFill,
  type OrbKind,
  type OrbMatter,
} from "./shell-orb-contract";
import {
  advanceOrbField,
  advanceOrbWater,
  createOrbWaterState,
  orbFieldDrive,
  orbWaveEnergy,
  type OrbWaterState,
} from "./orb-water-sim";
import {
  advanceVoiceEnvelope,
  voiceTarget,
  type OrbVoiceState,
} from "./voice-capture-contract";
import type { DeviceTiltHandle } from "./useDeviceTilt";

// Bloque N3 — LOS CINCO ORBES VIVEN EN UN SOLO LIENZO, Y EL LIENZO ES EL
// CARRUSEL.
//
// Hasta N2 esto era un canvas fijo y centrado con las capas pasando por debajo,
// y esa forma no podía sentirse continua: obligaba al orbe a cambiarse de color
// a sí mismo en cada capa, de donde salieron el relevo y el lag de una capa que
// el founder fotografió. Ahora la posición de cada orbe se DERIVA del
// desplazamiento de la vía, así que deslizar los mueve a todos y las vecinas
// asoman a los costados. No hay cambio de capa: hay movimiento.
//
// LO QUE NO SE REEMPLAZÓ, A PROPÓSITO: el gesto sigue siendo scroll nativo. El
// navegador conserva la inercia, el snap, la accesibilidad y el hecho de que
// `scrollLeft` sea la fuente de verdad de la posición. Lo único que se mudó al
// lienzo es el DIBUJO. Por eso la paridad de M2/B12 —posición, slide, chip,
// capa, acento, nudo, cifra— no hubo que reponerla: nunca se fue, y ahora la
// capa activa y el centro del lienzo salen de la MISMA posición a través de
// `orbActiveIndex`, así que no existen dos fuentes que puedan separarse.

export type OrbQualityTier = 0 | 1 | 2 | 3;
export type OrbPauseReason =
  | "initializing"
  | "hidden"
  | "offscreen"
  | "inactive"
  | "no-size"
  | "tier-0"
  | null;
export type LiveOrbState =
  | "available"
  | "dawn"
  | "fog"
  | "runway"
  | "empty"
  | "capturing"
  | "written"
  | "crossing";

export interface LiveOrbHandle {
  signalCapture(): void;
  signalWritten(result: { level: number; receiptKey: string }): void;
  signalCrossing(result: { level: number; to: OrbKind; factKey: string }): void;
  setVoice(state: OrbVoiceState, level?: number): void;
  reset(): void;
}

export interface LiveOrbTelemetry {
  tier: OrbQualityTier | null;
  fps: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  dpr: number | null;
  bufferPixels: number | null;
  liveContexts: number | null;
  paused: boolean;
  pauseReason: OrbPauseReason;
  /** N3 · qué contexto se consiguió de verdad, no cuál se pidió. */
  glVersion: 1 | 2 | null;
  antialias: boolean | null;
  /** N3 · cuántos orbes se dibujaron en el último cuadro. En reposo: uno. */
  drawnOrbs: number | null;
  /** N3 · E10 · fps medido al abrir, a los 30 s y a los 3 min. */
  fpsAt: { open: number | null; s30: number | null; s180: number | null };
}

/** Lo que el lienzo necesita saber de UNA capa. */
export interface LiveOrbSlotInput {
  kind: OrbKind;
  /** El nivel del MOTOR, sin acotar. Lo mapea a trazo `orbWaterline`. */
  level: number | null;
  /** La decisión de `orbFill`. `sin-dato` NO se dibuja: lo dibuja el DOM. */
  fill: OrbFill;
  matter: OrbMatter;
}

interface LiveOrbProps {
  orbs: readonly LiveOrbSlotInput[];
  /** La vía del carrusel. Su `scrollLeft` es la fuente de verdad de todo. */
  trackRef: RefObject<HTMLDivElement | null>;
  dawn: ShellDawn | null;
  runway: boolean;
  active: boolean;
  tilt: DeviceTiltHandle;
  forcedTier?: OrbQualityTier;
  forcedState?: LiveOrbState;
  showPerf?: boolean;
  onStateChange?: (state: LiveOrbState) => void;
  /** N2 §5.1 · Se dispara UNA vez, cuando el lienzo ya pintó su primer cuadro. */
  onReady?: () => void;
}

type LocalSignal =
  | { type: "capturing" }
  | { type: "written"; level: number; receiptKey: string }
  | { type: "crossing"; level: number; to: OrbKind; factKey: string }
  | null;

interface RenderInputs {
  orbs: readonly LiveOrbSlotInput[];
  /** La capa activa. La deriva `orbActiveIndex` desde la posición de la vía. */
  kind: OrbKind;
  activeIndex: number;
  dawn: ShellDawn | null;
  state: LiveOrbState;
  signal: LocalSignal;
  active: boolean;
}


const DAWN_STORAGE_KEY = "kipu:shell:dawn:last-day";
const IDLE_AFTER_MS = 60_000;
let liveWebglContexts = 0;

function clampLevel(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? 0;
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

function initialTier(forcedTier?: OrbQualityTier): OrbQualityTier {
  if (forcedTier != null) return forcedTier;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4) ||
      (nav.deviceMemory != null && nav.deviceMemory <= 4)) {
    return 2;
  }
  return 3;
}

function deriveState(input: {
  forcedState?: LiveOrbState;
  signal: LocalSignal;
  dawnActive: boolean;
  runway: boolean;
  amountMissing: boolean;
  level: number | null;
}): LiveOrbState {
  if (input.forcedState) return input.forcedState;
  if (input.signal?.type === "capturing") return "capturing";
  if (input.signal?.type === "written") return "written";
  if (input.signal?.type === "crossing") return "crossing";
  if (input.dawnActive) return "dawn";
  if (input.runway) return "runway";
  if (input.amountMissing || input.level === 0) return "empty";
  return "available";
}

function telemetryText(value: number | null): string {
  return value != null && Number.isFinite(value) ? value.toFixed(1) : "—";
}

function pauseReasonLabel(reason: OrbPauseReason): string {
  if (reason === "hidden") return "oculto";
  if (reason === "offscreen") return "fuera de viewport";
  if (reason === "inactive") return "tapado por una hoja";
  if (reason === "no-size") return "sin tamaño";
  if (reason === "tier-0") return "tier 0";
  return "inicializando";
}

function signalAnimationKey(input: RenderInputs): string {
  if (input.signal?.type === "written") return `written:${input.signal.receiptKey}`;
  if (input.signal?.type === "crossing") return `crossing:${input.signal.factKey}`;
  if (input.state === "dawn") return `dawn:${input.dawn?.dayKey ?? "none"}`;
  return `${input.state}:${input.kind}`;
}

export const LiveOrb = forwardRef<LiveOrbHandle, LiveOrbProps>(function LiveOrb(
  {
    orbs,
    trackRef,
    dawn,
    runway,
    active,
    tilt,
    forcedTier,
    forcedState,
    showPerf = false,
    onStateChange,
    onReady,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wakeRef = useRef<() => void>(() => undefined);
  const voiceRef = useRef<{ state: OrbVoiceState; level: number }>({
    state: "calm",
    level: 0,
  });
  const [signal, setSignal] = useState<LocalSignal>(null);
  const [voiceState, setVoiceState] = useState<OrbVoiceState>("calm");
  const [dawnDay, setDawnDay] = useState<string | null>(null);
  const [tier, setTier] = useState<OrbQualityTier>(0);
  const [telemetry, setTelemetry] = useState<LiveOrbTelemetry>({
    tier: null,
    fps: null,
    medianMs: null,
    p95Ms: null,
    dpr: null,
    bufferPixels: null,
    liveContexts: null,
    paused: true,
    pauseReason: "initializing",
    glVersion: null,
    antialias: null,
    drawnOrbs: null,
    fpsAt: { open: null, s30: null, s180: null },
  });

  useImperativeHandle(ref, () => ({
    signalCapture() {
      setSignal({ type: "capturing" });
    },
    signalWritten(result) {
      if (!result.receiptKey.trim() || !Number.isFinite(result.level)) return;
      setSignal({
        type: "written",
        level: clampLevel(result.level),
        receiptKey: result.receiptKey,
      });
    },
    signalCrossing(result) {
      if (!result.factKey.trim() || !Number.isFinite(result.level)) return;
      setSignal({
        type: "crossing",
        level: clampLevel(result.level),
        to: result.to,
        factKey: result.factKey,
      });
    },
    setVoice(nextState, nextLevel) {
      voiceRef.current = {
        state: nextState,
        level:
          nextState === "listening" && Number.isFinite(nextLevel)
            ? clampLevel(nextLevel ?? 0)
            : 0,
      };
      setVoiceState(nextState);
      wakeRef.current();
    },
    reset() {
      setSignal(null);
    },
  }), []);

  // La posición viva de la vía. Se lee en el bucle, no en el render de React:
  // un `setState` por cuadro de scroll sería re-renderizar el santuario entero a
  // 60 Hz, que es exactamente el costo que el Bloque N vino a bajar.
  const positionRef = useRef(0);
  const readPosition = useRef((): number => {
    const track = trackRef.current;
    if (!track || track.clientWidth <= 0) return positionRef.current;
    const raw = track.scrollLeft / track.clientWidth;
    positionRef.current = Number.isFinite(raw) ? raw : 0;
    return positionRef.current;
  });

  const activeIndexNow = orbActiveIndex({
    count: orbs.length,
    position: positionRef.current,
  });
  const activeOrb = orbs[activeIndexNow] ?? orbs[0] ?? null;

  useEffect(() => {
    setSignal(null);
  }, [activeOrb?.kind]);

  useEffect(() => {
    if (forcedState === "dawn") {
      setDawnDay(dawn?.dayKey ?? "preview");
      return;
    }
    if (activeOrb?.kind !== "saldo" || !dawn) {
      setDawnDay(null);
      return;
    }
    try {
      if (window.localStorage.getItem(DAWN_STORAGE_KEY) === dawn.dayKey) {
        setDawnDay(null);
        return;
      }
      window.localStorage.setItem(DAWN_STORAGE_KEY, dawn.dayKey);
      setDawnDay(dawn.dayKey);
    } catch {
      // Storage can be disabled. The financial level stays truthful; only the
      // once-per-device ceremony is skipped rather than inventing persistence.
      setDawnDay(null);
    }
  }, [dawn, forcedState, activeOrb?.kind]);

  const state = deriveState({
    forcedState,
    signal,
    dawnActive: dawnDay != null,
    runway,
    amountMissing: activeOrb == null || activeOrb.fill === "sin-dato",
    level: activeOrb?.level ?? null,
  });

  const renderInputs = useRef<RenderInputs>({
    orbs,
    kind: activeOrb?.kind ?? "saldo",
    activeIndex: activeIndexNow,
    dawn,
    state,
    signal,
    active,
  });
  renderInputs.current = {
    orbs,
    kind: activeOrb?.kind ?? "saldo",
    activeIndex: activeIndexNow,
    dawn,
    state,
    signal,
    active,
  };

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const tiltRef = useRef(tilt);
  tiltRef.current = tilt;

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  useEffect(() => {
    wakeRef.current();
  }, [active, state]);

  useEffect(() => {
    if (state !== "dawn" || forcedState === "dawn") return;
    const timeout = window.setTimeout(() => setDawnDay(null), 1_240);
    return () => window.clearTimeout(timeout);
  }, [forcedState, state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const selectedTier = initialTier(forcedTier);
    setTier(selectedTier);
    const deadTelemetry = (): LiveOrbTelemetry => ({
      tier: 0,
      fps: null,
      medianMs: null,
      p95Ms: null,
      dpr: null,
      bufferPixels: null,
      liveContexts: liveWebglContexts,
      paused: true,
      pauseReason: "tier-0",
      glVersion: null,
      antialias: null,
      drawnOrbs: null,
      fpsAt: { open: null, s30: null, s180: null },
    });
    if (selectedTier === 0) {
      setTelemetry(deadTelemetry());
      return;
    }

    let renderer: OrbRenderer | null = createOrbRenderer(canvas);
    if (!renderer) {
      setTier(0);
      setTelemetry(deadTelemetry());
      return;
    }
    liveWebglContexts += 1;
    let contextCounted = true;

    let currentTier: OrbQualityTier = selectedTier;
    let buffer: OrbBufferInfo | null = null;
    let frameRequest = 0;
    let inViewport: boolean | null = null;
    let loopWasPaused = true;
    let lastDrawAt = 0;
    let lastInteractionAt = performance.now();
    const startAt = performance.now();
    const frameSamples: number[] = [];
    let announcedReady = false;
    let framesThisSecond = 0;
    let fpsWindowAt = performance.now();
    let fps: number | null = null;
    const fpsAt: { open: number | null; s30: number | null; s180: number | null } = {
      open: null,
      s30: null,
      s180: null,
    };
    let telemetryAt = 0;
    let drawnOrbs = 0;
    // N2-7 · la capa que el lienzo está mostrando DE VERDAD.
    let drawnKind: OrbKind | null = null;

    // La geometría sale de la CAJA QUE EL CSS YA MAQUETÓ, no de un número
    // escrito aquí: así el orbe no puede separarse de su cifra si cambia el
    // layout, y `min(70vw, 34svh, 300px)` sigue teniendo un solo dueño.
    let orbRadius = 0;
    let orbCenterY = 0;
    let trackWidth = 0;

    const colorCache = new Map<string, { liquid: OrbRgb; deep: OrbRgb; accent: OrbRgb }>();
    const colorsFor = (kind: OrbKind, theme: string) => {
      const key = `${kind}:${theme}`;
      const cached = colorCache.get(key);
      if (cached) return cached;
      const next = {
        liquid: readCssColor(canvas, `--kipu-liquid-${kind}`),
        deep: readCssColor(canvas, `--kipu-deep-${kind}`),
        accent: readCssColor(canvas, `--layer-${kind}`),
      };
      colorCache.set(key, next);
      return next;
    };

    let animatedLevel = orbWaterline(renderInputs.current.orbs[renderInputs.current.activeIndex]?.level ?? 0);
    let animatedVoice = voiceTarget("calm");
    let animationKey = signalAnimationKey(renderInputs.current);
    let animationFrom = animatedLevel;
    let animationAt = startAt;
    // El agua tiene peso: se inclina con el arrastre y vuelve a su nivel sola.
    // N3B · EL AGUA YA NO SE RESUELVE ACÁ ADENTRO.
    //
    // N3 tenía siete líneas de resorte sueltas en el bucle, y por eso nadie pudo
    // probar nunca que amortiguaran: lo que sólo existe dentro de un
    // `requestAnimationFrame` no se puede ejecutar en un entorno que no compone
    // cuadros. Es la familia de agujeros que este bloque arrastra desde N1, y
    // ésta es su sexta aparición. Ahora el líquido vive en `orb-water-sim`,
    // puro, y el gate lo integra dos segundos y le exige que oscile y se
    // aquiete. Acá sólo queda el estado.
    let water: OrbWaterState = createOrbWaterState(0);
    // N3C · el reloj del campo de color, que acelera con la voz. Acumulado acá y
    // avanzado por una función pura, igual que el agua: lo que sólo existe
    // dentro del bucle no se puede ejecutar ni, por lo tanto, probar.
    let fieldClock = 0;
    let lastPosition = readPosition.current();

    const releaseContextCount = () => {
      if (!contextCounted) return;
      contextCounted = false;
      liveWebglContexts = Math.max(0, liveWebglContexts - 1);
    };

    const getPauseReason = (): OrbPauseReason => {
      if (currentTier === 0 || renderer == null) return "tier-0";
      if (document.hidden) return "hidden";
      // N3 · D-N3.4 (default declarado) · el orbe VIVE MIENTRAS SE LO MIRA y se
      // calma solo cuando no está a la vista. `active` es «no hay una hoja
      // encima»: deslizar ya NO pausa, porque en la forma nueva el gesto ES el
      // dibujo.
      if (!renderInputs.current.active) return "inactive";
      if (inViewport === false) return "offscreen";
      if (buffer == null) return "no-size";
      // Un viewport TODAVÍA DESCONOCIDO no es motivo para no pintar. Antes el
      // primer cuadro esperaba al `IntersectionObserver`, que entrega dentro del
      // ciclo de render: hasta que el navegador no componía, el orbe no
      // arrancaba. Si resulta que está fuera de pantalla, el observador lo
      // apaga un instante después — el costo es un cuadro, y lo que se gana es
      // que el relevo del orbe de CSS no dependa de un observador.
      return null;
    };

    const shouldPause = () => getPauseReason() != null;

    // N2-7 · una pausa POR GESTO le debe un cuadro a la capa rancia. La forma
    // nueva hace la clase mucho más difícil —el lienzo ya no se pausa al
    // deslizar— pero la deuda sigue existiendo cuando una hoja tapa el orbe y
    // debajo cambia la capa, así que el guard se conserva entero.
    const owesStaleLayerFrame = () =>
      orbMustRedraw({
        pauseReason: getPauseReason(),
        drawnKind,
        activeKind: renderInputs.current.kind,
      });

    const publishTelemetry = (now: number, force = false) => {
      if (!force && now - telemetryAt < 500) return;
      telemetryAt = now;
      const pauseReason = getPauseReason();
      setTelemetry({
        tier: currentTier,
        fps: pauseReason == null ? fps : null,
        medianMs: frameSamples.length > 0 ? percentile(frameSamples, 0.5) : null,
        p95Ms: frameSamples.length > 0 ? percentile(frameSamples, 0.95) : null,
        dpr: buffer?.dpr ?? null,
        bufferPixels: buffer == null ? null : buffer.width * buffer.height,
        liveContexts: liveWebglContexts,
        paused: pauseReason != null,
        pauseReason,
        glVersion: buffer?.glVersion ?? null,
        antialias: buffer?.antialias ?? null,
        drawnOrbs,
        fpsAt: { ...fpsAt },
      });
    };

    const measure = (): boolean => {
      if (!renderer) return false;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) {
        publishTelemetry(performance.now(), true);
        return false;
      }
      const track = trackRef.current;
      trackWidth = track != null && track.clientWidth > 0 ? track.clientWidth : rect.width;
      const box = track?.querySelector<HTMLElement>(".kipu-shell-orb");
      if (box) {
        const boxRect = box.getBoundingClientRect();
        if (boxRect.width > 1) {
          orbRadius = boxRect.width / 2;
          orbCenterY = boxRect.top - rect.top + boxRect.height / 2;
        }
      }
      if (orbRadius <= 0) {
        orbRadius = Math.min(rect.width * 0.35, rect.height * 0.34, 150);
        orbCenterY = rect.height * 0.42;
      }
      buffer = renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
      publishTelemetry(performance.now(), true);
      return true;
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      if (!renderer) return;
      renderer = null;
      releaseContextCount();
      currentTier = 0;
      setTier(0);
      loopWasPaused = true;
      if (frameRequest) cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      publishTelemetry(performance.now(), true);
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    const resizeObserver = new ResizeObserver(() => measure());
    resizeObserver.observe(canvas);
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
    measure();
    publishTelemetry(performance.now(), true);

    // N2 §5.2 · LA ESCALERA DE CALIDAD SIGUE RETIRADA. La calidad es UNA
    // decisión por dispositivo, tomada antes del primer cuadro, y no se vuelve
    // a mover delante del usuario. La única salida de tier que queda es
    // `webglcontextlost`, y no es una decisión de calidad: es que el lienzo se
    // murió y no hay nada que dibujar.

    const draw = (now: number) => {
      frameRequest = 0;
      if (buffer == null) measure();
      if (shouldPause() && !owesStaleLayerFrame()) {
        loopWasPaused = true;
        publishTelemetry(now, true);
        return;
      }

      const idle = now - lastInteractionAt >= IDLE_AFTER_MS;
      const cadence = idle ? 1000 / 30 : 1000 / 60;
      if (lastDrawAt > 0 && now - lastDrawAt < cadence - 0.5) {
        frameRequest = requestAnimationFrame(draw);
        return;
      }
      const frameDelta = lastDrawAt > 0 ? now - lastDrawAt : null;
      lastDrawAt = now;
      drawnKind = renderInputs.current.kind;
      if (frameDelta != null) {
        frameSamples.push(frameDelta);
        if (frameSamples.length > 120) frameSamples.shift();
      }
      if (!renderer || currentTier === 0) {
        loopWasPaused = true;
        publishTelemetry(now, true);
        return;
      }

      const input = renderInputs.current;
      const position = readPosition.current();
      const step = frameDelta == null ? 1 : Math.min(3, frameDelta / (1000 / 60));

      // EL AGUA RESPONDE AL MOVIMIENTO, con peso: el desplazamiento la empuja,
      // un resorte la devuelve a su nivel y el rozamiento la frena. Sale de la
      // MISMA posición que dibuja los orbes, así que no puede desincronizarse
      // del gesto.
      const dPos = position - lastPosition;
      lastPosition = position;

      const nextAnimationKey = signalAnimationKey(input);
      const activeInput = input.orbs[input.activeIndex] ?? null;
      const trueWaterline = orbWaterline(activeInput?.level ?? null);
      if (nextAnimationKey !== animationKey) {
        animationKey = nextAnimationKey;
        animationAt = now;
        animationFrom = animatedLevel;
        if (input.state === "dawn" && input.dawn) {
          animatedLevel = orbWaterline(clampLevel(input.dawn.levelFrom));
          animationFrom = animatedLevel;
        }
      }
      const targetWaterline =
        input.signal?.type === "written" || input.signal?.type === "crossing"
          ? orbWaterline(input.signal.level)
          : trueWaterline;
      if (input.state === "dawn" && input.dawn) {
        const progress = Math.min(1, (now - animationAt) / 1_200);
        const eased = 1 - Math.pow(1 - progress, 3);
        const from = orbWaterline(clampLevel(input.dawn.levelFrom));
        animatedLevel = from + (trueWaterline - from) * eased;
      } else if (input.state === "written" || input.state === "crossing") {
        const progress = Math.min(1, (now - animationAt) / 1_100);
        const eased = 1 - Math.pow(1 - progress, 3);
        animatedLevel = animationFrom + (targetWaterline - animationFrom) * eased;
      } else if (input.state !== "capturing") {
        animatedLevel = trueWaterline;
      }

      const theme = document.documentElement.dataset.theme ?? "dark";
      const elapsed = (now - startAt) / 1_000;
      const slowTime = input.state === "runway" ? elapsed * 0.36 : elapsed;
      const energy = input.state === "capturing"
        ? 0.42 + Math.sin(elapsed * 4.2) * 0.12
        : input.state === "written" || input.state === "crossing"
          ? Math.max(0, 1 - (now - animationAt) / 1_100)
          : 0;
      const voice = voiceRef.current;
      animatedVoice = advanceVoiceEnvelope(
        animatedVoice,
        voiceTarget(voice.state, voice.level),
        step,
      );

      // ── UN CUADRO DE LÍQUIDO ─────────────────────────────────────────────
      //
      // El giroscopio entra como OBJETIVO del plano, no como su valor. Es el
      // defecto que más se notaba en el teléfono y estaba a la vista en una sola
      // línea de N3: `tiltX: leanX + gyro.x` — la inclinación del teléfono
      // llegaba CRUDA al shader, sin una sola línea de inercia entre el aparato
      // y el agua. Inclinabas el teléfono y el agua se inclinaba con él, al
      // instante y sin peso: exactamente lo que un líquido no hace.
      const gyro = tiltRef.current.tilt.current;
      water = advanceOrbWater(
        water,
        {
          tiltX: gyro.x,
          tiltZ: gyro.z,
          travel: dPos,
          waterline: animatedLevel,
          // Un recibo y un cruce de capa GOLPEAN el agua: entran por la
          // velocidad del pistón, que es como entra un impacto en un líquido.
          // `animationAt` se acaba de poner en `now` si hubo señal nueva, así
          // que esta ventana corta ES el flanco: el golpe entra una vez, no en
          // todos los cuadros de la animación.
          impulse:
            now - animationAt < 40 &&
            (input.signal?.type === "written" || input.signal?.type === "crossing")
              ? 0.9
              : 0,
        },
        frameDelta == null ? 1 / 60 : Math.max(0.001, frameDelta / 1_000),
      );
      const waveEnergy = orbWaveEnergy(water);
      fieldClock = advanceOrbField(
        fieldClock,
        orbFieldDrive(animatedVoice, waveEnergy),
        frameDelta == null ? 1 / 60 : Math.max(0.001, frameDelta / 1_000),
      );
      const placements = orbFieldPlacements({
        count: input.orbs.length,
        position,
        geometry: {
          centerX: (buffer ? buffer.width / (buffer.dpr || 1) : trackWidth) / 2,
          centerY: orbCenterY,
          radius: orbRadius,
          trackWidth,
        },
      });
      const calls: OrbDrawCall[] = [];
      for (const slot of placements) {
        const orb = input.orbs[slot.index];
        if (!orb) continue;
        // `sin-dato` NO se dibuja en el lienzo. La frontera de N0 se mantiene
        // ENTERA en la forma nueva: «no pude leer» lo dibuja el DOM con su
        // silueta interrumpida, y por eso nunca puede parecerse a un cero leído.
        if (orb.fill === "sin-dato") continue;
        if (slot.presence <= 0.002) continue;
        const isActive = slot.index === input.activeIndex;
        const colors = colorsFor(orb.kind, theme);
        calls.push({
          centerX: slot.centerX,
          centerY: slot.centerY,
          radius: slot.radius,
          presence: slot.presence,
          // Cada vecina se dibuja con SU nivel real. La activa es la única que
          // anima, y sólo cuando hay un recibo o un amanecer que lo justifique.
          waterline: isActive ? animatedLevel : orbWaterline(orb.level),
          energy: isActive ? energy : 0,
          voice: isActive ? animatedVoice : 0,
          tiltX: water.tiltX,
          tiltZ: water.tiltZ,
          spin: water.spin,
          // La ola sale de la VELOCIDAD del líquido: quieto es un espejo.
          wave: waveEnergy,
          bob: isActive ? water.bob : 0,
          // Lo que está detrás se ve detrás: más chico, con menos contraste, y
          // por eso PASA por atrás en vez de intersecarse con un borde duro.
          depth: slot.depth,
          // El santuario SIEMPRE lleva el campo de color. El apagado existe
          // sólo en la probeta, para poder fotografiar el antes y el después.
          env: 1,
          // N3C · el reloj del campo. Uno solo para los cinco: es el mismo
          // líquido en el mismo momento, no cinco animaciones sueltas.
          field: fieldClock,
          // La materia la decide UNA función pura, que el gate ejecuta — y que
          // por fin vuelve a entregarle la GOTA al vidrio.
          material: orbPresentationMaterial({
            kind: orb.kind,
            matter: orb.matter,
            fill: orb.fill,
          }),
          liquid: colors.liquid,
          deep: colors.deep,
          accent: colors.accent,
        });
      }
      drawnOrbs = calls.length;
      // el santuario también lo declara: el fluido corrió, o no
      canvas.dataset.fluid = renderer.hasFluid() ? "1" : "0";
      renderer.draw({
        time: slowTime,
        day: theme === "light" ? 1 : 0,
        tier: currentTier,
        // N3C r6 · lo que empuja el fluido: la voz de M5 y el chapoteo del
        // líquido. Es UNA simulación para el lienzo entero, así que el empuje
        // viene del cuadro y no de una llamada de dibujo.
        voice: animatedVoice,
        wave: waveEnergy,
        dtSeconds: frameDelta == null ? 1 / 60 : Math.max(0.001, frameDelta / 1_000),
        orbs: calls,
      });

      if (!announcedReady) {
        announcedReady = true;
        onReadyRef.current?.();
      }

      framesThisSecond += 1;
      if (now - fpsWindowAt >= 1_000) {
        fps = (framesThisSecond * 1_000) / (now - fpsWindowAt);
        framesThisSecond = 0;
        fpsWindowAt = now;
        // E10 · las tres marcas que el founder tiene que poder leer del teléfono
        // sin que nadie se las cuente.
        const age = (now - startAt) / 1_000;
        if (fpsAt.open == null && age >= 2) fpsAt.open = fps;
        if (fpsAt.s30 == null && age >= 30) fpsAt.s30 = fps;
        if (fpsAt.s180 == null && age >= 180) fpsAt.s180 = fps;
      }
      publishTelemetry(now);
      frameRequest = requestAnimationFrame(draw);
    };

    const resume = () => {
      const now = performance.now();
      lastInteractionAt = now;
      if (buffer == null) measure();
      if (!frameRequest && (!shouldPause() || owesStaleLayerFrame())) {
        if (loopWasPaused) {
          loopWasPaused = false;
          lastDrawAt = 0;
          framesThisSecond = 0;
          fpsWindowAt = now;
          fps = null;
        }
        // EL PRIMER CUADRO SE PINTA YA, no en el próximo `requestAnimationFrame`.
        // El relevo del orbe de CSS al vivo espera a que HAYA IMAGEN (N2 §5.1),
        // así que adelantar este cuadro adelanta el relevo entero — y de paso
        // hace que el orbe sea observable donde no se componen cuadros, que es
        // la única forma de auditar lo visual sin creerle a nadie.
        if (!announcedReady) draw(now);
        else frameRequest = requestAnimationFrame(draw);
      } else {
        if (shouldPause()) loopWasPaused = true;
        publishTelemetry(now, true);
      }
    };
    wakeRef.current = resume;
    const onVisibility = () => {
      if (document.hidden) {
        if (frameRequest) cancelAnimationFrame(frameRequest);
        frameRequest = 0;
        loopWasPaused = true;
        publishTelemetry(performance.now(), true);
      } else {
        resume();
      }
    };
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inViewport = entry?.isIntersecting ?? false;
      if (!inViewport && frameRequest) {
        cancelAnimationFrame(frameRequest);
        frameRequest = 0;
        loopWasPaused = true;
        publishTelemetry(performance.now(), true);
      } else if (!inViewport) {
        loopWasPaused = true;
        publishTelemetry(performance.now(), true);
      } else {
        measure();
        resume();
      }
    });
    intersectionObserver.observe(canvas);

    document.addEventListener("visibilitychange", onVisibility);
    for (const eventName of ["pointerdown", "keydown", "scroll", "touchstart"] as const) {
      window.addEventListener(eventName, resume, { passive: true });
    }
    const track = trackRef.current;
    track?.addEventListener("scroll", resume, { passive: true });
    resume();

    return () => {
      if (frameRequest) cancelAnimationFrame(frameRequest);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      track?.removeEventListener("scroll", resume);
      for (const eventName of ["pointerdown", "keydown", "scroll", "touchstart"] as const) {
        window.removeEventListener(eventName, resume);
      }
      if (renderer) {
        renderer.dispose();
        renderer = null;
        releaseContextCount();
      }
      wakeRef.current = () => undefined;
    };
  }, [forcedTier, trackRef]);

  const canvasVisible = tier > 0 && state !== "fog";

  return (
    <>
      <span
        aria-hidden="true"
        className={`kipu-live-orb${canvasVisible ? " kipu-live-orb--visible" : ""}`}
        data-orb-kind={activeOrb?.kind ?? "saldo"}
        data-live-state={state}
        data-voice-state={voiceState}
        data-quality-tier={tier}
      >
        <canvas ref={canvasRef} className="kipu-live-orb__canvas" />
      </span>
      {showPerf && (
        <aside className="kipu-orb-perf" aria-label="Rendimiento del orbe vivo">
          <strong>Orbe vivo</strong>
          <span>
            tier {telemetry.tier ?? "—"} · {telemetry.paused
              ? `pausado: ${pauseReasonLabel(telemetry.pauseReason)}`
              : "activo"}
          </span>
          <span>
            WebGL {telemetry.glVersion ?? "—"} · AA {telemetry.antialias == null
              ? "—"
              : telemetry.antialias ? "sí" : "no"} · orbes {telemetry.drawnOrbs ?? "—"}
          </span>
          <span>fps {telemetryText(telemetry.fps)}</span>
          <span>
            fps al abrir {telemetryText(telemetry.fpsAt.open)} · 30 s {telemetryText(telemetry.fpsAt.s30)} · 3 min {telemetryText(telemetry.fpsAt.s180)}
          </span>
          <span>frame p50 {telemetryText(telemetry.medianMs)} ms · p95 {telemetryText(telemetry.p95Ms)} ms</span>
          <span>
            DPR {telemetryText(telemetry.dpr)} · {telemetry.bufferPixels == null
              ? "—"
              : telemetry.bufferPixels.toLocaleString("es-419")} px
          </span>
          <span>contextos vivos {telemetry.liveContexts ?? "—"}</span>
          <span>estado {state}</span>
        </aside>
      )}
    </>
  );
});
