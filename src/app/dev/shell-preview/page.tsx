import Link from "next/link";
import { notFound } from "next/navigation";
import { SantuarioShell } from "@/app/app/components/shell/SantuarioShell";
import type {
  LiveOrbState,
  OrbQualityTier,
} from "@/app/app/components/shell/LiveOrb";
import type {
  OrbKind,
  ShellOrb,
  ShellPayload,
} from "@/app/app/components/shell/shell-payload";

type Scenario =
  | "normal"
  | "saldo-cero"
  | "runway"
  | "niebla"
  | "dia-1"
  | "deuda-con-cobertura"
  | "deuda-sin-cobertura"
  | "amanecer"
  | "capturando"
  | "escrito"
  | "cruce-de-capa"
  | "patrimonio-negativo";

const SCENARIO_LABELS: Record<Scenario, string> = {
  normal: "Normal",
  "saldo-cero": "Saldo cero",
  runway: "Runway",
  niebla: "Niebla",
  "dia-1": "Día 1",
  "deuda-con-cobertura": "Deuda con cobertura",
  "deuda-sin-cobertura": "Deuda sin cobertura",
  amanecer: "Amanecer",
  capturando: "Capturando",
  escrito: "Escrito y verificado",
  "cruce-de-capa": "Cruce de capa",
  "patrimonio-negativo": "Patrimonio negativo",
};

const STATE_ALIASES: Record<string, Scenario> = {
  available: "normal",
  dawn: "amanecer",
  fog: "niebla",
  empty: "saldo-cero",
  capturing: "capturando",
  written: "escrito",
  crossing: "cruce-de-capa",
};

const FORCED_LIVE_STATE: Partial<Record<Scenario, LiveOrbState>> = {
  normal: "available",
  amanecer: "dawn",
  niebla: "fog",
  runway: "runway",
  "saldo-cero": "empty",
  capturando: "capturing",
  escrito: "written",
  "cruce-de-capa": "crossing",
};

const normalOrbs: ShellOrb[] = [
  { kind: "saldo", amountLabel: "82.40$", amountRaw: 82.4, subtitle: "Disponible hoy", level: 0.64, levelNote: null, emptyInvite: null },
  { kind: "reserva", amountLabel: "1,200$", amountRaw: 1200, subtitle: "Tu respaldo", level: null, levelNote: null, emptyInvite: null },
  { kind: "metas", amountLabel: "260$", amountRaw: 260, subtitle: "Por aportar este mes", level: null, levelNote: null, emptyInvite: null },
  { kind: "patrimonio", amountLabel: "3,480$", amountRaw: 3480, subtitle: "Patrimonio total", level: null, levelNote: null, emptyInvite: null },
  { kind: "deuda", amountLabel: "760$", amountRaw: 760, subtitle: "Te falta pagar", level: null, levelNote: null, emptyInvite: null },
];

const basePayload: ShellPayload = {
  status: "ok",
  orbs: normalOrbs,
  pillLine: "Diners · 50.60$ · 27 de agosto",
  lastMovement: { timeLabel: "14:20", label: "Café · Produbanco", amountLabel: "−4.50$" },
  runwayLine: null,
  greetingName: "Nico",
  dawn: null,
};

const dayOneInvites: Record<OrbKind, string> = {
  saldo: "Vacío hasta mañana — vuelven 24$ al amanecer.",
  reserva: "Tu respaldo se construye solo, mes a mes. Pregúntame cómo.",
  metas: "¿Armamos tu primera meta? Cuéntame qué sueñas.",
  patrimonio: "Aún no hay un patrimonio para mostrar. Cuéntame qué tienes y qué debes.",
  deuda: "Sin deudas registradas. Si tienes una tarjeta, dímelo y la cuidamos juntos.",
};

