"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearChatHistoryAction,
  sendChatMessageAndGetReply,
  sendWebEvidenceAction,
} from "../transaction-actions";

// The Kipu conversation — a real DM experience: optimistic user bubble, typing
// indicator, no page reload, keyboard-safe input. The bottom tab bar is hidden
// on this route so the input owns the bottom of the screen.

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
}

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
}: {
  initialMessages: ChatMsg[];
  firstName: string;
  /** Text shared into Kipu via the PWA share target (?share=). */
  initialShareText?: string;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [failedDelivery, setFailedDelivery] = useState<{
    text: string;
    submissionId: string;
  } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isTyping]);

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
        {
          id: `local-${Date.now()}`,
          role: "user",
          content: file.type === "application/pdf" ? `📄 ${file.name}` : `📷 ${file.name || "Imagen"}`,
        },
      ]);
      setIsTyping(true);
      try {
        const formData = new FormData();
        formData.set("file", file);
        const { reply } = await sendWebEvidenceAction(formData);
        setMessages((prev) => [
          ...prev,
          { id: `local-${Date.now()}-r`, role: "assistant", content: reply },
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
        { id: `local-${Date.now()}`, role: "user", content: trimmed },
      ]);
    }
    setIsTyping(true);
    const submissionId = retry?.submissionId ?? makeSubmissionId();
    try {
      const { reply } = await sendChatMessageAndGetReply(trimmed, submissionId);
      setMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}-r`, role: "assistant", content: reply },
      ]);
    } catch {
      // Transport state is UI, not Kipu-authored conversation. The durable
      // delivery can be retried with the same submission id server-side; never
      // fabricate an assistant bubble when the model produced no safe reply.
      setFailedDelivery({ text: trimmed, submissionId });
    } finally {
      setIsTyping(false);
      inputRef.current?.focus();
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div
      className="relative mx-auto flex h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col"
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
          {isEmpty ? (
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
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-6 ${
                    m.role === "user"
                      ? "rounded-br-md bg-emerald-400 text-zinc-950"
                      : "rounded-bl-md bg-zinc-800 text-zinc-100"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))
          )}
          {isTyping && <TypingDots />}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
        {failedDelivery && (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200" role="status">
            <span>No se pudo entregar la respuesta.</span>
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
        {isEmpty && (
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
