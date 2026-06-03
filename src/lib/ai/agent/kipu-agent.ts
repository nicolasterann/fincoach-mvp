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

Herramientas disponibles: get_financial_context, log_movement, transfer_between_accounts, undo_last_movement, remember_fact. Úsalas cuando haya que actuar; si solo es una pregunta o consejo, responde sin herramienta (modo solo-lectura por defecto). Puedes encadenar varias en un turno.

Después de actuar, responde natural y breve, explicando qué pasó y, si ayuda, el impacto en su semana o meta. No expongas ids, JSON, ni lenguaje técnico.

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
      if (!choice) return { ok: false, toolsUsed };

      messages.push(choice);

      const toolCalls = choice.tool_calls ?? [];
      if (toolCalls.length === 0) {
        const text = choice.content?.trim();
        if (!text) return { ok: false, toolsUsed };
        return { ok: true, message: text, toolsUsed };
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
            "Responde ya al usuario en español natural y breve, sin llamar más herramientas.",
        },
      ],
    });
    const text = final.choices[0]?.message?.content?.trim();
    return text ? { ok: true, message: text, toolsUsed } : { ok: false, toolsUsed };
  } catch {
    return { ok: false, toolsUsed };
  }
}
