import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { formatDateEs } from "@/lib/format/dates-es";
import { loadFxRatesForDisplay } from "@/lib/fx/fx-store";
import { findRate } from "@/lib/fx/fx-rates";
import { DisplayCurrencyToggle } from "./components/DisplayCurrencyToggle";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { MovementRow } from "./components/MovementRow";
import { UpcomingCommitmentsCard } from "./components/UpcomingCommitmentsCard";
import { HouseholdCard, FxCard } from "./components/DashboardCards";
import { Chevron, PressCard } from "./components/living/shell";
import {
  SaldoKipuHero,
  HoyCard,
  ReservaCard,
  MetaPrincipalCard,
  ProximoPagoCard,
  AccionCard,
  pickAccion,
} from "./components/SaldoKipu";
import { describeMovement } from "./components/app-dashboard-helpers";

// Stage D — the redesigned home. Organized around CONCRETE information, no
// scores, no state section, no metric grid (per the founder's design spec):
//   Principal:  Saldo Kipu (hero) · Hoy · Lo que viene
//   Secundario: Reserva · Meta principal · Próximo pago
// Text appears only when there is a decision or action (AccionCard). The
// financial detail lives one tap away in /app/saldo — never around the hero.

// Known ?message codes → calm human copy. Anything else renders NOTHING (raw
// codes or DB errors never leak into the UI).
const NOTICES: Record<string, { text: string; tone: "emerald" | "amber" | "zinc" }> = {
  "onboarding-completed": {
    text: "¡Listo! Kipu ya conoce tu plata. Este es tu Resumen.",
    tone: "emerald",
  },
  "onboarding-already-completed": {
    text: "Ya habías completado tu configuración.",
    tone: "zinc",
  },
  "goal-contribution-created": { text: "Aporte registrado ✓", tone: "emerald" },
  "goal-contribution-fx-missing": {
    text: "Ese aporte cruza monedas y no tengo la tasa — configúrala en Ajustes → Tipo de cambio.",
    tone: "amber",
  },
};

const NOTICE_TONE_CLASSES: Record<"emerald" | "amber" | "zinc", string> = {
  emerald: "border-emerald-400/25 bg-emerald-950/50 text-emerald-100",
  amber: "border-amber-400/25 bg-amber-950/40 text-amber-100",
  zinc: "border-line/10 bg-zinc-900 text-zinc-300",
};



