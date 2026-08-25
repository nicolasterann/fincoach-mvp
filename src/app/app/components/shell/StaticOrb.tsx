import type { CSSProperties } from "react";
import type { OrbKind } from "./shell-payload";

export function StaticOrb({
  kind,
  level,
  fog = false,
}: {
  kind: OrbKind;
  level: number | null;
  fog?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`kipu-shell-orb${fog ? " kipu-shell-orb--fog" : ""}`}
      data-orb-kind={kind}
      style={level == null ? undefined : ({ "--kipu-orb-level": `${level * 100}%` } as CSSProperties)}
    >
      <span className="kipu-shell-orb__halo" />
      <span className="kipu-shell-orb__floor" />
      <span className="kipu-shell-orb__glass">
        {level != null && <span className="kipu-shell-orb__water" />}
      </span>
    </span>
  );
}
