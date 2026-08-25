import Link from "next/link";
import { notFound } from "next/navigation";
import { SantuarioShell } from "@/app/app/components/shell/SantuarioShell";
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
  | "deuda-sin-cobertura";

const SCENARIO_LABELS: Record<Scenario, string> = {
  normal: "Normal",
  "saldo-cero": "Saldo cero",
  runway: "Runway",
  niebla: "Niebla",
  "dia-1": "Día 1",
  "deuda-con-cobertura": "Deuda con cobertura",
  "deuda-sin-cobertura": "Deuda sin cobertura",
};

const normalOrbs: ShellOrb[] = [
  { kind: "saldo", amountLabel: "82.40$", amountRaw: 82.4, subtitle: "Disponible hoy", level: 0.64, levelNote: null, emptyInvite: null },
  { kind: "reserva", amountLabel: "1,200$", amountRaw: 1200, subtitle: "Tu respaldo", level: null, levelNote: null, emptyInvite: null },
  { kind: "metas", amountLabel: "260$", amountRaw: 260, subtitle: "Por aportar este mes", level: null, levelNote: null, emptyInvite: null },
  { kind: "patrimonio", amountLabel: "3,480$", amountRaw: 3480, subtitle: "Ya invertido", level: null, levelNote: null, emptyInvite: null },
  { kind: "deuda", amountLabel: "760$", amountRaw: 760, subtitle: "Te falta pagar", level: null, levelNote: null, emptyInvite: null },
];

const basePayload: ShellPayload = {
  status: "ok",
  orbs: normalOrbs,
  pillLine: "Diners · 50.60$ · 27 de agosto",
  lastMovement: { timeLabel: "14:20", label: "Café · Produbanco", amountLabel: "−4.50$" },
  runwayLine: null,
  greetingName: "Nico",
};

const dayOneInvites: Record<OrbKind, string> = {
  saldo: "Vacío hasta mañana — vuelven 24$ al amanecer.",
  reserva: "Tu respaldo se construye solo, mes a mes. Pregúntame cómo.",
  metas: "¿Armamos tu primera meta? Cuéntame qué sueñas.",
  patrimonio: "Cuando inviertas o ahorres a largo plazo, esto crece contigo.",
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
        amountLabel: null,
        amountRaw: null,
        level: null,
        levelNote: null,
        emptyInvite: dayOneInvites[orb.kind],
      })),
      pillLine: null,
      lastMovement: null,
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

  return basePayload;
}

export default async function ShellPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { state } = await searchParams;
  const scenario: Scenario = typeof state === "string" && Object.prototype.hasOwnProperty.call(SCENARIO_LABELS, state)
    ? (state as Scenario)
    : "normal";

  return (
    <div className="min-h-screen bg-zinc-950">
      <nav className="relative z-[70] mx-auto flex max-w-5xl flex-wrap gap-2 border-b border-line/10 px-4 py-3" aria-label="Estados del santuario">
        {Object.entries(SCENARIO_LABELS).map(([key, label]) => (
          <Link
            key={key}
            href={key === "normal" ? "/dev/shell-preview" : `/dev/shell-preview?state=${key}`}
            className={`inline-flex min-h-11 items-center rounded-full px-4 text-xs font-semibold ${scenario === key ? "bg-emerald-400 text-zinc-950" : "border border-line/10 text-zinc-400"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <SantuarioShell payload={payloadFor(scenario)} />
    </div>
  );
}