export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  // hasOwnProperty guard: ?message=constructor must not hit inherited keys.
  const notice =
    message && Object.prototype.hasOwnProperty.call(NOTICES, message) ? NOTICES[message] : undefined;
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const ctx = await buildUserFinancialContext(session.user.id);

  if (!ctx.mainGoal || ctx.accounts.length === 0 || !ctx.dashboard) {
    redirect("/onboarding");
  }

  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const { data: recentTransactions } = await supabase
    .from("transactions")
    .select("id, description, category, base_amount, base_currency, type, occurred_at, debt_account_id, goal_id, related_transaction_id")
    .eq("user_id", session.user.id)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(200);

  const { mainGoal, dashboard } = ctx;
  const baseCurrency = ctx.profile.baseCurrency;
  // Stage 24 — WEB-ONLY display currency: re-express base numbers at READ time.
  const displayCurrency = ctx.profile.displayCurrency; // undefined => native no-op
  const manualRates = await loadFxRatesForDisplay(session.user.id);
  const disp = makeDisplayFormatter(baseCurrency, displayCurrency, manualRates);
  const firstName = ctx.profile.fullName?.split(" ")[0] ?? "";
  const txList = recentTransactions ?? [];

  // Same engine as the chat coach → home and chat can't disagree. Read-only.
  const snapshot = deriveAdvisorySnapshot(ctx);
  const briefing = await buildCoachingBriefing({
    userId: session.user.id,
    ctx,
    snapshot,
    surfaceNudges: false,
  });
  const mk = briefing.margenKipu;
  const s = mk.saldo;

  // ONE action, only when something concrete needs the user (never a score).
  const accion = pickAccion({
    transferAlerts: briefing.transferAlerts,
    marginGaps: mk.marginGaps,
    formatMoney: disp,
  });

  const runwayLine =
    s.mode === "runway"
      ? s.runwayDays != null
        ? `Sin ingreso activo: tu plata cubre ~${s.runwayDays} días al ritmo actual.`
        : "Sin ingreso activo: registra tu ingreso para calcular tu Saldo."
      : null;

  // FX surface only when the user actually touches a non-base currency.
  const codeSet = new Set<string>(
    ctx.accounts.map((a) => a.currency).filter((c): c is typeof baseCurrency => Boolean(c) && c !== baseCurrency),
  );
  for (const r of manualRates) {
    if (r.from && r.from !== baseCurrency) codeSet.add(r.from as typeof baseCurrency);
    if (r.to && r.to !== baseCurrency) codeSet.add(r.to as typeof baseCurrency);
  }
  const fx =
    codeSet.size > 0
      ? {
          base: baseCurrency,
          lines: Array.from(codeSet).map((code) => {
            const r = findRate(code, baseCurrency, manualRates);
            return { code, rateToBase: r ? Math.round(r.rate * 10000) / 10000 : null, source: r?.source ?? null };
          }),
        }
      : null;
  const altCurrency = Array.from(codeSet)[0] ?? null;
  const toggleHasRate = altCurrency ? findRate(baseCurrency, altCurrency, manualRates) != null : false;

  const household = briefing.household.households[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-5xl pb-28 lg:pb-12">
      {/* Greeting */}
      <header className="kipu-fade-up flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-zinc-500">Tu plata, en calma</p>
          <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-zinc-50">
            {firstName ? `Hola, ${firstName}` : "Hola"}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {altCurrency && (
            <DisplayCurrencyToggle
              base={baseCurrency}
              alt={altCurrency}
              active={displayCurrency ?? baseCurrency}
              hasRate={toggleHasRate}
            />
          )}
          <Link
            href="/app/settings"
            aria-label="Ajustes"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line/10 text-zinc-400 transition hover:border-line/20 hover:text-zinc-200"
          >
            <svg aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.3 3.3a1.5 1.5 0 0 1 3.4 0l.2 1.1a7 7 0 0 1 1.7 1l1-.5a1.5 1.5 0 0 1 1.9 2l-.5 1a7 7 0 0 1 0 2l.5 1a1.5 1.5 0 0 1-1.9 2l-1-.5a7 7 0 0 1-1.7 1l-.2 1.1a1.5 1.5 0 0 1-3.4 0l-.2-1.1a7 7 0 0 1-1.7-1l-1 .5a1.5 1.5 0 0 1-1.9-2l.5-1a7 7 0 0 1 0-2l-.5-1a1.5 1.5 0 0 1 1.9-2l1 .5a7 7 0 0 1 1.7-1Z"
              />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          </Link>
          <Link
            href="/app/chat"
            className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
          >
            Hablar con Kipu
          </Link>
        </div>
      </header>

      {/* One-shot notice from a redirect (?message=...) — known codes only */}
      {notice && (
        <div
          className={`kipu-fade-up mt-5 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${NOTICE_TONE_CLASSES[notice.tone]}`}
        >
          <p className="text-sm font-medium leading-6">{notice.text}</p>
          <Link
            href="/app"
            aria-label="Cerrar aviso"
            className="-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold opacity-50 transition hover:opacity-100"
          >
            ✕
          </Link>
        </div>
      )}

      {/* Engagement banner — tapping it lands in chat to retomar */}
      {briefing.engagementMode !== "normal" && (
        <Link
          href="/app/chat"
          className="kipu-press group mt-5 flex items-center justify-between gap-3 rounded-2xl border border-line/10 bg-zinc-900 px-4 py-3 hover:border-line/20"
        >
          <p className="text-xs font-medium text-zinc-400">
            {briefing.engagementMode === "paused"
              ? "Recordatorios en pausa. Cuando quieras, retomamos suave."
              : "Modo ligero activo. Te acompaño sin insistir."}
          </p>
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-400">
            Hablar con Kipu
            <Chevron />
          </span>
        </Link>
      )}

      {/* Two calm columns on desktop; single stack on mobile */}
      <div className="mt-5 flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6">
        {/* Principal: Saldo Kipu · Hoy · Lo que viene */}
        <div className="kipu-stagger flex min-w-0 flex-col gap-5">
          <SaldoKipuHero
            saldo={s}
            amountLabel={disp(s.saldo)}
            runwayLine={runwayLine}
          />

          {accion && <AccionCard text={accion.text} href={accion.href} />}

          <HoyCard
            fillLabel={disp(s.todayFill)}
            spentLabel={disp(s.todaySpent)}
            spentIsZero={s.todaySpent <= 0}
          />

          <UpcomingCommitmentsCard
            baseCurrency={baseCurrency}
            cardsDueSoon={briefing.cardsDueSoon}
            upcomingPayments={briefing.upcomingPayments}
            displayCurrency={displayCurrency}
            rates={manualRates}
            hasCommitmentsConfigured={
              ctx.fixedExpenses.some((f) => f.isActive) || ctx.debtAccounts.length > 0
            }
          />
        </div>

        {/* Secundario: Reserva · Meta principal · Próximo pago (+ Tu mes + actividad) */}
        <div className="kipu-stagger flex min-w-0 flex-col gap-5">
          <ReservaCard amountLabel={disp(s.reserva)} />

          <MetaPrincipalCard
            name={mainGoal.name}
            progressPct={dashboard.goalProgress.progressPercentage}
            amountLine={`${disp(mainGoal.currentAmount)} de ${disp(mainGoal.targetAmount)}`}
          />

          {s.nextPayment && (
            <ProximoPagoCard
              name={s.nextPayment.label}
              amountLabel={disp(s.nextPayment.amount)}
              dateLabel={formatDateEs(s.nextPayment.dateISO)}
            />
          )}

          {/* "Tu mes": the PLANNING number keeps its own home. Verb is repartir
              (never "gastar" — that's the Saldo hero). */}
          <PressCard href="/app/mes" className="px-5 py-4" ariaLabel="Tu mes: cómo se reparte y cuánto queda libre">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-300">Tu mes</p>
                <p className="mt-1 text-sm leading-5 text-zinc-400">
                  Libre para repartir{" "}
                  <span className="font-bold text-emerald-300">
                    {disp(Math.max(0, mk.capacity.monthlyTrulyFree))}
                  </span>
                  /mes
                </p>
                {/* Stage H — the pre-cliff pace line (REQUIRED design): the
                    day-~22 tank drop must never arrive unannounced. Crossed
                    wins over pacing; one compact line, engine numbers only. */}
                {(() => {
                  const st =
                    briefing.objectives.states.find((o) => o.crossed) ??
                    briefing.objectives.states.find((o) => o.projectedCrossDateISO) ??
                    null;
                  if (!st) return null;
                  return (
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      {st.crossed ? (
                        <>
                          {st.labelEs}: cruzaste tu objetivo — lo que sigue sale de tu Saldo
                        </>
                      ) : (
                        <>
                          {st.labelEs}: {disp(st.spentMTD)} de {disp(st.objectiveBase)} · a este ritmo lo cruzas el{" "}
                          {Number(st.projectedCrossDateISO!.slice(8, 10))}
                        </>
                      )}
                    </p>
                  );
                })()}
              </div>
              <Chevron className="shrink-0 text-lg" />
            </div>
          </PressCard>

          <section className="rounded-3xl border border-line/5 bg-zinc-900 p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-300">Actividad reciente</p>
              <Link href="/app/activity" className="text-xs font-semibold text-emerald-400">
                Ver todo
              </Link>
            </div>
            {txList.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-zinc-600">
                Aún no hay movimientos. Cuéntale a Kipu tu primer gasto o ingreso.
              </p>
            ) : (
              <div className="mt-1 divide-y divide-line/5">
                {txList.slice(0, 4).map((tx) => (
                  <MovementRow
                    key={tx.id}
                    href="/app/activity"
                    view={describeMovement(tx, { displayCurrency, rates: manualRates })}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Concrete extras only when they exist: shared money + currencies */}
      {(household || fx) && (
        <div className="kipu-fade-up mt-5 flex flex-col gap-4">
          {household && (
            <HouseholdCard
              name={household.name}
              nextAction={household.nextAction}
              toPay={household.myToPay}
              toCollect={household.myToCollect}
              pendingReimbursements={household.pendingReimbursements}
              sharedGoal={
                household.sharedGoals[0]
                  ? { name: household.sharedGoals[0].name, progressPct: household.sharedGoals[0].progressPct }
                  : null
              }
              baseCurrency={baseCurrency}
              displayCurrency={displayCurrency}
              rates={manualRates}
            />
          )}
          {fx && <FxCard base={fx.base} lines={fx.lines} />}
        </div>
      )}
    </div>
  );
}
