"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadReceipt, ThreadTurn, TurnStatus } from "@/lib/chat-memory/thread-view";
import {
  clearChatHistoryAction,
  sendChatMessageAndGetReply,
  sendWebEvidenceAction,
} from "../transaction-actions";

// The Kipu conversation — a real DM experience: optimistic user bubble, typing
// indicator, no page reload, keyboard-safe input. The bottom tab bar is hidden
// on this route so the input owns the bottom of the screen.

const SUGGESTIONS = [
  "¿Cuánto puedo gastar hoy?",
  "Gasté 12 en almuerzo",
  "¿Cómo voy esta semana?",
];

function TypingDots() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-zinc-800 px-4 py-3.5">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

const ACCEPTED_FILES = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const INTERNAL_RECEIPT_SENTINEL = "KIPU_" + "INTERNAL_WRITE_RECEIPT";

function localTurn(input: {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: TurnStatus | null;
  attachment?: ThreadTurn["attachment"];
}): ThreadTurn {
  return {
    id: input.id,
    role: input.role,
    author: input.role === "user" ? "usuario" : "agente",
    channel: "web",
    createdAtISO: new Date().toISOString(),
    text: input.text,
    status: input.status ?? null,
    receipt: null,
    attachment: input.attachment ?? null,
  };
}

function visibleAssistantText(text: string): string {
  return text.replaceAll(INTERNAL_RECEIPT_SENTINEL, "").trim();
}

