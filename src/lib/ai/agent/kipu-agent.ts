import OpenAI from "openai";
import type { AdvisoryRecentMessage } from "@/lib/ai/advisory-classifier";
import {
  executeTool,
  KIPU_TOOL_SCHEMAS,
  type AgentContext,
} from "@/lib/ai/agent/kipu-agent-tools";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";

// The Kipu agent: an LLM that reasons over the user's LIVE financial memory and
// recent conversation, decides what to do, and executes only through safe typed
// tools. This is the AI-native front door (gated by KIPU_AGENT_MODE). It NEVER
// writes the DB itself — tools do, with validation. On any failure it signals
// the caller to fall back to the deterministic legacy pipeline.

export type AgentMode = "off" | "shadow" | "on";

export function agentMode(): AgentMode {
  const raw = (process.env.KIPU_AGENT_MODE ?? "off").toLowerCase();
  return raw === "on" || raw === "shadow" ? raw : "off";
}

const MAX_TOOL_TURNS = 5;

function money(value: number, currency: string): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const text = isWhole ? String(Math.round(rounded)) : rounded.toFixed(2);
  return currency === "USD" ? `${text}$` : `${text} ${currency}`;
}

function buildSystemPrompt(
  ctx: Awaited<ReturnType<typeof buildUserFinancialContext>>,
): string {
  const base = ctx.profile.baseCurrency;
  const accounts = ctx.accounts
    .filter((a) => !a.isGoalAccount)
    .map((a) => `- id=${a.id} | ${a.name} | saldo ${money(a.currentBalanceBase, base)}`)
    .join("\n") || "- (ninguna)";
  const cards = ctx.debtAccounts
    .map((d) => `- id=${d.id} | ${d.name} | deuda ${money(d.currentBalanceBase, base)}`)
    .join("\n") || "- (ninguna)";
  const goals = ctx.goals
    .map((g) => `- id=${g.id} | ${g.name} | ${money(g.currentAmount, base)} de ${money(g.targetAmount, base)}`)
    .join("\n") || "- (ninguna)";
  const goalAccount = ctx.accounts.find((a) => a.isGoalAccount);
  const fixed = ctx.fixedExpenses
    .filter((f) => f.isActive)
    .map((f) => `- ${f.name}: ${money(f.amount, base)}`)
    .join("\n") || "- (ninguno)";
  const weekly = ctx.dashboard
    ? `Margen flexible de la semana: ${money(ctx.dashboard.flexibleSpending.flexibleSpending, base)} (sugerido ${money(ctx.dashboard.weeklyPlan.dailySuggestedLimit, base)}/día).`
    : "Margen semanal: aún sin meta principal para calcularlo.";
  const notes = ctx.userContextNotes
    .filter((n) => n.isActive)
    .slice(-20)
    .map((n) => `- [${n.noteType}] ${n.content}`)
    .join("\n") || "- (todavía nada aprendido)";

  return `
Eres Kipu, un coach financiero personal de IA para usuarios de LatAm. No eres un bot de comandos ni un formulario: entiendes lenguaje natural messy, recuerdas el contexto, aprendes del usuario y ACTÚAS de forma segura. Hablas español cercano, con cero juicio, claro y humano. El usuario debe sentir "esto me conoce".

Tu inteligencia es flexible; la ejecución es segura. Tú decides QUÉ hacer; las herramientas validan y ejecutan. Nunca inventes saldos ni montos: los números reales vienen del contexto y de las herramientas. Para CUALQUIER movimiento de dinero ambiguo, pregunta una cosa corta antes de ejecutar; nunca adivines.

Reglas de dinero:
- Tarjeta = deuda, no dinero disponible. Una compra con tarjeta sube la deuda y NO baja efectivo hoy. Un pago de tarjeta baja la cuenta y baja la deuda, no es un gasto nuevo.
- Si falta el monto o la fuente para registrar, pregunta; no registres a medias.
- Si el usuario corrige algo o te enseña un alias/preferencia/patrón ("cuando digo Pichincha me refiero a mi cuenta", "Juan es mi hermano", "los findes gasto más en comida"), usa remember_fact para no olvidarlo.

Herramientas disponibles: get_financial_context, log_movement, transfer_between_accounts, undo_last_movement, remember_fact. Para actuar, LLÁMALAS por el canal de herramientas (function calling); NUNCA escribas la llamada ni sus argumentos como texto. Si solo es una pregunta o consejo, responde sin herramienta (modo solo-lectura por defecto). Puedes encadenar varias en un turno.

REGLA ABSOLUTA DE SALIDA: tu mensaje final al usuario es SOLO español natural. Jamás incluyas JSON, llaves {}, comillas de campos, nombres de herramientas, ids, categorías internas, ni ningún rastro técnico. El usuario solo ve una confirmación humana y breve.

Después de actuar, confirma natural y breve qué pasó y, si ayuda, el impacto en su semana o meta. Formato de dinero: el signo va DESPUÉS del número ("3$", "593$"), sin decimales cuando es entero, nunca "USD 3.00" ni "$3". Cuando sume valor, usa el margen de la semana en este formato: "Te quedan 593$ para esta semana, más o menos 119$ por día." Ejemplo de tono (NO es plantilla, varía la redacción): "Listo, café por 3$ desde Pichincha. Te quedan 593$ para esta semana, más o menos 119$ por día."

=== CONTEXTO FINANCIERO REAL (moneda base ${base}) ===
${weekly}
Cuentas:
${accounts}
Tarjetas / deudas:
${cards}
Metas:
${goals}
Cuenta de meta (destino de aportes): ${goalAccount ? `id=${goalAccount.id} (${goalAccount.name})` : "no definida"}
Gastos fijos activos:
${fixed}

=== MEMORIA APRENDIDA DEL USUARIO ===
${notes}
`.trim();
}

