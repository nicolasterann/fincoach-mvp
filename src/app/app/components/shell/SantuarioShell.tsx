"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from "react";
import { ChatView, type ChatViewHandle } from "../ChatView";
import type { ChatDeliveryResult } from "../../transaction-actions";
import {
  LiveOrb,
  type LiveOrbHandle,
  type LiveOrbState,
  type OrbQualityTier,
} from "./LiveOrb";
import { QuipuLayerCord } from "./QuipuLayerCord";
import type { OrbKind, ShellOrb, ShellPayload } from "./shell-payload";
import { StaticOrb } from "./StaticOrb";

const ORB_META: Record<OrbKind, { label: string; href: string; ariaPrefix: string }> = {
  saldo: { label: "Saldo", href: "/app/saldo", ariaPrefix: "Saldo disponible" },
  reserva: { label: "Reserva", href: "/app/saldo", ariaPrefix: "Reserva" },
  metas: { label: "Metas", href: "/app/goals", ariaPrefix: "Metas" },
  patrimonio: { label: "Patrimonio", href: "/app/wealth", ariaPrefix: "Patrimonio" },
  deuda: { label: "Deuda", href: "/app/debt", ariaPrefix: "Deuda pendiente" },
};

const PERSPECTIVE_LINKS = [
  { label: "Tu mes", href: "/app/mes" },
  { label: "Gasto", href: "/app/spending" },
  { label: "Cuentas", href: "/app/cuentas" },
  { label: "Actividad", href: "/app/activity" },
  { label: "Tu Kipu", href: "/app/settings" },
];

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
  const pct = Math.round(orb.level * 100);
  const level = orb.kind === "saldo" ? `tanque al ${pct} por ciento` : orb.kind === "deuda" ? `ciclo cubierto ${pct} por ciento` : `nivel al ${pct} por ciento`;
  return `${meta.ariaPrefix}: ${amount}, ${level}.`;
}

function orbSubtitle(orb: ShellOrb): string {
  if (orb.kind === "deuda" && orb.levelNote && orb.amountLabel) {
    return `${orb.levelNote} · te faltan ${orb.amountLabel}`;
  }
  return orb.subtitle;
}

function PillText({ line }: { line: string }) {
  return line.split(/(\S*\d\S*)/g).map((part, index) =>
    /\d/.test(part) ? <strong key={`${part}-${index}`}>{part}</strong> : part,
  );
}

