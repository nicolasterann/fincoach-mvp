"use server";

import { readThreadView } from "@/lib/chat-memory/thread-view";
import type { ThreadView } from "@/lib/chat-memory/thread-view-contract";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Bloque N1 · Causa A — el cargador del hilo BAJO DEMANDA.
//
// Antes de N1 la pantalla que muestra un número te descargaba toda tu
// conversación por si acaso: `buildShellPayload` leía el hilo entero y lo
// mandaba dentro de la respuesta inicial de `/app`. Medido en la maqueta con
// 576 turnos reales: 463,6 kB de la respuesta eran el hilo, y en el teléfono
// del founder ese tramo era el 42 % del arranque en frío.
//
// Ahora el hilo se lee cuando se abre la conversación, y esta acción es la
// única puerta nueva. Devuelve el MISMO `ThreadView` tipado que ya consume
// `ChatView`, así que los turnos, la procedencia y los recibos son los de
// siempre — sólo cambia CUÁNDO llegan.
//
// `chat_cleared_at` sigue gobernando el corte: la promesa de M4 —«oculta sin
// borrar»— vive aquí igual que vivía en el payload.
export async function loadThreadAction(): Promise<ThreadView> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  // Sin sesión no se inventa una conversación vacía: se dice que no se pudo
  // leer. Una conversación vacía afirmaría «no tienes mensajes».
  if (!session) return { turns: [], complete: false, readFailed: true };

  const { data: prefs, error: prefsError } = await supabase
    .from("user_financial_preferences")
    .select("chat_cleared_at")
    .eq("user_id", session.user.id)
    .maybeSingle();
  // Si no se puede leer el punto de corte, leer el hilo entero mostraría
  // mensajes que el usuario mandó ocultar. Se prefiere decir que no se pudo.
  if (prefsError) return { turns: [], complete: false, readFailed: true };

  try {
    return await readThreadView({
      client: supabase,
      userId: session.user.id,
      since: (prefs?.chat_cleared_at as string | null) ?? null,
    });
  } catch {
    return { turns: [], complete: false, readFailed: true };
  }
}
