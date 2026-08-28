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
import { buildShellPerspective } from "@/app/app/components/shell/shell-perspective";
import type { OrbVoiceState } from "@/app/app/components/shell/voice-capture-contract";
import type { DatedSnapshot } from "@/lib/trends/snapshot-store";

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

type PerspectiveFixture =
  | "completo"
  | "sin-objetivo-reserva"
  | "sin-meta-principal"
  | "con-huecos"
  | "lectura-caida"
  | "sin-compromisos";

const PERSPECTIVE_FIXTURES: Record<PerspectiveFixture, string> = {
  completo: "Completo",
  "sin-objetivo-reserva": "Sin objetivo de Reserva",
  "sin-meta-principal": "Sin meta principal",
  "con-huecos": "Huecos en el cordón",
  "lectura-caida": "Lectura caída",
  "sin-compromisos": "Sin compromisos",
};

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

const snapshot = (
  dateISO: string,
  saldoKipu: number,
  totalDebt: number,
  netWorth: number,
): DatedSnapshot => ({
  dateISO,
  saldoKipu,
  totalDebt,
  netWorth,
  margenWeekly: 180,
  safeWeekly: 170,
  readiness: 70,
});

function perspectiveFor(fixture: PerspectiveFixture) {
  const completeHistory = [
    snapshot("2026-08-22", 58, 910, 3_100),
    snapshot("2026-08-23", 72, 860, 3_180),
    snapshot("2026-08-24", 44, 820, 3_250),
    snapshot("2026-08-25", 66, 790, 3_360),
    snapshot("2026-08-26", 82.4, 760, 3_480),
  ];
  const gapHistory = [
    snapshot("2026-08-20", 36, 940, 3_000),
    snapshot("2026-08-21", 52, 900, 3_080),
    snapshot("2026-08-24", 49, 830, 3_260),
    snapshot("2026-08-25", 82.4, 760, 3_480),
  ];
  return buildShellPerspective({
    today: {
      spent: 18,
      fill: 24,
      objectives: [
        { category: "food", label: "Comida", spent: 184, objective: 300, crossed: false, projectedCrossDateISO: null },
        { category: "transport", label: "Transporte", spent: 96, objective: 120, crossed: false, projectedCrossDateISO: "2026-08-30" },
      ],
    },
    month: {
      income: 2_400,
      fixed: 650,
      debt: 280,
      installments: 90,
      essentials: 520,
      savings: 180,
      investment: 100,
      goals: 240,
      free: 340,
    },
    history: {
      ok: fixture !== "lectura-caida",
      snapshots: fixture === "con-huecos" ? gapHistory : completeHistory,
      todayISO: "2026-08-27",
    },
    progress: {
      primaryGoal:
        fixture === "sin-meta-principal"
          ? null
          : { name: "Brasil", current: 1_260, target: 3_000, percent: 42 },
      reserve: {
        readOk: true,
        amount: 1_200,
        target: fixture === "sin-objetivo-reserva" ? null : 2_400,
      },
      debt: { amount: 760 },
      wealth: { readOk: true, amount: 3_480 },
    },
    upcoming: {
      cards:
        fixture === "sin-compromisos"
          ? []
          : [{ name: "Diners", inDays: 2, balance: 760, due: 50.6 }],
      payments:
        fixture === "sin-compromisos"
          ? []
          : [{ name: "Internet", amount: 36, dueDate: "2026-08-31" }],
    },
    formatMoney: (amount) => `${new Intl.NumberFormat("es-419", { maximumFractionDigits: 2 }).format(amount)}$`,
  });
}

const basePayload: ShellPayload = {
  status: "ok",
  orbs: normalOrbs,
  pillLine: "Diners · 50.60$ · 27 de agosto",
  pillLines: [
    "¿Cuánto cerró tu tarjeta el 25 de agosto?",
    "Diners · 50.60$ · 27 de agosto",
    "Comida va al 72% de su objetivo.",
  ],
  lastMovement: {
    timeLabel: "14:20",
    label: "Café · Produbanco",
    amountLabel: "−4.50$",
    turnId: null,
  },
  runwayLine: null,
  greetingName: "Nico",
  dawn: null,
  thread: { turns: [], complete: true, readFailed: false },
  perspective: perspectiveFor("completo"),
};

