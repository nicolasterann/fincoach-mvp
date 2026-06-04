import OpenAI from "openai";
import type { AdvisoryRecentMessage } from "@/lib/ai/advisory-classifier";
import {
  executeTool,
  KIPU_TOOL_SCHEMAS,
  type AgentContext,
} from "@/lib/ai/agent/kipu-agent-tools";
import { deriveAdvisorySnapshot, type AdvisorySnapshot } from "@/lib/ai/advisory-handler";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import {
  buildCoachingBriefing,
  type CoachingBriefing,
} from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import type { Account, DebtAccount } from "@/types/financial";

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

// Safe fallback when the proactive briefing can't be built, so the agent still
// has a coherent (neutral) state and never crashes.
function emptyBriefing(snapshot: AdvisorySnapshot): CoachingBriefing {
  return {
    baseCurrency: snapshot.baseCurrency,
    weeklyMargin: snapshot.weeklyRemaining,
    dailySuggested: snapshot.dailySuggested,
    daysRemainingInWeek: snapshot.daysRemainingInWeek,
    margenKipu: {
      margenWeekly: snapshot.weeklyRemaining,
      margenDaily: snapshot.dailySuggested,
      safeToSpendUntilIncome: snapshot.weeklyRemaining,
      horizonDays: 21,
      daysRemainingInWeek: snapshot.daysRemainingInWeek,
      nextIncomeDate: null,
      nextIncomeAmount: 0,
      status: "healthy",
      liquidCash: snapshot.availableCash,
      breakdown: {
        liquidCash: snapshot.availableCash,
        reservedFixed: 0,
        reservedScheduled: 0,
        reservedDebt: 0,
        reservedEssentials: 0,
        reservedSavings: 0,
        reservedInvestment: 0,
        reservedGoal: 0,
        totalReserved: 0,
      },
      baseCurrency: snapshot.baseCurrency,
    },
    liquid: {
      lines: [],
      liquidTotal: snapshot.availableCash,
      bankTotal: 0,
      cashTotal: 0,
      walletTotal: 0,
    },
    daysSinceLastActivity: null,
    upcomingPayments: [],
    receivablesOutstanding: 0,
    nonLiquidTotal: 0,
    protectedGoalMoney: 0,
    cardsDueSoon: [],
    signals: [{ kind: "all_good", severity: "positive", text: "Vas en orden." }],
    leadSignal: null,
    recentlyMentioned: [],
    engagementMode: "normal",
    nextBestAction: "Seguir así.",
    metrics: {
      financialReadiness: 60,
      goalMomentum: 60,
      debtPressure: 70,
      spendingFlexibility: 60,
      financialAccuracy: 50,
      budgetReality: 55,
    },
    digest: "Estado proactivo no disponible este turno.",
  };
}

// Structured learned memory, grouped by kind, so the agent can resolve aliases,
// people and the default payment source — and keep getting more personal.
function buildMemoryDigest(
  notes: Awaited<ReturnType<typeof buildUserFinancialContext>>["userContextNotes"],
  defaultSourceName: string | null,
): string {
  const active = notes.filter((n) => n.isActive);
  const group = (label: string, type: string): string => {
    const items = active.filter((n) => n.noteType === type).slice(-10);
    return items.length ? `${label}:\n${items.map((n) => `  · ${n.content}`).join("\n")}` : "";
  };
  const parts = [
    defaultSourceName ? `Fuente de pago por defecto: ${defaultSourceName}` : "",
    group("Alias y preferencias", "preference"),
    group("Personas y contexto", "general"),
    group("Patrones de comportamiento", "behavior_pattern"),
    group("Restricciones", "constraint"),
    group("Contexto de meta", "goal_context"),
    group("Riesgos a cuidar", "risk_context"),
  ].filter(Boolean);
  return parts.length
    ? parts.join("\n")
    : "- (todavía nada aprendido; ve aprendiendo del usuario con remember_fact)";
}

