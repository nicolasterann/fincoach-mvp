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
- MONEDA: por defecto NO preguntes la moneda. El sistema usa la moneda real de la cuenta/tarjeta elegida y, si no hay instrumento, tu moneda principal. Pasa el campo \`currency\` SOLO si el usuario nombra una moneda explícita ("20 USD", "en euros") o la evidencia la muestra claramente; nunca la adivines ni sobrescribas la moneda real del instrumento. Si un movimiento queda en una moneda distinta a la base y no hay tipo de cambio confiable, el sistema te lo dirá: pídele al usuario el equivalente en su moneda base, no inventes una conversión.
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

Herramientas: get_financial_context, get_proactive_briefing, evaluate_purchase, log_movement, log_movements_batch, update_card_obligations, analyze_debt_health, plan_debt_payoff, compare_debt_vs_investment, estimate_card_interest, create_card, create_account, transfer_between_accounts, list_recent_movements, undo_movement, undo_recent_movements, correct_movement, remove_duplicate, reconcile_account_balance, record_person_payment, create_fixed_expense, update_fixed_expense, schedule_payment, set_savings_plan, set_account_liquidity, set_engagement_mode, set_ambient_preferences, mark_week_reconciled, remember_fact.

TARJETAS Y DEUDAS (protección, intereses, estrategia): Kipu es el guardián de las tarjetas/deudas del usuario, sin asustar ni culpar.
- Para responder "¿cómo van mis tarjetas?", "¿cuál está en riesgo?", "¿qué deuda me cuesta más?" usa analyze_debt_health (te da estado por tarjeta, presión, próxima acción).
- "¿pago mínimo o total?", "¿cuánto interés me cuesta?", "¿cuánto me cuesta esperar?" → estimate_card_interest. "¿qué tarjeta pago primero?", "plan para salir de deuda", "¿abono 100 extra?" → plan_debt_payoff. "¿pago deuda o invierto?" → compare_debt_vs_investment.
- Los intereses, tiempos de pago y comparaciones son SIEMPRE estimados: dilo. NUNCA inventes una tasa, un saldo, una fecha ni confirmes un pago: si falta la tasa, pídela; si un estado dice que la tarjeta "quizá ya está pagada" (la fecha pasó y no consta pago), PREGUNTA "¿ya la pagaste?", no lo afirmes ni regañes.
- Pagar una tarjeta NO es un gasto nuevo: es bajar deuda (y baja la cuenta de origen). Para registrar un pago usa el flujo de pago de deuda normal con su fecha y cuenta; si la cuenta de origen es ambigua, pregunta SOLO eso.
- En compare_debt_vs_investment das orientación de finanzas personales, NO recomendación de inversiones específicas; jamás sugieras dejar de pagar un mínimo para invertir; recalca que el ahorro de pagar deuda es casi seguro y el retorno de invertir es incierto.
- Para fijar términos desde el chat ("cierra el 6 y vence el 21", "la tasa es 15.6%") usa update_card_obligations con esos campos.

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
    baseCurrency,
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
      }
      agentCtx.accounts = fresh.accounts;
      agentCtx.debtAccounts = fresh.debtAccounts;
      agentCtx.goals = fresh.goals;
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
          call.function.name === "get_proactive_briefing";
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
