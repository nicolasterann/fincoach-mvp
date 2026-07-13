import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { makeDisplayFormatter, formatDisplay } from "@/lib/financial/display-money";
import { loadFxRates } from "@/lib/fx/fx-store";
import { formatDateEs } from "@/lib/format/dates-es";
import { formatKipuMoney } from "@/lib/financial/money";
import type { CurrencyCode } from "@/types/financial";
import { Chevron, MetricShell, Section, ChatCta } from "../components/living/shell";

// Stage F — "Dónde está tu plata": the treasury page. One glance answers where
// the money physically lives, where it SHOULD be (each account's operational
// floor), and the exact moves to get ordered. Recommend-only: every "ya lo
// hice" goes through the chat agent, which registers the real transfer with
// all its FX/money-safety guards. Wellness DNA: calm, no scores, no jargon.

export default async function CuentasPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const ctx = await buildUserFinancialContext(session.user.id);
  if (!ctx.dashboard) redirect("/onboarding");

  const snapshot = deriveAdvisorySnapshot(ctx);
  const [briefing, manualRates] = await Promise.all([
    buildCoachingBriefing({ userId: session.user.id, ctx, snapshot, surfaceNudges: false }),
    loadFxRates(session.user.id),
  ]);
  const disp = makeDisplayFormatter(ctx.profile.baseCurrency, ctx.profile.displayCurrency, manualRates);
  // Each account speaks its OWN currency here (a peso account in pesos, a dollar
  // account in dollars) — "dónde está tu plata" is a physical, per-account
  // question. Aggregates (Saldo, Reserva, total) stay in base. base→native, no
  // invented rate.
  const nat = (amount: number, currency: string) =>
    formatDisplay(amount, ctx.profile.baseCurrency, currency as CurrencyCode, manualRates);
  const t = briefing.treasury;
  const s = briefing.margenKipu.saldo;

  if (t.accounts.length < 2) {
    return (
      <div className="mx-auto w-full max-w-3xl pb-28 lg:pb-12">
        <MetricShell kicker="Cuentas" title="Dónde está tu plata" />
        <section className="kipu-fade-up mt-5 rounded-3xl border border-line/5 bg-zinc-900 p-6">
          <p className="text-sm leading-6 text-zinc-400">
            Hoy toda tu plata líquida vive en un solo lugar, así que no hay nada que ordenar entre cuentas.
            Cuando registres más cuentas, aquí verás dónde debería estar cada peso y qué movimientos hacer.
          </p>
          <Link href="/app/mis-datos" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-emerald-400 hover:text-emerald-300">
            Agregar una cuenta
            <Chevron />
          </Link>
        </section>
      </div>
    );
  }

  const maxScale = Math.max(...t.accounts.map((a) => Math.max(a.balance, a.floor)), 1);
  // The chat prefill speaks BASE currency (the agent's money contract) — disp()
  // is display-only and would re-express the amount for display-toggle users.
  const chatMove = (m: { amount: number; fromName: string; toName: string }) =>
    `/app/chat?share=${encodeURIComponent(`Ya moví ${formatKipuMoney(m.amount, ctx.profile.baseCurrency)} de ${m.fromName} a ${m.toName}`)}`;

  return (
    <div className="mx-auto w-full max-w-3xl pb-28 lg:pb-12">
      <MetricShell kicker="Cuentas" title="Dónde está tu plata" />

      {/* Hero: real vs piso, one glance = where there's extra and where it's short */}
      <section className="kipu-fade-up mt-5 rounded-3xl border border-line/5 bg-gradient-to-b from-zinc-900 to-zinc-950 p-6 sm:p-8">
        <div className="space-y-5">
          {t.accounts.filter((a) => a.balance > 0.5 || a.floor > 0.5 || a.surplus < -0.5).map((a) => {
            const short = a.surplus < 0;
            const balancePct = Math.max(2, Math.round((a.balance / maxScale) * 100));
            const floorPct = Math.min(100, Math.round((a.floor / maxScale) * 100));
            const idealRow = t.ideal.find((i) => i.accountId === a.accountId);
            // Schedule-aware: urge only the NEXT tranche (what's due next), with
            // the full-cycle total as context — never the whole month on the
            // first date (consistent with the move card below).
            const urgent = a.shortfallSchedule[0];
            const totalShort = a.shortfallSchedule.reduce((x, tr) => x + tr.amount, 0);
            return (
              <div key={a.accountId}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-zinc-200">
                    {a.name}
                    {a.deadPocket && <span className="ml-2 rounded-full border border-line/10 px-2 py-0.5 text-[10px] font-medium text-zinc-500">por mover</span>}
                  </p>
                  <p className={`shrink-0 text-sm font-bold tabular-nums ${short ? "text-amber-300" : "text-zinc-100"}`}>
                    {nat(a.balance, a.currency)}
                  </p>
                </div>
                <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-line/8">
                  <div
                    className={`kipu-rise h-full rounded-full ${short ? "bg-amber-400/80" : "bg-emerald-400/80"}`}
                    style={{ width: `${balancePct}%` }}
                  />
                  {a.floor > 0 && (
                    <div
                      className="absolute top-0 h-full w-0.5 bg-zinc-100/70"
                      style={{ left: `${floorPct}%` }}
                      aria-hidden
                    />
                  )}
                </div>
                <p className="mt-1.5 text-[11px] leading-4 text-zinc-600">
                  {short ? (
                    <>
                      te faltan <span className="font-semibold text-amber-300">{nat(urgent ? urgent.amount : Math.abs(a.surplus), a.currency)}</span> para{" "}
                      {urgent?.obligations[0] ?? a.nextObligations[0] ?? "tus pagos"}
                      {(urgent?.byDateISO ?? a.firstShortfallDateISO) ? ` · antes del ${formatDateEs((urgent?.byDateISO ?? a.firstShortfallDateISO)!)}` : ""}
                      {a.shortfallSchedule.length > 1 ? ` (de ${nat(totalShort, a.currency)} en el ciclo)` : ""}
                    </>
                  ) : a.floor > 0.5 ? (
                    <>
                      necesita {nat(a.floor, a.currency)} para tus pagos · te queda libre {nat(Math.max(0, a.surplus), a.currency)}
                      {idealRow && Math.abs(idealRow.amount - a.balance) > 5
                        ? ` · lo ideal sería ${nat(idealRow.amount, a.currency)} acá`
                        : " · está bien acá"}
                    </>
                  ) : (
                    <>sin pagos propios pronto · {nat(a.balance, a.currency)} libre acá</>
                  )}
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-5 border-t border-line/5 pt-4 text-xs leading-5 text-zinc-600">
          La línea clara es el piso de cada cuenta: lo que necesita para sus pagos de los próximos días,
          con un colchoncito. Por encima de los pisos queda tu plata libre — de ahí salen tu gasto del día a día
          que viene, tu Saldo y tu Reserva.
        </p>
      </section>

      {/* The exact moves */}
      {t.moves.length > 0 && (
        <Section kicker="Para ordenarte hoy" className="mt-6">
          <div className="space-y-3">
            {t.moves.map((m, i) => {
              // Schedule-aware: the move urges only the NEXT tranche. If the
              // destination has later tranches this cycle, show them softly +
              // the "or all at once" total, in the destination's own currency.
              const dest = t.accounts.find((a) => a.accountId === m.toAccountId);
              const destCur = dest?.currency ?? ctx.profile.baseCurrency;
              const sched = dest?.shortfallSchedule ?? [];
              const later = sched.slice(1).filter((tr) => tr.amount > 0.5);
              const total = sched.reduce((x, tr) => x + tr.amount, 0);
              // Only the FIRST move to a given destination carries the schedule
              // note — a multi-source urgent tranche splits into 2+ moves to the
              // same account, and we must not repeat "o mueve {total} de una vez".
              const isFirstForDest = t.moves.findIndex((x) => x.toAccountId === m.toAccountId) === i;
              return (
              <div key={i} className={`rounded-2xl border p-4 ${m.urgent ? "border-amber-400/25 bg-amber-950/30" : "border-line/5 bg-zinc-900"}`}>
                <p className={`text-sm font-semibold leading-5 ${m.urgent ? "text-amber-100" : "text-zinc-200"}`}>
                  Mueve {nat(m.amount, destCur)} de {m.fromName} a {m.toName}
                  {m.byDateISO ? ` antes del ${formatDateEs(m.byDateISO)}` : ""}
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {m.reason}
                  {m.crossesCurrency ? " · cruza moneda: el monto exacto depende del tipo de cambio del día" : ""}
                </p>
                {later.length > 0 && isFirstForDest && (
                  <p className="mt-1.5 text-xs leading-5 text-zinc-500">
                    y luego {nat(later[0].amount, destCur)}
                    {later[0].byDateISO ? ` antes del ${formatDateEs(later[0].byDateISO)}` : ""}
                    {later[0].obligations[0] ? ` (${later[0].obligations[0]})` : ""} · o mueve {nat(total, destCur)} de una vez y te olvidas del mes
                  </p>
                )}
                <Link
                  href={chatMove(m)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                >
                  Ya lo hice — registrarlo
                  <Chevron />
                </Link>
              </div>
              );
            })}
          </div>
        </Section>
      )}
      {t.moves.length === 0 && (
        <Section kicker="Para ordenarte hoy" className="mt-6">
          {t.accounts.some((a) => a.surplus < -5) ? (
            <div className="rounded-2xl border border-amber-400/25 bg-amber-950/30 p-4">
              {t.accounts.filter((a) => a.surplus < -5).map((a) => {
                const u = a.shortfallSchedule[0];
                return (
                <p key={a.accountId} className="text-sm leading-6 text-amber-100">
                  En {a.name} te faltan {nat(u ? u.amount : Math.abs(a.surplus), a.currency)}
                  {(u?.byDateISO ?? a.firstShortfallDateISO) ? ` antes del ${formatDateEs((u?.byDateISO ?? a.firstShortfallDateISO)!)}` : ""} y hoy no
                  hay de dónde moverlos — toca frenar gasto o adelantar un ingreso.
                </p>
                );
              })}
            </div>
          ) : (
            <div className="rounded-3xl border border-line/5 bg-zinc-900 p-5">
              <p className="text-sm leading-6 text-zinc-400">
                Nada que mover — cada cuenta tiene lo que necesita. Respira.
              </p>
            </div>
          )}
        </Section>
      )}

      {/* Where the Saldo + Reserva physically live */}
      <Section kicker="Dónde viven tu Saldo y tu Reserva" className="mt-6">
        <div className="rounded-3xl border border-line/5 bg-zinc-900 p-5">
          <p className="text-sm leading-6 text-zinc-400">
            Tu plata sin pagos fechados encima vive hoy así — de ahí salen tu Saldo Kipu
            (<span className="font-semibold text-emerald-300">{disp(s.saldo)}</span>) y tu Reserva
            (<span className="font-semibold text-sky-300">{disp(s.reserva)}</span>), después de apartar el gasto
            del día a día que aún viene en el mes:
          </p>
          {t.layerHomes.length > 0 ? (
            <div className="mt-4 space-y-2">
              {t.layerHomes.map((h) => {
                const hCur = t.accounts.find((a) => a.accountId === h.accountId)?.currency ?? ctx.profile.baseCurrency;
                return (
                  <div key={h.accountId} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-zinc-300">{h.name}</span>
                    <span className="font-semibold tabular-nums text-zinc-100">{nat(h.amount, hCur)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">Hoy no hay sobrantes — todo está trabajando en los pisos.</p>
          )}
          {t.globalShortage > 0 && (
            <p className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-950/30 p-3.5 text-xs leading-5 text-amber-100">
              A tus cuentas les faltan {disp(t.globalShortage)} en total para cubrir todos los pisos{t.moves.length > 0 ? " — los movimientos de arriba priorizan lo que vence primero" : " y hoy no hay de dónde moverlos"}.
            </p>
          )}
        </div>
        {(t.shareConfidence === "low" || t.shareConfidence === "none" || t.accounts.some((a) => a.hasAssumedEvents)) && (
          <p className="mt-2 px-1 text-xs leading-5 text-zinc-600">
            {t.accounts.some((a) => a.hasAssumedEvents)
              ? "Algún pago no tiene cuenta declarada, así que lo asumí en la cuenta de tu día a día — si no es así, dímelo por chat y lo corrijo."
              : "Aún estoy aprendiendo de qué cuenta vive tu día a día — si algo no cuadra, dímelo por chat y lo corrijo."}
          </p>
        )}
      </Section>

      <div className="mt-8 flex items-center justify-between">
        <Link href="/app/saldo" className="kipu-press group inline-flex items-center gap-1 text-sm font-semibold text-zinc-400 hover:text-zinc-200">
          Ver tu Saldo Kipu
          <Chevron />
        </Link>
        <ChatCta label="Preguntarle a Kipu" prompt="¿Dónde está mi plata y qué movimientos me recomiendas?" />
      </div>
    </div>
  );
}