export interface SantuarioPreviewControls {
  forcedTier?: OrbQualityTier;
  forcedState?: LiveOrbState;
  showPerf?: boolean;
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
  const scrollFrame = useRef<number | null>(null);
  const settleTimer = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [liveSettled, setLiveSettled] = useState(true);
  const [liveTier, setLiveTier] = useState<OrbQualityTier>(0);
  const [liveState, setLiveState] = useState<LiveOrbState>("available");
  const [perspectiveOpen, setPerspectiveOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [micHint, setMicHint] = useState(false);
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

  useEffect(() => {
    if (payload.pillLines.length < 2) return;
    const timer = window.setInterval(() => {
      setPillIndex((current) => (current + 1) % payload.pillLines.length);
    }, 9000);
    return () => window.clearInterval(timer);
  }, [payload.pillLines]);

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
  }, [activeOrb?.level, preview?.forcedState, preview?.forcedTier]);

  const openDialog = (focus = true) => {
    setPerspectiveOpen(false);
    setDialogOpen(true);
    if (focus) {
      window.requestAnimationFrame(() => chatRef.current?.focusComposer());
    }
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
      setDialogOpen(false);
    }
    sheetGestureY.current = null;
  };

  const pillFor = (orb: ShellOrb) =>
    orb.amountLabel == null
      ? null
      : orb.emptyInvite ??
        (orb.kind === "saldo" && liveState === "dawn" && payload.dawn
          ? `Volvieron ${payload.dawn.fillLabel} al amanecer.`
          : null) ??
        (orb.kind === "saldo" ? payload.runwayLine : null) ??
        receiptPill ??
        payload.pillLines[pillIndex % Math.max(1, payload.pillLines.length)] ??
        payload.pillLine;

  const imperativePreview =
    preview?.forcedState === "capturing" ||
    preview?.forcedState === "written" ||
    preview?.forcedState === "crossing";
  const forcedRenderState = imperativePreview ? undefined : preview?.forcedState;
  const showLiveCanvas = liveSettled && !dialogOpen && liveTier > 0 && liveState !== "fog";
  const movement = liveMovement ?? payload.lastMovement;

  return (
    <main
      className="kipu-santuario"
      data-layer={activeKind}
      data-dialog-open={dialogOpen ? "true" : "false"}
    >
      <span className="kipu-shell-atmosphere" aria-hidden="true" />
      <div className="kipu-shell-frame">
        <button
          type="button"
          className="kipu-shell-handle"
          onClick={() => setPerspectiveOpen(true)}
          aria-expanded={perspectiveOpen}
          aria-controls="kipu-perspective-sheet"
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
            <StaticOrb kind="saldo" level={null} fog />
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
                active={liveSettled && !dialogOpen}
                forcedTier={preview?.forcedTier}
                forcedState={forcedRenderState}
                showPerf={preview?.showPerf}
                onStateChange={setLiveState}
                onTierChange={setLiveTier}
              />
              <span className="kipu-shell-live-spacer kipu-shell-live-spacer--readout" />
              <span className="kipu-shell-live-spacer kipu-shell-live-spacer--pill" />
            </div>
            <div ref={trackRef} className="kipu-shell-track" onScroll={handleScroll}>
              {payload.orbs.map((orb, index) => {
                const line = pillFor(orb);
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
                      <StaticOrb kind={orb.kind} level={orb.level} />
                      <span className="kipu-shell-readout">
                        <span className={`kipu-shell-amount${orb.amountLabel == null ? " kipu-shell-amount--invite" : ""}`}>
                          {orb.amountLabel ?? orb.emptyInvite ?? "Dato no disponible"}
                        </span>
                        {orb.amountLabel != null && (
                          <span className="kipu-shell-subtitle">{orbSubtitle(orb)}</span>
                        )}
                      </span>
                    </Link>
                    <div className={`kipu-shell-pill${line ? "" : " kipu-shell-pill--empty"}`} aria-hidden={line ? undefined : true}>
                      <span className="kipu-shell-pill__dot" />
                      <span className="kipu-shell-pill__text" key={line ?? "empty"}>
                        {line ? <PillText line={line} /> : "Sin novedades"}
                      </span>
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}

        <div className="kipu-shell-actions">
          {movement ? (
            dialogOpen && movement.turnId ? (
              <button
                key={liveMovement?.receiptKey ?? "persisted-movement"}
                type="button"
                className="kipu-shell-cinta"
                aria-label={`Ir al recibo: ${movement.label}, ${movement.amountLabel}`}
                onClick={() => chatRef.current?.scrollToTurn(movement.turnId as string)}
              >
                <span className="kipu-shell-cinta__time">{movement.timeLabel}</span>
                <span className="kipu-shell-cinta__label">{movement.label}</span>
                <span className="kipu-shell-cinta__amount">{movement.amountLabel}</span>
              </button>
            ) : (
              <Link
                key={liveMovement?.receiptKey ?? "persisted-movement"}
                href={
                  movement.turnId
                    ? `/app/chat?turn=${encodeURIComponent(movement.turnId)}`
                    : "/app/activity"
                }
                className="kipu-shell-cinta"
                aria-label={`Último movimiento: ${movement.label}, ${movement.amountLabel}`}
              >
                <span className="kipu-shell-cinta__time">{movement.timeLabel}</span>
                <span className="kipu-shell-cinta__label">{movement.label}</span>
                <span className="kipu-shell-cinta__amount">{movement.amountLabel}</span>
              </Link>
            )
          ) : (
            <div className="kipu-shell-cinta kipu-shell-cinta--empty" aria-hidden="true" />
          )}

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
            {micHint && (
              <p id="kipu-mic-hint" className="kipu-shell-mic-hint" role="status">
                Pronto — por ahora mándame una nota de voz por Telegram
              </p>
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
                aria-disabled="true"
                aria-describedby={micHint ? "kipu-mic-hint" : undefined}
                title="Pronto — por ahora mándame una nota de voz por Telegram"
                onClick={() => setMicHint((visible) => !visible)}
              >
                <span className="kipu-shell-dock__circle"><MicIcon /></span>
                <span className="sr-only">Micrófono: pronto</span>
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
              <div>
                <span className="kipu-shell-sheet__grip" />
                <h2 id="kipu-perspective-title">Cómo vas</h2>
              </div>
              <button type="button" onClick={() => setPerspectiveOpen(false)} aria-label="Cerrar Cómo vas">
                <Chevron direction="up" />
              </button>
            </div>
            <nav aria-label="Perspectiva financiera">
              {PERSPECTIVE_LINKS.map((item) => (
                <Link key={item.href} href={item.href} className="kipu-shell-sheet__link">
                  <span>{item.label}</span>
                  <Chevron />
                </Link>
              ))}
            </nav>
          </section>
        </div>
      )}

      <div
        className="kipu-dialog-backdrop"
        data-open={dialogOpen ? "true" : "false"}
        aria-hidden={!dialogOpen}
        inert={!dialogOpen}
        onMouseDown={() => setDialogOpen(false)}
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
              setDialogOpen(false);
            }
          }}
        >
          <span className="kipu-dialog-sheet__grip" aria-hidden="true" />
          {movement?.turnId && (
            <button
              type="button"
              className="kipu-dialog-receipt-jump"
              onClick={() => chatRef.current?.scrollToTurn(movement.turnId as string)}
              aria-label={`Ir al recibo: ${movement.label}, ${movement.amountLabel}`}
            >
              <span>{movement.timeLabel}</span>
              <strong>{movement.label}</strong>
              <span>{movement.amountLabel}</span>
            </button>
          )}
          <ChatView
            imperativeRef={chatRef}
            variant="sheet"
            initialMessages={payload.thread.turns}
            firstName={payload.greetingName ?? ""}
            threadComplete={payload.thread.complete}
            threadReadFailed={payload.thread.readFailed}
            draftValue={draft}
            onDraftValueChange={setDraft}
            onClose={() => setDialogOpen(false)}
            onCaptureStart={() => liveOrbRef.current?.signalCapture()}
            onDeliverySettled={handleDeliverySettled}
          />
        </section>
      </div>
    </main>
  );
}
