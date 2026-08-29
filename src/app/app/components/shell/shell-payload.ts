import "server-only";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import {
  buildCoachingBriefing,
  KipuSaldoUnavailableError,
  type CoachingBriefing,
} from "@/lib/financial/coaching-signals";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { formatDateEs } from "@/lib/format/dates-es";
import { makeDayKey } from "@/lib/financial/margen-kipu";
import { loadCurrentFxRatesForDisplay } from "@/lib/fx/fx-store";
import { convert } from "@/lib/fx/fx-rates";
import { findThreadTurnForTransaction } from "@/lib/chat-memory/thread-view";
import {
  readOpenOccurrences,
  type OpenOccurrencesRead,
} from "@/lib/financial/recurring-occurrences-store";
import { loadSnapshotSeriesRead } from "@/lib/trends/snapshot-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  SHELL_TIMING_GROUPS,
  formatServerTiming,
  type ServerTimingMark,
  type ShellTimingMilestone,
  type ShellTimingTramo,
} from "@/lib/metro/metro-contract";
import {
  briefedRead,
  debtCycleCardsFrom,
  debtCycleLevel,
  goalsLevel,
  goalsPlannedFrom,
  metasRead,
  orbTargetReached,
  patrimonioRead,
  reserveLevel,
  reserveTargetFrom,
  wealthLevel,
  wealthTargetFrom,
} from "./shell-orb-contract";
import { describeMovement } from "../app-dashboard-helpers";
import { buildShellPillLines } from "./shell-dialog-contract";
import {
  buildShellPerspective,
  type ShellPerspective,
} from "./shell-perspective";

export type ShellStatus = "ok" | "niebla";
export type OrbKind = "saldo" | "reserva" | "metas" | "patrimonio" | "deuda";

export interface ShellOrb {
  kind: OrbKind;
  amountLabel: string | null;
  amountRaw: number | null;
  subtitle: string;
  level: number | null;
  levelNote: string | null;
  emptyInvite: string | null;
  /** N2 ronda 2 · El veredicto de LECTURA del motor para esta capa. `false` es
   * «no sé», y sólo entonces el orbe se dibuja interrumpido. Sin esto, el orbe
   * tenía que adivinar qué significaba un monto ausente — y en el día uno
   * adivinaba mal: dibujaba «no pude leer» junto a un texto que invitaba a
   * crear la primera meta. */
  readOk: boolean;
}

export interface ShellDawn {
  levelFrom: number;
  fillLabel: string;
  dayKey: string;
}

export interface ShellMovement {
  timeLabel: string;
  label: string;
  amountLabel: string;
  turnId: string | null;
}

/** N1 · La segunda tanda: la píldora y la cinta. Llega cuando llega; el orbe
 * nunca la espera. */
export interface ShellLater {
  pillLine: string | null;
  pillLines: string[];
  lastMovement: ShellMovement | null;
  /** «No pude leer» ≠ «no hay nada»: con esto en `true` la cinta se dibuja como
   * `sin-dato`, jamás como una cinta vacía y jamás como un cero. */
  lastMovementReadFailed: boolean;
  serverTiming: string | null;
}

/** N1 · La tercera tanda: la perspectiva. */
export interface ShellPerspectiveLater {
  perspective: ShellPerspective | null;
  readFailed: boolean;
  serverTiming: string | null;
}

export interface ShellPayload {
  status: ShellStatus;
  orbs: ShellOrb[];
  runwayLine: string | null;
  greetingName: string | null;
  dawn: ShellDawn | null;
  /** N0 · el metro. La cabecera `Server-Timing` ya formateada. Es MEDICIÓN, no
   * dato financiero: nadie decide nada con ella y su ausencia se lee `—`,
   * jamás `0`. Aquí viajan sólo los tramos del CAMINO CRÍTICO DEL ORBE. */
  serverTiming: string | null;
  /** N1 · promesas, no valores: el servidor devuelve el orbe en cuanto lo tiene
   * y transmite el resto cuando esté. El cliente las abre con `use()` dentro de
   * una frontera `<Suspense>`; ninguna de las dos puede rechazar. */
  later: Promise<ShellLater>;
  perspective: Promise<ShellPerspectiveLater>;
}

