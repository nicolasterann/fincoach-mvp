import { readFileSync } from "node:fs";
import Link from "next/link";
import {
  KipuEmpty,
  KipuError,
  KipuLoading,
  KipuNoData,
  KipuOffline,
  KIPU_STATE_KINDS,
  KIPU_STATE_SHAPES,
  kipuStateContract,
  stateDifferences,
  type KipuStateKind,
  type KipuStateShape,
} from "@/app/app/components/state";
import { MetroOverlay } from "@/app/app/components/metro/MetroOverlay";
import { StaticOrb } from "@/app/app/components/shell/StaticOrb";
import {
  ORB_KINDS,
  orbFill,
  orbMatter,
  type OrbKind,
} from "@/app/app/components/shell/shell-orb-contract";

// Bloque N0 — la superficie de aprobación del acabado. Aquí se mira la REGLA,
// no un dato: los tokens con su valor real leído de la hoja, y los cinco
// estados en sus cuatro formas, sin tener que reproducir un error de verdad.

export const dynamic = "force-dynamic";

const SECTIONS = [
  "movimiento",
  "tipografia",
  "escala",
  "duelo",
  "estados",
  "materias",
  "claro",
] as const;
type Section = (typeof SECTIONS)[number];

/** N2 · Los cuatro casos que puede dibujar el vidrio, sobre las cinco capas.
 * Patrimonio nunca acepta un nivel: su columna prueba que la materia manda. */
const ORB_MATTER_CASES: {
  title: string;
  body: string;
  amount: number | null;
  readOk: boolean;
  levelFor: (kind: OrbKind) => number | null;
}[] = [
  {
    title: "nivel",
    body: "hay denominador: agua hasta su altura",
    amount: 1200,
    readOk: true,
    levelFor: (kind) => (kind === "patrimonio" ? null : 0.62),
  },
  {
    title: "gota",
    body: "leí y da cero: vacío a propósito",
    amount: 0,
    readOk: true,
    levelFor: () => 0,
  },
  {
    title: "gota (leí y no hay nada)",
    body: "monto ausente CON lectura buena: sigue siendo un cero leído",
    amount: null,
    readOk: true,
    levelFor: () => null,
  },
  {
    title: "nucleo",
    body: "hay materia, no hay techo honesto",
    amount: 3480,
    readOk: true,
    levelFor: () => null,
  },
  {
    title: "sin-dato",
    body: "NO se pudo leer: silueta interrumpida",
    amount: null,
    readOk: false,
    levelFor: () => null,
  },
];

const SHAPE_LABEL: Record<KipuStateShape, string> = {
  orbe: "Orbe",
  tarjeta: "Tarjeta",
  linea: "Línea",
  hoja: "Hoja",
};

const KIND_LABEL: Record<KipuStateKind, string> = {
  cargando: "Cargando",
  vacio: "Vacío",
  "sin-dato": "Sin dato",
  "sin-senal": "Sin señal",
  error: "Error",
};

/** Los tokens se LEEN de la hoja: la página no puede mentir sobre su valor. */
function readTokens(): { name: string; value: string }[] {
  const css = readFileSync(`${process.cwd()}/src/app/globals.css`, "utf8");
  const start = css.indexOf("/* ── Bloque N0: la regla ─");
  if (start < 0) return [];
  const block = css.slice(start, css.indexOf("\n}\n", start));
  return [...block.matchAll(/^\s*(--kipu-[a-z0-9-]+):\s*([^;]+);/gmu)].map((m) => ({
    name: m[1],
    value: m[2].trim(),
  }));
}

