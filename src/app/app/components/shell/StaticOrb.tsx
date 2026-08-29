import type { CSSProperties } from "react";
import { orbFill, orbMatter, type OrbKind } from "./shell-orb-contract";

// Bloque N2 — el orbe de CSS deja de tener una sola forma.
//
// Hasta N1 esto decía `{level != null && <span …__water />}`: **sin nivel no
// había agua, y quedaba una bola de vidrio hueca**. Es lo que el founder
// fotografió en cuatro de las cinco capas, y era mi error de M1 — preferí el
// vacío a la mentira, sin ver que el vacío también miente.
//
// Ahora la decisión no vive aquí: la toma `orbFill`, que es puro y que el gate
// EJECUTA. Este componente sólo dibuja lo que esa función dice.
//
//   nivel    → agua hasta su altura
//   gota     → una gota y su menisco en el fondo: «vacío a propósito»
//   nucleo   → núcleo suspendido: hay materia, no hay techo honesto
//   sin-dato → silueta INTERRUMPIDA, que no se puede confundir con `gota`
//              (la frontera de N0: «no pude leer» ≠ «no hay nada»)

export function StaticOrb({
  kind,
  level,
  amount,
  readOk,
  fog = false,
}: {
  kind: OrbKind;
  level: number | null;
  amount: number | null;
  /** N2 ronda 2 · El veredicto de lectura, explícito. Un monto ausente con
   * `readOk` en `true` es un cero LEÍDO, no un misterio. */
  readOk: boolean;
  fog?: boolean;
}) {
  const fill = orbFill({ kind, amount, level, readOk });
  return (
    <span
      aria-hidden="true"
      className={`kipu-shell-orb${fog ? " kipu-shell-orb--fog" : ""}`}
      data-orb-kind={kind}
      data-orb-fill={fill}
      data-orb-matter={orbMatter(kind)}
      style={level == null ? undefined : ({ "--kipu-orb-level": `${level * 100}%` } as CSSProperties)}
    >
      <span className="kipu-shell-orb__halo" />
      <span className="kipu-shell-orb__floor" />
      <span className="kipu-shell-orb__glass">
        {fill === "nivel" && <span className="kipu-shell-orb__water" />}
        {fill === "gota" && <span className="kipu-shell-orb__drop" />}
        {fill === "nucleo" && <span className="kipu-shell-orb__core" />}
      </span>
    </span>
  );
}
