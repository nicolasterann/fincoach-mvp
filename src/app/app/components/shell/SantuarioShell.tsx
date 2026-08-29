"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Suspense,
  use,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from "react";
import { ChatView, type ChatViewHandle } from "../ChatView";
import { KipuLoading, KipuNoData } from "../state";
import { MetroOverlay } from "../metro/MetroOverlay";
import type { ChatDeliveryResult } from "../../transaction-actions";
import { loadThreadAction } from "../../thread-actions";
import type { ThreadView } from "@/lib/chat-memory/thread-view-contract";
import {
  LiveOrb,
  type LiveOrbHandle,
  type LiveOrbState,
  type OrbQualityTier,
} from "./LiveOrb";
import { QuipuLayerCord } from "./QuipuLayerCord";
import type {
  OrbKind,
  ShellLater,
  ShellMovement,
  ShellOrb,
  ShellPayload,
  ShellPerspectiveLater,
} from "./shell-payload";
import { PerspectiveSheet } from "./PerspectiveSheet";
import { cintaState } from "./shell-dialog-contract";
import { StaticOrb } from "./StaticOrb";
import { orbMatter } from "./shell-orb-contract";
import type { OrbVoiceState } from "./voice-capture-contract";
import { useVoiceCapture } from "./useVoiceCapture";

const ORB_META: Record<OrbKind, { label: string; href: string; ariaPrefix: string }> = {
  saldo: { label: "Saldo", href: "/app/saldo", ariaPrefix: "Saldo disponible" },
  reserva: { label: "Reserva", href: "/app/saldo", ariaPrefix: "Reserva" },
  metas: { label: "Metas", href: "/app/goals", ariaPrefix: "Metas" },
  patrimonio: { label: "Patrimonio", href: "/app/wealth", ariaPrefix: "Patrimonio" },
  deuda: { label: "Deuda", href: "/app/debt", ariaPrefix: "Deuda pendiente" },
};

function Chevron({ direction = "right" }: { direction?: "right" | "down" | "up" }) {
  const path =
    direction === "right" ? "m7 4 5 5-5 5" : direction === "down" ? "m4 7 5 5 5-5" : "m4 12 5-5 5 5";
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
      <path d={path} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <rect x="7" y="2.5" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <rect x="2.2" y="5" width="15.6" height="11.5" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10.7" r="3.1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 5l1.1-1.8h3.8L13 5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="M3.4 10h11.4M10.2 5.2 15 10l-4.8 4.8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function spokenMoney(amount: number, label: string): string {
  const absoluteCents = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(absoluteCents / 100);
  const cents = absoluteCents % 100;
  const unit = label.trim().endsWith("$") ? (whole === 1 ? "dólar" : "dólares") : label.trim().split(" ").at(-1) ?? "";
  const number = new Intl.NumberFormat("es-419").format(whole);
  return `${amount < 0 ? "menos " : ""}${number} ${unit}${cents ? ` con ${String(cents).padStart(2, "0")}` : ""}`;
}

function orbAriaLabel(orb: ShellOrb): string {
  const meta = ORB_META[orb.kind];
  if (orb.amountRaw == null || orb.amountLabel == null) {
    return `${meta.ariaPrefix}: sin dato. ${orb.emptyInvite ?? "Abre el detalle para continuar."}`;
  }
  const amount = spokenMoney(orb.amountRaw, orb.amountLabel);
  if (orb.level == null) return `${meta.ariaPrefix}: ${amount}. ${orb.subtitle}.`;
  // N2 · un porcentaje SIN denominador declarado es un defecto (doctrina M6).
  // La frase del nivel la trae el motor en `levelNote`, con su denominador
  // dentro; «nivel al X por ciento» —lo que se decía antes— no declaraba nada.
  const pct = Math.round(orb.level * 100);
  const level =
    orb.levelNote ??
    (orb.kind === "saldo" ? `tanque al ${pct} por ciento` : `nivel al ${pct} por ciento`);
  return `${meta.ariaPrefix}: ${amount}, ${level}.`;
}

