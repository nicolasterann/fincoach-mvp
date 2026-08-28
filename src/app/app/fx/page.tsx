import Link from "next/link";
import { redirect } from "next/navigation";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { findRate, formatFxRate, type FxSource } from "@/lib/fx/fx-rates";
import { currentFxRateIsFresh, loadFxRatesForDisplay } from "@/lib/fx/fx-store";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ChatCta, DetailSurface, MetricShell, Section } from "../components/living/shell";

// Stage 27 — Monedas detail: the currencies the user actually touches and the
// KNOWN rates Kipu uses to express them in the base currency. Rates are NOT
// money: they render as plain numbers ("1 USD = 1,480 ARS"), never through the
// money formatter. When a rate is missing, Kipu says so — it never invents one.

function humanDateMs(ms: number): string {
  return new Date(ms).toLocaleDateString("es", { day: "numeric", month: "short" });
}

function sourceChip(source: FxSource): { text: string; cls: string } {
  if (source === "manual") return { text: "tuya", cls: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" };
  if (source === "historical") return { text: "histórica", cls: "border-line/10 bg-line/5 text-zinc-400" };
  return { text: "referencia", cls: "border-line/10 bg-line/5 text-zinc-400" };
}

export default async function FxDetailPage() {
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

  const rates = await loadFxRatesForDisplay(session.user.id);
  const base = (ctx.profile.baseCurrency || "USD").trim().toUpperCase();
  const displayCurrency = ctx.profile.displayCurrency?.trim().toUpperCase();

  const accountsByCurrency = new Map<string, number>();
  for (const a of ctx.accounts) {
    const c = (a.currency || base).trim().toUpperCase();
    accountsByCurrency.set(c, (accountsByCurrency.get(c) ?? 0) + 1);
  }
  const foreign = [...accountsByCurrency.keys()].filter((c) => c !== base).sort();
  const baseAccounts = accountsByCurrency.get(base) ?? 0;
  const onlyBase = foreign.length === 0;

  return (
    <DetailSurface layer="patrimonio">
      <MetricShell
        kicker="Detalle"
        title="Monedas"
        right={
          <span className="rounded-full border border-line/10 bg-line/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-zinc-400">
            base {base}
          </span>
        }
      />

      <div className="kipu-stagger">
        <Section kicker="Tu base">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-zinc-500">Moneda base</span>
            <span className="font-bold text-zinc-100">{base}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-600">
            Todo lo que registras guarda su moneda original, y las sumas de tu día a día se hacen en {base}.
          </p>
          <div className="mt-4 border-t border-line/5 pt-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-zinc-500">Vista</span>
              <span className="font-semibold text-zinc-300">{displayCurrency ?? base}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-600">
              {displayCurrency && displayCurrency !== base
                ? `Estás viendo los números re-expresados en ${displayCurrency}. Es solo una vista: lo guardado no cambia nunca.`
                : "Si un día quieres ver todo re-expresado en otra moneda, se activa desde Ajustes — solo cambia lo que ves, nunca lo guardado."}
            </p>
          </div>
        </Section>

        <Section kicker="Monedas que tocas">
          {onlyBase ? (
            <p className="text-sm leading-6 text-zinc-400">
              Todo vive en {base} por ahora — si un día tocas otra moneda, aquí la verás con su tipo de cambio.
            </p>
          ) : (
            <div className="space-y-4">
              {baseAccounts > 0 && (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-zinc-300">
                    {base} <span className="text-[10px] font-medium text-zinc-600">tu base</span>
                  </span>
                  <span className="text-xs text-zinc-600">
                    {baseAccounts === 1 ? "1 cuenta" : `${baseAccounts} cuentas`}
                  </span>
                </div>
              )}
              {foreign.map((c) => {
                const r = findRate(c, base, rates);
                const n = accountsByCurrency.get(c) ?? 0;
                const prompt = c === "USD" ? "el dólar está a " : `el ${c} está a `;
                if (!r) {
                  return (
                    <div key={c} className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-amber-300">Sin tipo de cambio para {c}</p>
                        <span className="text-xs text-zinc-600">{n === 1 ? "1 cuenta" : `${n} cuentas`}</span>
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-amber-200/70">
                        No convierto {c} a {base} sin una tasa conocida — antes prefiero preguntarte.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
                        <Link href="/app/settings" className="text-amber-300 hover:text-amber-200">
                          Configúrala en Ajustes → Tipo de cambio ›
                        </Link>
                        <Link
                          href={`/app/chat?share=${encodeURIComponent(prompt)}`}
                          className="text-emerald-300 hover:text-emerald-200"
                        >
                          Decírselo a Kipu ›
                        </Link>
                      </div>
                    </div>
                  );
                }
                const fresh = currentFxRateIsFresh(r);
                const chip = sourceChip(r.source);
                return (
                  <div
                    key={c}
                    className={fresh ? "flex items-center justify-between gap-3" : "rounded-2xl border border-amber-400/20 bg-amber-400/5 p-3"}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold tabular-nums text-zinc-200">
                        1 {c} = {formatFxRate(r.rate)} {base}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-600">
                        {n === 1 ? "1 cuenta" : `${n} cuentas`}
                        {r.asOfMs ? ` · al ${humanDateMs(r.asOfMs)}` : ""}
                      </p>
                      {!fresh && (
                        <p className="mt-1 text-xs leading-5 text-amber-200/70">
                          Esta tasa ya no valora tu dinero actual. Actualízala para recuperar el Saldo.
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${chip.cls}`}>
                        {chip.text}
                      </span>
                      {!fresh && (
                        <Link href="/app/settings" className="text-[10px] font-semibold text-amber-300">
                          actualizar ›
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section kicker="Cómo la uso">
          <ul className="space-y-2">
            <li className="flex items-start gap-2 text-sm leading-6 text-zinc-400">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              Tu tasa manual siempre gana: si me diste un valor, uso ese.
            </li>
            <li className="flex items-start gap-2 text-sm leading-6 text-zinc-400">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600" />
              Una tasa de referencia es eso, referencia — puede no ser exactamente la de tu banco.
            </li>
            <li className="flex items-start gap-2 text-sm leading-6 text-zinc-400">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600" />
              Si me falta una tasa, no la invento: te pregunto antes de convertir.
            </li>
          </ul>
        </Section>
      </div>

      <ChatCta label="Pregúntale a Kipu por tus monedas" prompt="¿Cómo están mis monedas?" />
    </DetailSurface>
  );
}
