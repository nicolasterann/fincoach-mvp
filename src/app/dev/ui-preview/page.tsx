import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { loadFxRates } from "@/lib/fx/fx-store";
import { formatDateEs } from "@/lib/format/dates-es";
import {
  SaldoKipuHero,
  HoyCard,
  ReservaCard,
  MetaPrincipalCard,
  ProximoPagoCard,
  AccionCard,
  pickAccion,
  QuipuCord,
} from "@/app/app/components/SaldoKipu";

// Stage D — dev-only visual QA for the redesigned home (same components, same
// briefing path, latest disposable `d-ui-` user). Dev family page: never linked,
// unavailable in production (NODE_ENV gate below, same posture as /dev/*).


export default async function UiPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const sb = createSupabaseAdminClient();
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 200 });
  const user = list.users
    .filter((u) => u.email?.startsWith("d-ui-"))
    .sort((a, b) => (b.created_at > a.created_at ? 1 : -1))[0];
  if (!user) return <p className="p-8 text-zinc-400">No hay usuario d-ui-*.</p>;

  const ctx = await buildUserFinancialContext(user.id);
  const snapshot = deriveAdvisorySnapshot(ctx);
  const briefing = await buildCoachingBriefing({ userId: user.id, ctx, snapshot, surfaceNudges: false });
  const manualRates = await loadFxRates(user.id);
  const disp = makeDisplayFormatter(ctx.profile.baseCurrency, ctx.profile.displayCurrency, manualRates);
  const mk = briefing.margenKipu;
  const s = mk.saldo;
  const accion = pickAccion({ transferAlerts: briefing.transferAlerts, marginGaps: mk.marginGaps, formatMoney: disp });

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 p-6">
      <p className="text-xs text-zinc-600">dev/ui-preview · {user.email}</p>
      <SaldoKipuHero
        saldo={s}
        amountLabel={disp(s.saldo)}
        runwayLine={s.mode === "runway" && s.runwayDays != null ? `Sin ingreso activo: tu plata cubre ~${s.runwayDays} días al ritmo actual.` : null}
      />
      {accion && <AccionCard text={accion.text} href={accion.href} />}
      <HoyCard fillLabel={disp(s.todayFill)} spentLabel={disp(s.todaySpent)} spentIsZero={s.todaySpent <= 0} />
      <ReservaCard amountLabel={disp(s.reserva)} />
      {ctx.mainGoal && (
        <MetaPrincipalCard
          name={ctx.mainGoal.name}
          progressPct={ctx.dashboard?.goalProgress.progressPercentage ?? 0}
          amountLine={`${disp(ctx.mainGoal.currentAmount)} de ${disp(ctx.mainGoal.targetAmount)}`}
        />
      )}
      {s.nextPayment && (
        <ProximoPagoCard name={s.nextPayment.label} amountLabel={disp(s.nextPayment.amount)} dateLabel={formatDateEs(s.nextPayment.dateISO)} />
      )}
      <div className="rounded-3xl border border-line/5 bg-zinc-900 p-5">
        <p className="mb-3 text-sm text-zinc-400">Estados del cordón (lleno → vacío)</p>
        <div className="flex items-end gap-6">
          <QuipuCord saldo={{ ...s, saldo: s.cap, tank: s.cap }} height={170} />
          <QuipuCord saldo={{ ...s, saldo: s.cap * 0.5, tank: s.cap * 0.5 }} height={170} />
          <QuipuCord saldo={{ ...s, saldo: s.cap * 0.15, tank: s.cap * 0.15 }} height={170} />
          <QuipuCord saldo={{ ...s, saldo: 0, tank: 0 }} height={170} />
        </div>
      </div>
    </div>
  );
}
