"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  clearChatHistoryAction,
  sendChatMessageAndGetReply,
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

export function ChatView({
  initialMessages,
  firstName,
}: {
  initialMessages: ChatMsg[];
  firstName: string;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isTyping]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "user", content: trimmed },
    ]);
    setIsTyping(true);
    try {
      const { reply } = await sendChatMessageAndGetReply(trimmed);
      setMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}-r`, role: "assistant", content: reply },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-e`,
          role: "assistant",
          content: "Se me fue la señal un momento. ¿Me lo repites?",
        },
      ]);
    } finally {
      setIsTyping(false);
      inputRef.current?.focus();
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="mx-auto flex h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between pb-3">
        <div className="flex items-center gap-3">
          <Link
            href="/app"
            aria-label="Volver"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-zinc-400 transition hover:bg-white/5 lg:hidden"
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
            className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300"
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
        {isEmpty && (
          <div className="mb-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/5"
                onClick={() => void send(s)}
                type="button"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          className="flex items-center gap-2 rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 focus-within:border-emerald-400/40"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
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