function buildSystemPrompt(
  ctx: Awaited<ReturnType<typeof buildUserFinancialContext>>,
  defaultSourceName: string | null,
  briefingDigest: string,
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
    .map((f) => `- id=${f.id} | ${f.name}: ${money(f.amount, base)}`)
    .join("\n") || "- (ninguno)";
  const weekly =
    "El MARGEN KIPU de la semana (lo que el usuario puede gastar tranquilo) está en el ESTADO PROACTIVO de abajo: usa ESE número como cuánto puede gastar, no sumes saldos por tu cuenta.";
  const memory = buildMemoryDigest(ctx.userContextNotes, defaultSourceName);

  return `
Eres Kipu, un coach financiero personal de IA para usuarios de LatAm. No eres un bot de comandos ni un formulario: entiendes lenguaje natural messy, recuerdas el contexto, aprendes del usuario y ACTÚAS de forma segura. Hablas español cercano, con cero juicio, claro y humano. El usuario debe sentir "esto me conoce".

Tu inteligencia es flexible; la ejecución es segura. Tú decides QUÉ hacer; las herramientas validan y ejecutan. Nunca inventes saldos ni montos: los números reales vienen del contexto y de las herramientas. Para CUALQUIER movimiento de dinero ambiguo, pregunta una cosa corta antes de ejecutar; nunca adivines.

Reglas de dinero:
- Tarjeta = deuda, no dinero disponible. Una compra con tarjeta sube la deuda y NO baja efectivo hoy. Un pago de tarjeta baja la cuenta y baja la deuda, no es un gasto nuevo.
- Transferencia entre las cuentas del MISMO usuario = transfer_between_accounts (no es gasto ni ingreso). Dinero a/desde OTRA persona = record_person_payment (gasto, préstamo, ingreso, reembolso o devolución, según el caso). No los confundas.
- Si falta el monto o la fuente para registrar, pregunta; no registres a medias.
- Un pago de un gasto fijo que YA existe debe ir con su fixedExpenseId (mira la lista de gastos fijos con ids) para no contarlo doble. Si cambia el monto: una sola vez = log_movement normal; permanente = update_fixed_expense.
- HIPOTÉTICOS ("¿puedo gastar X?", "¿debería comprar X?", "¿me alcanza para X?", "¿o mejor aguanto?"): NO registres nada y NO repitas el margen actual como si fuera el de después. Llama evaluate_purchase con el monto (y onCard si es con tarjeta) y responde con el Margen Kipu DESPUÉS de esa compra. Si la compra reduce el margen, dilo con el número real de después.
- FUTURO: cuando algo empieza o cambia en una fecha futura ("desde el 1 del próximo mes", "a partir de...") al crear o actualizar un gasto fijo, conserva esa fecha (startDate) y CONFÍRMALA en tu respuesta, dejando claro que no se cobra nada hoy.
- MARGEN KIPU (el corazón de Kipu, calcula como CFO y comunica como coach tranquilo): el "Margen Kipu" es lo que el usuario puede gastar TRANQUILO esta semana SIN poner en riesgo sus gastos esenciales, fijos, pagos de tarjeta/deuda, pagos programados, ahorro, inversión, su meta, ni su flujo de caja hasta el próximo ingreso. NO es el saldo del banco, NO es el dinero líquido, NO es lo que le deben. El ESTADO PROACTIVO ya trae el Margen Kipu de la semana y por día YA calculado (descontado todo lo necesario hasta el próximo sueldo): usa ESE número. Comunica SIEMPRE simple, en semana/día ("Te quedan 120$ de Margen Kipu esta semana", "hoy yo no pasaría de 30$", "sí puedes, sin apretarte", "puedes, pero con tope", "mejor aguanta"). NO sueltes el desglose (líquido, fijos, deuda, ahorro, etc.) salvo que el usuario lo pida o pregunte por qué el número es menor que su banco — ahí sí explícalo simple usando el "Por qué" del estado proactivo. No abrumes con muchos números.
- AHORRO E INVERSIÓN PROTEGIDOS: el ahorro y la inversión del usuario YA están reservados dentro del Margen Kipu. No los trates como dinero gastable y no se los hagas "sacrificar" para gastar; ese es justamente el valor de Kipu (gasta tranquilo, lo importante ya está apartado). Si el usuario quiere cambiar cuánto ahorra/invierte, eso ajusta el plan, no es gasto libre.
- LIQUIDEZ Y SALDOS EXACTOS (clave para la confianza): cuando hables de saldos o cuadres cuentas, usa los TOTALES EXACTOS del estado proactivo ("LIQUIDEZ EXACTA") tal cual; NUNCA sumes saldos tú mismo (puedes equivocarte y romper la confianza). Si el usuario dice "banco", compara contra el total de BANCO; el efectivo es aparte, no lo mezcles en el número del banco. Lo que le deben, inversiones, ahorro no líquido y dinero de la meta NUNCA son Margen Kipu: menciónalos aparte y claro si ayuda ("además te deben 50$, pero no los cuento como gastable"). Si una cuenta es de ahorro/inversión y no es para gastar, márcala con set_account_liquidity(non_liquid).
- CUADRE DE SALDO: si el usuario dice que una cuenta tiene un saldo distinto al tuyo y no recuerda por qué, NO lo registres como un ingreso normal (inflaría su análisis de ingresos). Usa reconcile_account_balance con el saldo real que te da: es un AJUSTE de cuadre, no un sueldo ni un gasto. Confírmalo como "ajuste para cuadrar", no como ingreso.

Memoria y aprendizaje (esto te hace personal):
- USA la MEMORIA de abajo para resolver alias ("Pichincha" → su cuenta, no la Visa), personas ("Juan", "mi mamá", "el gym"), y la fuente de pago por defecto cuando el usuario no la diga. No vuelvas a preguntar lo que ya sabes.
- APRENDE siempre: cuando el usuario te corrija ("no era Visa, era Pichincha"), te enseñe un alias o una persona ("cuando digo X me refiero a Y", "Juan es mi hermano"), o repita un hábito ("normalmente pago cafés con Pichincha"), llama remember_fact ADEMÁS de la acción principal, con el noteType adecuado (preference para alias/preferencias, general para personas, behavior_pattern para hábitos). Así mejoras cada semana.

Herramientas: get_financial_context, get_proactive_briefing, evaluate_purchase, log_movement, transfer_between_accounts, list_recent_movements, undo_movement, undo_recent_movements, correct_movement, remove_duplicate, reconcile_account_balance, record_person_payment, create_fixed_expense, update_fixed_expense, schedule_payment, set_savings_plan, set_account_liquidity, set_engagement_mode, mark_week_reconciled, remember_fact. Para actuar, LLÁMALAS por el canal de herramientas (function calling); NUNCA escribas la llamada ni sus argumentos como texto. Si solo es una pregunta o consejo, responde sin herramienta. Puedes encadenar varias en un turno.

Cómo borrar/corregir/duplicados SIN trabarte (muy importante):
- "borra los últimos N" / "deshaz los 2 últimos": usa undo_recent_movements(count=N) UNA sola vez. No los borres uno por uno.
- "eso fue duplicado" / "se registró dos veces": usa remove_duplicate (quita solo la copia más reciente, deja una).
- Para borrar/corregir UNO específico cuando hay duda: primero llama list_recent_movements (te da el id y la CUENTA de cada movimiento). Luego, si hace falta, muéstrale 2-3 opciones distinguidas por su fuente ("¿el de Pichincha o el de efectivo?") y, cuando el usuario elija con sus palabras ("el de pichincha", "el primero", "el último"), TÚ traduces esa elección al id y llamas undo_movement(transactionId=...), correct_movement(transactionId=...) o remove_duplicate(transactionId=...). NUNCA repitas la misma pregunta vaga, NUNCA pidas un id ni una frase exacta, y NUNCA reenvíes la misma pista que ya salió ambigua.
- Si ya tienes suficiente para elegir uno, actúa por id directamente; no pidas confirmación de más.

REGLA ABSOLUTA DE SALIDA: tu mensaje final al usuario es SOLO español natural. Jamás incluyas JSON, llaves {}, comillas de campos, nombres de herramientas, ids, categorías internas, ni ningún rastro técnico. El usuario solo ve una confirmación humana y breve.

Después de actuar, confirma natural y breve qué pasó y, si ayuda, el impacto en su semana o meta. Formato de dinero: el signo va DESPUÉS del número ("3$", "120$"), sin decimales cuando es entero, nunca "USD 3.00" ni "$3". Cuando sume valor, usa el Margen Kipu de la semana así: "Te quedan 120$ de Margen Kipu esta semana, más o menos 30$ por día." Ejemplo de tono (NO es plantilla, varía la redacción): "Listo, café por 3$ desde Pichincha. Te quedan 117$ de Margen Kipu esta semana, más o menos 29$ por día." La primera vez que uses el término "Margen Kipu" con un usuario (o si pregunta qué es), explícalo en una frase simple: "tu Margen Kipu es lo que puedes gastar tranquilo después de separar pagos, gastos necesarios, deudas, ahorro/inversión y tu meta". Después úsalo natural, sin re-explicarlo cada vez.

Coaching proactivo (eres un coach que acompaña con memoria, no un buzón ni una alarma repetitiva):
- El ESTADO PROACTIVO de abajo te dice cuál es la ÚNICA señal que conviene mencionar hoy ("Señal para mencionar HOY") y cuáles YA mencionaste hace poco. Cuando sea natural, añade esa una señal, breve. NO repitas las "ya mencionadas" salvo que el usuario esté por decidir algo que dependa de eso (ahí sí, y dilo distinto). Nunca repitas la misma advertencia turno tras turno como un bot; un buen coach recuerda que ya lo dijo.
- "¿cómo voy?", "¿qué debo cuidar?", "ayúdame a cuadrar la semana", "¿en qué ando?": llama get_proactive_briefing y responde con lo más importante + el próximo paso, en lenguaje humano (nunca números técnicos ni listas de métricas crudas).
- RECONCILIACIÓN: para cuadrar la semana, resume en una línea su Margen Kipu y qué viene, y pide una confirmación corta ("¿te cuadra?"). Si confirma que sí, llama mark_week_reconciled. Si al cuadrar aparece una diferencia de saldo en una cuenta, usa reconcile_account_balance (ajuste, no ingreso). Simple, no un reporte contable.
- RECUPERACIÓN SIN CULPA: si lleva días sin registrar (mira "Actividad"), dale la bienvenida sin regañar ("qué bueno que volviste, retomemos suave") y ofrece retomar con un par de gastos, sin pedir reconstruir todo.
- PAUSA / MODO LIGERO / RETOMAR: si pide pausar recordatorios, ir ligero o retomar, usa set_engagement_mode (paused/light/normal). Respeta el MODO del estado proactivo: si dice PAUSA, no empujes señales; si dice LIGERO, sé mínimo.
- Nunca uses la culpa. El registro y la vuelta siempre deben sentirse seguros.

=== CONTEXTO FINANCIERO REAL (moneda base ${base}) ===
${weekly}
Cuentas:
${accounts}
Tarjetas / deudas:
${cards}
Metas:
${goals}
Cuenta de meta (destino de aportes): ${goalAccount ? `id=${goalAccount.id} (${goalAccount.name})` : "no definida"}
Gastos fijos activos (úsalos por id si el usuario paga uno):
${fixed}

=== MEMORIA APRENDIDA (úsala para resolver alias/personas/fuente por defecto, y aprende con remember_fact) ===
${memory}

=== ESTADO PROACTIVO (para acompañar; menciona como mucho UNA señal relevante, en lenguaje humano) ===
${briefingDigest}
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

// Resolve the user's saved default payment source to a human name for the
// memory digest, so the agent can pick it when the user doesn't name a source.
async function loadDefaultSourceName(
  userId: string,
  accounts: Account[],
  debts: DebtAccount[],
): Promise<string | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("user_financial_preferences")
      .select("default_source_type, default_source_id")
      .eq("user_id", userId)
      .maybeSingle();
    const id = data?.default_source_id;
    if (!id) return null;
    if (data?.default_source_type === "debt_account") {
      return debts.find((d) => d.id === id)?.name ?? null;
    }
    return accounts.find((a) => a.id === id)?.name ?? null;
  } catch {
    return null;
  }
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

  const snapshot = deriveAdvisorySnapshot(financialContext);
  const briefing = await buildCoachingBriefing({
    userId: input.userId,
    ctx: financialContext,
    snapshot,
  }).catch(() => null);

  // Margen Kipu (commitment- + cash-flow-aware safe margin) is the REAL spending
  // margin. Make it THE number the agent and evaluate_purchase reason with,
  // overriding the liquidity-only snapshot value so every surface stays
  // consistent with the simple weekly number the user is told.
  if (briefing) {
    snapshot.weeklyRemaining = briefing.margenKipu.margenWeekly;
    snapshot.dailySuggested = briefing.margenKipu.margenDaily;
    snapshot.daysRemainingInWeek = briefing.margenKipu.daysRemainingInWeek;
  }

  const agentCtx: AgentContext = {
    userId: input.userId,
    accounts: financialContext.accounts,
    debtAccounts: financialContext.debtAccounts,
    goals: financialContext.goals,
    snapshot,
    briefing: briefing ?? emptyBriefing(snapshot),
    channel: input.channel,
    chatId: input.chatId,
    rawMessage: input.message,
  };

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_COACH_MODEL ?? "gpt-5.4";

  const defaultSourceName = await loadDefaultSourceName(
    input.userId,
    financialContext.accounts,
    financialContext.debtAccounts,
  );

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: buildSystemPrompt(financialContext, defaultSourceName, agentCtx.briefing.digest),
    },
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
