import Link from "next/link";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import { buildCoachingBriefing } from "@/lib/financial/coaching-signals";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { formatKipuMoney } from "@/lib/financial/money";
import { loadFxRatesForDisplay } from "@/lib/fx/fx-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { inviteTokenIsMine, loadHouseholdData } from "@/lib/household/household-store";
import { getSiteUrl } from "@/lib/site-url";
import { createHouseholdInviteAction } from "./actions";
import { CopyInviteButton } from "./CopyInviteButton";
import { ProgressStrand } from "@/app/app/components/living/ProgressStrand";
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

// Honest privacy explainer per mode — what the GROUP can see, in one line.
// Explicit about what stays private: cuentas, saldos, Margen y deudas son SOLO tuyos.
const PRIVACY_COPY: Record<string, string> = {
  minimal:
    "Cada quien ve solo su parte del cuadre. Tus cuentas, tu Saldo Kipu y tus deudas son solo tuyos — nadie del grupo los ve.",
  standard:
    "El grupo ve solo lo compartido (quién le pasa a quién para cuadrar). Tus cuentas, tu Saldo Kipu y tus deudas son solo tuyos — nadie del grupo los ve.",
  full:
    "El grupo ve solo lo compartido (quién le pasa a quién para cuadrar). Tus cuentas, tu Saldo Kipu y tus deudas son solo tuyos — nadie del grupo los ve.",
};

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
  const rates = await loadFxRatesForDisplay(session.user.id);
  const disp = makeDisplayFormatter(base, displayCurrency, rates);
  const money = (v: number) => disp(v);
  const households = briefing.household.households;

  // Only an ACTIVE owner/admin sees the invite button (same permission model
  // the store enforces on write). Loaded via the store — household tables are
  // deny-by-default at the DB, so this is the intended, membership-scoped read.
  const loaded = await loadHouseholdData(session.user.id);
  // Active members per household (for the member chips) — same store read that
  // already gates the invite button; only membership-scoped data.
  const activeMembersById = new Map(
    loaded.households.map((h) => [h.id, h.members.filter((m) => m.status === "active")]),
  );
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
          <p className="text-sm font-semibold text-emerald-100">Tu invitación está lista</p>
          <p className="mt-1 text-xs leading-5 text-emerald-200/80">
            Copia este link y pásaselo a quien quieras sumar. Al abrirlo, se une al grupo.
          </p>
          <code className="mt-2 block select-all break-all rounded-xl border border-line/10 bg-zinc-950 px-3 py-2.5 text-xs leading-5 text-emerald-300">
            {inviteUrl}
          </code>
          <CopyInviteButton url={inviteUrl} />
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
        <section className="mt-6 rounded-3xl border border-line/5 bg-zinc-900 p-6">
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
        <div className="kipu-stagger mt-6 flex flex-col gap-5">
          {households.map((h) => {
            const activeMembers = activeMembersById.get(h.householdId) ?? [];
            const toPayKeys = new Set(h.myToPay.map((t) => `${t.toName}|${t.amountBase}`));
            const toCollectKeys = new Set(h.myToCollect.map((t) => `${t.fromName}|${t.amountBase}`));
            const hasSharedActivity =
              h.visibleTransfers.length > 0 || h.sharedGoals.length > 0 || h.upcomingSharedBills.length > 0;
            return (
            <section key={h.householdId} className="kipu-press rounded-3xl border border-line/5 bg-zinc-900 p-6">
              <div className="flex items-center justify-between">
                <p className="text-lg font-bold text-zinc-50">{h.name}</p>
                <span className="rounded-full bg-line/5 px-3 py-1 text-[11px] font-semibold text-zinc-400">
                  {TYPE_LABEL[h.type] ?? "Grupo"} · {h.memberCount}
                </span>
              </div>

              {activeMembers.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {activeMembers.map((m) => (
                    <span
                      key={m.memberId}
                      className="flex items-center gap-1.5 rounded-full border border-line/10 px-2.5 py-1 text-xs font-medium text-zinc-300"
                    >
                      {(m.role === "owner" || m.role === "admin") && (
                        <span
                          aria-hidden
                          title={m.role === "owner" ? "Dueño del grupo" : "Admin"}
                          className={`h-1.5 w-1.5 rounded-full ${m.role === "owner" ? "bg-emerald-400" : "bg-sky-400"}`}
                        />
                      )}
                      {m.displayName}
                    </span>
                  ))}
                </div>
              )}

              <p className="mt-3 text-sm leading-6 text-zinc-300">{h.nextAction}</p>

              {!hasSharedActivity && (
                <div className="mt-4 rounded-2xl border border-line/5 bg-line/[0.02] px-4 py-3">
                  <p className="text-sm leading-6 text-zinc-400">
                    Todavía no hay nada compartido aquí. Cuando dividan un gasto, dile a Kipu algo como
                    “divide la cena con {activeMembers.find((m) => m.role !== "owner")?.displayName ?? "el grupo"} mitad y mitad”
                    y aparece el cuadre.
                  </p>
                </div>
              )}

              {h.visibleTransfers.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
                    {h.privacyMode === "minimal" ? "Tu parte para cuadrar" : "El camino más simple para cuadrar"}
                  </p>
                  <div className="mt-2 space-y-1">
                    {h.visibleTransfers.map((t, i) => {
                      // Settle via chat, never a destructive tap: the prefill says
                      // exactly what happened and Kipu confirms before writing.
                      // Prefills carry the BASE amount (ledger truth) — the
                      // display re-expression is cosmetic and never enters chat.
                      const amountForChat = formatKipuMoney(t.amountBase, base);
                      const prompt = toPayKeys.has(`${t.toName}|${t.amountBase}`)
                        ? `márcale pagado: le pagué ${amountForChat} a ${t.toName}`
                        : toCollectKeys.has(`${t.fromName}|${t.amountBase}`)
                          ? `márcale pagado: ${t.fromName} me pagó ${amountForChat}`
                          : `márcale pagado: ${t.fromName} le pagó ${amountForChat} a ${t.toName}`;
                      return (
                        <Link
                          key={i}
                          href={`/app/chat?share=${encodeURIComponent(prompt)}`}
                          className="kipu-press group -mx-2 flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 text-sm transition hover:bg-line/5"
                        >
                          <span className="text-zinc-400">
                            {t.fromName} → {t.toName}
                          </span>
                          <span className="flex items-center gap-1.5 font-semibold text-zinc-200">
                            {money(t.amountBase)}
                            <span aria-hidden className="text-zinc-600 transition-transform duration-200 group-hover:translate-x-0.5">
                              ›
                            </span>
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] leading-4 text-zinc-600">
                    Montos en {base} para que cuadren parejo; el detalle en la moneda original
                    de cada gasto vive en Actividad.
                  </p>
                </div>
              )}

              {h.sharedGoals.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Metas compartidas</p>
                  <div className="mt-2 space-y-2">
                    {h.sharedGoals.map((g) => (
                      <div key={g.name}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-zinc-400">{g.name}</span>
                          <span className="font-semibold text-violet-300">{g.progressPct}%</span>
                        </div>
                        <ProgressStrand
                          fraction={g.progressPct / 100}
                          accent="violet"
                          ariaLabel={`Progreso de ${g.name}: ${g.progressPct}%`}
                        />
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

              <Link
                href={`/app/chat?share=${encodeURIComponent("¿cómo va lo compartido este mes?")}`}
                className="kipu-press group mt-4 flex min-h-11 items-center justify-between gap-3 border-t border-line/5 pt-3 text-xs text-zinc-600 transition hover:text-zinc-400"
              >
                <span>Gasto compartido este mes: {money(h.sharedSpendThisMonthBase)}</span>
                <span className="flex items-center gap-1.5">
                  {h.pendingReimbursements > 0 && (
                    <span>
                      {h.pendingReimbursements === 1 ? "1 pendiente" : `${h.pendingReimbursements} pendientes`}
                    </span>
                  )}
                  <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">›</span>
                </span>
              </Link>

              <div className="mt-3 rounded-2xl bg-line/[0.03] px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
                  Qué ve el grupo
                </p>
                <p className="mt-0.5 text-xs leading-5 text-zinc-500">
                  {PRIVACY_COPY[h.privacyMode] ?? PRIVACY_COPY.standard}
                </p>
              </div>

              {manageableIds.has(h.householdId) && (
                // NOTE (integrator): this generates a FRESH invite token each click.
                // loadHouseholdData does not expose an existing PENDING invite token
                // on the household object, so we can't render "copiar invitación"
                // for an already-created invite without a new store read
                // (e.g. loadHouseholdData returning the newest pending token per
                // household). Until then, the owner regenerates to get a copyable link.
                <form action={createHouseholdInviteAction} className="mt-3">
                  <input name="household_id" type="hidden" value={h.householdId} />
                  <input name="request_id" type="hidden" value={crypto.randomUUID()} />
                  <button
                    type="submit"
                    className="kipu-press rounded-xl border border-line/10 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-line/20 hover:text-zinc-100"
                  >
                    {inviteUrl ? "Generar otro link de invitación" : "Invitar a alguien al grupo"}
                  </button>
                </form>
              )}
            </section>
            );
          })}

          <Link
            href="/app/chat"
            className="rounded-2xl border border-line/10 bg-zinc-900 px-5 py-4 text-center text-sm font-semibold text-zinc-200 transition hover:border-line/20"
          >
            Coordinar algo con Kipu
          </Link>
        </div>
      )}
    </div>
  );
}