function payloadFor(scenario: Scenario): ShellPayload {
  if (scenario === "niebla") {
    return {
      ...basePayload,
      status: "niebla",
      orbs: normalOrbs.map((orb) => ({ ...orb, amountLabel: null, amountRaw: null, level: null })),
      pillLine: null,
      lastMovement: null,
    };
  }

  if (scenario === "dia-1") {
    return {
      ...basePayload,
      orbs: normalOrbs.map((orb) => ({
        ...orb,
        amountLabel: orb.kind === "metas" || orb.kind === "patrimonio" ? null : "0$",
        amountRaw: orb.kind === "metas" || orb.kind === "patrimonio" ? null : 0,
        level: orb.kind === "saldo" ? 0 : null,
        levelNote: null,
        emptyInvite: dayOneInvites[orb.kind],
      })),
      pillLine: null,
      lastMovement: null,
    };
  }

  if (scenario === "amanecer") {
    return {
      ...basePayload,
      dawn: { levelFrom: 0.52, fillLabel: "24$", dayKey: "preview-dawn" },
    };
  }

  if (scenario === "saldo-cero") {
    return {
      ...basePayload,
      orbs: normalOrbs.map((orb) =>
        orb.kind === "saldo"
          ? { ...orb, amountLabel: "0$", amountRaw: 0, level: 0, emptyInvite: dayOneInvites.saldo }
          : orb,
      ),
    };
  }

  if (scenario === "runway") {
    return {
      ...basePayload,
      runwayLine: "Sin ingreso activo: tu plata cubre ~18 días al ritmo actual.",
    };
  }

  if (scenario === "deuda-con-cobertura") {
    return {
      ...basePayload,
      orbs: normalOrbs.map((orb) =>
        orb.kind === "deuda"
          ? { ...orb, level: 0.62, levelNote: "Ciclo cubierto 62%" }
          : orb,
      ),
    };
  }

  if (scenario === "patrimonio-negativo") {
    return {
      ...basePayload,
      orbs: normalOrbs.map((orb) =>
        orb.kind === "patrimonio"
          ? { ...orb, amountLabel: "−420$", amountRaw: -420, level: null, emptyInvite: null }
          : orb,
      ),
    };
  }

  return basePayload;
}

function previewHref(input: {
  scenario?: Scenario;
  tier?: OrbQualityTier;
  perf?: boolean;
}): string {
  const params = new URLSearchParams();
  if (input.scenario && input.scenario !== "normal") params.set("state", input.scenario);
  if (input.tier != null) params.set("tier", String(input.tier));
  if (input.perf) params.set("perf", "1");
  const query = params.toString();
  return query ? `/dev/shell-preview?${query}` : "/dev/shell-preview";
}

export default async function ShellPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; tier?: string; perf?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { state, tier: tierQuery, perf } = await searchParams;
  const normalizedState = typeof state === "string" ? (STATE_ALIASES[state] ?? state) : "normal";
  const scenario: Scenario = Object.prototype.hasOwnProperty.call(SCENARIO_LABELS, normalizedState)
    ? (normalizedState as Scenario)
    : "normal";
  const tier: OrbQualityTier | undefined =
    tierQuery === "0" || tierQuery === "1" || tierQuery === "2" || tierQuery === "3"
      ? Number(tierQuery) as OrbQualityTier
      : undefined;
  const showPerf = perf === "1";

  return (
    <div className="relative min-h-screen bg-zinc-950">
      <details className="fixed right-2 top-2 z-[70]">
        <summary className="grid size-11 cursor-pointer list-none place-items-center rounded-full border border-line/10 bg-zinc-950/90 text-[10px] font-semibold text-zinc-200 shadow-lg backdrop-blur" aria-label={`Abrir controles QA. Estado actual: ${SCENARIO_LABELS[scenario]}`}>
          QA
        </summary>
        <div className="absolute right-0 mt-2 w-[min(92vw,390px)] rounded-2xl border border-line/10 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Estados</p>
          <nav className="flex max-h-[48svh] flex-wrap justify-end gap-2 overflow-y-auto" aria-label="Estados del santuario">
            {Object.entries(SCENARIO_LABELS).map(([key, label]) => (
              <Link
                key={key}
                href={previewHref({ scenario: key as Scenario, tier, perf: showPerf })}
                className={`inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold ${scenario === key ? "bg-emerald-400 text-zinc-950" : "border border-line/10 text-zinc-400"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tier</p>
          <nav className="flex justify-end gap-2" aria-label="Tier del orbe">
            {([0, 1, 2, 3] as const).map((item) => (
              <Link
                key={item}
                href={previewHref({ scenario, tier: item, perf: showPerf })}
                className={`grid size-11 place-items-center rounded-full text-xs font-semibold ${tier === item ? "bg-emerald-400 text-zinc-950" : "border border-line/10 text-zinc-400"}`}
              >
                {item}
              </Link>
            ))}
            <Link
              href={previewHref({ scenario, tier, perf: !showPerf })}
              className={`inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold ${showPerf ? "bg-emerald-400 text-zinc-950" : "border border-line/10 text-zinc-400"}`}
            >
              Perf
            </Link>
          </nav>
        </div>
      </details>
      <SantuarioShell
        payload={payloadFor(scenario)}
        preview={{
          forcedTier: tier,
          forcedState: FORCED_LIVE_STATE[scenario],
          showPerf,
        }}
      />
    </div>
  );
}
