import "server-only";
import { redirect } from "next/navigation";
import { deriveAdvisorySnapshot } from "@/lib/ai/advisory-handler";
import {
  buildCoachingBriefing,
  KipuSaldoUnavailableError,
} from "@/lib/financial/coaching-signals";
import { makeDisplayFormatter } from "@/lib/financial/display-money";
import { buildUserFinancialContext } from "@/lib/financial/user-financial-context-builder";
import { formatDateEs } from "@/lib/format/dates-es";
import { loadCurrentFxRatesForDisplay } from "@/lib/fx/fx-store";
import { convert } from "@/lib/fx/fx-rates";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { describeMovement } from "../app-dashboard-helpers";

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
}

export interface ShellPayload {
  status: ShellStatus;
  orbs: ShellOrb[];
  pillLine: string | null;
  lastMovement: { timeLabel: string; label: string; amountLabel: string } | null;
  runwayLine: string | null;
  greetingName: string | null;
}

interface RecentMovementRow {
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
  patrimonio: "Ya invertido",
  deuda: "Te falta pagar",
};

function clampLevel(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function fogPayload(greetingName: string | null): ShellPayload {
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
    })),
    pillLine: null,
    lastMovement: null,
    runwayLine: null,
    greetingName,
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
  const ctx = await buildUserFinancialContext(userId);
  if (!ctx.mainGoal || ctx.accounts.length === 0 || !ctx.dashboard) {
    redirect("/onboarding");
  }

  const greetingName = ctx.profile.fullName?.split(" ")[0] || null;
  const snapshot = deriveAdvisorySnapshot(ctx);
  let briefing;
  try {
    briefing = await buildCoachingBriefing({
      userId,
      ctx,
      snapshot,
      surfaceNudges: false,
    });
  } catch (error) {
    if (error instanceof KipuSaldoUnavailableError) return fogPayload(greetingName);
    throw error;
  }

  const rates = await loadCurrentFxRatesForDisplay(userId);
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
  const metasAmount = metasLayers.length
    ? metasLayers.reduce((sum, layer) => sum + (layer.amount ?? 0), 0)
    : null;
  const patrimonioLayer = saldo.layers.find((layer) => layer.kind === "patrimonio") ?? null;
  const patrimonioAmount = patrimonioLayer?.amount ?? null;
  const debtAmount = briefing.debtHealth.totalDebt;

  const supabase = await createSupabaseServerClient();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: recentRows, error: movementError } = await supabase
    .from("transactions")
    .select("description, category, base_amount, base_currency, type, occurred_at, debt_account_id, goal_id")
    .eq("user_id", userId)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(1);
  if (movementError) throw movementError;

  const recent = ((recentRows ?? []) as RecentMovementRow[])[0] ?? null;
  const movementView = recent
    ? describeMovement(recent, {
        displayCurrency: ctx.profile.displayCurrency,
        rates,
      })
    : null;
  const movementSign = movementView?.tone === "out" ? "−" : movementView?.tone === "in" ? "+" : "";

  const orbs: ShellOrb[] = [
    {
      kind: "saldo",
      amountLabel: display(saldo.saldo),
      amountRaw: displayRaw(saldo.saldo),
      subtitle: subtitles.saldo,
      level: saldo.cap > 0 ? clampLevel(saldo.saldo / saldo.cap) : null,
      levelNote: null,
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
      level: null,
      levelNote: null,
      emptyInvite:
        saldo.reserva <= 0.005
          ? "Tu respaldo se construye solo, mes a mes. Pregúntame cómo."
          : null,
    },
    {
      kind: "metas",
      amountLabel: metasAmount == null ? null : display(metasAmount),
      amountRaw: metasAmount == null ? null : displayRaw(metasAmount),
      subtitle: subtitles.metas,
      level: null,
      levelNote: null,
      emptyInvite:
        metasAmount == null
          ? "¿Armamos tu primera meta? Cuéntame qué sueñas."
          : null,
    },
    {
      kind: "patrimonio",
      amountLabel: patrimonioAmount == null ? null : display(patrimonioAmount),
      amountRaw: patrimonioAmount == null ? null : displayRaw(patrimonioAmount),
      subtitle: subtitles.patrimonio,
      level: null,
      levelNote: null,
      emptyInvite:
        patrimonioAmount == null
          ? "Cuando inviertas o ahorres a largo plazo, esto crece contigo."
          : null,
    },
    {
      kind: "deuda",
      amountLabel: display(debtAmount),
      amountRaw: displayRaw(debtAmount),
      subtitle: subtitles.deuda,
      level: null,
      levelNote: null,
      emptyInvite:
        briefing.debtHealth.hasAnyDebt
          ? null
          : "Sin deudas registradas. Si tienes una tarjeta, dímelo y la cuidamos juntos.",
    },
  ];

  return {
    status: "ok",
    orbs,
    pillLine: saldo.nextPayment
      ? `${saldo.nextPayment.label} · ${display(saldo.nextPayment.amount)} · ${formatDateEs(saldo.nextPayment.dateISO)}`
      : null,
    lastMovement:
      recent && movementView
        ? {
            timeLabel: movementTime(recent.occurred_at, ctx.profile.timezone),
            label: movementView.title,
            amountLabel: `${movementSign}${movementView.amount}`,
          }
        : null,
    runwayLine:
      saldo.mode === "runway"
        ? saldo.runwayDays != null
          ? `Sin ingreso activo: tu plata cubre ~${saldo.runwayDays} días al ritmo actual.`
          : "Sin ingreso activo: registra tu ingreso para calcular tu Saldo."
        : null,
    greetingName,
  };
}