const dayOneInvites: Record<OrbKind, string> = {
  saldo: "Vacío hasta mañana — vuelven 24$ al amanecer.",
  reserva: "Tu respaldo se construye solo, mes a mes. Pregúntame cómo.",
  metas: "¿Armamos tu primera meta? Cuéntame qué sueñas.",
  patrimonio: "Aún no hay un patrimonio para mostrar. Cuéntame qué tienes y qué debes.",
  deuda: "Sin deudas registradas. Si tienes una tarjeta, dímelo y la cuidamos juntos.",
};

function payloadFor(
  scenario: Scenario,
  perspectiveFixture: PerspectiveFixture,
): ShellPayload {
  const shellBase = {
    ...basePayload,
    perspective: perspectiveFor(perspectiveFixture),
  };
  if (scenario === "niebla") {
    return {
      ...shellBase,
      status: "niebla",
      orbs: normalOrbs.map((orb) => ({ ...orb, amountLabel: null, amountRaw: null, level: null })),
      pillLine: null,
      pillLines: [],
      lastMovement: null,
      perspective: null,
    };
  }

  if (scenario === "dia-1") {
    return {
      ...shellBase,
      orbs: normalOrbs.map((orb) => ({
        ...orb,
        amountLabel: orb.kind === "metas" || orb.kind === "patrimonio" ? null : "0$",
        amountRaw: orb.kind === "metas" || orb.kind === "patrimonio" ? null : 0,
        level: orb.kind === "saldo" ? 0 : null,
        levelNote: null,
        emptyInvite: dayOneInvites[orb.kind],
      })),
      pillLine: null,
      pillLines: [],
      lastMovement: null,
    };
  }

  if (scenario === "amanecer") {
    return {
      ...shellBase,
      dawn: { levelFrom: 0.52, fillLabel: "24$", dayKey: "preview-dawn" },
    };
  }

  if (scenario === "saldo-cero") {
    return {
      ...shellBase,
      orbs: normalOrbs.map((orb) =>
        orb.kind === "saldo"
          ? { ...orb, amountLabel: "0$", amountRaw: 0, level: 0, emptyInvite: dayOneInvites.saldo }
          : orb,
      ),
    };
  }

  if (scenario === "runway") {
    return {
      ...shellBase,
      runwayLine: "Sin ingreso activo: tu plata cubre ~18 días al ritmo actual.",
    };
  }

  if (scenario === "deuda-con-cobertura") {
    return {
      ...shellBase,
      orbs: normalOrbs.map((orb) =>
        orb.kind === "deuda"
          ? { ...orb, level: 0.62, levelNote: "Ciclo cubierto 62%" }
          : orb,
      ),
    };
  }

  if (scenario === "patrimonio-negativo") {
    return {
      ...shellBase,
      orbs: normalOrbs.map((orb) =>
        orb.kind === "patrimonio"
          ? { ...orb, amountLabel: "−420$", amountRaw: -420, level: null, emptyInvite: null }
          : orb,
      ),
    };
  }

  return shellBase;
}

function previewHref(input: {
  scenario?: Scenario;
  tier?: OrbQualityTier;
  voice?: OrbVoiceState;
  perf?: boolean;
  sheet?: boolean;
  perspective?: PerspectiveFixture;
}): string {
  const params = new URLSearchParams();
  if (input.scenario && input.scenario !== "normal") params.set("state", input.scenario);
  if (input.tier != null) params.set("tier", String(input.tier));
  if (input.voice) params.set("voice", input.voice);
  if (input.perf) params.set("perf", "1");
  if (input.sheet) params.set("sheet", "perspectiva");
  if (input.perspective && input.perspective !== "completo") {
    params.set("perspective", input.perspective);
  }
  const query = params.toString();
  return query ? `/dev/shell-preview?${query}` : "/dev/shell-preview";
}

