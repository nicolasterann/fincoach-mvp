"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { OrbKind, ShellDawn } from "./shell-payload";
import {
  createOrbRenderer,
  type OrbBufferInfo,
  type OrbRenderer,
  type OrbRgb,
} from "./orb-shader";

export type OrbQualityTier = 0 | 1 | 2 | 3;
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
  reset(): void;
}

export interface LiveOrbTelemetry {
  tier: OrbQualityTier;
  fps: number;
  medianMs: number;
  p95Ms: number;
  dpr: number;
  bufferPixels: number;
  liveContexts: number;
  paused: boolean;
}

interface LiveOrbProps {
  kind: OrbKind;
  level: number | null;
  amountMissing: boolean;
  dawn: ShellDawn | null;
  runway: boolean;
  active: boolean;
  forcedTier?: OrbQualityTier;
  forcedState?: LiveOrbState;
  showPerf?: boolean;
  onStateChange?: (state: LiveOrbState) => void;
  onTierChange?: (tier: OrbQualityTier) => void;
}

type LocalSignal =
  | { type: "capturing" }
  | { type: "written"; level: number; receiptKey: string }
  | { type: "crossing"; level: number; to: OrbKind; factKey: string }
  | null;

interface RenderInputs {
  kind: OrbKind;
  level: number;
  dawn: ShellDawn | null;
  state: LiveOrbState;
  signal: LocalSignal;
  active: boolean;
}

const MATERIAL_BY_KIND: Record<OrbKind, number> = {
  saldo: 0,
  reserva: 1,
  metas: 2,
  patrimonio: 3,
  deuda: 4,
};

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

function telemetryText(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "0.0";
}

function signalAnimationKey(input: RenderInputs): string {
  if (input.signal?.type === "written") return `written:${input.signal.receiptKey}`;
  if (input.signal?.type === "crossing") return `crossing:${input.signal.factKey}`;
  if (input.state === "dawn") return `dawn:${input.dawn?.dayKey ?? "none"}`;
  return input.state;
}

function mixRgb(from: OrbRgb, to: OrbRgb, ratio: number): OrbRgb {
  return [
    from[0] + (to[0] - from[0]) * ratio,
    from[1] + (to[1] - from[1]) * ratio,
    from[2] + (to[2] - from[2]) * ratio,
  ];
}