function TokenTable({
  title,
  prefix,
  tokens,
}: {
  title: string;
  prefix: string;
  tokens: { name: string; value: string }[];
}) {
  const rows = tokens.filter((token) => token.name.startsWith(prefix));
  return (
    <div className="kipu-sistema-card">
      <p className="kipu-sistema-kicker">{title}</p>
      <dl className="kipu-sistema-tokens">
        {rows.map((token) => (
          <div key={token.name}>
            <dt>{token.name}</dt>
            <dd>{token.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StateCell({ kind, shape }: { kind: KipuStateKind; shape: KipuStateShape }) {
  const label = `${KIND_LABEL[kind]} · ${SHAPE_LABEL[shape]}`;
  if (kind === "cargando") return <KipuLoading shape={shape} label={label} />;
  if (kind === "vacio") {
    return (
      <KipuEmpty
        shape={shape}
        label={label}
        invitation="Cuéntame tu primer gasto y esto se llena."
      />
    );
  }
  if (kind === "sin-dato") return <KipuNoData shape={shape} label={label} />;
  if (kind === "sin-senal") return <KipuOffline shape={shape} label={label} />;
  return <KipuError shape={shape} label={label} />;
}

function StateMatrix() {
  return (
    <div className="kipu-sistema-matrix">
      {KIPU_STATE_SHAPES.map((shape) => (
        <div key={shape} className="kipu-sistema-matrix__band" data-band={shape}>
          <p className="kipu-sistema-kicker">{SHAPE_LABEL[shape]}</p>
          <div className="kipu-sistema-row">
            {KIPU_STATE_KINDS.map((kind) => (
              <div key={kind} className="kipu-sistema-slot" data-slot-shape={shape}>
                <p className="kipu-sistema-slot__name">{KIND_LABEL[kind]}</p>
                <StateCell kind={kind} shape={shape} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function SistemaPage({
  searchParams,
}: {
  searchParams: Promise<{ seccion?: string | string[] }>;
}) {
  // `?seccion=` aísla UNA sección. Aprobar un acabado en un teléfono es más
  // fácil de a una cosa, y así cada pieza se puede fotografiar sin desplazar.
  const { seccion } = await searchParams;
  const asked = Array.isArray(seccion) ? seccion[0] : seccion;
  const only = (SECTIONS as readonly string[]).includes(asked ?? "")
    ? (asked as Section)
    : null;
  const show = (section: Section) => only === null || only === section;

  const tokens = readTokens();
  const separation = stateDifferences("vacio", "sin-dato");
  const empty = kipuStateContract("vacio");
  const noData = kipuStateContract("sin-dato");

  return (
    <main className="kipu-sistema">
      <MetroOverlay serverTiming={null} />
      <header className="kipu-sistema-head">
        <p className="kipu-sistema-kicker">Dev · Bloque N0</p>
        <h1>El sistema</h1>
        <p className="kipu-sistema-lede">
          La regla contra la que se miden N1–N7. Los valores salen de{" "}
          <code>globals.css</code>: esta página los lee, no los repite. Enciende
          el metro con{" "}
          <Link href="/dev/sistema?metro=1" className="kipu-sistema-link">
            ?metro=1
          </Link>
          .
        </p>
        <nav className="kipu-sistema-nav" aria-label="Secciones">
          <Link href="/dev/sistema" aria-current={only === null ? "page" : undefined}>
            todo
          </Link>
          {SECTIONS.map((section) => (
            <Link
              key={section}
              href={`/dev/sistema?seccion=${section}`}
              aria-current={only === section ? "page" : undefined}
            >
              {section}
            </Link>
          ))}
        </nav>
      </header>

      {show("movimiento") && (
        <section className="kipu-sistema-section">
          <h2>Movimiento</h2>
          <p className="kipu-sistema-note">
            Cuatro duraciones y tres curvas. Pasa el cursor por cada barra: usa
            su token, y ninguna transición del santuario declara ya una duración
            literal.
          </p>
          <div className="kipu-sistema-motion">
            {[
              { token: "--kipu-t-instant", use: "un control responde al dedo" },
              { token: "--kipu-t-quick", use: "algo aparece o cambia de color" },
              { token: "--kipu-t-move", use: "algo se desplaza: hojas, capas" },
              { token: "--kipu-t-settle", use: "algo se acomoda con peso" },
            ].map((item) => (
              <div key={item.token} className="kipu-sistema-motion__row">
                <span
                  className="kipu-sistema-motion__bar"
                  style={{ transitionDuration: `var(${item.token})` }}
                />
                <span>
                  <b>{item.token}</b>
                  <small>{item.use}</small>
                </span>
              </div>
            ))}
          </div>
          <div className="kipu-sistema-grid">
            <TokenTable title="Duraciones" prefix="--kipu-t-" tokens={tokens} />
            <TokenTable title="Curvas" prefix="--kipu-e-" tokens={tokens} />
          </div>
        </section>
      )}

      {show("tipografia") && (
        <section className="kipu-sistema-section">
          <h2>Tipografía</h2>
          <p className="kipu-sistema-note">
            Cinco tamaños. Y la regla que no se relaja: todo número de dinero
            lleva <code>tabular-nums</code>, así una cifra que baja de 4.311,14 a
            4.298,20 no hace saltar los dígitos.
          </p>
          <div className="kipu-sistema-card">
            <p className="kipu-sistema-type" data-size="cifra">4.311,14$</p>
            <p className="kipu-sistema-type" data-size="title">Tu Saldo de hoy</p>
            <p className="kipu-sistema-type" data-size="body">
              El cuerpo del texto vive aquí: una frase que se lee sin esfuerzo.
            </p>
            <p className="kipu-sistema-type" data-size="label">Etiqueta y controles</p>
            <p className="kipu-sistema-type" data-size="micro">PROCEDENCIA · SELLO</p>
          </div>
          <div className="kipu-sistema-grid">
            <TokenTable title="Tamaños" prefix="--kipu-fs-" tokens={tokens} />
          </div>
        </section>
      )}

      {show("escala") && (
        <section className="kipu-sistema-section">
          <h2>Espacio, esquinas y elevación</h2>
          <div className="kipu-sistema-scale">
            {["1", "2", "3", "4", "5", "6"].map((step) => (
              <span
                key={step}
                style={{ width: `var(--kipu-sp-${step})`, height: `var(--kipu-sp-${step})` }}
              />
            ))}
          </div>
          <div className="kipu-sistema-radii">
            {["1", "2", "3", "4"].map((step) => (
              <span key={step} style={{ borderRadius: `var(--kipu-r-${step})` }}>
                {step}
              </span>
            ))}
            <span style={{ borderRadius: "var(--kipu-r-full)" }}>full</span>
          </div>
          <div className="kipu-sistema-elevation">
            {["0", "1", "2"].map((step) => (
              <span key={step} style={{ boxShadow: `var(--kipu-el-${step})` }}>
                el-{step}
              </span>
            ))}
          </div>
          <div className="kipu-sistema-grid">
            <TokenTable title="Espaciado" prefix="--kipu-sp-" tokens={tokens} />
            <TokenTable title="Esquinas" prefix="--kipu-r-" tokens={tokens} />
            <TokenTable title="Elevación" prefix="--kipu-el-" tokens={tokens} />
          </div>
        </section>
      )}

      {show("duelo") && (
        <section className="kipu-sistema-section">
          <h2>Vacío no se parece a sin dato</h2>
          <p className="kipu-sistema-note">
            Es la doctrina monetaria del proyecto —«no pude leer» ≠ «no hay
            nada»— hecha visual. Difieren en {separation.length} ejes:{" "}
            {separation.join(" · ")}. Vacío afirma <b>{empty.claim}</b> con
            silueta <b>{empty.silhouette}</b> y un cero MEDIDO; sin dato afirma{" "}
            <b>{noData.claim}</b> con silueta <b>{noData.silhouette}</b> y nunca
            un número.
          </p>
          <div className="kipu-sistema-duel">
            <div>
              <p className="kipu-sistema-kicker">Vacío</p>
              <KipuEmpty
                shape="orbe"
                label="Reserva"
                invitation="Tu respaldo se construye solo, mes a mes. Pregúntame cómo."
              />
            </div>
            <div>
              <p className="kipu-sistema-kicker">Sin dato</p>
              <KipuNoData shape="orbe" label="Reserva" />
            </div>
          </div>
        </section>
      )}

      {show("estados") && (
        <section className="kipu-sistema-section">
          <h2>Los cinco estados, en sus cuatro formas</h2>
          <p className="kipu-sistema-note">
            Cinco, no cuarenta improvisaciones. Un orbe cargando es un círculo
            del tamaño del orbe, no una barra redondeada.
          </p>
          <StateMatrix />
        </section>
      )}

      {show("materias") && (
        <section className="kipu-sistema-section">
          <h2>Las materias del orbe</h2>
          <p className="kipu-sistema-note">
            La doctrina que sale de N2: <b>si el motor no puede afirmar un nivel,
            se cambia la materia — no se apaga el orbe.</b> Hasta N1 un orbe sin
            denominador era una bola de vidrio hueca, y eso comunicaba «no tienes
            nada» o «está roto». Cuál se dibuja lo decide <code>orbFill</code>,
            que es puro y que el gate ejecuta.
          </p>
          <div className="kipu-sistema-matrix">
            {ORB_MATTER_CASES.map((row) => (
              <div key={row.title} className="kipu-sistema-matrix__band">
                <p className="kipu-sistema-kicker">
                  {row.title} — {row.body}
                </p>
                <div className="kipu-sistema-row">
                  {ORB_KINDS.map((kind: OrbKind) => (
                    <div
                      key={kind}
                      className="kipu-sistema-slot"
                      data-slot-shape="orbe"
                    >
                      <p className="kipu-sistema-slot__name">
                        {kind} ·{" "}
                        {orbFill({
                          kind,
                          amount: row.amount,
                          level: row.levelFor(kind),
                          readOk: row.readOk,
                        })}
                        {orbMatter(kind) === "cristal" ? " · cristal" : ""}
                      </p>
                      <span className="kipu-sistema-orb">
                        <StaticOrb
                          kind={kind}
                          level={row.levelFor(kind)}
                          amount={row.amount}
                          readOk={row.readOk}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {show("claro") && (
        <section className="kipu-sistema-section" data-theme="light">
          <h2>El tema claro no rompe la regla</h2>
          <p className="kipu-sistema-note">
            Los mismos tokens, el mismo componente, la otra piel.
          </p>
          <div className="kipu-sistema-duel">
            <div>
              <p className="kipu-sistema-kicker">Vacío</p>
              <KipuEmpty shape="tarjeta" label="Metas" invitation="Cuéntame qué sueñas." />
            </div>
            <div>
              <p className="kipu-sistema-kicker">Sin dato</p>
              <KipuNoData shape="tarjeta" label="Metas" />
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