function orbSubtitle(orb: ShellOrb): string {
  // Deuda conserva la forma que M2 diseñó y que hasta N2 nunca tuvo datos.
  if (orb.kind === "deuda" && orb.levelNote && orb.amountLabel) {
    return `${orb.levelNote} · te faltan ${orb.amountLabel}`;
  }
  // N2 · la frase del nivel viaja al lado de lo que la cifra significa, así que
  // el porcentaje nunca aparece sin decir de qué es porcentaje.
  if (orb.levelNote) return `${orb.subtitle} · ${orb.levelNote}`;
  return orb.subtitle;
}

function PillText({ line }: { line: string }) {
  return line.split(/(\S*\d\S*)/g).map((part, index) =>
    /\d/.test(part) ? <strong key={`${part}-${index}`}>{part}</strong> : part,
  );
}


// ── N1 · Las tandas que llegan después ──────────────────────────────────────
// El servidor entrega el orbe y su cifra en cuanto los tiene, y promete el
// resto. Estas tres piezas abren esas promesas con `use()` dentro de su propia
// frontera `<Suspense>`: nada de lo que hay aquí dentro puede retrasar la cifra,
// y mientras viene el hueco tiene la FORMA de lo que va a ocupar — los estados
// de N0, jamás una barra gris improvisada.

function pillLineFor(
  later: ShellLater,
  orb: ShellOrb,
  local: {
    dawnFill: string | null;
    runwayLine: string | null;
    liveState: LiveOrbState;
    receiptPill: string | null;
    pillIndex: number;
  },
): string | null {
  if (orb.amountLabel == null) return null;
  return (
    orb.emptyInvite ??
    (orb.kind === "saldo" && local.liveState === "dawn" && local.dawnFill
      ? `Volvieron ${local.dawnFill} al amanecer.`
      : null) ??
    (orb.kind === "saldo" ? local.runwayLine : null) ??
    local.receiptPill ??
    later.pillLines[local.pillIndex % Math.max(1, later.pillLines.length)] ??
    later.pillLine
  );
}

function ShellPill({
  later,
  orb,
  ...local
}: {
  later: Promise<ShellLater>;
  orb: ShellOrb;
  dawnFill: string | null;
  runwayLine: string | null;
  liveState: LiveOrbState;
  receiptPill: string | null;
  pillIndex: number;
}) {
  const line = pillLineFor(use(later), orb, local);
  return (
    <div
      className={`kipu-shell-pill${line ? "" : " kipu-shell-pill--empty"}`}
      aria-hidden={line ? undefined : true}
    >
      <span className="kipu-shell-pill__dot" />
      <span className="kipu-shell-pill__text" key={line ?? "empty"}>
        {line ? <PillText line={line} /> : "Sin novedades"}
      </span>
    </div>
  );
}

function ShellCinta({
  later,
  liveMovement,
  dialogOpen,
  onJump,
}: {
  later: Promise<ShellLater>;
  liveMovement: (ShellMovement & { receiptKey: string }) | null;
  dialogOpen: boolean;
  onJump: (turnId: string) => void;
}) {
  const resolved = use(later);
  const movement: ShellMovement | null = liveMovement ?? resolved.lastMovement;
  // N1 (ronda 2, O2) · el santuario NO decide: consume. Qué dibuja la cinta es
  // `cintaState`, una función pura que el gate EJECUTA — «no pude leer» ≠ «no
  // hay nada» deja de estar sujeto por el orden de dos cadenas en el fuente.
  const cinta = cintaState({
    movement,
    readFailed: resolved.lastMovementReadFailed,
  });
  if (cinta === "sin-dato") {
    return (
      <KipuNoData
        shape="linea"
        className="kipu-shell-cinta-slot"
        label="Tu último movimiento"
        title="No pude leer tu último movimiento"
      />
    );
  }
  // Aquí `cinta` sólo puede ser "vacio", y "vacio" es exactamente `!movement`
  // con la lectura sana: la cinta invisible que reserva el sitio.
  if (!movement) {
    return <div className="kipu-shell-cinta kipu-shell-cinta--empty" aria-hidden="true" />;
  }
  const key = liveMovement?.receiptKey ?? "persisted-movement";
  const body = (
    <>
      <span className="kipu-shell-cinta__time">{movement.timeLabel}</span>
      <span className="kipu-shell-cinta__label">{movement.label}</span>
      <span className="kipu-shell-cinta__amount">{movement.amountLabel}</span>
    </>
  );
  if (dialogOpen && movement.turnId) {
    return (
      <button
        key={key}
        type="button"
        className="kipu-shell-cinta"
        aria-label={`Ir al recibo: ${movement.label}, ${movement.amountLabel}`}
        onClick={() => onJump(movement.turnId as string)}
      >
        {body}
      </button>
    );
  }
  return (
    <Link
      key={key}
      href={
        movement.turnId
          ? `/app/chat?turn=${encodeURIComponent(movement.turnId)}`
          : "/app/activity"
      }
      className="kipu-shell-cinta"
      aria-label={`Último movimiento: ${movement.label}, ${movement.amountLabel}`}
    >
      {body}
    </Link>
  );
}

