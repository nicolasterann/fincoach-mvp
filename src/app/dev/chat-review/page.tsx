import { createSupabaseServerClient } from "@/lib/supabase-server";
import { makeDayKey, DEFAULT_USER_TZ } from "@/lib/financial/margen-kipu";
import {
  turnAuthor,
  toolsUsedOf,
  citedNumbers,
  AUTHOR_LABEL,
  type TurnAuthor,
} from "@/lib/chat-memory/turn-provenance";
import {
  readCompleteChatReviewWith,
  type ChatReviewRow as Row,
} from "@/lib/chat-memory/chat-review-read";

// Bloque J (J-7) — el harness de OBSERVACIÓN. La mitad humana del bloque es
// revisar el chat real, mensaje a mensaje, sobre datos reales: sin esa lectura
// el bloque es adivinar. Esta página existe para hacerla DIAGNOSTICABLE en vez
// de anecdótica — junto a cada turno muestra su PROCEDENCIA (quién lo escribió y
// con qué herramientas), que es lo que convierte "esto respondió raro" en un
// defecto localizable.
//
// Lee con el cliente de SESIÓN (RLS), nunca con el admin: cada usuario ve
// únicamente su propia conversación — la misma que ya ve en la app. Por eso no
// se apaga en producción: el chat real vive ahí, y ahí hay que poder mirarlo.

export const dynamic = "force-dynamic";

const TONE: Record<TurnAuthor, string> = {
  usuario: "bg-zinc-200 text-zinc-700",
  agente: "bg-emerald-200 text-emerald-900",
  calendario: "bg-sky-200 text-sky-900",
  coach: "bg-violet-200 text-violet-900",
  cierre_de_mes: "bg-amber-200 text-amber-900",
  otro: "bg-zinc-200 text-zinc-700",
  sin_atribuir: "bg-red-200 text-red-900",
};

export default async function ChatReviewPage() {
  const supabase = await createSupabaseServerClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id ?? null;

  if (!userId) {
    return (
      <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
        <p className="mx-auto max-w-3xl text-sm">Iniciá sesión para revisar tu conversación.</p>
      </main>
    );
  }

  const [reviewRead, tzRead] = await Promise.all([
    readCompleteChatReviewWith({
      page: async (cursor, limit) => {
        let query = supabase
          .from("chat_messages")
          .select("id, role, channel, content, message_type, metadata, created_at")
          .eq("user_id", userId);
        if (cursor) {
          query = query.or(
            `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`,
          );
        }
        const { data, error } = await query
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit);
        return {
          rows: error || !data ? null : (data as Row[]),
          error: error?.message ?? null,
        };
      },
      count: async () => {
        const { count, error } = await supabase
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);
        return { count, error: error?.message ?? null };
      },
    }),
    supabase.from("user_engagement").select("timezone").eq("user_id", userId).maybeSingle(),
  ]);

  const tz = tzRead.data?.timezone ? String(tzRead.data.timezone) : DEFAULT_USER_TZ;
  const dayKey = makeDayKey(tz);

  // La lectura puede FALLAR, y "no pude leer" no es "no dijiste nada" (doctrina
  // del Bloque I). Un harness de revisión que muestra cero turnos por un error
  // de lectura haría concluir que no hay nada que revisar.
  if (!reviewRead.ok || tzRead.error) {
    const detail = !reviewRead.ok ? reviewRead.detail : tzRead.error?.message;
    return (
      <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
        <p className="mx-auto max-w-3xl rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
          No pude leer la conversación completa ({detail}). Esto NO significa que no haya mensajes — reintentá.
        </p>
      </main>
    );
  }
  const complete = reviewRead.complete;
  const rows = (complete ? reviewRead.rows : reviewRead.partial).slice().reverse();

  const assistant = rows.filter((r) => r.role === "assistant");
  const unattributed = assistant.filter((r) => turnAuthor(r) === "sin_atribuir");
  const byAuthor = new Map<string, number>();
  for (const r of assistant) {
    const k = AUTHOR_LABEL[turnAuthor(r)];
    byAuthor.set(k, (byAuthor.get(k) ?? 0) + 1);
  }

  // El separador de día se calcula ANTES del render: mutar una variable dentro
  // del callback del map la haría depender del orden de renderizado.
  const dayOf = rows.map((r) => dayKey(new Date(r.created_at)));
  const startsDay = dayOf.map((d, i) => i === 0 || d !== dayOf[i - 1]);

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-6 text-zinc-50">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-5">
          <p className="text-sm font-medium text-emerald-300">Kipu · Bloque J</p>
          <h1 className="mt-2 text-3xl font-bold">Revisión del chat</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            El chat real, en orden, con la procedencia de cada turno. Zona horaria: {tz}.
          </p>
        </header>

        <section className="rounded-3xl bg-white p-5 text-zinc-950">
          <h2 className="text-lg font-bold">Cobertura de atribución</h2>
          <p className="mt-1 text-sm text-zinc-600">
            La precondición del harness: todo turno del asistente tiene que tener autor.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[...byAuthor.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([label, n]) => (
                <span
                  key={label}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    label === "SIN ATRIBUIR" ? "bg-red-200 text-red-900" : "bg-zinc-200 text-zinc-700"
                  }`}
                >
                  {label}: {n}
                </span>
              ))}
          </div>
          <p className="mt-4 text-sm font-semibold">
            {!complete
              ? `Vista parcial: recuperé ${rows.length} turnos, pero no pude probar que sean todos. La cobertura no se certifica.`
              : assistant.length === 0
              ? "Todavía no hay turnos del asistente."
              : unattributed.length === 0
                ? `${assistant.length}/${assistant.length} turnos atribuidos.`
                : `${assistant.length - unattributed.length}/${assistant.length} atribuidos — ${unattributed.length} SIN AUTOR.`}
          </p>
        </section>

        <section className="flex flex-col gap-3">
          {rows.map((row, i) => {
            const author = turnAuthor(row);
            const tools = toolsUsedOf(row);
            const day = dayOf[i];
            const newDay = startsDay[i];
            const isUser = row.role === "user";
            const numbers = isUser ? [] : citedNumbers(row.content);
            return (
              <div key={row.id} className="flex flex-col gap-2">
                {newDay ? (
                  <p className="mt-2 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">{day}</p>
                ) : null}
                <article
                  className={`rounded-2xl border p-4 ${
                    isUser ? "border-white/10 bg-white/5" : "border-emerald-400/20 bg-emerald-400/5"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${TONE[author]}`}>{AUTHOR_LABEL[author]}</span>
                    <span className="text-zinc-400">{row.channel ?? "—"}</span>
                    <span className="text-zinc-500">
                      {new Date(row.created_at).toLocaleTimeString("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {row.message_type ? <span className="text-zinc-500">· {row.message_type}</span> : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-100">{row.content}</p>
                  {tools.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tools.map((t) => (
                        <span key={t} className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-zinc-300">
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {numbers.length > 0 ? (
                    <p className="mt-2 text-[11px] text-zinc-500">cifras citadas: {numbers.join(" · ")}</p>
                  ) : null}
                </article>
              </div>
            );
          })}
        </section>
      </section>
    </main>
  );
}