interface RecentMovementRow {
  id: string;
  description: string;
  category: string | null;
  base_amount: number | string;
  base_currency: string;
  type: string;
  occurred_at: string;
  debt_account_id: string | null;
  goal_id: string | null;
}

const subtitles: Record<OrbKind, string> = {
  saldo: "Disponible hoy",
  reserva: "Tu respaldo",
  metas: "Por aportar este mes",
  patrimonio: "Patrimonio total",
  deuda: "Te falta pagar",
};

function clampLevel(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// N0 · el metro del servidor. `timed` envuelve cada await SIN tocar el curso:
// devuelve exactamente lo que devuelve el tramo y deja pasar cualquier throw
// (el `finally` registra igual, así que un tramo que falla también se mide).
// Las marcas viven en un array LOCAL de la invocación: no hay estado de
// módulo, así que ninguna medición puede cruzarse entre peticiones.
type ShellTimer = ReturnType<typeof shellTimer>;
type ShellClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function shellTimer() {
  const startedAt = performance.now();
  const marks: ServerTimingMark[] = [];
  return {
    async timed<T>(name: ShellTimingTramo, run: () => Promise<T>): Promise<T> {
      const from = performance.now();
      try {
        return await run();
      } finally {
        marks.push({ name, ms: performance.now() - from });
      }
    },
    /** N1 · la cabecera de UNA tanda: sus tramos más el hito, que dice cuántos
     * ms pasaron desde que arrancó el builder hasta que la tanda estuvo lista.
     * Los tramos se filtran por nombre porque varios corren EN PARALELO: un
     * grupo no puede llevarse la medición de otro. */
    milestone(name: ShellTimingMilestone): string {
      const belongs = new Set<string>(SHELL_TIMING_GROUPS[name]);
      return formatServerTiming([
        ...marks.filter((mark) => belongs.has(mark.name)),
        { name, ms: performance.now() - startedAt },
      ]);
    },
  };
}


// ── N1 · Las lecturas DECORATIVAS ─────────────────────────────────────────────
//
// Una lectura es FATAL cuando, si falta, una cifra mentiría. Todo lo demás es
// decorativo y DEGRADA: se dice que no se pudo leer y la pantalla se dibuja
// entera. Antes de N1 `shell-payload.ts` hacía lo contrario en el peor sitio —
// `if (movementError) throw movementError` tumbaba el santuario completo por
// fallar la lectura del ÚLTIMO MOVIMIENTO, un dato decorativo.
//
// La regla que no se relaja: degradar nunca puede inventar un número. Estas dos
// funciones jamás rechazan y jamás devuelven un cero para tapar un hueco.

interface PrefsRead {
  prefs: {
    emergency_reserve_target?: unknown;
    /** N3B · el techo de Patrimonio, declarado por el usuario. Misma fila. */
    wealth_target?: unknown;
  } | null;
  prefsError: boolean;
}

/**
 * N2 §5.5 · Esta lectura ENTRA al camino crítico del orbe, porque de aquí sale
 * el denominador de Reserva. Por eso dejó de ir en el mismo `Promise.all` que
 * las ocurrencias abiertas: el orbe espera la fila de preferencias (una lectura
 * de una sola fila por `user_id`) y NO espera nada más.
 *
 * Sigue sin agregar una consulta: son las dos mismas de antes, sólo que ya no
 * se esperan juntas.
 */
async function readPrefs(
  metro: ShellTimer,
  clientPromise: Promise<ShellClient>,
  userId: string,
): Promise<PrefsRead> {
  try {
    const supabase = await clientPromise;
    const { data: prefs, error: prefsError } = await metro.timed(
      "preferencias",
      async () =>
        await supabase
          .from("user_financial_preferences")
          // N3B · Patrimonio gana techo con la MISMA lectura: dos columnas de
          // la fila que ya se estaba trayendo. Cero consultas nuevas, cero
          // migraciones — las dos columnas existen desde antes de este bloque.
          .select("emergency_reserve_target, wealth_target")
          .eq("user_id", userId)
          .maybeSingle(),
    );
    return { prefs, prefsError: Boolean(prefsError) };
  } catch {
    return { prefs: null, prefsError: true };
  }
}

/** Sólo alimenta la píldora: se queda FUERA del camino crítico del orbe. */
async function readPending(
  metro: ShellTimer,
  userId: string,
): Promise<OpenOccurrencesRead> {
  try {
    return await metro.timed("pendientes", () => readOpenOccurrences(userId));
  } catch {
    return { ok: false, complete: false };
  }
}

interface MovementRead {
  row: RecentMovementRow | null;
  turnId: string | null;
  /** `true` = NO se pudo leer. Distinto de `row === null`, que es «no hay». */
  readFailed: boolean;
}

async function readLastMovement(
  metro: ShellTimer,
  clientPromise: Promise<ShellClient>,
  userId: string,
  now: Date,
): Promise<MovementRead> {
  try {
    const supabase = await clientPromise;
    const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const { data: recentRows, error: movementError } = await metro.timed(
      "movimiento",
      async () =>
        await supabase
          .from("transactions")
          .select("id, description, category, base_amount, base_currency, type, occurred_at, debt_account_id, goal_id")
          .eq("user_id", userId)
          .gte("occurred_at", since)
          .order("occurred_at", { ascending: false })
          .limit(1),
    );
    // N1 · aquí vivía `throw movementError`.
    if (movementError) return { row: null, turnId: null, readFailed: true };
    const row = ((recentRows ?? []) as RecentMovementRow[])[0] ?? null;
    if (!row) return { row: null, turnId: null, readFailed: false };
    const turnId = await metro.timed("recibo", () =>
      findThreadTurnForTransaction({
        client: supabase,
        userId,
        transactionId: row.id,
      }).catch(() => null),
    );
    return { row, turnId, readFailed: false };
  } catch {
    return { row: null, turnId: null, readFailed: true };
  }
}

/** Niebla: el motor no pudo afirmar el saldo. Las dos tandas se resuelven
 * vacías al instante — el santuario ya dice «no puedo leer tu saldo ahora» y
 * ninguna de las dos puede quedarse colgada esperando lo que no va a venir. */
function fogPayload(
  greetingName: string | null,
  serverTiming: string | null,
): ShellPayload {
  const kinds: OrbKind[] = ["saldo", "reserva", "metas", "patrimonio", "deuda"];
  return {
    status: "niebla",
    orbs: kinds.map((kind) => ({
      kind,
      amountLabel: null,
      amountRaw: null,
      subtitle: subtitles[kind],
      level: null,
      levelNote: null,
      emptyInvite: null,
      // Niebla = el motor no pudo afirmar el saldo. Las cinco capas se dibujan
      // interrumpidas porque eso es exactamente lo que pasó.
      readOk: false,
    })),
    runwayLine: null,
    greetingName,
    dawn: null,
    serverTiming,
    later: Promise.resolve({
      pillLine: null,
      pillLines: [],
      lastMovement: null,
      lastMovementReadFailed: false,
      serverTiming: null,
    }),
    perspective: Promise.resolve({
      perspective: null,
      readFailed: false,
      serverTiming: null,
    }),
  };
}

function movementTime(iso: string, timezone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Ahora";
  return new Intl.DateTimeFormat("es-419", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(date);
}

export async function buildShellPayload(userId: string): Promise<ShellPayload> {
  const metro = shellTimer();
  const now = new Date();

  // N1 · Lo que el ORBE necesita es `contexto` + `briefing` + `cotizaciones`.
  // Todo lo demás arranca AHORA, en paralelo, y se entrega cuando esté: nada de
  // esto puede volver a retrasar la cifra. Cada promesa atrapa su propio fallo,
  // así que ninguna puede quedar sin manejar cuando el `redirect` de más abajo
  // interrumpe el camino principal.
  const clientPromise = metro.timed("cliente", () => createSupabaseServerClient());
  const ratesPromise = metro
    .timed("cotizaciones", () => loadCurrentFxRatesForDisplay(userId))
    // Sin tasas, `display` cae a la moneda base — que es la verdad de la fila,
    // no un número inventado. El `.catch` cumple además un papel de higiene: si
    // el `redirect` de abajo corta el camino, esta promesa ya está atendida y no
    // queda un rechazo suelto.
    .catch(() => []);
  const prefsPromise = readPrefs(metro, clientPromise, userId);
  const pendingPromise = readPending(metro, userId);
  const movementPromise = readLastMovement(metro, clientPromise, userId, now);

  const ctx = await metro.timed("contexto", () =>
    buildUserFinancialContext(userId),
  );
  if (!ctx.mainGoal || ctx.accounts.length === 0 || !ctx.dashboard) {
    redirect("/onboarding");
  }

  const greetingName = ctx.profile.fullName?.split(" ")[0] || null;
  const snapshot = deriveAdvisorySnapshot(ctx);
  let briefing: CoachingBriefing;
  try {
    briefing = await metro.timed("briefing", () =>
      buildCoachingBriefing({
        userId,
        ctx,
        snapshot,
        surfaceNudges: false,
      }),
    );
  } catch (error) {
    if (error instanceof KipuSaldoUnavailableError) {
      return fogPayload(greetingName, metro.milestone("orbe"));
    }
    throw error;
  }

  const rates = await ratesPromise;
  const display = makeDisplayFormatter(
    ctx.profile.baseCurrency,
    ctx.profile.displayCurrency,
    rates,
  );
  const displayRaw = (amount: number): number => {
    const target = ctx.profile.displayCurrency;
    if (!target || target === ctx.profile.baseCurrency) return amount;
    const converted = convert(amount, ctx.profile.baseCurrency, target, rates);
    return converted.ok ? converted.baseAmount : amount;
  };
  const saldo = briefing.margenKipu.saldo;
  const metasLayers = saldo.layers.filter(
    (layer) => layer.kind === "metas" || layer.kind === "ahorro_inversion",
  );
  const monthlyProtected = briefing.margenKipu.capacity.monthlyProtected;
  const hasMetasEntity =
    ctx.goals.length > 0 ||
    ctx.assets.length > 0 ||
    monthlyProtected.savings > 0 ||
    monthlyProtected.investment > 0 ||
    briefing.goalsIntel.investment != null;
  // N2 ronda 2 (O1) · La lectura y el monto salen JUNTOS del contrato puro, con
  // el mismo veredicto que abajo elige entre invitar y disculparse. Antes el
  // monto era `null` para dos cosas opuestas y el orbe elegía la peor.
  const metas = metasRead({
    reservedTotal: metasLayers.length
      ? metasLayers.reduce((sum, layer) => sum + (layer.amount ?? 0), 0)
      : null,
    hasEntity: hasMetasEntity,
    assetsAvailable: ctx.assetsAvailable,
  });
  const metasAmount = metas.amount;
  const patrimonio = patrimonioRead({
    netWorth: briefing.goalsIntel.netWorth?.totalNetWorth,
    wealthAvailable: briefing.goalsIntel.wealthAvailable,
  });
  const patrimonioAmount = patrimonio.amount;
  const debtAmount = briefing.debtHealth.totalDebt;

  // M6 — one bounded history read after the briefing has archived today's
  // snapshot. Its typed result keeps an outage distinct from a new user with
  // fewer than two recorded days.
  // N1 — sigue corriendo DESPUÉS del briefing por esa misma razón, pero ya no
  // antes del primer píxel: esta tanda se promete y llega la última.
  const primaryGoal = briefing.goalsIntel.portfolio.primary;
  const perspectivePromise: Promise<ShellPerspectiveLater> = (async () => {
    const { prefs, prefsError } = await prefsPromise;
    const snapshotRead = await metro.timed("historia", () =>
      loadSnapshotSeriesRead(userId, 18, now.getTime()),
    );
    const perspective = buildShellPerspective({
      today: {
        spent: saldo.todaySpent,
        fill: saldo.todayFill,
        objectives: briefing.objectives.states.map((objective) => ({
          category: objective.category,
          label: objective.labelEs,
          spent: objective.spentMTD,
          objective: objective.objectiveBase,
          crossed: objective.crossed,
          projectedCrossDateISO: objective.projectedCrossDateISO,
        })),
      },
      month: {
        income: briefing.margenKipu.capacity.monthlyIncome,
        fixed: briefing.margenKipu.capacity.monthlyFixed,
        debt: briefing.margenKipu.capacity.monthlyDebtService,
        installments: briefing.margenKipu.capacity.monthlyInstallments,
        essentials: briefing.margenKipu.capacity.monthlyEssentials,
        savings: briefing.margenKipu.capacity.monthlyProtected.savings,
        investment: briefing.margenKipu.capacity.monthlyProtected.investment,
        goals: briefing.margenKipu.capacity.monthlyProtected.goals,
        free: briefing.margenKipu.capacity.monthlyTrulyFree,
      },
      history: {
        ok: snapshotRead.ok,
        snapshots: snapshotRead.snapshots,
        todayISO: makeDayKey(ctx.profile.timezone)(now),
      },
      progress: {
        primaryGoal: primaryGoal
          ? {
              name: primaryGoal.goal.name,
              current: primaryGoal.goal.currentAmount,
              target: primaryGoal.goal.targetAmount,
              percent:
                primaryGoal.goal.targetAmount > 0
                  ? primaryGoal.progressPct
                  : null,
            }
          : null,
        reserve: {
          readOk: !prefsError,
          amount: saldo.reserva,
          // N2 ronda 2 (O2) · La misma derivación vivía DOS veces —aquí y en el
          // orbe— y sólo una pasaba por el contrato. Ahora hay un único dueño de
          // «cuál es la meta de respaldo», y el gate lo ejecuta.
          target: reserveTargetFrom({
            prefsError,
            raw: prefs?.emergency_reserve_target,
          }),
        },
        debt: { amount: debtAmount },
        wealth: {
          readOk: briefing.goalsIntel.wealthAvailable,
          amount: patrimonioAmount,
        },
      },
      upcoming: {
        cards: briefing.cardsDueSoon.map((card) => ({
          name: card.name,
          inDays: card.inDays,
          balance: card.balance,
          due: card.due,
        })),
        payments: briefing.upcomingPayments,
      },
      formatMoney: display,
    });
    return {
      perspective,
      readFailed: false,
      serverTiming: metro.milestone("perspectiva"),
    };
  })().catch(() => ({
    // Degradar NUNCA puede inventar un número: la perspectiva ilegible se dice,
    // no se rellena con ceros.
    perspective: null,
    readFailed: true,
    serverTiming: null,
  }));

  // ── N2 §5.3 · Un denominador honesto por capa ─────────────────────────────
  // Los tres YA ESTÁN en memoria: nada de esto agrega una consulta. Reserva sale
  // de la fila de preferencias (tramo `preferencias`, ahora en el grupo del
  // orbe), Metas del briefing y Deuda del contexto.
  const { prefs, prefsError } = await prefsPromise;
  const reserveTarget = reserveTargetFrom({
    prefsError,
    raw: prefs?.emergency_reserve_target,
  });
  const reserva = reserveLevel({ amount: saldo.reserva, target: reserveTarget });

  // N3B · El techo de Patrimonio (revierte D-N2). Sin techo declarado no hay
  // nivel y la materia cambia sola a cristal: Kipu NO inventa un techo.
  const wealthTarget = wealthTargetFrom({
    prefsError,
    raw: prefs?.wealth_target,
  });
  const patrimonioNivel = wealthLevel({
    amount: patrimonioAmount,
    target: wealthTarget,
  });

  // El numerador de Metas suma las capas `metas` Y `ahorro_inversion`, así que
  // el denominador tiene que sumar las tres partidas protegidas del mes. Usar
  // sólo `.goals` daría niveles por encima del 100 %.
  const metasNivel = goalsLevel({
    pending: metasAmount,
    planned: goalsPlannedFrom(monthlyProtected),
  });

  // OJO — `briefing.debtHealth.cards` NO trae la cobertura del corte. El camino
  // es `ctx.debtAccounts`, que sí. Y las cifras se comparan en la moneda NATIVA
  // de cada tarjeta: `fullPaymentDue` viene reexpresado a base por el builder de
  // contexto, que preserva el nativo en `fullPaymentDueOriginal`.
  const deuda = debtCycleLevel(debtCycleCardsFrom(ctx.debtAccounts));
  // Las tres capas cuyo veredicto es «llegar hasta aquí»: si el briefing no
  // pudiera afirmar el saldo, esto no se estaría ejecutando.
  const briefed = briefedRead(0);

  const orbs: ShellOrb[] = [
    {
      kind: "saldo",
      amountLabel: display(saldo.saldo),
      amountRaw: displayRaw(saldo.saldo),
      subtitle: subtitles.saldo,
      level: saldo.cap > 0 ? clampLevel(saldo.saldo / saldo.cap) : null,
      levelNote: null,
      readOk: briefed.ok,
      emptyInvite:
        saldo.saldo <= 0.005
          ? `Vacío hasta mañana — vuelven ${display(saldo.fillDaily)} al amanecer.`
          : null,
    },
    {
      kind: "reserva",
      amountLabel: display(saldo.reserva),
      amountRaw: displayRaw(saldo.reserva),
      subtitle: subtitles.reserva,
      level: reserva.level,
      levelNote: reserva.note,
      readOk: briefed.ok,
      emptyInvite:
        saldo.reserva <= 0.005
          ? "Tu respaldo se construye solo, mes a mes. Pregúntame cómo."
          : // N3B · La misma regla que Patrimonio, y por el mismo motivo: sin
            // techo declarado el orbe no inventa uno, lo pregunta; y al llegar
            // ofrece el siguiente, que es lo que pidió el founder.
            reserveTarget == null
            ? "¿Cuánto quieres tener de respaldo? Dímelo y te muestro cuánto llevas."
            : orbTargetReached({ amount: saldo.reserva, target: reserveTarget })
              ? "Llegaste a tu meta de respaldo. ¿Subimos la vara?"
              : null,
    },
    {
      kind: "metas",
      amountLabel: metasAmount == null ? null : display(metasAmount),
      amountRaw: metasAmount == null ? null : displayRaw(metasAmount),
      subtitle: subtitles.metas,
      level: metasNivel.level,
      levelNote: metasNivel.note,
      readOk: metas.ok,
      // Las tres frases son las de siempre; lo que cambió es de qué dependen.
      // Antes ramificaban sobre `metasAmount == null`, que significaba dos cosas
      // opuestas a la vez.
      emptyInvite: !metas.ok
        ? "No puedo confirmar tus metas e inversiones ahora."
        : !hasMetasEntity && metasLayers.length === 0
          ? "¿Armamos tu primera meta? Cuéntame qué sueñas."
          : (metasAmount ?? 0) <= 0.005
            ? "No queda aporte reservado este mes."
            : null,
    },
    {
      kind: "patrimonio",
      amountLabel: patrimonioAmount == null ? null : display(patrimonioAmount),
      amountRaw: patrimonioAmount == null ? null : displayRaw(patrimonioAmount),
      subtitle: subtitles.patrimonio,
      level: patrimonioNivel.level,
      levelNote: patrimonioNivel.note,
      readOk: patrimonio.ok,
      emptyInvite: !patrimonio.ok
        ? "No puedo leer tu patrimonio ahora. Intenta de nuevo."
        : briefing.goalsIntel.netWorth == null
          ? "Aún no hay un patrimonio para mostrar. Cuéntame qué tienes y qué debes."
          : // Sin techo declarado el orbe no inventa uno: lo PREGUNTA. Es la
            // otra mitad de la decisión del founder — antes te dejaba con un
            // cristal que no se entendía.
            wealthTarget == null
            ? "¿A cuánto quieres llegar? Dime tu meta de patrimonio y te muestro cuánto llevas."
            : orbTargetReached({ amount: patrimonioAmount, target: wealthTarget })
              ? "Llegaste a tu meta de patrimonio. ¿Ponemos una nueva?"
              : null,
    },
    {
      kind: "deuda",
      amountLabel: display(debtAmount),
      amountRaw: displayRaw(debtAmount),
      subtitle: subtitles.deuda,
      level: deuda.level,
      levelNote: deuda.note,
      readOk: briefed.ok,
      emptyInvite:
        briefing.debtHealth.hasAnyDebt
          ? null
          : "Sin deudas registradas. Si tienes una tarjeta, dímelo y la cuidamos juntos.",
    },
  ];

  // N1 · La segunda tanda: la píldora y la cinta. Se promete; el orbe ya se fue.
  const laterPromise: Promise<ShellLater> = (async () => {
    const [pendingRead, movementRead] = await Promise.all([
      pendingPromise,
      movementPromise,
    ]);
    const nextCommitment = saldo.nextPayment
      ? `${saldo.nextPayment.label} · ${display(saldo.nextPayment.amount)} · ${formatDateEs(saldo.nextPayment.dateISO)}`
      : null;
    const openOccurrences = pendingRead.ok
      ? pendingRead.complete
        ? pendingRead.occurrences
        : pendingRead.partial
      : [];
    const pillLines = buildShellPillLines({
      pending: pendingRead.ok
        ? {
            ok: true,
            first: openOccurrences[0]
              ? {
                  kind: openOccurrences[0].kind,
                  dateLabel: formatDateEs(openOccurrences[0].occurrenceDate),
                }
              : null,
          }
        : { ok: false },
      nextCommitment,
      signals: briefing.signals,
    });
    const movementView = movementRead.row
      ? describeMovement(movementRead.row, {
          displayCurrency: ctx.profile.displayCurrency,
          rates,
        })
      : null;
    const movementSign =
      movementView?.tone === "out" ? "−" : movementView?.tone === "in" ? "+" : "";
    return {
      pillLine: nextCommitment,
      pillLines,
      lastMovement:
        movementRead.row && movementView
          ? {
              timeLabel: movementTime(
                movementRead.row.occurred_at,
                ctx.profile.timezone,
              ),
              label: movementView.title,
              amountLabel: `${movementSign}${movementView.amount}`,
              turnId: movementRead.turnId,
            }
          : null,
      lastMovementReadFailed: movementRead.readFailed,
      serverTiming: metro.milestone("pill"),
    };
  })().catch(() => ({
    // El mismo criterio: si esta tanda entera se cae, se DICE que no se pudo
    // leer el movimiento; no se finge una cinta vacía ni una píldora en cero.
    pillLine: null,
    pillLines: [],
    lastMovement: null,
    lastMovementReadFailed: true,
    serverTiming: null,
  }));

  return {
    status: "ok",
    orbs,
    runwayLine:
      saldo.mode === "runway"
        ? saldo.runwayDays != null
          ? `Sin ingreso activo: tu plata cubre ~${saldo.runwayDays} días al ritmo actual.`
          : "Sin ingreso activo: registra tu ingreso para calcular tu Saldo."
        : null,
    greetingName,
    dawn:
      saldo.todayFill > 0 && saldo.cap > 0
        ? {
            levelFrom: clampLevel((saldo.saldo - saldo.todayFill) / saldo.cap),
            fillLabel: display(saldo.todayFill),
            dayKey: makeDayKey(ctx.profile.timezone)(new Date()),
          }
        : null,
    serverTiming: metro.milestone("orbe"),
    later: laterPromise,
    perspective: perspectivePromise,
  };
}

/** The action consumes the same context→snapshot→briefing chain as the shell.
 * This is deliberately server-only: a successful write without a publishable
 * denominator produces null and therefore cannot move the orb. */
export async function readShellSaldoLevel(userId: string): Promise<number | null> {
  const ctx = await buildUserFinancialContext(userId);
  if (!ctx.mainGoal || ctx.accounts.length === 0 || !ctx.dashboard) return null;
  try {
    const briefing = await buildCoachingBriefing({
      userId,
      ctx,
      snapshot: deriveAdvisorySnapshot(ctx),
      surfaceNudges: false,
    });
    const saldo = briefing.margenKipu.saldo;
    return saldo.cap > 0 ? clampLevel(saldo.saldo / saldo.cap) : null;
  } catch (error) {
    if (error instanceof KipuSaldoUnavailableError) return null;
    throw error;
  }
}