function DialogReceiptJump({
  later,
  liveMovement,
  onJump,
}: {
  later: Promise<ShellLater>;
  liveMovement: (ShellMovement & { receiptKey: string }) | null;
  onJump: (turnId: string) => void;
}) {
  const movement: ShellMovement | null = liveMovement ?? use(later).lastMovement;
  if (!movement?.turnId) return null;
  return (
    <button
      type="button"
      className="kipu-dialog-receipt-jump"
      onClick={() => onJump(movement.turnId as string)}
      aria-label={`Ir al recibo: ${movement.label}, ${movement.amountLabel}`}
    >
      <span>{movement.timeLabel}</span>
      <strong>{movement.label}</strong>
      <span>{movement.amountLabel}</span>
    </button>
  );
}

function ShellPerspectiveBody({
  perspective,
  onRetry,
}: {
  perspective: Promise<ShellPerspectiveLater>;
  onRetry: () => void;
}) {
  const resolved = use(perspective);
  if (!resolved.perspective) {
    return (
      <KipuNoData
        shape="hoja"
        label="Cómo vas"
        title={
          resolved.readFailed
            ? "No pude leer cómo vas ahora"
            : "No puedo leer tu saldo ahora"
        }
        onRetry={onRetry}
      />
    );
  }
  return <PerspectiveSheet perspective={resolved.perspective} onRetry={onRetry} />;
}

export interface SantuarioPreviewControls {
  forcedTier?: OrbQualityTier;
  forcedState?: LiveOrbState;
  forcedVoice?: OrbVoiceState;
  showPerf?: boolean;
  initialPerspectiveOpen?: boolean;
  /** N1 · la maqueta siembra el hilo sin sesión; la app lo pide al abrir. */
  thread?: ThreadView;
}