// Markers that mean structure / internals leaked into the user-facing text:
// JSON braces, a "key": pair, code fences, ids, or tool plumbing. The user must
// NEVER see any of these.
const STRUCTURE_MARKERS =
  /[{}]|"\w+"\s*:|```|sourceaccountid|destinationaccountid|debtaccountid|goalid|tool_call|function_call|"type"\s*:/i;

// Strip any leaked JSON objects/arrays, code fences and tool arguments from the
// model's final text, leaving only the natural-language reply. The common leak
// is a flat tool-args object ("{...}") on its own line followed by the real
// sentence — removing the object salvages the sentence cleanly.
function sanitizeAgentReply(raw: string): string {
  let text = raw.replace(/```[\s\S]*?```/g, " ");
  for (let i = 0; i < 4; i += 1) {
    text = text.replace(/\{[^{}]*\}/g, " ").replace(/\[[^[\]]*\]/g, " ");
  }
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*\n\s*/g, "\n\n")
    .trim();
}

function looksDirty(text: string): boolean {
  return STRUCTURE_MARKERS.test(text);
}

function finalizeReply(
  rawText: string | null | undefined,
  toolsUsed: string[],
  wroteSomething: boolean,
): RunKipuAgentResult {
  const cleaned = rawText ? sanitizeAgentReply(rawText) : "";
  if (cleaned && !looksDirty(cleaned)) {
    return { ok: true, message: cleaned, toolsUsed };
  }
  // Salvage failed. If a write already executed this turn, we must NOT fall
  // back to the legacy pipeline (it would re-process the same message and could
  // duplicate the movement). Return a safe, clean confirmation instead.
  if (wroteSomething) {
    return { ok: true, message: "Listo, lo dejé registrado.", toolsUsed };
  }
  return { ok: false, toolsUsed };
}

export interface RunKipuAgentInput {
  userId: string;
  message: string;
  recentMessages: AdvisoryRecentMessage[];
  channel?: ChatChannel;
  chatId?: string | null;
}

export interface RunKipuAgentResult {
  ok: boolean;
  message?: string;
  toolsUsed: string[];
}

export async function runKipuAgent(
  input: RunKipuAgentInput,
): Promise<RunKipuAgentResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, toolsUsed: [] };

  let financialContext: Awaited<ReturnType<typeof buildUserFinancialContext>>;
  try {
    financialContext = await buildUserFinancialContext(input.userId);
  } catch {
    return { ok: false, toolsUsed: [] };
  }

  const agentCtx: AgentContext = {
    userId: input.userId,
    accounts: financialContext.accounts,
    debtAccounts: financialContext.debtAccounts,
    goals: financialContext.goals,
    channel: input.channel,
    chatId: input.chatId,
    rawMessage: input.message,
  };

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_COACH_MODEL ?? "gpt-5.4";

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(financialContext) },
    ...input.recentMessages
      .slice(-8)
      .filter((m) => m.content?.trim())
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      })),
    { role: "user", content: input.message },
  ];

  const toolsUsed: string[] = [];
  let wroteSomething = false;

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.4,
        messages,
        tools: KIPU_TOOL_SCHEMAS,
        tool_choice: "auto",
      });
      const choice = completion.choices[0]?.message;
      if (!choice) return finalizeReply(null, toolsUsed, wroteSomething);

      messages.push(choice);

      const toolCalls = choice.tool_calls ?? [];
      if (toolCalls.length === 0) {
        // Final turn: sanitize before the user ever sees it — never leak JSON,
        // ids, or tool plumbing.
        return finalizeReply(choice.content, toolsUsed, wroteSomething);
      }

      for (const call of toolCalls) {
        if (call.type !== "function") continue;
        toolsUsed.push(call.function.name);
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }
        const result = await executeTool(call.function.name, args, agentCtx);
        if (result.status === "done" && call.function.name !== "get_financial_context") {
          wroteSomething = true;
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    // Tool budget exhausted — force a final natural answer.
    const final = await client.chat.completions.create({
      model,
      temperature: 0.4,
      messages: [
        ...messages,
        {
          role: "system",
          content:
            "Responde ya al usuario en español natural y breve, SIN llamar más herramientas y SIN incluir JSON, ids ni nada técnico.",
        },
      ],
    });
    return finalizeReply(final.choices[0]?.message?.content, toolsUsed, wroteSomething);
  } catch {
    return finalizeReply(null, toolsUsed, wroteSomething);
  }
}