function timeLabel(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Ahora";
  return new Intl.DateTimeFormat("es-419", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function provenanceLabel(turn: ThreadTurn): string | null {
  const source =
    turn.author === "calendario"
      ? "Calendario"
      : turn.author === "coach"
        ? "Coach"
        : turn.author === "cierre_de_mes"
          ? "Cierre de mes"
          : null;
  if (turn.channel === "telegram") {
    return source ? `Telegram · ${source}` : "Telegram";
  }
  return source;
}

function ReceiptCard({ receipt, createdAtISO }: { receipt: ThreadReceipt; createdAtISO: string }) {
  return (
    <div className="mt-2 rounded-2xl border border-emerald-300/15 bg-zinc-950/55 p-3 font-mono">
      <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300/80">
        Quedó registrado
      </p>
      <div className="mt-2 divide-y divide-line/5">
        {receipt.lines.map((line, index) => (
          <div className="grid grid-cols-[1fr_auto] gap-3 py-2" key={`${line.label}-${index}`}>
            <div className="min-w-0">
              <p className="truncate text-[11px] text-zinc-300">{line.label}</p>
              <p className="mt-0.5 text-[10px] text-zinc-600">
                {timeLabel(createdAtISO)} · {line.kindLabel}
              </p>
            </div>
            <p className="text-xs font-semibold tabular-nums text-zinc-200">
              {line.amountLabel}
            </p>
          </div>
        ))}
      </div>
      {receipt.saldoLabel && (
        <p className="mt-2 border-t border-line/5 pt-2 font-sans text-xs text-zinc-400">
          {receipt.saldoLabel}
        </p>
      )}
      {receipt.incomplete && (
        <p className="mt-2 font-sans text-[11px] leading-5 text-amber-200/80">
          No pude releer todo el recibo ahora.
        </p>
      )}
    </div>
  );
}

// One trusted submission id per send → a double-fire of THIS submission
// converges to a single financial result server-side (durable idempotency).
// Module-level on purpose: impure by design (time + randomness), never render.
function makeSubmissionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ChatView({
  initialMessages,
  firstName,
  initialShareText,
  initialTurnId,
  threadComplete,
  threadReadFailed,
}: {
  initialMessages: ThreadTurn[];
  firstName: string;
  /** Text shared into Kipu via the PWA share target (?share=). */
  initialShareText?: string;
  initialTurnId?: string;
  threadComplete: boolean;
  threadReadFailed: boolean;
}) {
  const [messages, setMessages] = useState<ThreadTurn[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [failedDelivery, setFailedDelivery] = useState<{
    text: string;
    submissionId: string;
    message: string;
  } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const turnRefs = useRef(new Map<string, HTMLDivElement>());
  const deepLinkHandled = useRef(false);
  const [highlightedTurnId, setHighlightedTurnId] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isTyping]);

  useEffect(() => {
    if (!initialTurnId || deepLinkHandled.current) return;
    let frame = 0;
    let timer = 0;
    let attempts = 0;
    const reveal = () => {
      const target = turnRefs.current.get(initialTurnId);
      if (!target && attempts < 8) {
        attempts += 1;
        frame = window.requestAnimationFrame(reveal);
        return;
      }
      if (!target) return;
      deepLinkHandled.current = true;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedTurnId(initialTurnId);
      timer = window.setTimeout(() => setHighlightedTurnId(null), 2200);
    };
    frame = window.requestAnimationFrame(reveal);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [initialTurnId, messages.length]);

  // Text shared into Kipu (PWA share target or an internal CTA) PREFILLS the
  // box — never auto-sends. ?share= is URL-controllable, so auto-sending would
  // let any external link execute a message against the money agent; the one
  // deliberate tap keeps the user in charge of what Kipu acts on.
  const sharedOnce = useRef(false);
  useEffect(() => {
    if (initialShareText && !sharedOnce.current) {
      sharedOnce.current = true;
      setInput(initialShareText);
      inputRef.current?.focus();
    }
  }, [initialShareText]);

  // Send a file (attach / paste / drop) through the evidence pipeline.
  const sendFile = useCallback(
    async (file: File) => {
      if (isTyping) return;
      setFileError(null);
      if (file.size > MAX_UPLOAD_BYTES) {
        setFileError("El archivo supera el límite de 12 MB.");
        return;
      }
      setMessages((prev) => [
        ...prev,
        localTurn({
          id: `local-${Date.now()}`,
          role: "user",
          text:
            file.type === "application/pdf"
              ? `📄 ${file.name}`
              : `📷 ${file.name || "Imagen"}`,
          attachment: {
            kind: file.type === "application/pdf" ? "document" : "image",
            label: file.name || (file.type === "application/pdf" ? "Documento" : "Imagen"),
          },
        }),
      ]);
      setIsTyping(true);
      try {
        const formData = new FormData();
        formData.set("file", file);
        const { reply } = await sendWebEvidenceAction(formData);
        const safeReply = visibleAssistantText(reply);
        if (!safeReply) {
          setFileError("No llegó una respuesta visible. Puedes volver a adjuntarlo.");
          return;
        }
        setMessages((prev) => [
          ...prev,
          localTurn({
            id: `local-${Date.now()}-r`,
            role: "assistant",
            text: safeReply,
            status: "success",
          }),
        ]);
      } catch {
        // Delivery/validation state belongs to the interface, not to Kipu's
        // authored conversation. A retryable evidence failure keeps the exact
        // server identity and never fabricates an assistant turn.
        setFileError("No se pudo procesar el archivo. Puedes volver a adjuntarlo.");
      } finally {
        setIsTyping(false);
      }
    },
    [isTyping],
  );

  async function send(
    text: string,
    retry?: { submissionId: string },
  ) {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;
    setInput("");
    setFailedDelivery(null);
    if (!retry) {
      setMessages((prev) => [
        ...prev,
        localTurn({ id: `local-${Date.now()}`, role: "user", text: trimmed }),
      ]);
    }
    setIsTyping(true);
    const submissionId = retry?.submissionId ?? makeSubmissionId();
    try {
      const { reply, status, turn, deliveryError } = await sendChatMessageAndGetReply(
        trimmed,
        submissionId,
      );
      if (deliveryError) {
        setFailedDelivery({
          text: trimmed,
          submissionId,
          message: deliveryError.message,
        });
        return;
      }
      const safeReply = visibleAssistantText(reply);
      if (status === "failed" || !safeReply) {
        setFailedDelivery({
          text: trimmed,
          submissionId,
          message: "No pude completar este envío. Puedes reintentarlo sin duplicar movimientos.",
        });
        return;
      }
      setMessages((prev) => [
        ...prev,
        turn ??
          localTurn({
            id: `local-${Date.now()}-r`,
            role: "assistant",
            text: safeReply,
            status,
          }),
      ]);
    } catch {
      // Transport state is UI, not Kipu-authored conversation. The durable
      // delivery can be retried with the same submission id server-side; never
      // fabricate an assistant bubble when the model produced no safe reply.
      setFailedDelivery({
        text: trimmed,
        submissionId,
        message: "No se pudo entregar la respuesta. Puedes reintentar el mismo envío.",
      });
    } finally {
      setIsTyping(false);
      inputRef.current?.focus();
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div
      className="relative mx-auto flex h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col"
      data-initial-turn-id={initialTurnId}
      data-share-prefill={initialShareText ? "ready" : undefined}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDragging(false);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setIsDragging(true);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void sendFile(file);
      }}
      onPaste={(e) => {
        const file = Array.from(e.clipboardData?.files ?? [])[0];
        if (file) {
          e.preventDefault();
          void sendFile(file);
        }
      }}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl border-2 border-dashed border-emerald-400/60 bg-zinc-950/80">
          <p className="text-sm font-semibold text-emerald-300">
            Suelta tu recibo o captura aquí 📸
          </p>
        </div>
      )}
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between pb-3">
        <div className="flex items-center gap-3">
          <Link
            href="/app"
            aria-label="Volver"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line/10 text-zinc-400 transition hover:bg-line/5 lg:hidden"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-black text-emerald-300">
              K
            </span>
            <div>
              <p className="text-sm font-bold leading-tight text-zinc-50">Kipu</p>
              <p className="text-[11px] leading-tight text-emerald-400/80">
                {isTyping ? "escribiendo…" : "tu coach financiero"}
              </p>
            </div>
          </div>
        </div>
        <form action={clearChatHistoryAction}>
          <button
            className="rounded-full border border-line/10 px-3 py-1.5 text-[11px] font-semibold text-zinc-500 transition hover:bg-line/5 hover:text-zinc-300"
            type="submit"
          >
            Nueva conversación
          </button>
        </form>
      </header>

      {/* Messages — anchored to the bottom like a real DM, calm scrollbar */}
      <div className="kipu-scroll flex-1 overflow-y-auto overscroll-contain">
        <div className="flex min-h-full flex-col justify-end space-y-3 py-2">
          {threadReadFailed ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm font-semibold text-zinc-200">
                No pude leer tu conversación ahora.
              </p>
              <button
                className="rounded-full border border-line/10 px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-line/5"
                onClick={() => window.location.reload()}
                type="button"
              >
                Reintentar
              </button>
            </div>
          ) : isEmpty ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-400/15 text-2xl font-black text-emerald-300">
                K
              </span>
              <div className="max-w-xs">
                <p className="text-base font-semibold text-zinc-100">
                  {firstName ? `Hola, ${firstName}` : "Hola"} 👋
                </p>
                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  Cuéntame un gasto, pregúntame cuánto puedes gastar, o pídeme cuadrar tu semana.
                </p>
              </div>
            </div>
          ) : (
            messages
              .filter((m) => !(m.role === "assistant" && m.status === "failed"))
              .map((m) => (
              <div
                key={m.id}
                ref={(node) => {
                  if (node) turnRefs.current.set(m.id, node);
                  else turnRefs.current.delete(m.id);
                }}
                data-turn-id={m.id}
                className={`flex scroll-m-20 transition duration-700 ${
                  m.role === "user" ? "justify-end" : "justify-start"
                } ${highlightedTurnId === m.id ? "rounded-3xl bg-emerald-300/10 ring-1 ring-emerald-300/30" : ""}`}
              >
                <div className="max-w-[86%]">
                  {provenanceLabel(m) && (
                    <p
                      className={`mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600 ${
                        m.role === "user" ? "text-right" : "text-left"
                      }`}
                    >
                      {provenanceLabel(m)}
                    </p>
                  )}
                  <div
                    className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-6 ${
                      m.role === "user"
                        ? "rounded-br-md bg-emerald-400 text-zinc-950"
                        : "rounded-bl-md bg-zinc-800 text-zinc-100"
                    }`}
                  >
                    {m.status === "needs_clarification" && (
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300/80">
                        Pregunta pendiente
                      </p>
                    )}
                    {m.text}
                    {m.attachment && (
                      <div className="mt-2 rounded-xl border border-current/10 px-3 py-2 text-xs opacity-75">
                        {m.attachment.kind === "document" ? "Documento" : "Imagen"} · {m.attachment.label}
                      </div>
                    )}
                    {m.status === "unsupported" && (
                      <p className="mt-2 border-t border-line/10 pt-2 text-xs text-zinc-400">
                        Eso todavía no lo sé hacer.
                      </p>
                    )}
                  </div>
                  {m.role === "assistant" && m.receipt && (
                    <ReceiptCard receipt={m.receipt} createdAtISO={m.createdAtISO} />
                  )}
                </div>
              </div>
              ))
          )}
          {!threadReadFailed && !threadComplete && (
            <p className="px-3 py-2 text-center text-xs text-zinc-600" role="status">
              Hay más historial del que puedo mostrar aquí.
            </p>
          )}
          {isTyping && <TypingDots />}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        {failedDelivery && (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200" role="status">
            <span>{failedDelivery.message}</span>
            <button
              className="shrink-0 font-semibold underline underline-offset-2"
              onClick={() => void send(failedDelivery.text, {
                submissionId: failedDelivery.submissionId,
              })}
              type="button"
            >
              Reintentar
            </button>
          </div>
        )}
        {fileError && (
          <div
            className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200"
            role="status"
          >
            <span>{fileError}</span>
            <button
              aria-label="Cerrar aviso de archivo"
              className="shrink-0 font-semibold underline underline-offset-2"
              onClick={() => setFileError(null)}
              type="button"
            >
              Cerrar
            </button>
          </div>
        )}
        {isEmpty && !threadReadFailed && (
          <div className="mb-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                className="rounded-full border border-line/10 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-line/5"
                onClick={() => void send(s)}
                type="button"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          className="flex items-center gap-2 rounded-2xl border border-line/10 bg-zinc-900 px-3 py-2 focus-within:border-emerald-400/40"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <input
            ref={fileRef}
            accept={ACCEPTED_FILES}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void sendFile(file);
            }}
            type="file"
          />
          <button
            aria-label="Adjuntar recibo o captura"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-line/5 hover:text-emerald-300 disabled:opacity-40"
            disabled={isTyping}
            onClick={() => fileRef.current?.click()}
            type="button"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path
                d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <input
            ref={inputRef}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent px-2 text-base text-zinc-100 placeholder-zinc-600 outline-none sm:text-sm"
            enterKeyHint="send"
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escríbele a Kipu…"
            value={input}
          />
          <button
            aria-label="Enviar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-zinc-950 transition hover:bg-emerald-300 disabled:opacity-40"
            disabled={!input.trim() || isTyping}
            type="submit"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
