import { ChatView } from "@/app/app/components/ChatView";
import type { ThreadTurn } from "@/lib/chat-memory/thread-view-contract";

const turns: ThreadTurn[] = [
  {
    id: "m3-user-web",
    role: "user",
    author: "usuario",
    channel: "web",
    createdAtISO: "2026-08-25T14:20:00.000Z",
    text: "Gasté 4,50 en café con Produbanco",
    status: null,
    receipt: null,
    attachment: null,
  },
  {
    id: "m3-receipt",
    role: "assistant",
    author: "agente",
    channel: "web",
    createdAtISO: "2026-08-25T14:20:02.000Z",
    text: "Listo, quedó registrado.",
    status: "success",
    receipt: {
      lines: [
        {
          label: "Café · Comida",
          amountLabel: "−4,50$",
          kindLabel: "Gasto",
        },
      ],
      saldoLabel: null,
      incomplete: false,
    },
    attachment: null,
  },
  {
    id: "m3-telegram",
    role: "assistant",
    author: "calendario",
    channel: "telegram",
    createdAtISO: "2026-08-25T15:00:00.000Z",
    text: "¿Ya pagaste la tarjeta que vence mañana?",
    status: "needs_clarification",
    receipt: null,
    attachment: null,
  },
  {
    id: "m3-unsupported",
    role: "assistant",
    author: "sin_atribuir",
    channel: "web",
    createdAtISO: "2026-08-25T15:05:00.000Z",
    text: "Todavía no puedo hacer ese cambio con seguridad.",
    status: "unsupported",
    receipt: null,
    attachment: null,
  },
  {
    id: "m3-failed-must-not-render",
    role: "assistant",
    author: "agente",
    channel: "web",
    createdAtISO: "2026-08-25T15:06:00.000Z",
    text: "ESTE TURNO FALLIDO NO DEBE APARECER",
    status: "failed",
    receipt: null,
    attachment: null,
  },
];

export default async function ChatPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string;
    share?: string;
    turn?: string;
  }>;
}) {
  const { mode, share, turn } = await searchParams;
  return (
    <main className="min-h-screen bg-zinc-950 px-3 pt-3 text-zinc-50">
      <ChatView
        firstName="Nico"
        initialMessages={mode === "read-failed" ? [] : turns}
        initialShareText={share?.trim().slice(0, 1000) || undefined}
        initialTurnId={turn?.trim() || undefined}
        threadComplete={mode !== "incomplete"}
        threadReadFailed={mode === "read-failed"}
      />
    </main>
  );
}