export function SantuarioShell({
  payload,
  preview,
}: {
  payload: ShellPayload;
  preview?: SantuarioPreviewControls;
}) {
  const router = useRouter();
  const trackRef = useRef<HTMLDivElement>(null);
  const liveOrbRef = useRef<LiveOrbHandle>(null);
  const chatRef = useRef<ChatViewHandle>(null);
  const dockGestureY = useRef<number | null>(null);
  const sheetGestureY = useRef<number | null>(null);
  const perspectiveHandleY = useRef<number | null>(null);
  const perspectiveSheetY = useRef<number | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [liveSettled, setLiveSettled] = useState(true);
  // N2 §5.1 · UNA sola vez. `liveReady` se enciende cuando el orbe vivo ya
  // pintó su primer cuadro y NO se vuelve a apagar: ni al deslizar, ni al abrir
  // la hoja, ni si la calidad medida cambia. Ese relevo único es el que
  // sustituye a los cuatro relevos que el founder fotografió.
  const [liveReady, setLiveReady] = useState(false);
  const [liveState, setLiveState] = useState<LiveOrbState>("available");
  const [perspectiveOpen, setPerspectiveOpen] = useState(
    preview?.initialPerspectiveOpen ?? false,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pillIndex, setPillIndex] = useState(0);
  const [receiptPill, setReceiptPill] = useState<string | null>(null);
  const [liveMovement, setLiveMovement] = useState<{
    timeLabel: string;
    label: string;
    amountLabel: string;
    turnId: string;
    receiptKey: string;
  } | null>(null);
  const activeOrb = payload.orbs[activeIndex] ?? payload.orbs[0];
  const activeKind = activeOrb?.kind ?? "saldo";
  const kinds = payload.orbs.map((orb) => orb.kind);

  // N1 · el hilo se lee al ABRIR la conversación, no antes. Una sola vez por
  // montaje: `ChatView` queda montado a propósito (M4) y su estado local ya
  // tiene lo enviado después.
  // `thread === null` ES el estado «viene en camino». No hace falta una segunda
  // bandera: mientras sea null la hoja muestra `KipuLoading`, y cuando llega —
  // con turnos o con `readFailed`— muestra lo que de verdad pasó.
  const [thread, setThread] = useState<ThreadView | null>(preview?.thread ?? null);
  const threadAsked = useRef(preview?.thread != null);
  function ensureThread() {
    if (threadAsked.current) return;
    threadAsked.current = true;
    void loadThreadAction()
      .then(setThread)
      // Ni siquiera un fallo del transporte puede convertirse en «no tienes
      // mensajes»: se dice que no se pudo leer.
      .catch(() => setThread({ turns: [], complete: false, readFailed: true }));
  }

  function revealDialog(focus: boolean) {
    setPerspectiveOpen(false);
    setDialogOpen(true);
    ensureThread();
    if (focus) {
      window.requestAnimationFrame(() => chatRef.current?.focusComposer());
    }
  }

  const voice = useVoiceCapture({
    sendEvidence: (file) =>
      chatRef.current?.sendEvidence(file) ?? Promise.resolve(null),
    revealConversation: () => revealDialog(false),
    setAura: (state, level) => liveOrbRef.current?.setVoice(state, level),
  });

  // Se enciende una vez y se queda. Escrito como función y no como
  // `setLiveReady(true)` suelto para que el latch sea explícito: no hay ningún
  // camino en este archivo que lo devuelva a `false`.
  function markLiveReady() {
    setLiveReady(true);
  }

  const syncActiveFromTrack = (track: HTMLDivElement) => {
    if (track.clientWidth === 0) return;
    const observed = Math.max(
      0,
      Math.min(payload.orbs.length - 1, Math.round(track.scrollLeft / track.clientWidth)),
    );
    setActiveIndex(observed);
  };

  const goToOrb = (index: number) => {
    const track = trackRef.current;
    if (!track) return;
    setLiveSettled(false);
    track.scrollLeft = index * track.clientWidth;
    // The label follows the position the browser actually accepted. A failed
    // programmatic move therefore cannot claim a different layer than the one
    // still visible.
    syncActiveFromTrack(track);
    if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => setLiveSettled(true), 140);
  };

  const handleScroll = () => {
    setLiveSettled(false);
    if (scrollFrame.current != null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      const track = trackRef.current;
      if (!track) return;
      syncActiveFromTrack(track);
    });
    if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const track = trackRef.current;
      if (track) syncActiveFromTrack(track);
      setLiveSettled(true);
    }, 140);
  };

  useEffect(() => () => {
    if (scrollFrame.current != null) cancelAnimationFrame(scrollFrame.current);
    if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
  }, []);

  // N1 · el largo de la lista vive ahora en la tanda que llega después, así que
  // el índice avanza siempre y la píldora hace el módulo con lo que tenga. Con
  // una sola línea el módulo devuelve siempre la misma: en pantalla, idéntico.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setPillIndex((current) => current + 1);
    }, 9000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const orb = liveOrbRef.current;
    if (!orb) return;
    orb.reset();
    if (preview?.forcedState === "capturing") {
      orb.signalCapture();
    } else if (preview?.forcedState === "written") {
      orb.signalWritten({
        level: Math.max(0, (activeOrb?.level ?? 0.64) - 0.24),
        receiptKey: "preview-receipt",
      });
    } else if (preview?.forcedState === "crossing") {
      orb.signalCrossing({ level: 0, to: "reserva", factKey: "preview-crossing" });
    }
    if (preview?.forcedVoice) {
      orb.setVoice(
        preview.forcedVoice,
        preview.forcedVoice === "listening" ? 0.68 : undefined,
      );
    }
  }, [activeOrb?.level, preview?.forcedState, preview?.forcedTier, preview?.forcedVoice]);

  const openDialog = (focus = true) => {
    voice.cancel();
    revealDialog(focus);
  };

  const openPerspective = () => {
    voice.cancel();
    setDialogOpen(false);
    setPerspectiveOpen(true);
  };

  const submitDock = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    openDialog(!text);
    if (text) window.requestAnimationFrame(() => void chatRef.current?.sendText(text));
  };

  const handleDeliverySettled = (result: ChatDeliveryResult | null) => {
    if (result?.orbSignal) {
      liveOrbRef.current?.signalWritten(result.orbSignal);
    } else {
      liveOrbRef.current?.reset();
    }
    const line = result?.turn?.receipt?.lines[0];
    if (result?.turn?.receipt && line) {
      const at = new Date(result.turn.createdAtISO);
      const timeLabel = Number.isNaN(at.getTime())
        ? "Ahora"
        : new Intl.DateTimeFormat("es-419", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(at);
      setLiveMovement({
        timeLabel,
        label: line.label,
        amountLabel: line.amountLabel,
        turnId: result.turn.id,
        receiptKey: result.orbSignal?.receiptKey ?? result.turn.id,
      });
      setReceiptPill(`Listo · ${line.label}`);
    }
    if (result) router.refresh();
  };

  const finishDockGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (dockGestureY.current != null && dockGestureY.current - event.clientY > 34) {
      openDialog();
    }
    dockGestureY.current = null;
  };

  const finishSheetGesture = (event: PointerEvent<HTMLElement>) => {
    if (sheetGestureY.current != null && event.clientY - sheetGestureY.current > 46) {
      voice.cancel();
      setDialogOpen(false);
    }
    sheetGestureY.current = null;
  };

  const finishPerspectiveOpenGesture = (event: PointerEvent<HTMLButtonElement>) => {
    if (
      perspectiveHandleY.current != null &&
      event.clientY - perspectiveHandleY.current > 34
    ) {
      openPerspective();
    }
    perspectiveHandleY.current = null;
  };

  const finishPerspectiveCloseGesture = (event: PointerEvent<HTMLDivElement>) => {
    if (
      perspectiveSheetY.current != null &&
      perspectiveSheetY.current - event.clientY > 42
    ) {
      setPerspectiveOpen(false);
    }
    perspectiveSheetY.current = null;
  };

  const imperativePreview =
    preview?.forcedState === "capturing" ||
    preview?.forcedState === "written" ||
    preview?.forcedState === "crossing";
  const forcedRenderState = imperativePreview ? undefined : preview?.forcedState;
  // N2 §5.1 · MURIÓ LA REGLA DE SUSTITUCIÓN.
  //
  // Decía `liveSettled && !dialogOpen && liveTier > 0 && liveState !== "fog"`.
  // Cada término apagaba el orbe bueno y enseñaba el barato: deslizar, abrir el
  // chat, la calidad medida, la niebla. Con una transición de opacidad de por
  // medio — la tercera forma que el founder vio en sus capturas 11, 12 y 13.
  //
  // Queda una sola condición, y es de EXISTENCIA, no de gesto: se enseña el
  // orbe vivo cuando el orbe vivo YA PINTÓ. Deslizar sigue pausando su
  // animación (`active`, más abajo), que es legítimo; lo que ya no puede hacer
  // es cambiar de objeto.
  const showLiveCanvas = liveReady;
  const forcedVoiceMessage = preview?.forcedVoice
    ? `Aura ${preview.forcedVoice} · vista QA`
    : null;
  const voiceMessage = voice.message ?? forcedVoiceMessage;
  const voiceCanRestart =
    voice.state === "idle" ||
    voice.state === "denied" ||
    voice.state === "unsupported" ||
    voice.state === "failed";
  const voiceBusy =
    voice.state === "requesting" ||
    voice.state === "sending" ||
    voice.state === "transcribing" ||
    voice.state === "responding";

  return (
    <main
      className="kipu-santuario"
      data-layer={activeKind}
      data-dialog-open={dialogOpen ? "true" : "false"}
      data-perspective-open={perspectiveOpen ? "true" : "false"}
      data-orb-paused={!liveSettled || dialogOpen || perspectiveOpen ? "true" : "false"}
    >
      <span className="kipu-shell-atmosphere" aria-hidden="true" />
      <MetroOverlay
        serverTiming={payload.serverTiming}
        later={payload.later}
        perspective={payload.perspective}
      />
      <div className="kipu-shell-frame">
        <button
          type="button"
          className="kipu-shell-handle"
          onClick={openPerspective}
          aria-expanded={perspectiveOpen}
          aria-controls="kipu-perspective-sheet"
          disabled={!payload.perspective}
          onPointerDown={(event) => {
            perspectiveHandleY.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (
              perspectiveHandleY.current != null &&
              event.clientY - perspectiveHandleY.current > 34
            ) {
              perspectiveHandleY.current = null;
              openPerspective();
            }
          }}
          onPointerUp={finishPerspectiveOpenGesture}
          onTouchStart={(event) => {
            perspectiveHandleY.current = event.touches[0]?.clientY ?? null;
          }}
          onTouchMove={(event) => {
            const y = event.touches[0]?.clientY;
            if (
              y != null &&
              perspectiveHandleY.current != null &&
              y - perspectiveHandleY.current > 34
            ) {
              perspectiveHandleY.current = null;
              openPerspective();
            }
          }}
        >
          <span className="kipu-shell-handle__grip" />
          <span>Cómo vas</span>
          <Chevron direction="down" />
        </button>

        <div className="kipu-shell-tabs" role="tablist" aria-label="Capas de tu plata">
          {payload.orbs.map((orb, index) => (
            <button
              key={orb.kind}
              type="button"
              id={`kipu-tab-${orb.kind}`}
              className="kipu-shell-chip"
              role="tab"
              aria-selected={index === activeIndex}
              aria-controls={`kipu-panel-${orb.kind}`}
              disabled={payload.status === "niebla"}
              onClick={() => goToOrb(index)}
            >
              {ORB_META[orb.kind].label}
            </button>
          ))}
        </div>
        <QuipuLayerCord active={activeIndex} kinds={kinds} />

        {payload.status === "niebla" ? (
          <section className="kipu-shell-fog" aria-live="polite">
            <StaticOrb kind="saldo" level={null} amount={null} readOk={false} fog />
            <p className="kipu-shell-fog__message">No puedo leer tu saldo ahora</p>
            <button type="button" className="kipu-shell-retry" onClick={() => window.location.reload()}>
              Reintentar
            </button>
          </section>
        ) : (
          <div className="kipu-shell-track-wrap" data-live-visible={showLiveCanvas ? "true" : "false"}>
            <div className="kipu-shell-live-layer" aria-hidden="true">
              <LiveOrb
                key={`live-orb-tier-${preview?.forcedTier ?? "auto"}`}
                ref={liveOrbRef}
                kind={activeKind}
                level={activeOrb?.level ?? null}
                amountMissing={activeOrb?.amountLabel == null}
                dawn={activeKind === "saldo" ? payload.dawn : null}
                runway={activeKind === "saldo" && payload.runwayLine != null}
                active={liveSettled && !dialogOpen && !perspectiveOpen}
                forcedTier={preview?.forcedTier}
                forcedState={forcedRenderState}
                showPerf={preview?.showPerf}
                matter={orbMatter(activeKind)}
                onStateChange={setLiveState}
                onReady={markLiveReady}
              />
              <span className="kipu-shell-live-spacer kipu-shell-live-spacer--readout" />
              <span className="kipu-shell-live-spacer kipu-shell-live-spacer--pill" />
            </div>
            <div ref={trackRef} className="kipu-shell-track" onScroll={handleScroll}>
              {payload.orbs.map((orb, index) => {
                return (
                  <section
                    key={orb.kind}
                    id={`kipu-panel-${orb.kind}`}
                    className="kipu-shell-slide"
                    data-active={index === activeIndex ? "true" : "false"}
                    data-orb-kind={orb.kind}
                    role="tabpanel"
                    aria-labelledby={`kipu-tab-${orb.kind}`}
                  >
                    <Link href={ORB_META[orb.kind].href} className="kipu-shell-orb-link" aria-label={orbAriaLabel(orb)}>
                      <StaticOrb kind={orb.kind} level={orb.level} amount={orb.amountRaw} readOk={orb.readOk} />
                      <span className="kipu-shell-readout">
                        <span className={`kipu-shell-amount${orb.amountLabel == null ? " kipu-shell-amount--invite" : ""}`}>
                          {orb.amountLabel ?? orb.emptyInvite ?? "Dato no disponible"}
                        </span>
                        {orb.amountLabel != null && (
                          <span className="kipu-shell-subtitle">{orbSubtitle(orb)}</span>
                        )}
                      </span>
                    </Link>
                    <Suspense
                      fallback={
                        <KipuLoading
                          shape="linea"
                          className="kipu-shell-pill-slot"
                          label="tu ritmo"
                        />
                      }
                    >
                      <ShellPill
                        later={payload.later}
                        orb={orb}
                        dawnFill={payload.dawn?.fillLabel ?? null}
                        runwayLine={payload.runwayLine}
                        liveState={liveState}
                        receiptPill={receiptPill}
                        pillIndex={pillIndex}
                      />
                    </Suspense>
                  </section>
                );
              })}
            </div>
          </div>
        )}

        <div className="kipu-shell-actions">
          <Suspense
            fallback={
              <KipuLoading
                shape="linea"
                className="kipu-shell-cinta-slot"
                label="tu último movimiento"
              />
            }
          >
            <ShellCinta
              later={payload.later}
              liveMovement={liveMovement}
              dialogOpen={dialogOpen}
              onJump={(turnId) => chatRef.current?.scrollToTurn(turnId)}
            />
          </Suspense>

          {!dialogOpen && <div
            className="kipu-shell-dock-wrap"
            onPointerDown={(event) => {
              dockGestureY.current = event.clientY;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (dockGestureY.current != null && dockGestureY.current - event.clientY > 34) {
                dockGestureY.current = null;
                openDialog();
              }
            }}
            onPointerUp={finishDockGesture}
            onTouchStart={(event) => {
              dockGestureY.current = event.touches[0]?.clientY ?? null;
            }}
            onTouchMove={(event) => {
              const y = event.touches[0]?.clientY;
              if (y != null && dockGestureY.current != null && dockGestureY.current - y > 34) {
                dockGestureY.current = null;
                openDialog();
              }
            }}
          >
            {voiceMessage && (
              <div
                id="kipu-voice-status"
                className="kipu-shell-voice-status"
                data-voice-state={preview?.forcedVoice ?? voice.state}
                role="status"
              >
                <p>{voiceMessage}</p>
                {(voice.state === "requesting" || voice.state === "recording") && (
                  <span className="kipu-shell-voice-status__actions">
                    <button type="button" onClick={voice.cancel}>Cancelar</button>
                    {voice.state === "recording" && (
                      <button type="button" onClick={() => void voice.send()}>Enviar</button>
                    )}
                  </span>
                )}
                {(voice.state === "denied" ||
                  voice.state === "unsupported" ||
                  voice.state === "failed") && (
                  <button type="button" onClick={() => openDialog()}>Escribir</button>
                )}
              </div>
            )}
            <form className="kipu-shell-dock" onSubmit={submitDock}>
              <input
                className="kipu-shell-dock__input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onClick={() => openDialog()}
                placeholder="Anota o pregúntame…"
                aria-label="Anota un gasto o pregúntale a Kipu"
              />
              <button
                type="button"
                className="kipu-shell-dock__target"
                aria-label={voice.state === "recording" ? "Enviar nota de voz" : "Grabar nota de voz"}
                aria-pressed={voice.state === "recording"}
                aria-describedby={voiceMessage ? "kipu-voice-status" : undefined}
                disabled={voiceBusy}
                onClick={() => {
                  if (voice.state === "recording") void voice.send();
                  else if (voiceCanRestart) void voice.start();
                }}
              >
                <span className={`kipu-shell-dock__circle${voice.state === "recording" ? " kipu-shell-dock__circle--recording" : ""}`}><MicIcon /></span>
              </button>
              <button
                type="button"
                className="kipu-shell-dock__target"
                aria-label="Adjuntar una foto sin salir"
                onClick={() => {
                  openDialog(false);
                  chatRef.current?.openFilePicker();
                }}
              >
                <span className="kipu-shell-dock__circle"><CameraIcon /></span>
              </button>
              <button type="submit" className="kipu-shell-dock__target" aria-label="Enviar a Kipu sin salir">
                <span className="kipu-shell-dock__circle kipu-shell-dock__circle--send"><SendIcon /></span>
              </button>
            </form>
          </div>}
        </div>
      </div>

      {payload.status === "niebla" && preview?.showPerf && (
        <aside className="kipu-orb-perf" aria-label="Rendimiento del orbe estático en niebla">
          <strong>Orbe vivo</strong>
          <span>tier 0 · pausado: tier 0</span>
          <span>fps —</span>
          <span>frame p50 — ms · p95 — ms</span>
          <span>DPR — · — px</span>
          <span>contextos vivos 0</span>
          <span>estado fog</span>
        </aside>
      )}

      {perspectiveOpen && (
        <div className="kipu-shell-sheet-backdrop" role="presentation" onMouseDown={() => setPerspectiveOpen(false)}>
          <section
            id="kipu-perspective-sheet"
            className="kipu-shell-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kipu-perspective-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="kipu-shell-sheet__head">
              <div
                className="kipu-shell-sheet__swipe-target"
                onPointerDown={(event) => {
                  perspectiveSheetY.current = event.clientY;
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (
                    perspectiveSheetY.current != null &&
                    perspectiveSheetY.current - event.clientY > 42
                  ) {
                    perspectiveSheetY.current = null;
                    setPerspectiveOpen(false);
                  }
                }}
                onPointerUp={finishPerspectiveCloseGesture}
                onTouchStart={(event) => {
                  perspectiveSheetY.current = event.touches[0]?.clientY ?? null;
                }}
                onTouchMove={(event) => {
                  const y = event.touches[0]?.clientY;
                  if (
                    y != null &&
                    perspectiveSheetY.current != null &&
                    perspectiveSheetY.current - y > 42
                  ) {
                    perspectiveSheetY.current = null;
                    setPerspectiveOpen(false);
                  }
                }}
              >
                <span className="kipu-shell-sheet__grip" />
                <h2 id="kipu-perspective-title">Cómo vas</h2>
              </div>
              <button type="button" onClick={() => setPerspectiveOpen(false)} aria-label="Cerrar Cómo vas">
                <Chevron direction="up" />
              </button>
            </div>
            <Suspense
              fallback={<KipuLoading shape="hoja" label="cómo vas" />}
            >
              <ShellPerspectiveBody
                perspective={payload.perspective}
                onRetry={() => router.refresh()}
              />
            </Suspense>
          </section>
        </div>
      )}

      <div
        className="kipu-dialog-backdrop"
        data-open={dialogOpen ? "true" : "false"}
        aria-hidden={!dialogOpen}
        inert={!dialogOpen}
        onMouseDown={() => {
          voice.cancel();
          setDialogOpen(false);
        }}
      >
        <section
          className="kipu-dialog-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Conversación con Kipu"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => {
            sheetGestureY.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (sheetGestureY.current != null && event.clientY - sheetGestureY.current > 46) {
              sheetGestureY.current = null;
              voice.cancel();
              setDialogOpen(false);
            }
          }}
          onPointerUp={finishSheetGesture}
          onTouchStart={(event) => {
            sheetGestureY.current = event.touches[0]?.clientY ?? null;
          }}
          onTouchMove={(event) => {
            const y = event.touches[0]?.clientY;
            if (y != null && sheetGestureY.current != null && y - sheetGestureY.current > 46) {
              sheetGestureY.current = null;
              voice.cancel();
              setDialogOpen(false);
            }
          }}
        >
          <span className="kipu-dialog-sheet__grip" aria-hidden="true" />
          {/* El salto al recibo espera a su tanda: no hay hueco reservado
              porque hoy tampoco lo hay cuando no existe un recibo al que ir. */}
          <Suspense fallback={null}>
            <DialogReceiptJump
              later={payload.later}
              liveMovement={liveMovement}
              onJump={(turnId) => chatRef.current?.scrollToTurn(turnId)}
            />
          </Suspense>
          <ChatView
            imperativeRef={chatRef}
            variant="sheet"
            initialMessages={thread?.turns ?? []}
            firstName={payload.greetingName ?? ""}
            threadComplete={thread?.complete ?? true}
            threadReadFailed={thread?.readFailed ?? false}
            threadPending={thread == null}
            draftValue={draft}
            onDraftValueChange={setDraft}
            onClose={() => {
              voice.cancel();
              setDialogOpen(false);
            }}
            onCaptureStart={() => liveOrbRef.current?.signalCapture()}
            onDeliverySettled={handleDeliverySettled}
          />
        </section>
      </div>
    </main>
  );
}
