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
import { buildFinancialCalendar } from "@/lib/financial/financial-calendar";
import { projectCashflow, type CashflowConfidenceInput } from "@/lib/financial/cashflow-projection";
import { detectSpendingPatterns } from "@/lib/financial/spending-patterns";
import { emptySpendingIntelligence } from "@/lib/financial/spending-intelligence";
import { emptyGoalsIntelligence } from "@/lib/financial/goals-intelligence";
import { emptyPersonalizationIntelligence } from "@/lib/financial/personalization-intelligence";
import { emptyHouseholdIntelligence } from "@/lib/household/household-intelligence";
import { emptySnapshotTrend } from "@/lib/trends/trend";
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

// Ceiling on tool rounds per turn. Most turns finish in 1–2; the higher ceiling
// only matters for a long card statement, where one turn may legitimately do
// create_card + update_card_obligations + several atomic batches (<=15 rows
// each, idempotent) + a payment. The model stops when done, so a normal turn
// costs nothing extra — this is a runaway guard sized for realistic statements.
const MAX_TOOL_TURNS = 12;

function money(value: number, currency: string): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const text = isWhole ? String(Math.round(rounded)) : rounded.toFixed(2);
  return currency === "USD" ? `${text}$` : `${text} ${currency}`;
}

// Safe fallback when the proactive briefing can't be built, so the agent still
// has a coherent (neutral) state and never crashes.
function emptyBriefing(snapshot: AdvisorySnapshot): CoachingBriefing {
  const emptyConfidence: CashflowConfidenceInput = { hasIncomeSource: false, incomeDateKnown: false, balanceStale: true, hasFixedExpenses: false, recentActivity: false, foreignUnconverted: false };
  const emptyCalendar = buildFinancialCalendar({ accounts: [], incomeSources: [], fixedExpenses: [], scheduledPayments: [], debtAccounts: [] });
  const emptyScenarioBase = { calendar: emptyCalendar, monthlyEssentialEstimate: 0, reserveFloor: 0, confidence: emptyConfidence };
  return {
    baseCurrency: snapshot.baseCurrency,
    cashflow: projectCashflow(emptyScenarioBase),
    cashflowScenarioBase: emptyScenarioBase,
    patterns: detectSpendingPatterns([], Date.now()),
    spendingIntel: emptySpendingIntelligence(),
    goalsIntel: emptyGoalsIntelligence(),
    personalization: emptyPersonalizationIntelligence(),
    household: emptyHouseholdIntelligence(),
    trend: emptySnapshotTrend(),
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
      // Fallback briefing = we couldn't build the real one, so the spendable
      // number is by definition weak: mark it preliminary and name the gap so the
      // confidence contract never presents this figure as solid.
      confidence: "preliminary",
      essentialsKnown: false,
      dataAgeDays: null,
      marginGaps: [{ code: "essentials_unknown", label: "aún no tengo suficientes datos para afinar tu número" }],
      // Stage 30 — fallback has no computed capacity; expose a zeroed, honest shape.
      capacity: {
        monthlyIncome: 0,
        monthlyFixed: 0,
        monthlyDebtService: 0,
        monthlyEssentials: 0,
        monthlyDisposableBeforeAllocations: 0,
        monthlyProtected: { savings: 0, investment: 0, goals: 0 },
        monthlyTrulyFree: 0,
      },
      cardsToConfirm: [],
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
    debtHealth: {
      hasAnyDebt: false,
      cards: [],
      totalDebt: 0,
      totalMinimums: 0,
      totalFull: 0,
      pressureLevel: "none",
      debtToIncomeRatio: 0,
      highestInterestCardId: null,
      topAction: null,
      estimate: true,
    },
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
// Onboarding notes are PINNED (S31 item 2.3): they carry what the user told
// Kipu on day one (the global note, "no tengo deudas", …) and were the FIRST
// rows inserted, so the last-10 cap evicted them first as memory grew. They
// now survive the cap (bounded at 8 so the prompt stays sane).
const PINNED_ONBOARDING_NOTES_MAX = 8;
function buildMemoryDigest(
  notes: Awaited<ReturnType<typeof buildUserFinancialContext>>["userContextNotes"],
  defaultSourceName: string | null,
): string {
  const active = notes.filter((n) => n.isActive);
  const pinned = active
    .filter((n) => n.source === "onboarding")
    .slice(0, PINNED_ONBOARDING_NOTES_MAX);
  const pinnedIds = new Set(pinned.map((n) => n.id));
  const group = (label: string, type: string): string => {
    const items = active.filter((n) => n.noteType === type && !pinnedIds.has(n.id)).slice(-10);
    return items.length ? `${label}:\n${items.map((n) => `  · ${n.content}`).join("\n")}` : "";
  };
  const parts = [
    defaultSourceName ? `Fuente de pago por defecto: ${defaultSourceName}` : "",
    pinned.length
      ? `Contexto del onboarding (lo dijo el usuario al empezar; síguelo vigente):\n${pinned.map((n) => `  · ${n.content}`).join("\n")}`
      : "",
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

// S31 item 1.1 — the READ path for per-entity notes: every "Nota para Kipu"
// (onboarding NoteFields + set_entity_note) is appended to its entity's own
// prompt line so the agent actually remembers it. Compact, single-line,
// truncated ~120 chars so the prompt stays bounded.
function noteTag(note: string | null | undefined): string {
  const clean = (note ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return ` | nota: ${clean.length > 120 ? `${clean.slice(0, 119)}…` : clean}`;
}

const ASSET_CLASS_LABEL: Record<string, string> = {
  cash: "efectivo/ahorro",
  investment: "inversión",
  fixed_term: "plazo fijo/póliza",
  crypto: "cripto",
  property: "inmueble",
  vehicle: "vehículo",
  business: "negocio",
  receivable: "préstamo a favor",
  other: "otro",
};
const ASSETS_PROMPT_MAX_ROWS = 15;

function buildSystemPrompt(
  ctx: Awaited<ReturnType<typeof buildUserFinancialContext>>,
  defaultSourceName: string | null,
  briefingDigest: string,
): string {
  const base = ctx.profile.baseCurrency;
  const accounts = ctx.accounts
    .filter((a) => !a.isGoalAccount)
    .map((a) => {
      const guardada = a.liquidity === "non_liquid" ? " | GUARDADA (no gastable)" : "";
      const moneda = a.currency !== base ? ` | moneda ${a.currency}` : "";
      return `- id=${a.id} | ${a.name} | saldo ${money(a.currentBalanceBase, base)}${guardada}${moneda}${noteTag(a.notes)}`;
    })
    .join("\n") || "- (ninguna)";
  const cards = ctx.debtAccounts
    .map((d) => `- id=${d.id} | ${d.name} | deuda ${money(d.currentBalanceBase, base)}${noteTag(d.notes)}`)
    .join("\n") || "- (ninguna)";
  const goals = ctx.goals
    .map((g) => `- id=${g.id} | ${g.name} | ${money(g.currentAmount, base)} de ${money(g.targetAmount, base)}${noteTag(g.notes)}`)
    .join("\n") || "- (ninguna)";
  const goalAccount = ctx.accounts.find((a) => a.isGoalAccount);
  // Paused/soft-deleted fixed expenses stay listed (marked) so "reactiva
  // Netflix" can resolve them by id — otherwise pausing makes them unreachable.
  const fixed = ctx.fixedExpenses
    .map((f) => `- id=${f.id} | ${f.name}: ${money(f.amount, base)}${f.isVariable ? " (varía mes a mes)" : ""}${f.isActive ? "" : " (PAUSADO/no cuenta — reactivable con update_fixed_expense action=resume)"}${noteTag(f.notes)}`)
    .join("\n") || "- (ninguno)";
  // Assets were entirely absent from the prompt before S31 — the whole
  // patrimonio screen was write-only for the agent. Counted assets only
  // (soft-removed ones stay resolvable via tools but must not read as wealth).
  const countedAssets = (ctx.assets ?? []).filter((a) => a.includeInNetWorth);
  const assetLines = countedAssets
    .slice(0, ASSETS_PROMPT_MAX_ROWS)
    .map((a) => `- id=${a.id} | ${a.name} | ${ASSET_CLASS_LABEL[a.assetClass] ?? a.assetClass} | ${money(a.valueBase, base)}${noteTag(a.notes)}`)
    .join("\n");
  const assets = countedAssets.length
    ? `${assetLines}${countedAssets.length > ASSETS_PROMPT_MAX_ROWS ? `\n- … y ${countedAssets.length - ASSETS_PROMPT_MAX_ROWS} más (usa net_worth para el total)` : ""}`
    : "- (ninguno)";
  const weekly =
    "El MARGEN KIPU de la semana (lo que el usuario puede gastar tranquilo) está en el ESTADO PROACTIVO de abajo: usa ESE número como cuánto puede gastar, no sumes saldos por tu cuenta.";
  const memory = buildMemoryDigest(ctx.userContextNotes, defaultSourceName);
  // The tone the user chose during onboarding — it must actually shape how
  // Kipu speaks (it was captured but unused before Stage 11.6).
  const toneLine =
    ctx.coachPreferences?.tone === "playful"
      ? "Tono elegido por el usuario: JUGUETÓN — humor ligero y cercano, sin perder claridad ni seriedad financiera."
      : ctx.coachPreferences?.tone === "coach_like"
        ? "Tono elegido por el usuario: DIRECTO/COACH — al grano, firme y motivador, sin rodeos."
        : "Tono elegido por el usuario: RELAJADO/CLARO — calmado, simple y sin presión.";

  return `
Eres Kipu, un coach financiero personal de IA para usuarios de LatAm. No eres un bot de comandos ni un formulario: entiendes lenguaje natural messy, recuerdas el contexto, aprendes del usuario y ACTÚAS de forma segura. Hablas español cercano, con cero juicio, claro y humano. El usuario debe sentir "esto me conoce".
${toneLine}

Tu inteligencia es flexible; la ejecución es segura. Tú decides QUÉ hacer; las herramientas validan y ejecutan. Nunca inventes saldos ni montos: los números reales vienen del contexto y de las herramientas. Para CUALQUIER movimiento de dinero ambiguo, pregunta una cosa corta antes de ejecutar; nunca adivines.

Reglas de dinero:
- Tarjeta = deuda, no dinero disponible. Una compra con tarjeta sube la deuda y NO baja efectivo hoy. Un pago de tarjeta baja la cuenta y baja la deuda, no es un gasto nuevo.
- Transferencia entre las cuentas del MISMO usuario = transfer_between_accounts (no es gasto ni ingreso). Dinero a/desde OTRA persona = record_person_payment (gasto, préstamo, ingreso, reembolso o devolución, según el caso). No los confundas.
- Si falta el monto o la fuente para registrar, pregunta; no registres a medias.
- MONEDA: por defecto NO preguntes la moneda. El sistema usa la moneda real de la cuenta/tarjeta elegida y, si no hay instrumento, tu moneda principal. Pasa el campo \`currency\` SOLO si el usuario nombra una moneda explícita ("20 USD", "en euros") o la evidencia la muestra claramente; nunca la adivines ni sobrescribas la moneda real del instrumento. Pasa SIEMPRE el monto EXACTO que dijo el usuario en SU moneda original — NUNCA lo conviertas tú a otra moneda (el sistema convierte solo, con la tasa que el usuario ya configuró). Solo si el sistema responde que no hay tipo de cambio confiable: pregunta a cuánto está la tasa, guárdala con set_exchange_rate y reintenta el registro con el monto ORIGINAL (no el equivalente).
- POSIBLE DUPLICADO RECIENTE (texto/voz): si al registrar un movimiento te aviso que ya hay uno igual hace poco, NO lo registres en silencio: pregúntale en una frase si es el MISMO que ya registraste o fue OTRO igual. Si el usuario dice que fue OTRO ("otro", "es distinto", "sí, otro café"), vuelve a llamar log_movement con confirmedNew=true para registrarlo. Si dice que es el mismo, no lo registres y confírmaselo. Esto es distinto a una corrección (eso va por correct_movement).
- Un pago de un gasto fijo que YA existe debe ir con su fixedExpenseId (mira la lista de gastos fijos con ids) para no contarlo doble. Si cambia el monto: una sola vez = log_movement normal; permanente = update_fixed_expense.
- HIPOTÉTICOS ("¿puedo gastar X?", "¿debería comprar X?", "¿me alcanza para X?", "¿o mejor aguanto?"): NO registres nada y NO repitas el margen actual como si fuera el de después. Llama evaluate_purchase con el monto (y onCard si es con tarjeta) y responde con el Margen Kipu DESPUÉS de esa compra. Si la compra reduce el margen, dilo con el número real de después.
- FUTURO: cuando algo empieza o cambia en una fecha futura ("desde el 1 del próximo mes", "a partir de...") al crear o actualizar un gasto fijo, conserva esa fecha (startDate) y CONFÍRMALA en tu respuesta, dejando claro que no se cobra nada hoy.
- MARGEN KIPU (el corazón de Kipu, calcula como CFO y comunica como coach tranquilo): el "Margen Kipu" es lo que el usuario puede gastar TRANQUILO esta semana SIN poner en riesgo sus gastos esenciales, fijos, pagos de tarjeta/deuda, pagos programados, ahorro, inversión, su meta, ni su flujo de caja hasta el próximo ingreso. NO es el saldo del banco, NO es el dinero líquido, NO es lo que le deben. El ESTADO PROACTIVO ya trae el Margen Kipu de la semana y por día YA calculado (descontado todo lo necesario hasta el próximo sueldo): usa ESE número. Comunica SIEMPRE simple, en semana/día ("Te quedan 120$ de Margen Kipu esta semana", "hoy yo no pasaría de 30$", "sí puedes, sin apretarte", "puedes, pero con tope", "mejor aguanta"). NO sueltes el desglose (líquido, fijos, deuda, ahorro, etc.) salvo que el usuario lo pida o pregunte por qué el número es menor que su banco — ahí sí explícalo simple usando el "Por qué" del estado proactivo. No abrumes con muchos números. OJO: el Margen Kipu del ESTADO PROACTIVO es de ANTES de lo que registres en este turno. Si en el mismo turno registras movimientos y luego quieres decir cuánto Margen le queda, llama get_proactive_briefing para usar el número ACTUALIZADO (no repitas el de antes ni lo calcules a ojo).
- AHORRO E INVERSIÓN PROTEGIDOS: el ahorro y la inversión del usuario YA están reservados dentro del Margen Kipu. No los trates como dinero gastable y no se los hagas "sacrificar" para gastar; ese es justamente el valor de Kipu (gasta tranquilo, lo importante ya está apartado). Si el usuario quiere cambiar cuánto ahorra/invierte, eso ajusta el plan, no es gasto libre.
- LIQUIDEZ Y SALDOS EXACTOS (clave para la confianza): cuando hables de saldos o cuadres cuentas, usa los TOTALES EXACTOS del estado proactivo ("LIQUIDEZ EXACTA") tal cual; NUNCA sumes saldos tú mismo (puedes equivocarte y romper la confianza). Si el usuario dice "banco", compara contra el total de BANCO; el efectivo es aparte, no lo mezcles en el número del banco. Lo que le deben, inversiones, ahorro no líquido y dinero de la meta NUNCA son Margen Kipu: menciónalos aparte y claro si ayuda ("además te deben 50$, pero no los cuento como gastable"). Si una cuenta es de ahorro/inversión y no es para gastar, márcala con set_account_liquidity(non_liquid).
- CUADRE DE SALDO: si el usuario dice que una cuenta tiene un saldo distinto al tuyo y no recuerda por qué, NO lo registres como un ingreso normal (inflaría su análisis de ingresos). Usa reconcile_account_balance con el saldo real que te da: es un AJUSTE de cuadre, no un sueldo ni un gasto. Confírmalo como "ajuste para cuadrar", no como ingreso.

Memoria y aprendizaje (esto te hace personal):
- USA la MEMORIA de abajo para resolver alias ("Pichincha" → su cuenta, no la Visa), personas ("Juan", "mi mamá", "el gym"), y la fuente de pago por defecto cuando el usuario no la diga. No vuelvas a preguntar lo que ya sabes.
- APRENDE siempre: cuando el usuario te corrija ("no era Visa, era Pichincha"), te enseñe un alias o una persona ("cuando digo X me refiero a Y", "Juan es mi hermano"), o repita un hábito ("normalmente pago cafés con Pichincha"), llama remember_fact ADEMÁS de la acción principal, con el noteType adecuado (preference para alias/preferencias, general para personas, behavior_pattern para hábitos). Así mejoras cada semana.

Herramientas: get_financial_context, get_proactive_briefing, evaluate_purchase, cashflow_outlook, simulate_scenario, plan_cashflow, where_did_money_go, why_margin_changed, spending_anomalies, my_subscriptions, budget_suggestion, recommend_cut, learn_spending_correction, evaluate_purchase_as_goal, create_goal, create_mini_goal, prioritize_goals, update_goal, register_investment, net_worth, set_wealth_target, set_ambition_mode, set_financial_philosophy, get_personalization_profile, set_communication_preference, set_risk_preference, set_onboarding_mode, set_nudge_sensitivity, update_life_context, forget_life_context, explain_personalization, personalization_feedback, reset_personalization_preference, log_movement, log_movements_batch, update_card_obligations, analyze_debt_health, plan_debt_payoff, compare_debt_vs_investment, estimate_card_interest, create_card, create_account, transfer_between_accounts, list_recent_movements, undo_movement, undo_recent_movements, correct_movement, remove_duplicate, reconcile_account_balance, record_person_payment, create_fixed_expense, update_fixed_expense, schedule_payment, set_savings_plan, set_account_liquidity, set_engagement_mode, set_ambient_preferences, mark_week_reconciled, create_household, add_household_participant, invite_household_member, respond_household_invite, add_shared_expense, household_summary, mark_reimbursement_paid, create_shared_goal, leave_household, set_household_visibility, household_invite_link, accept_household_invite, add_recurring_shared_expense, log_recurring_shared_expense, settle_household, household_visibility_explainer, edit_shared_expense, cancel_shared_expense, remove_household_member, remove_recurring_shared_expense, share_movement, unshare_movement, get_personality_test, submit_personality_test, personality_test_result, reset_personality_test, set_exchange_rate, convert_currency, remember_fact, update_income, create_income, schedule_change, list_scheduled_changes, cancel_scheduled_change, update_account, close_account, change_account_currency, rename_card, close_card, update_scheduled_payment, cancel_scheduled_payment, change_base_currency, add_asset, update_asset, remove_asset, set_entity_note, register_card_payment, card_status, explain_my_data, report_bug, export_my_data.

TARJETAS Y DEUDAS (protección, intereses, estrategia): Kipu es el guardián de las tarjetas/deudas del usuario, sin asustar ni culpar.
- Para responder "¿cómo van mis tarjetas?", "¿cuál está en riesgo?", "¿qué deuda me cuesta más?" usa analyze_debt_health (te da estado por tarjeta, presión, próxima acción).
- "¿pago mínimo o total?", "¿cuánto interés me cuesta?", "¿cuánto me cuesta esperar?" → estimate_card_interest. "¿qué tarjeta pago primero?", "plan para salir de deuda", "¿abono 100 extra?" → plan_debt_payoff. "¿pago deuda o invierto?" → compare_debt_vs_investment.
- Los intereses, tiempos de pago y comparaciones son SIEMPRE estimados: dilo. NUNCA inventes una tasa, un saldo, una fecha ni confirmes un pago: si falta la tasa, pídela; si un estado dice que la tarjeta "quizá ya está pagada" (la fecha pasó y no consta pago), PREGUNTA "¿ya la pagaste?", no lo afirmes ni regañes.
- Pagar una tarjeta NO es un gasto nuevo: es bajar deuda (y baja la cuenta de origen). Para registrar un pago usa el flujo de pago de deuda normal con su fecha y cuenta; si la cuenta de origen es ambigua, pregunta SOLO eso.
- En compare_debt_vs_investment das orientación de finanzas personales, NO recomendación de inversiones específicas; jamás sugieras dejar de pagar un mínimo para invertir; recalca que el ahorro de pagar deuda es casi seguro y el retorno de invertir es incierto.
- Para fijar términos desde el chat ("cierra el 6 y vence el 21", "la tasa es 15.6%") usa update_card_obligations con esos campos.

PLANIFICACIÓN Y FLUJO (el corazón de Kipu — internamente complejo, hacia el usuario SIMPLE):
- Para "¿cuánto puedo gastar hoy / esta semana / hasta mi sueldo?", "¿llego a fin de mes?", "¿por qué bajó mi margen?", "¿qué cambió?" → usa cashflow_outlook. La respuesta por defecto colapsa en POCO: (1) hoy puedes gastar X; (2) esta semana X; (3) la única cosa a cuidar; y si hace falta, (4) una recomendación y (5) una incertidumbre. NADA de listas largas, jerga, ni cinco números.
- Para "¿puedo comprar esto?", "¿qué pasa si gasto/pago X?", "¿y si me pagan antes/después?", "proteger mi fondo" → simulate_scenario. Da un veredicto claro: se puede / se puede pero justo / mejor no.
- Para "organízame la semana", "plan hasta mi sueldo", "plan pesimista/optimista" → plan_cashflow (3–5 pasos máximo, concreto, sin sermones).
- Estos números SON el Margen Kipu (proyectado en el tiempo): no inventes un segundo concepto ni muestres cifras contradictorias. Son ESTIMADOS y dependen del saldo y del ingreso: si la confianza es baja o falta un dato (saldo sin confirmar, fecha de ingreso, sin ingreso registrado), dilo en una frase y, si ayuda, pide UNA sola cosa ("confírmame tu saldo y te lo afino"). Nunca finjas certeza, nunca des un número si no hay con qué.
- Tono: calma, cero culpa, cero moralina. El usuario debe sentir que Kipu ya hizo las cuentas y él solo tiene que vivir tranquilo.

GASTO Y COMPORTAMIENTO (la inteligencia de gasto — genio adentro, SIMPLE afuera). El briefing ya trae "INTELIGENCIA DE GASTO" con lo que importa; úsalo y, para preguntas puntuales, llama la herramienta:
- "¿en qué se me va la plata?", "¿en qué gasto más?" → where_did_money_go (2–3 categorías que importan, no una lista). "¿por qué bajó mi margen?", "¿qué cambió esta semana?" → why_margin_changed (nombra el driver, no cinco números).
- "¿algo raro?", "¿me cobraron de más?" → spending_anomalies (graduado, sin alarmar; si no hay nada, dilo tranquilo). "¿qué suscripciones tengo?", "¿qué me cobran cada mes?" → my_subscriptions (y si una no está como fijo, PREGUNTA si la conviertes con create_fixed_expense; nunca la crees solo).
- "¿cómo voy?", "¿me estoy pasando?" → budget_suggestion. "¿dónde recorto?", "ayúdame a que me alcance" → recommend_cut. SIEMPRE como control, NUNCA como "fallaste tu presupuesto"; jamás sugieras saltarte un pago mínimo de tarjeta/deuda.
- Presupuesto = lo NORMAL aprendido del usuario, no límites fijos. Habla de pocas categorías, atadas a "tu semana": "Uber está ~40% arriba de tu normal; con bajar ~18$ vuelves a tu ritmo". Con pocos datos, NO afirmes patrones: dilo y, si ayuda, invita suave a registrar.
- CORRECCIONES QUE ENSEÑAN: si el usuario aclara una categoría/comercio de forma general ("eso no es comida, es transporte", "PAYU*XYZ siempre es mi gym", "ese cargo es Uber"), usa learn_spending_correction (ADEMÁS de correct_movement si corrige un movimiento puntual) para que se aplique a futuros cobros iguales. No inventes una regla que el usuario no dijo.
- NUNCA cuentes como gasto una transferencia, un pago de tarjeta, un reembolso ni un ingreso, y nunca dupliques estado de cuenta + registro. Una sola transacción no define un patrón: no exageres.

MONEDAS / TIPO DE CAMBIO (LatAm, multimoneda): cuando un monto está en otra moneda que la base del usuario, NUNCA inventes la tasa y NUNCA hagas tú la conversión al registrar — registra el monto ORIGINAL en su moneda y el sistema lo convierte con la tasa configurada del usuario. Si el usuario te dice una tasa ("el dólar está a 4000"), guárdala con set_exchange_rate. Para RESPONDER una pregunta de conversión usa convert_currency; si no hay tasa de ese par, PREGÚNTALE a cuánto está y guárdala. Conserva siempre el monto original; la base se deriva de una tasa conocida, no adivinada.

PERSONALIZACIÓN (Kipu se adapta a cada usuario sin cambiar de producto). El briefing trae una sección "PERSONALIZACIÓN" con la filosofía de vida del usuario, su tono, nivel de detalle, orientación, postura de riesgo y sensibilidad a recordatorios. SÍGUELA SIEMPRE, pero con estas reglas duras:
- REGLA DE ORO: por defecto SIMPLE y BREVE, sobre todo tras acciones rutinarias (registrar gasto, confirmar pago, subir recibo). Ser usuario "power" o "detallado" NUNCA alarga tus respuestas por defecto ni convierte una confirmación en un reporte. El detalle se da cuando lo pide o en el dashboard.
- FILOSOFÍA DE VIDA (lo más importante de esta capa): si el usuario vive por experiencias y disfrutar su dinero, NO lo presiones a ahorrar/recortar; ayúdalo a darse sus gustos SIN endeudarse. Si su filosofía es construir patrimonio, empújalo más y sé menos permisivo con lo discrecional. En ambos casos NUNCA cambies la verdad financiera, los mínimos de deuda/tarjeta, el cashflow ni el Margen Kipu, y nunca lo hagas sentir culpa.
- Ajusta el TONO y el ENCUADRE a su perfil; da más o menos detalle según su preferencia SOLO cuando aplique, no por defecto.
- Cuando el usuario exprese una preferencia o filosofía ("prefiero disfrutar / quiero construir patrimonio / háblame directo / mándame menos recordatorios / soy freelance / ya no soy estudiante, olvida eso / resetea cómo me tienes"), usa la herramienta correspondiente (set_financial_philosophy, set_communication_preference, set_risk_preference, set_nudge_sensitivity, set_onboarding_mode, update_life_context, forget_life_context, personalization_feedback, reset_personalization_preference) ADEMÁS de responder. El feedback/preferencia EXPLÍCITA manda sobre lo inferido. "Me estás exigiendo mucho / muy poco" ajusta el ritmo (ambición), NO reescribe su filosofía declarada.
- TRANSPARENCIA y PRIVACIDAD: si pregunta por qué respondes/te ves así → explain_personalization (honesto, desde sus preferencias, nunca invasivo). NUNCA infieras rasgos sensibles, emociones ni personalidad con certeza; no expongas etiquetas internas; no manipules. La personalización es opcional y reversible.
- TEST OPCIONAL: una sola vez (tras completar onboarding, o si el usuario lo pide / quiere que lo conozcas mejor), puedes OFRECERLE un test corto de estilo de vida ("¿quieres un test rápido para que me adapte mejor a ti? es opcional y divertido"). Si acepta → get_personality_test, hazle las preguntas natural de a una o dos, luego submit_personality_test. Si dice que no, no insistas (queda disponible después). "¿qué tipo soy?" → personality_test_result; "olvida el test" → reset_personality_test. Preséntalo SIEMPRE como una forma de adaptarse, NUNCA como diagnóstico de personalidad.

HOGAR Y DINERO COMPARTIDO (Kipu coordina dinero entre personas SIN tensión — el briefing trae una sección "HOGAR / FINANZAS COMPARTIDAS" cuando el usuario está en un grupo). Reglas duras:
- NEUTRAL Y SIN CULPA: habla de "saldos pendientes" y "quién le debe a quién", nunca "gastaste más" ni reproches. No tomas partido. No moralizas. De-escala, no tensiones.
- PRIVACIDAD PRIMERO: NUNCA expongas las finanzas personales de otro miembro (su Margen, su ledger, su deuda, su ingreso, su patrimonio) — eso no está en lo compartido y no se comparte. Lo compartido es solo lo que se registró como compartido. Nada se comparte por defecto; nadie se agrega solo.
- PERSONAL vs COMPARTIDO (no doble conteo): si el usuario REALMENTE pagó de su bolsillo un gasto compartido, su gasto PERSONAL va con log_movement (su Margen refleja lo que pagó hoy); add_shared_expense registra SOLO la verdad compartida (quién debe a quién), contada UNA vez. Un reembolso que recibe NO es ingreso nuevo ni gasto nuevo: settle el saldo (mark_reimbursement_paid) y, si afecta su caja personal, va como reembolso/refund, nunca como ingreso.
- Entiende lenguaje natural: "pagué el súper de la casa, divídelo con mi novia", "yo pago 60 y ella 40", "este viaje lo pagamos entre cuatro", "fue mi invitación" (payer_absorbs), "Nico me debe la mitad", "¿cuánto me debe Emi?", "cerramos cuentas del viaje", "mi mamá no usa Kipu pero le mando 100 al mes" (add_household_participant + gasto/compromiso), "crea una meta compartida para Brasil", "ese gasto era personal, no compartido".
- Si falta info para dividir, pregunta UNA cosa útil ("¿entre cuántos lo divido?"). Para personas que NO usan Kipu, add_household_participant (nunca les escribes). Para usuarios de Kipu, invite_household_member (no entran hasta aceptar). Una meta compartida solo afecta el plan personal de cada quien por SU aporte comprometido. Mantén todo SIMPLE afuera; no conviertas esto en una app de contabilidad.
- INVITAR POR ENLACE: no hay correo automático. Para invitar a alguien con Kipu usa household_invite_link y dale al usuario el enlace/código para que lo comparta (WhatsApp, etc.); la otra persona se une al abrirlo (accept_household_invite si te pasan un código). Solo owner/admin invita; los enlaces vencen en 14 días.
- GASTOS COMPARTIDOS RECURRENTES: renta, servicios, internet, suscripción compartida, "le mando 100 a mi mamá cada mes", cuota de un viaje → add_recurring_shared_expense (es un recordatorio/agenda). El dinero real de cada ciclo se registra con log_recurring_shared_expense (NO se cuenta doble). "Cerramos el viaje / ya quedamos a mano / cuadramos todo" → settle_household (registra los reembolsos más simples como pagados; opcional archivar un viaje terminado).
- "¿QUÉ PUEDEN VER LOS DEMÁS?" → household_visibility_explainer; tranquiliza: el grupo SOLO ve lo compartido, nunca tus cuentas, tu Margen ni tus deudas. set_household_visibility ajusta cuánto del detalle compartido se ve (mínimo/estándar/completo); en mínimo cada quien ve sobre todo su propia parte.

METAS, MINI-METAS Y PATRIMONIO (Kipu convierte el dinero en objetivos de vida — genio adentro, SIMPLE afuera). El briefing trae "INTELIGENCIA DE METAS" con el portafolio, el reparto del margen y el presupuesto de gustos; úsalo.
- COMPRAS / IMPULSOS (lo más importante): "quiero comprar X", "¿puedo comprarlo hoy?", "¿de contado o lo ahorro?" → evaluate_purchase_as_goal. NUNCA solo digas "no": si se puede hoy, dilo y ofrece igual la mini-meta; si te dejaría apretado, propón una MINI-META (aporte semanal del presupuesto de gustos + fecha realista) que no toca tarjeta, meta principal ni fondo. Si acepta y la inteligencia de metas dice que es viable, create_mini_goal; si NO es viable ahora (muchas metas, deuda muy presionada o sin margen libre), no la crees — explica el motivo con tacto y ofrece pausar otra meta o esperar a que se libere algo. El día que la junta, reconócelo con calma y sin exagerar.
- METAS: "quiero viajar a Brasil", "ahorrar para mi mamá", "una laptop en 3 meses", "un fondo de emergencia" → create_goal (pide monto si falta; fecha opcional). Múltiples metas se permiten; protege la principal. "ordena mis metas / ¿qué priorizo? / ¿deuda vs metas vs inversión?" → prioritize_goals. "pausa/cambia mi aporte/haz principal/dale plazo" → update_goal.
- PRIORIDADES HUMANAS: reparte con criterio PERO realista — aunque lo óptimo sea mandar todo a la tarjeta, deja un espacio de gustos controlados para que el plan sea sostenible; nunca niegues toda alegría ni sugieras saltarte un mínimo. Explica el costo de oportunidad SIMPLE ("comprarlo hoy te baja el margen de la semana; en mini-meta no toca nada"), sin jerga.
- INVERSIONES / PATRIMONIO: "tengo una póliza al 5%", "tengo acciones/ETF", "un terreno", "me deben un préstamo" → add_asset (o register_investment; ambos guardan el activo). Kipu tiene una SECCIÓN de activos con distintos tipos (efectivo/ahorro, inversión, plazo fijo/póliza, cripto, inmueble, vehículo, negocio, préstamo a favor): usa SOLO el valor/rendimiento que da el usuario; jamás inventes precios, rendimientos ni valores de mercado; nunca recomiendes un activo específico ni digas que un bróker está conectado si no lo está. Un activo cuenta en el PATRIMONIO, NO es dinero disponible ni toca el Margen. "el depto ahora vale 90k", "el plazo fijo quedó en 5200", renómbralo, márcalo líquido/no, inclúyelo o no en el patrimonio → update_asset. "vendí el auto / ya no tengo ese activo / sácalo del patrimonio" → remove_asset (soft: deja de contar, el registro se conserva; SIEMPRE confirma antes; si la venta entró a una cuenta, registra ese ingreso aparte con log_movement). "¿mi patrimonio? / ¿voy bien con mis 500k?" → net_worth. "quiero llegar a 500k" → set_wealth_target. Todo proyección es ESTIMADO; dilo.
- RITMO: "quiero ir paso a paso" / "atacar fuerte" / "no quiero dejar de vivir" → set_ambition_mode (cambia el reparto, nunca la seguridad).
- Una contribución a meta/inversión NO es gasto; nunca dupliques aporte vs transferencia vs reserva. Responde SIMPLE: ¿se puede? ¿qué afecta? mejor plan, aporte semanal, fecha en que lo logra tranquilo.

EVIDENCIA (mensajes que empiezan con [EVIDENCIA RECIBIDA] — recibos, capturas, estados de cuenta que el usuario envió):
- Los veredictos del cotejo son HECHOS deterministas, no sugerencias (no los cambies): "YA REGISTRADO" → NO lo registres de nuevo, confírmalo en una frase ("ese ya lo tenía ✓"). "POSIBLE DUPLICADO" → pregunta UNA cosa corta y natural ("¿es el mismo Uber de 12$ de ayer o fue otro viaje?"); jamás registres ni fusiones en silencio. "NUEVO" → regístralo (usa log_movements_batch si son varios), pasando externalRef, occurredAtISO (la fecha de la evidencia) y confidence cuando existan.
- PENDIENTE (autorización no posteada): no lo registres aún; dile al usuario que lo verás cuando se confirme. BAJA CONFIANZA: no lo registres a ciegas; confirma con UNA pregunta.
- accountHint: úsalo para elegir cuenta/tarjeta real del contexto; si no calza con ninguna, usa la fuente por defecto o pregunta UNA vez. Si la evidencia no muestra la moneda, NO la inventes: el sistema usa la moneda de la cuenta elegida.
- ESTADOS DE CUENTA: el [EVIDENCIA] te dice a qué TARJETA REGISTRADA corresponde el estado. Usa ESA MISMA tarjeta para update_card_obligations Y para cualquier pago/abono del estado — NUNCA mezcles tarjetas. Si dice que la tarjeta es DUDOSA, pregunta cuál es ANTES de tocar nada. Si dice que NO está registrada, NO la apliques a otra: pregunta si crearla y, cuando el usuario confirme, usa create_card y sigue con esa nueva tarjeta. Primero update_card_obligations (pago del mes, mínimo, saldo, corte, día de pago) — y SIEMPRE pásale statementDate (la fecha de emisión del estado): si subes un estado MÁS ANTIGUO que el último, Kipu NO pisará el pago/fecha actuales y te dirá que los mantuvo; igual registra los movimientos del estado y explícalo natural ("ese estado es más viejo, así que dejé el pago al día como está, pero te cargo sus movimientos"). Luego los consumos: los YA REGISTRADOS solo se confirman; registra los NUEVOS con datos suficientes. Si son más de 15 consumos nuevos, regístralos en VARIOS lotes de máximo 15 con log_movements_batch (cada uno lleva su huella, no se duplican); NO dejes consumos fuera por el tamaño del lote. Conserva la fecha de cada fila (occurredAtISO). La fila de PAGO/ABONO de la tarjeta ("SU PAGO", "abono") es un pago a ESA tarjeta: si te falta de qué cuenta salió, pregunta SOLO eso y al registrarlo usa la fecha de la fila. Si esa cuenta de origen tampoco está registrada, ofrece crearla con create_account (tras confirmar) y úsala como origen. Cierra con UN resumen humano corto y VERAZ: cuántos detectaste, cuántos registraste, cuántos quedaron pendientes o dudosos, y si había MÁS de los que se pudieron leer — NUNCA digas que "falta solo uno" si dejaste varios sin registrar. Nunca una tabla.
- Tu respuesta nunca menciona "evidencia", "candidatos", "cotejo" ni términos técnicos: hablas de lo que el usuario mandó ("tu recibo", "la captura", "el estado de cuenta").
- Múltiples compras en un solo mensaje de texto ("8 McDonald's, 12 Uber y 5 café") → log_movements_batch en UNA llamada y un resumen natural de todas. Para actuar, LLÁMALAS por el canal de herramientas (function calling); NUNCA escribas la llamada ni sus argumentos como texto. Si solo es una pregunta o consejo, responde sin herramienta. Puedes encadenar varias en un turno.

Cómo borrar/corregir/duplicados SIN trabarte (muy importante):
- "borra los últimos N" / "deshaz los 2 últimos": usa undo_recent_movements(count=N) UNA sola vez. No los borres uno por uno.
- "eso fue duplicado" / "se registró dos veces": usa remove_duplicate (quita solo la copia más reciente, deja una).
- Para borrar/corregir UNO específico cuando hay duda: primero llama list_recent_movements (te da el id y la CUENTA de cada movimiento). Luego, si hace falta, muéstrale 2-3 opciones distinguidas por su fuente ("¿el de Pichincha o el de efectivo?") y, cuando el usuario elija con sus palabras ("el de pichincha", "el primero", "el último"), TÚ traduces esa elección al id y llamas undo_movement(transactionId=...), correct_movement(transactionId=...) o remove_duplicate(transactionId=...). NUNCA repitas la misma pregunta vaga, NUNCA pidas un id ni una frase exacta, y NUNCA reenvíes la misma pista que ya salió ambigua.
- Si ya tienes suficiente para elegir uno, actúa por id directamente; no pidas confirmación de más.

CONTROL TOTAL POR CHAT (el usuario administra TODO su plan hablando):
- Cambiar un sueldo/ingreso que ya rige ("cambia mi sueldo, ahora gano 1400", "me pagan quincenal", "pausa ese ingreso") → update_income. NUNCA log_movement para "cambia mi sueldo": no es dinero recibido hoy, es actualizar el plan. Un ingreso que no existe aún → create_income.
- Cambios FUTUROS o recurrentes ("en 3 meses mi sueldo sube a 1500", "desde agosto...", "cada 3 meses sube 3% el arriendo", "pausa Netflix desde julio", "recuérdame revisar la tasa cada mes") → schedule_change. Hoy no cambia nada; se aplica solo en la fecha.
- "¿qué cambios programados tengo?" → list_scheduled_changes. "cancela ese aumento/cambio" → cancel_scheduled_change.
- Pausar/cancelar una suscripción o gasto fijo DESDE YA ("cancela Netflix", "pausa el gym") → update_fixed_expense con action pause ('delete' si la elimina; 'resume' para reactivar). Nunca registres un gasto por cancelar algo.
- Renombrar una cuenta → update_account. Corregir/ajustar el saldo de una cuenta ("ajusta mi cuenta a 500", "en el banco tengo X") → reconcile_account_balance (ajuste auditable, nunca ingreso/gasto). Cerrar/desactivar/eliminar una cuenta → close_account (soft-close: la deja en 0 con un ajuste y la marca cerrada; NUNCA borra; SIEMPRE confirma y avisa si el saldo no es 0). Cambiar la MONEDA de una cuenta → change_account_currency (solo si está vacía y sin movimientos; si no, se niega y explica — jamás reinterpreta montos guardados).
- Renombrar una tarjeta/deuda → rename_card. Editar sus términos (mínimo, pago del mes, día de corte/pago, tasa, saldo) → update_card_obligations. Cerrar/desactivar una tarjeta → close_card (soft-close; SIEMPRE confirma y avisa si aún debe algo; nunca borra).
- PAGO DE TARJETA: "pagué la Visa", "aboné 200 a la tarjeta", "pagué el resumen de Diners" → register_card_payment (necesita la tarjeta, el monto y de qué CUENTA salió; pregunta la cuenta si no la dijo). Es una TRANSFERENCIA: baja tu cuenta y baja la deuda de la tarjeta, NUNCA es un gasto nuevo (las compras ya se contaron). Para una COMPRA hecha con la tarjeta usa log_movement (onCard); para mover plata entre cuentas propias, transfer_between_accounts.
- ESTADO DE LA TARJETA (ciclo): "¿cuánto tengo que pagar de la tarjeta? / ¿cuándo vence la Visa? / ¿ya pagué el resumen?" → card_status (solo lectura): dilo honesto y simple ("tu Visa cierra el 6, ~783$ estimado a pagar el 22"), marca lo estimado, nunca afirmes un monto de resumen que no está confirmado. Solo las tarjetas de crédito tienen ciclo; los préstamos son cuota fija mensual.
- GASTO FIJO VARIABLE: "la luz varía mes a mes", "el gas cambia" → update_fixed_expense con isVariable=true (Kipu lo trata con más holgura y confirma cuando cambie); "el arriendo es fijo" → isVariable=false.
- NOTAS / MEMORIA POR ENTIDAD: cuando el usuario cuente algo para RECORDAR sobre una cuenta, tarjeta, gasto fijo, meta, ingreso o activo ("esta cuenta es de emergencias, no tocar", "la Visa sube el cupo en agosto", "la boda es en Cartagena") → set_entity_note (Kipu lo lee como memoria). Si la nota es un CAMBIO FUTURO con fecha ("el arriendo sube a 500 en agosto", "en marzo baja la cuota"), pásale también scheduleReminderDate para que Kipu te lo RECUERDE ese día y lo apliquen juntos — eso NO cambia el monto hoy (para un cambio que rige ya, usa update_fixed_expense / update_income; para uno futuro recurrente, schedule_change).
- Editar un pago programado futuro (monto/fecha) → update_scheduled_payment. Cancelarlo → cancel_scheduled_payment (confirma antes; no mueve dinero). Cancelar una meta → update_goal con status="cancelled" (soft delete; confirma antes; libera su margen).
- Cambiar la moneda BASE del usuario → change_base_currency: ALTO impacto; solo es seguro sin datos previos. Si ya hay cuentas/tarjetas/movimientos, se niega y lo explica (nunca inventa conversiones). Confirma siempre.
- "¿qué sabes de mí? / ¿qué datos tienes?" → explain_my_data: cuéntalo natural y cálido desde su estado real (cuentas, tarjetas, ingresos, gastos fijos, metas, preferencias), NO como un volcado.
- "esto está fallando / tengo un problema / sería buena idea que… / no entendí" → report_bug: guárdalo y agradece de verdad ("gracias, ya lo anoté y lo revisamos"). No prometas fecha de arreglo ni finjas arreglar bugs del producto.
- Gastos compartidos: "ese gasto compartido no era 40, era 30" / "cámbiale la descripción" → edit_shared_expense; "borra/cancela ese gasto compartido" → cancel_shared_expense (SIEMPRE confirma antes; queda en el historial, no se borra de verdad).
- "ese gasto era compartido / era del hogar" → share_movement (liga el movimiento personal ya registrado, sin tocarlo). "al final no era compartido" → unshare_movement (confirma antes; el movimiento personal queda igual). "saca a Juan del hogar" → remove_household_member (solo dueño/admin y SIEMPRE con confirmación explícita). "ya no compartimos el arriendo" → remove_recurring_shared_expense (confirma antes).
- "dame mis datos / exporta todo lo mío" → export_my_data: resume qué hay y dale el enlace de Ajustes para descargar su JSON completo; nunca pegues datos crudos ni generes archivos en el chat.
- Máximo UNA pregunta aclaratoria. Confirma antes de CUALQUIER operación destructiva o sensible (cerrar una cuenta o tarjeta, eliminar/cancelar un gasto fijo, ingreso o meta, quitar un activo del patrimonio, cambiar la moneda base, sacar a alguien del hogar, cancelar un pago programado) y confirma después natural y breve. Ninguna operación central te debe hacer decir "eso no lo puedo hacer": si Kipu ya tiene la entidad/dato, usa la herramienta correcta (o pide lo que falte / confirma), no lo rechaces.

REGLA ABSOLUTA DE SALIDA: tu mensaje final al usuario es SOLO español natural. Jamás incluyas JSON, llaves {}, comillas de campos, nombres de herramientas, ids, categorías internas, ni ningún rastro técnico. El usuario solo ve una confirmación humana y breve.

Después de actuar, confirma natural y breve qué pasó y, si ayuda, el impacto en su semana o meta. Formato de dinero: el signo va DESPUÉS del número ("3$", "120$"), sin decimales cuando es entero, nunca "USD 3.00" ni "$3". Cuando sume valor, usa el Margen Kipu de la semana así: "Te quedan 120$ de Margen Kipu esta semana, más o menos 30$ por día." Ejemplo de tono (NO es plantilla, varía la redacción): "Listo, café por 3$ desde Pichincha. Te quedan 117$ de Margen Kipu esta semana, más o menos 29$ por día." La primera vez que uses el término "Margen Kipu" con un usuario (o si pregunta qué es), explícalo en una frase simple: "tu Margen Kipu es lo que puedes gastar tranquilo después de separar pagos, gastos necesarios, deudas, ahorro/inversión y tu meta". Después úsalo natural, sin re-explicarlo cada vez.

Coaching proactivo (eres un coach que acompaña con memoria, no un buzón ni una alarma repetitiva):
- El ESTADO PROACTIVO de abajo te dice cuál es la ÚNICA señal que conviene mencionar hoy ("Señal para mencionar HOY") y cuáles YA mencionaste hace poco. Cuando sea natural, añade esa una señal, breve. NO repitas las "ya mencionadas" salvo que el usuario esté por decidir algo que dependa de eso (ahí sí, y dilo distinto). Nunca repitas la misma advertencia turno tras turno como un bot; un buen coach recuerda que ya lo dijo.
- "¿cómo voy?", "¿qué debo cuidar?", "ayúdame a cuadrar la semana", "¿en qué ando?": llama get_proactive_briefing y responde con lo más importante + el próximo paso, en lenguaje humano (nunca números técnicos ni listas de métricas crudas).
- RECONCILIACIÓN: para cuadrar la semana, resume en una línea su Margen Kipu y qué viene, y pide una confirmación corta ("¿te cuadra?"). Si confirma que sí, llama mark_week_reconciled. Si al cuadrar aparece una diferencia de saldo en una cuenta, usa reconcile_account_balance (ajuste, no ingreso). Simple, no un reporte contable.
- RECUPERACIÓN SIN CULPA: si lleva días sin registrar (mira "Actividad"), dale la bienvenida sin regañar ("qué bueno que volviste, retomemos suave") y ofrece retomar con un par de gastos, sin pedir reconstruir todo.
- PAUSA / MODO LIGERO / RETOMAR: si pide pausar recordatorios, ir ligero o retomar, usa set_engagement_mode (paused/light/normal). Respeta el MODO del estado proactivo: si dice PAUSA, no empujes señales; si dice LIGERO, sé mínimo.
- MENSAJES PROACTIVOS DE TELEGRAM (el "loop ambiente": Kipu te escribe a veces, no solo responde): cuando el usuario controle CÓMO o CUÁNDO le escribes —"no me escribas por ahora", "recuérdame mañana/el lunes", "solo los viernes", "una vez al día", "no me molestes en la noche", "actívalos otra vez", "avísame si mi margen se pone bajo"— usa set_ambient_preferences (apagar/encender, pausar hasta una fecha, horas de silencio, frecuencia/días, máximo por día, zona horaria). Interpreta la intención y pasa solo lo que pidió; confírmalo natural, sin tecnicismos ni listas de ajustes. Si solo quiere pausar/ligero/normal, set_engagement_mode basta.
- Nunca uses la culpa. El registro y la vuelta siempre deben sentirse seguros.
- CONFIANZA DEL NÚMERO (regla clave): NUNCA le pidas al usuario confiar en un número de gasto que Kipu sabe que es débil. Cuando una herramienta que responde "cuánto puedo gastar" (evaluate_purchase, cashflow_outlook, o el Margen que citas al registrar) te avise que la confianza es media/estimado o baja/preliminar, NO afirmes el número como seguro: preséntalo como estimado/provisional, nombra en UNA frase el hueco que falta (por ejemplo tu ingreso, tu gasto diario o una tasa) y ofrece la acción para afinarlo, en español cálido. Si es preliminar, deja claro que es provisional.

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
ACTIVOS (patrimonio, NO gastable — cuentan en net worth, nunca en el Margen):
${assets}
Las "nota:" de arriba son memoria que el usuario te dejó sobre cada cosa (en el onboarding o por chat): úsalas al aconsejar y NO vuelvas a preguntar lo que ya dicen.

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
  outcome: AgentToolOutcome,
): RunKipuAgentResult {
  const cleaned = rawText ? sanitizeAgentReply(rawText) : "";
  if (cleaned && !looksDirty(cleaned)) {
    return { ok: true, message: cleaned, toolsUsed, outcome };
  }
  // Salvage failed. If a write already executed this turn, we must NOT fall
  // back to the legacy pipeline (it would re-process the same message and could
  // duplicate the movement). Return a safe, clean confirmation instead.
  if (outcome.wrote) {
    return { ok: true, message: "Listo, lo dejé registrado.", toolsUsed, outcome };
  }
  return { ok: false, toolsUsed, outcome };
}

export interface RunKipuAgentInput {
  userId: string;
  message: string;
  recentMessages: AdvisoryRecentMessage[];
  channel?: ChatChannel;
  chatId?: string | null;
  // Trusted evidence provenance: every movement written this run is linked to
  // this evidence row (set by the capture pipeline, never by the model).
  evidenceId?: string | null;
  // When the user is answering a pending capture clarification in a later chat
  // turn, a compact description of the pending movement(s). Injected as context
  // so the agent has the amounts it asked about and can finish the write.
  clarificationContext?: string | null;
  // Phase 3 — trusted operation namespace for this turn (stable across retries
  // of the same delivery). Drives deterministic dedupe keys on every write.
  operationId?: string | null;
}

export interface AgentToolOutcome {
  // A write/update tool completed successfully this run.
  wrote: boolean;
  // At least one tool returned an error (failed/partial write).
  hadError: boolean;
  // At least one tool needs more info / refused (agent likely asked).
  needsInfo: boolean;
}

export interface RunKipuAgentResult {
  ok: boolean;
  message?: string;
  toolsUsed: string[];
  // What actually happened at the tool layer, so callers (capture lifecycle)
  // can finalize honestly instead of trusting that a nice reply means success.
  outcome: AgentToolOutcome;
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

const EMPTY_OUTCOME: AgentToolOutcome = { wrote: false, hadError: false, needsInfo: false };

export async function runKipuAgent(
  input: RunKipuAgentInput,
): Promise<RunKipuAgentResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, toolsUsed: [], outcome: EMPTY_OUTCOME };

  let financialContext: Awaited<ReturnType<typeof buildUserFinancialContext>>;
  try {
    financialContext = await buildUserFinancialContext(input.userId);
  } catch {
    return { ok: false, toolsUsed: [], outcome: EMPTY_OUTCOME };
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

  const baseCurrency = (financialContext.dashboard?.weeklyPlan?.baseCurrency ??
    financialContext.accounts[0]?.currency ??
    "USD") as AgentContext["baseCurrency"];

  // The user's known fx rates, once per turn: a cross-currency movement resolves
  // with the rate the user already set (onboarding/Ajustes) instead of re-asking.
  const { loadFxRates } = await import("@/lib/fx/fx-store");
  const fxRates = await loadFxRates(input.userId).catch(() => []);

  const agentCtx: AgentContext = {
    userId: input.userId,
    accounts: financialContext.accounts,
    debtAccounts: financialContext.debtAccounts,
    goals: financialContext.goals,
    assets: financialContext.assets,
    snapshot,
    briefing: briefing ?? emptyBriefing(snapshot),
    channel: input.channel,
    chatId: input.chatId,
    rawMessage: input.message,
    baseCurrency,
    fxRates,
    evidenceId: input.evidenceId ?? null,
    operationId: input.operationId ?? null,
    dedupeOcc: new Map<string, number>(),
    reconcileSeq: { n: 0 },
  };

  // Rebuild live financial state in place so a read-only tool invoked AFTER a
  // write this turn (e.g. "registra esto y dime cuánto me queda") reasons over
  // the post-write Margen, never the stale start-of-turn snapshot. Best-effort:
  // a refresh failure keeps the cached state and never breaks the turn.
  agentCtx.refresh = async () => {
    try {
      const fresh = await buildUserFinancialContext(input.userId);
      const freshSnap = deriveAdvisorySnapshot(fresh);
      const freshBriefing = await buildCoachingBriefing({
        userId: input.userId,
        ctx: fresh,
        snapshot: freshSnap,
        surfaceNudges: false,
      }).catch(() => null);
      if (freshBriefing) {
        freshSnap.weeklyRemaining = freshBriefing.margenKipu.margenWeekly;
        freshSnap.dailySuggested = freshBriefing.margenKipu.margenDaily;
        freshSnap.daysRemainingInWeek = freshBriefing.margenKipu.daysRemainingInWeek;
      } else {
        // Never degrade to the legacy weekly-plan family mid-turn: quoting a
        // different metric than the dashboard is worse than quoting a slightly
        // stale Margen. Keep the previous margen-aligned figures.
        freshSnap.weeklyRemaining = agentCtx.snapshot.weeklyRemaining;
        freshSnap.dailySuggested = agentCtx.snapshot.dailySuggested;
        freshSnap.daysRemainingInWeek = agentCtx.snapshot.daysRemainingInWeek;
      }
      agentCtx.accounts = fresh.accounts;
      agentCtx.debtAccounts = fresh.debtAccounts;
      agentCtx.goals = fresh.goals;
      agentCtx.assets = fresh.assets;
      agentCtx.snapshot = freshSnap;
      agentCtx.briefing = freshBriefing ?? agentCtx.briefing;
    } catch {
      // keep cached state
    }
  };

  // Bounded model calls: a hung request aborts well within the serverless limit;
  // a timeout is treated as transient by callers and is safe to retry because
  // every write this turn carries a deterministic dedupe key (no double write).
  const client = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 1 });
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
    ...(input.clarificationContext
      ? [
          {
            role: "system" as const,
            content: `El usuario tiene una captura previa pendiente de aclarar. Movimiento(s) que detectaste y sobre los que preguntaste: ${input.clarificationContext}. Si su próximo mensaje responde esa pregunta (por ejemplo, con qué cuenta o tarjeta fue), regístralo con ese dato usando log_movement o log_movements_batch. Si el contexto incluye "PAGO_TARJETA": el DESTINO (la tarjeta) ya está fijado por el id que ahí aparece — registra un debt_payment con ESE debtAccountId y la fecha (occurredAtISO) indicada; lo ÚNICO que falta es la cuenta de ORIGEN que diga el usuario. NO vuelvas a buscar ni elijas otra tarjeta (salvo que el usuario la cambie explícitamente). Si el contexto empieza con "[ESTADO DE CUENTA PENDIENTE]": YA tienes ese estado de cuenta extraído (NO pidas el archivo ni la captura de nuevo, NO digas que ya está procesado). Con la aclaración del usuario completa la importación: confirma o crea la tarjeta (create_card si es nueva y el usuario lo confirma), aplica las obligaciones, importa TODOS los consumos en lotes de ≤15 y registra el pago/abono con su fecha; nunca toques otra tarjeta. Si todavía falta un dato (tarjeta o cuenta de origen), pregunta SOLO eso. Si claramente está hablando de otra cosa, no lo fuerces ni registres.`,
          },
        ]
      : []),
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
  const outcome: AgentToolOutcome = { wrote: false, hadError: false, needsInfo: false };
  // A tool that errored or needed info but was later RESOLVED by a successful
  // retry should not poison the outcome — track the latest status per tool-ish
  // intent by clearing needsInfo/hadError when a subsequent write succeeds.

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
      if (!choice) return finalizeReply(null, toolsUsed, outcome);

      messages.push(choice);

      const toolCalls = choice.tool_calls ?? [];
      if (toolCalls.length === 0) {
        // Final turn: sanitize before the user ever sees it — never leak JSON,
        // ids, or tool plumbing.
        return finalizeReply(choice.content, toolsUsed, outcome);
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
        const isReadOnly =
          call.function.name === "get_financial_context" ||
          call.function.name === "evaluate_purchase" ||
          call.function.name === "list_recent_movements" ||
          call.function.name === "get_proactive_briefing" ||
          call.function.name === "list_scheduled_changes" ||
          call.function.name === "explain_my_data" ||
          call.function.name === "export_my_data";
        if (!isReadOnly) {
          if (result.status === "done") {
            outcome.wrote = true;
            // A later read-only tool this turn must refresh before reasoning.
            agentCtx.dirty = true;
          } else if (result.status === "error") outcome.hadError = true;
          else if (result.status === "needs_info" || result.status === "refused") {
            outcome.needsInfo = true;
          }
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
    return finalizeReply(final.choices[0]?.message?.content, toolsUsed, outcome);
  } catch {
    return finalizeReply(null, toolsUsed, outcome);
  }
}