export default async function ShellPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    state?: string;
    tier?: string;
    voice?: string;
    perf?: string;
    sheet?: string;
    perspective?: string;
  }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const {
    state,
    tier: tierQuery,
    voice: voiceQuery,
    perf,
    sheet,
    perspective: perspectiveQuery,
  } = await searchParams;
  const normalizedState = typeof state === "string" ? (STATE_ALIASES[state] ?? state) : "normal";
  const scenario: Scenario = Object.prototype.hasOwnProperty.call(SCENARIO_LABELS, normalizedState)
    ? (normalizedState as Scenario)
    : "normal";
  const tier: OrbQualityTier | undefined =
    tierQuery === "0" || tierQuery === "1" || tierQuery === "2" || tierQuery === "3"
      ? Number(tierQuery) as OrbQualityTier
      : undefined;
  const showPerf = perf === "1";
  const perspectiveFixture: PerspectiveFixture =
    typeof perspectiveQuery === "string" &&
    Object.prototype.hasOwnProperty.call(PERSPECTIVE_FIXTURES, perspectiveQuery)
      ? perspectiveQuery as PerspectiveFixture
      : "completo";
  const perspectiveOpen = sheet === "perspectiva";
  const voice: OrbVoiceState =
    voiceQuery === "listening" ||
    voiceQuery === "thinking" ||
    voiceQuery === "responding"
      ? voiceQuery
      : "calm";
  const forcedState = state === "dawn" ? "dawn" : FORCED_LIVE_STATE[scenario];

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
                href={previewHref({ scenario: key as Scenario, tier, voice, perf: showPerf, sheet: perspectiveOpen, perspective: perspectiveFixture })}
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
                href={previewHref({ scenario, tier: item, voice, perf: showPerf, sheet: perspectiveOpen, perspective: perspectiveFixture })}
                className={`grid size-11 place-items-center rounded-full text-xs font-semibold ${tier === item ? "bg-emerald-400 text-zinc-950" : "border border-line/10 text-zinc-400"}`}
              >
                {item}
              </Link>
            ))}
            <Link
              href={previewHref({ scenario, tier, voice, perf: !showPerf, sheet: perspectiveOpen, perspective: perspectiveFixture })}
              className={`inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold ${showPerf ? "bg-emerald-400 text-zinc-950" : "border border-line/10 text-zinc-400"}`}
            >
              Perf
            </Link>
          </nav>
          <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Aura</p>
          <nav className="flex flex-wrap justify-end gap-2" aria-label="Registro de voz del orbe">
            {(["calm", "listening", "thinking", "responding"] as const).map((item) => (
              <Link
                key={item}
                href={previewHref({ scenario, tier, voice: item, perf: showPerf, sheet: perspectiveOpen, perspective: perspectiveFixture })}
                className={`inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold ${voice === item ? "bg-emerald-400 text-zinc-950" : "border border-line/10 text-zinc-400"}`}
              >
                {item}
              </Link>
            ))}
          </nav>
          <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Perspectiva</p>
          <nav className="flex max-h-[34svh] flex-wrap justify-end gap-2 overflow-y-auto" aria-label="Fixtures de perspectiva">
            {Object.entries(PERSPECTIVE_FIXTURES).map(([key, label]) => (
              <Link
                key={key}
                href={previewHref({ scenario, tier, voice, perf: showPerf, sheet: true, perspective: key as PerspectiveFixture })}
                className={`inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold ${perspectiveOpen && perspectiveFixture === key ? "bg-emerald-400 text-zinc-950" : "border border-line/10 text-zinc-400"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </details>
      <SantuarioShell
        key={`preview-${scenario}-${perspectiveFixture}-${perspectiveOpen ? "open" : "closed"}`}
        payload={payloadFor(scenario, perspectiveFixture)}
        preview={{
          forcedTier: tier,
          forcedState,
          forcedVoice: voice,
          showPerf,
          initialPerspectiveOpen: perspectiveOpen,
        }}
      />
    </div>
  );
}