export const LiveOrb = forwardRef<LiveOrbHandle, LiveOrbProps>(function LiveOrb(
  {
    kind,
    level,
    amountMissing,
    dawn,
    runway,
    active,
    forcedTier,
    forcedState,
    showPerf = false,
    onStateChange,
    onTierChange,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wakeRef = useRef<() => void>(() => undefined);
  const [signal, setSignal] = useState<LocalSignal>(null);
  const [dawnDay, setDawnDay] = useState<string | null>(null);
  const [tier, setTier] = useState<OrbQualityTier>(0);
  const [telemetry, setTelemetry] = useState<LiveOrbTelemetry>({
    tier: 0,
    fps: 0,
    medianMs: 0,
    p95Ms: 0,
    dpr: 1,
    bufferPixels: 0,
    liveContexts: 0,
    paused: true,
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
    reset() {
      setSignal(null);
    },
  }), []);

  useEffect(() => {
    setSignal(null);
  }, [kind]);

  useEffect(() => {
    if (forcedState === "dawn") {
      setDawnDay(dawn?.dayKey ?? "preview");
      return;
    }
    if (kind !== "saldo" || !dawn) {
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
  }, [dawn, forcedState, kind]);

  const state = deriveState({
    forcedState,
    signal,
    dawnActive: dawnDay != null,
    runway,
    amountMissing,
    level,
  });
  const visualKind = signal?.type === "crossing" ? signal.to : kind;
  const renderInputs = useRef<RenderInputs>({
    kind: visualKind,
    level: level == null ? 0 : clampLevel(level),
    dawn,
    state,
    signal,
    active,
  });
  renderInputs.current = {
    kind: visualKind,
    level: level == null ? 0 : clampLevel(level),
    dawn,
    state,
    signal,
    active,
  };

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  useEffect(() => {
    onTierChange?.(tier);
  }, [onTierChange, tier]);

  useEffect(() => {
    wakeRef.current();
  }, [active, kind, state]);

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
    if (selectedTier === 0) {
      setTelemetry((current) => ({
        ...current,
        tier: 0,
        liveContexts: liveWebglContexts,
        paused: true,
      }));
      return;
    }

    let renderer: OrbRenderer | null = createOrbRenderer(canvas);
    if (!renderer) {
      setTier(0);
      setTelemetry((current) => ({
        ...current,
        tier: 0,
        liveContexts: liveWebglContexts,
        paused: true,
      }));
      return;
    }
    liveWebglContexts += 1;
    let contextCounted = true;

    let currentTier: OrbQualityTier = selectedTier;
    let buffer: OrbBufferInfo = { dpr: 1, width: 1, height: 1 };
    let frameRequest = 0;
    let inViewport = true;
    let lastDrawAt = 0;
    let lastInteractionAt = performance.now();
    const startAt = performance.now();
    let paused = true;
    const frameSamples: number[] = [];
    let qualityWindow: number[] = [];
    let slowWindows = 0;
    let fastSince: number | null = null;
    let upgraded = false;
    let framesThisSecond = 0;
    let fpsWindowAt = performance.now();
    let fps = 0;
    let telemetryAt = 0;
    let colorSignature = "";
    let liquid: OrbRgb = [0, 0, 0];
    let deep: OrbRgb = [0, 0, 0];
    let accent: OrbRgb = [0, 0, 0];
    let liquidFrom: OrbRgb = liquid;
    let deepFrom: OrbRgb = deep;
    let accentFrom: OrbRgb = accent;
    let liquidTarget: OrbRgb = liquid;
    let deepTarget: OrbRgb = deep;
    let accentTarget: OrbRgb = accent;
    let colorTransitionAt = 0;
    let animatedLevel = renderInputs.current.level;
    let animationKey = signalAnimationKey(renderInputs.current);
    let animationFrom = animatedLevel;
    let animationAt = startAt;

    const releaseContextCount = () => {
      if (!contextCounted) return;
      contextCounted = false;
      liveWebglContexts = Math.max(0, liveWebglContexts - 1);
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      if (!renderer) return;
      renderer = null;
      releaseContextCount();
      currentTier = 0;
      setTier(0);
      paused = true;
      if (frameRequest) cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      publishTelemetry(performance.now(), true);
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    const resize = () => {
      if (!renderer) return;
      const rect = canvas.getBoundingClientRect();
      buffer = renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const shouldPause = () =>
      document.hidden || !renderInputs.current.active || !inViewport || renderer == null;

    const publishTelemetry = (now: number, force = false) => {
      if (!force && now - telemetryAt < 500) return;
      telemetryAt = now;
      setTelemetry({
        tier: currentTier,
        fps,
        medianMs: percentile(frameSamples, 0.5),
        p95Ms: percentile(frameSamples, 0.95),
        dpr: buffer.dpr,
        bufferPixels: buffer.width * buffer.height,
        liveContexts: liveWebglContexts,
        paused,
      });
    };

    const dropToTier = (nextTier: OrbQualityTier) => {
      currentTier = nextTier;
      setTier(nextTier);
      slowWindows = 0;
      qualityWindow = [];
      if (nextTier === 0 && renderer) {
        renderer.dispose();
        renderer = null;
        releaseContextCount();
      }
    };

    const evaluateQuality = (now: number) => {
      if (forcedTier != null || qualityWindow.length < 60) return;
      const median = percentile(qualityWindow, 0.5);
      qualityWindow = [];
      if (median > 20) {
        slowWindows += 1;
        fastSince = null;
        if (slowWindows >= 2 && currentTier > 0) {
          dropToTier((currentTier - 1) as OrbQualityTier);
        }
        return;
      }
      slowWindows = 0;
      if (median < 13) {
        fastSince ??= now;
        if (!upgraded && now - fastSince >= 30_000 && currentTier > 0 && currentTier < 3) {
          currentTier = (currentTier + 1) as OrbQualityTier;
          upgraded = true;
          setTier(currentTier);
        }
      } else {
        fastSince = null;
      }
    };

    const draw = (now: number) => {
      frameRequest = 0;
      if (shouldPause()) {
        paused = true;
        publishTelemetry(now, true);
        return;
      }
      paused = false;

      const idle = now - lastInteractionAt >= IDLE_AFTER_MS;
      const cadence = idle ? 1000 / 30 : 1000 / 60;
      if (lastDrawAt > 0 && now - lastDrawAt < cadence - 0.5) {
        frameRequest = requestAnimationFrame(draw);
        return;
      }
      const frameDelta = lastDrawAt > 0 ? now - lastDrawAt : cadence;
      lastDrawAt = now;
      frameSamples.push(frameDelta);
      if (frameSamples.length > 120) frameSamples.shift();
      if (!idle) qualityWindow.push(frameDelta);
      evaluateQuality(now);
      if (!renderer || currentTier === 0) {
        paused = true;
        publishTelemetry(now, true);
        return;
      }

      const input = renderInputs.current;
      const nextAnimationKey = signalAnimationKey(input);
      if (nextAnimationKey !== animationKey) {
        animationKey = nextAnimationKey;
        animationAt = now;
        animationFrom = animatedLevel;
        if (input.state === "dawn" && input.dawn) {
          animatedLevel = clampLevel(input.dawn.levelFrom);
          animationFrom = animatedLevel;
        }
      }
      const targetLevel = input.signal?.type === "written" || input.signal?.type === "crossing"
        ? input.signal.level
        : input.level;
      if (input.state === "dawn" && input.dawn) {
        const progress = Math.min(1, (now - animationAt) / 1_200);
        const eased = 1 - Math.pow(1 - progress, 3);
        animatedLevel = input.dawn.levelFrom + (input.level - input.dawn.levelFrom) * eased;
      } else if (input.state === "written" || input.state === "crossing") {
        const progress = Math.min(1, (now - animationAt) / 1_100);
        const eased = 1 - Math.pow(1 - progress, 3);
        animatedLevel = animationFrom + (targetLevel - animationFrom) * eased;
      } else if (input.state !== "capturing") {
        animatedLevel = input.level;
      }

      const theme = document.documentElement.dataset.theme ?? "dark";
      const nextColorSignature = `${input.kind}:${theme}`;
      if (colorSignature !== nextColorSignature) {
        const nextLiquid = readCssColor(canvas, `--kipu-liquid-${input.kind}`);
        const nextDeep = readCssColor(canvas, `--kipu-deep-${input.kind}`);
        const nextAccent = readCssColor(canvas, `--layer-${input.kind}`);
        if (colorSignature && input.state === "crossing") {
          liquidFrom = liquid;
          deepFrom = deep;
          accentFrom = accent;
          liquidTarget = nextLiquid;
          deepTarget = nextDeep;
          accentTarget = nextAccent;
          colorTransitionAt = now;
        } else {
          liquid = nextLiquid;
          deep = nextDeep;
          accent = nextAccent;
          liquidTarget = nextLiquid;
          deepTarget = nextDeep;
          accentTarget = nextAccent;
          colorTransitionAt = 0;
        }
        colorSignature = nextColorSignature;
      }
      if (colorTransitionAt > 0) {
        const progress = Math.min(1, (now - colorTransitionAt) / 900);
        const eased = 1 - Math.pow(1 - progress, 3);
        liquid = mixRgb(liquidFrom, liquidTarget, eased);
        deep = mixRgb(deepFrom, deepTarget, eased);
        accent = mixRgb(accentFrom, accentTarget, eased);
        if (progress === 1) colorTransitionAt = 0;
      }
      const elapsed = (now - startAt) / 1_000;
      const slowTime = input.state === "runway" ? elapsed * 0.36 : elapsed;
      const energy = input.state === "capturing"
        ? 0.42 + Math.sin(elapsed * 4.2) * 0.12
        : input.state === "written" || input.state === "crossing"
          ? Math.max(0, 1 - (now - animationAt) / 1_100)
          : 0;
      renderer.draw({
        time: slowTime,
        level: clampLevel(animatedLevel),
        energy,
        day: theme === "light" ? 1 : 0,
        material: MATERIAL_BY_KIND[input.kind],
        voice: 0,
        liquid,
        deep,
        accent,
        tier: currentTier,
      });

      framesThisSecond += 1;
      if (now - fpsWindowAt >= 1_000) {
        fps = (framesThisSecond * 1_000) / (now - fpsWindowAt);
        framesThisSecond = 0;
        fpsWindowAt = now;
      }
      publishTelemetry(now);
      frameRequest = requestAnimationFrame(draw);
    };

    const resume = () => {
      lastInteractionAt = performance.now();
      if (!frameRequest && !shouldPause()) frameRequest = requestAnimationFrame(draw);
    };
    wakeRef.current = resume;
    const onVisibility = () => {
      if (document.hidden) {
        if (frameRequest) cancelAnimationFrame(frameRequest);
        frameRequest = 0;
        paused = true;
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
        paused = true;
      } else {
        resume();
      }
    });
    intersectionObserver.observe(canvas);

    document.addEventListener("visibilitychange", onVisibility);
    for (const eventName of ["pointerdown", "keydown", "scroll", "touchstart"] as const) {
      window.addEventListener(eventName, resume, { passive: true });
    }
    resume();

    return () => {
      if (frameRequest) cancelAnimationFrame(frameRequest);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
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
  }, [forcedTier]);

  const canvasVisible = tier > 0 && state !== "fog";

  return (
    <>
      <span
        aria-hidden="true"
        className={`kipu-shell-orb kipu-live-orb${canvasVisible ? " kipu-live-orb--visible" : ""}`}
        data-orb-kind={visualKind}
        data-live-state={state}
        data-quality-tier={tier}
      >
        <span className="kipu-shell-orb__halo" />
        <span className="kipu-shell-orb__floor" />
        <canvas ref={canvasRef} className="kipu-live-orb__canvas" />
      </span>
      {showPerf && (
        <aside className="kipu-orb-perf" aria-label="Rendimiento del orbe vivo">
          <strong>Orbe vivo</strong>
          <span>tier {telemetry.tier} · {telemetry.paused ? "pausado" : "activo"}</span>
          <span>fps {telemetryText(telemetry.fps)}</span>
          <span>frame p50 {telemetryText(telemetry.medianMs)} ms · p95 {telemetryText(telemetry.p95Ms)} ms</span>
          <span>DPR {telemetryText(telemetry.dpr)} · {telemetry.bufferPixels.toLocaleString("es-419")} px</span>
          <span>contextos vivos {telemetry.liveContexts}</span>
          <span>estado {state}</span>
        </aside>
      )}
    </>
  );
});
