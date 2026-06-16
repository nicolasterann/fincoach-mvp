import OpenAI from "openai";

// Stage 13 — AI-first copy for a PROACTIVE Telegram check-in. Deterministic code
// decided WHETHER and WHAT to nudge (topic + facts); this turns that structured
// truth into ONE natural, contextual, guilt-free message. If the model can't run
// or the output looks structured, it returns null and the loop SENDS NOTHING —
// we never fall back to a canned template for a normal nudge.

export interface AmbientMessageInput {
  topic: string;
  facts: string; // deterministic factual context (the only data the model may use)
  firstName: string | null;
  tone: string | null; // "playful" | "coach_like" | "relaxed"
  recentMessages: { role: "user" | "assistant"; content: string }[];
}

// Any sign that structure/internals leaked into the user-facing text. The
// JSON-key alternative requires a real value after the colon so a legitimate
// quoted name + colon (e.g. `Tu "Nu": casi vence`) is NOT a false positive; a
// raw UUID or snake_case id field is also caught as defense-in-depth.
const STRUCTURE_MARKERS =
  /[{}]|"\w+"\s*:\s*[[{"\d]|```|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b\w+_id\b|sourceaccountid|debtaccountid|tool_call/i;

function toneLine(tone: string | null): string {
  if (tone === "playful")
    return "Tono: juguetón, cercano y humano, sin perder claridad.";
  if (tone === "coach_like")
    return "Tono: directo y motivador, al grano, sin rodeos.";
  return "Tono: relajado, simple y sin presión.";
}

export async function generateAmbientMessage(
  input: AmbientMessageInput,
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 1 });
  const model = process.env.OPENAI_COACH_MODEL ?? "gpt-5.4";

  const system = `Eres Kipu, un coach financiero de IA para LatAm. Estás iniciando TÚ una conversación por Telegram (el usuario no escribió ahora mismo): es un check-in proactivo, no una respuesta.
Reglas:
- UN mensaje corto (1–3 frases), español cercano y humano.
- CERO culpa, cero presión, cero tono de "app de notificaciones", cero regaño. Es un compañero que se asoma cuando es útil, no una alarma.
- Usa SOLO los datos que te doy; NO inventes saldos, montos ni certezas. Si Kipu no revisó algo, no afirmes que lo revisó.
- Si hace falta pedir algo, UNA sola cosa, natural y fácil de responder.
- Dinero: el signo va DESPUÉS del número ("120$"), sin decimales si es entero; nunca "USD 120".
- PROHIBIDO: JSON, llaves, ids, nombres de campos o herramientas, jerga técnica, listas de métricas, frases como "tu data está vieja" o "actualiza tus datos".
${toneLine(input.tone)}`;

  const user = `Inicia el mensaje${input.firstName ? ` para ${input.firstName}` : ""} sobre esto (son hechos deterministas; reescríbelos humano, no los copies literal): ${input.facts}`;

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.6,
      messages: [
        { role: "system", content: system },
        ...input.recentMessages.slice(-4).filter((m) => m.content?.trim()),
        { role: "user", content: user },
      ],
    });
    const text = (completion.choices[0]?.message?.content ?? "").trim();
    // Never send empty or structure-leaking copy — skip instead.
    if (!text || text.length > 600 || STRUCTURE_MARKERS.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}
