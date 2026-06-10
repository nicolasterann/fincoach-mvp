"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { sendWebChatMessageAction } from "../transaction-actions";

interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      aria-label="Enviar"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-zinc-950 transition hover:bg-emerald-300 disabled:opacity-40"
      disabled={pending}
      type="submit"
    >
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

const SUGGESTIONS = [
  "¿Cuánto puedo gastar hoy?",
  "Gasté 12 en almuerzo",
  "¿Cómo voy esta semana?",
];

export function ChatView({
  messages,
  firstName,
}: {
  messages: ChatMsg[];
  firstName: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages.length]);

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col lg:h-[calc(100vh-5rem)]">
      <header className="shrink-0 pb-4">
        <h1 className="text-xl font-bold tracking-tight text-zinc-50">Kipu</h1>
        <p className="text-xs text-zinc-600">Tu coach financiero. Escríbele como hablarías.</p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto pb-4">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-400/15 text-2xl">
              💬
            </div>
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
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 pt-2">
        {isEmpty && (
          <div className="mb-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/5"
                onClick={() => {
                  if (inputRef.current) inputRef.current.value = s;
                  inputRef.current?.focus();
                }}
                type="button"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          action={sendWebChatMessageAction}
          className="flex items-center gap-2 rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 focus-within:border-emerald-400/40"
        >
          <input type="hidden" name="redirectTo" value="/app/chat" />
          <input
            ref={inputRef}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent px-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none"
            name="message"
            placeholder="Escríbele a Kipu…"
            required
          />
          <SubmitButton />
        </form>
      </div>
    </div>
  );
}
