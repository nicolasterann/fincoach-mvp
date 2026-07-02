import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { loadFxRates } from "@/lib/fx/fx-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { inviteTokenIsMine, loadHouseholdData } from "@/lib/household/household-store";
import { getSiteUrl } from "@/lib/site-url";
import { createHouseholdInviteAction } from "./actions";
import type { CurrencyCode } from "@/types/financial";

// Stage 20 PASS 2 (Micro-stage B/F) — the "Compartido" detail surface. Reads the
// privacy-structural briefing.household (ONLY shared truth — never a member's
// personal ledger/Margen). Neutral, no-blame: "saldos pendientes", "el camino más
// simple para cuadrar". Enriched by Micro-stage F (recurring shared bills, invite
// link, visibility).

const TYPE_LABEL: Record<string, string> = {
  couple: "Pareja",
  family: "Familia",
  roommates: "Convivientes",
  trip: "Viaje",
  custom: "Grupo",
};

// Invite tokens are opaque hex/url-safe strings; anything else in ?invite=
// (besides the known "error" marker) renders nothing.
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export default async function HouseholdPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const ctx = await buildUserFinancialContext(session.user.id);
  const snapshot = deriveAdvisorySnapshot(ctx);
  const briefing = await buildCoachingBriefing({ userId: session.user.id, ctx, snapshot, surfaceNudges: false });
  const base = ctx.profile.baseCurrency as CurrencyCode;
  const displayCurrency = ctx.profile.displayCurrency as CurrencyCode | undefined; // undefined => native no-op
  const rates = await loadFxRates(session.user.id);
  const disp = makeDisplayFormatter(base, displayCurrency, rates);
  const money = (v: number) => disp(v);
  const households = briefing.household.households;

  // Only an ACTIVE owner/admin sees the invite button (same permission model
  // the store enforces on write). Loaded via the store — household tables are
  // deny-by-default at the DB, so this is the intended, membership-scoped read.
  const loaded = await loadHouseholdData(session.user.id);
  const manageableIds = new Set(
    loaded.households
      .filter((h) => {
        const self = h.members.find((m) => m.memberId === h.selfMemberId);
        return self?.role === "owner" || self?.role === "admin";
      })
      .map((h) => h.id),
  );

  // Besides the shape check, the token must belong to a household THIS user
  // administers — a foreign (but valid-looking) token in the URL renders nothing.
  const inviteToken =
    invite && INVITE_TOKEN_PATTERN.test(invite) && (await inviteTokenIsMine(session.user.id, invite))
      ? invite
      : null;
  const inviteUrl = inviteToken ? `${getSiteUrl()}/app/join/${inviteToken}` : null;
  const inviteFailed = invite === "error";

  return (
    <div className="mx-auto w-full max-w-2xl pb-28 lg:pb-12">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Compartido</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-50">Dinero en común</h1>
        </div>
        <Link href="/app" className="text-xs font-semibold text-zinc-500 hover:text-zinc-300">
          ← Resumen
        </Link>
      </header>

      {inviteUrl && (
        <section className="mt-5 rounded-2xl border border-emerald-400/25 bg-emerald-950/40 p-4">
          <p className="text-sm font-semibold text-emerald-100">Tu link de invitación está listo</p>
          <code className="mt-2 block select-all break-all rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-xs leading-5 text-emerald-300">
            {inviteUrl}
          </code>
          <p className="mt-2 text-xs leading-5 text-zinc-500">Vence en 14 días. Compártelo tal cual.</p>
        </section>
      )}
      {inviteFailed && (
        <section className="mt-5 rounded-2xl border border-amber-400/25 bg-amber-950/40 px-4 py-3">
          <p className="text-sm font-medium leading-6 text-amber-100">
            No pude generar el link ahora. Intenta de nuevo en un momento, o dile a Kipu por chat.
          </p>
        </section>
      )}

      {households.length === 0 ? (
        <section className="mt-6 rounded-3xl border border-white/5 bg-zinc-900 p-6">
          <p className="text-base leading-7 text-zinc-300">
            Aquí coordinas dinero compartido —con tu pareja, familia, roomies o un viaje— sin tensión y sin exponer tus cuentas
            personales. Cada quien mantiene su privacidad; Kipu solo ve lo que comparten.
          </p>
          <p className="mt-3 text-sm leading-6 text-zinc-500">
            Dile a Kipu algo como “crea un hogar con mi pareja” o “divide la cena con Ana mitad y mitad” y lo armamos.
          </p>
          <Link
            href="/app/chat"
            className="mt-5 inline-block rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-bold text-zinc-950 transition hover:bg-emerald-300"
          >
            Crear un hogar con Kipu
          </Link>
        </section>
      ) : (
        <div className="mt-6 flex flex-col gap-5">
          {households.map((h) => (
            <section key={h.householdId} className="rounded-3xl border border-white/5 bg-zinc-900 p-6">
              <div className="flex items-center justify-between">
                <p className="text-lg font-bold text-zinc-50">{h.name}</p>
                <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] font-semibold text-zinc-400">
                  {TYPE_LABEL[h.type] ?? "Grupo"} · {h.memberCount}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-zinc-300">{h.nextAction}</p>

              {h.visibleTransfers.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
                    {h.privacyMode === "minimal" ? "Tu parte para cuadrar" : "El camino más simple para cuadrar"}
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {h.visibleTransfers.map((t, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-zinc-400">
                          {t.fromName} → {t.toName}
                        </span>
                        <span className="font-semibold text-zinc-200">{money(t.amountBase)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {h.sharedGoals.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Metas compartidas</p>
                  <div className="mt-2 space-y-1.5">
                    {h.sharedGoals.map((g) => (
                      <div key={g.name} className="flex items-center justify-between text-sm">
                        <span className="text-zinc-400">{g.name}</span>
                        <span className="font-semibold text-violet-300">{g.progressPct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {h.upcomingSharedBills.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Gastos compartidos que vienen</p>
                  <div className="mt-2 space-y-1.5">
                    {h.upcomingSharedBills.map((b, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-zinc-400">
                          {b.description} · {b.dueInDays === 0 ? "hoy" : `en ${b.dueInDays}d`}
                        </span>
                        <span className="font-semibold text-amber-300">{money(b.amountBase)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3 text-xs text-zinc-600">
                <span>Gasto compartido este mes: {money(h.sharedSpendThisMonthBase)}</span>
                {h.pendingReimbursements > 0 && <span>{h.pendingReimbursements} pendiente(s)</span>}
              </div>

              {manageableIds.has(h.householdId) && (
                <form action={createHouseholdInviteAction} className="mt-3">
                  <input name="household_id" type="hidden" value={h.householdId} />
                  <button
                    type="submit"
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-white/20 hover:text-zinc-100"
                  >
                    Generar link de invitación
                  </button>
                </form>
              )}
            </section>
          ))}

          <Link
            href="/app/chat"
            className="rounded-2xl border border-white/10 bg-zinc-900 px-5 py-4 text-center text-sm font-semibold text-zinc-200 transition hover:border-white/20"
          >
            Coordinar algo con Kipu
          </Link>
        </div>
      )}
    </div>
  );
}
