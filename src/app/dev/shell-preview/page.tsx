import Link from "next/link";
import { notFound } from "next/navigation";
import { SantuarioShell } from "@/app/app/components/shell/SantuarioShell";
import type {
  LiveOrbState,
  OrbQualityTier,
} from "@/app/app/components/shell/LiveOrb";
import type {
  OrbKind,
  ShellLater,
  ShellOrb,
  ShellPayload,
} from "@/app/app/components/shell/shell-payload";
import { buildShellPerspective } from "@/app/app/components/shell/shell-perspective";
import type { OrbVoiceState } from "@/app/app/components/shell/voice-capture-contract";
import type { ThreadTurn } from "@/lib/chat-memory/thread-view-contract";
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
  | "patrimonio-negativo"
  | "movimiento-ilegible"
  | "sin-denominador"
  | "lectura-caida";

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
  "movimiento-ilegible": "Movimiento ilegible",
  "sin-denominador": "Sin denominador",
  "lectura-caida": "Lectura caída (Metas y Patrimonio)",
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

// N2 · Las CIFRAS no se tocan (C10): son las mismas cinco que fijó M2 y que
// verificaron N0 y N1. Lo que cambia es que ahora Reserva, Metas y Deuda tienen
// nivel, con el denominador que les corresponde. Los valores salen de correr
// las funciones puras del contrato con números realistas:
//   reserveLevel({ amount: 1200, target: 2400 })            → 0.5   · "50% de tu meta"
//   goalsLevel({ pending: 260, planned: 420 })              → 0.619 · "queda 62% del aporte del mes"
//   debtCycleLevel([{ 1000 total, 620 restante, USD }])     → 0.38  · "Ciclo cubierto 38%"
const normalOrbs: ShellOrb[] = [
  { kind: "saldo", amountLabel: "82.40$", amountRaw: 82.4, subtitle: "Disponible hoy", level: 0.64, levelNote: null, emptyInvite: null, readOk: true },
  { kind: "reserva", amountLabel: "1,200$", amountRaw: 1200, subtitle: "Tu respaldo", level: 0.5, levelNote: "50% de tu meta", emptyInvite: null, readOk: true },
  { kind: "metas", amountLabel: "260$", amountRaw: 260, subtitle: "Por aportar este mes", level: 0.6190476190476191, levelNote: "queda 62% del aporte del mes", emptyInvite: null, readOk: true },
  { kind: "patrimonio", amountLabel: "3,480$", amountRaw: 3480, subtitle: "Patrimonio total", level: null, levelNote: null, emptyInvite: null, readOk: true },
  { kind: "deuda", amountLabel: "760$", amountRaw: 760, subtitle: "Te falta pagar", level: 0.38, levelNote: "Ciclo cubierto 38%", emptyInvite: null, readOk: true },
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

// N1 · `?lento=<ms>` retrasa las tandas que llegan después, para poder VER en
// un navegador el orden de aparición: el orbe y su cifra primero, y los huecos
// de la píldora, la cinta y la perspectiva con los estados de N0 hasta que
// llegan. El retraso es un ARNÉS, no una medición: la maqueta no mide nada y
// por eso sus cabeceras siguen valiendo `null`.
function delayed<T>(value: T, ms: number): Promise<T> {
  if (ms <= 0) return Promise.resolve(value);
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

const normalLater: ShellLater = {
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
  lastMovementReadFailed: false,
  serverTiming: null,
};

const emptyLater: ShellLater = {
  pillLine: null,
  pillLines: [],
  lastMovement: null,
  lastMovementReadFailed: false,
  serverTiming: null,
};

const basePayload: ShellPayload = {
  status: "ok",
  orbs: normalOrbs,
  runwayLine: null,
  greetingName: "Nico",
  dawn: null,
  // N0 — la maqueta NO midió ningún tramo de servidor, así que no inventa uno:
  // con `?metro=1` el overlay muestra `—` en cada casilla del servidor.
  serverTiming: null,
  later: Promise.resolve(normalLater),
  perspective: Promise.resolve({
    perspective: perspectiveFor("completo"),
    readFailed: false,
    serverTiming: null,
  }),
};

/** N1 · una conversación mínima para poder mirar la hoja sin sesión. */
function previewThreadTurns(): ThreadTurn[] {
  return [
    {
      id: "preview-turn-user",
      role: "user",
      author: "usuario",
      channel: "web",
      createdAtISO: "2026-08-28T14:19:00.000Z",
      text: "Gasté 4.50 en un café",
      status: null,
      receipt: null,
      attachment: null,
    },
    {
      id: "preview-turn-kipu",
      role: "assistant",
      author: "agente",
      channel: "web",
      createdAtISO: "2026-08-28T14:20:00.000Z",
      text: "Listo, lo anoté.",
      status: "success",
      receipt: {
        lines: [
          { label: "Café · Produbanco", amountLabel: "−4.50$", kindLabel: "Gasto" },
        ],
        saldoLabel: "82.40$",
        incomplete: false,
      },
      attachment: null,
    },
  ];
}

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
  slowMs = 0,
): ShellPayload {
  const shellBase: ShellPayload = {
    ...basePayload,
    later: delayed(normalLater, slowMs),
    perspective: delayed(
      {
        perspective: perspectiveFor(perspectiveFixture),
        readFailed: false,
        serverTiming: null,
      },
      slowMs * 2,
    ),
  };
  if (scenario === "niebla") {
    return {
      ...shellBase,
      status: "niebla",
      // La niebla es una lectura CAÍDA: las cinco capas se dibujan interrumpidas.
      orbs: normalOrbs.map((orb) => ({
        ...orb,
        amountLabel: null,
        amountRaw: null,
        level: null,
        readOk: false,
      })),
      later: delayed(emptyLater, slowMs),
      perspective: delayed(
        { perspective: null, readFailed: false, serverTiming: null },
        slowMs * 2,
      ),
    };
  }

  // N2 · La doctrina en pantalla: sin denominador NO se apaga el orbe, cambia la
  // materia. Reserva sin meta de respaldo y Metas sin aporte del mes pasan a
  // núcleo suspendido — que es lo que dibujaba Patrimonio desde M2.
  // N2 ronda 2 · La contracara del día uno: aquí Metas y Patrimonio SÍ se
  // cayeron, así que el anillo interrumpido es lo correcto. Las dos pantallas
  // juntas son la prueba de que la materia sigue a la afirmación.
  if (scenario === "lectura-caida") {
    return {
      ...shellBase,
      orbs: normalOrbs.map((orb) =>
        orb.kind === "metas" || orb.kind === "patrimonio"
          ? {
              ...orb,
              amountLabel: null,
              amountRaw: null,
              level: null,
              levelNote: null,
              readOk: false,
              emptyInvite:
                orb.kind === "metas"
                  ? "No puedo confirmar tus metas e inversiones ahora."
                  : "No puedo leer tu patrimonio ahora. Intenta de nuevo.",
            }
          : orb,
      ),
    };
  }

  if (scenario === "sin-denominador") {
    return {
      ...shellBase,
      orbs: normalOrbs.map((orb) =>
        orb.kind === "reserva" || orb.kind === "metas" || orb.kind === "deuda"
          ? { ...orb, level: null, levelNote: null }
          : orb,
      ),
    };
  }

  if (scenario === "movimiento-ilegible") {
    return {
      ...shellBase,
      later: delayed(
        { ...normalLater, lastMovement: null, lastMovementReadFailed: true },
        slowMs,
      ),
    };
  }

  if (scenario === "dia-1") {
    return {
      ...shellBase,
      // N2 ronda 2 · El día uno es una lectura EXITOSA con todo en cero. Antes
      // esta maqueta cableaba `amountLabel: null` para Metas y Patrimonio, y por
      // eso el orbe dibujaba «no pude leer» junto a un texto que invitaba a
      // empezar. Ahora refleja lo que el payload produce de verdad:
      // `metasRead`/`patrimonioRead` con su veredicto en `true` devuelven 0.
      orbs: normalOrbs.map((orb) => ({
        ...orb,
        amountLabel: "0$",
        amountRaw: 0,
        level: orb.kind === "saldo" ? 0 : null,
        levelNote: null,
        emptyInvite: dayOneInvites[orb.kind],
        readOk: true,
      })),
      later: delayed(emptyLater, slowMs),
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
    lento?: string;
    hilo?: string;
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
    lento,
    hilo,
  } = await searchParams;
  // N1 · el arnés de las tandas. Acotado a 5 s para que nadie deje la maqueta
  // colgada creyendo que se rompió.
  const slowMs = Math.min(5_000, Math.max(0, Number(lento) || 0));
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
        payload={payloadFor(scenario, perspectiveFixture, slowMs)}
        preview={{
          forcedTier: tier,
          forcedState,
          forcedVoice: voice,
          showPerf,
          initialPerspectiveOpen: perspectiveOpen,
          // N1 · sin sesión la acción del hilo responde «no pude leer», que es
          // correcto pero poco útil para mirar la hoja. `?hilo=demo` siembra
          // una conversación; `?hilo=cargando` la deja en camino a propósito.
          thread:
            hilo === "demo"
              ? { turns: previewThreadTurns(), complete: true, readFailed: false }
              : undefined,
        }}
      />
    </div>
  );
}
