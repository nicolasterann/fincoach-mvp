import type { OrbKind } from "./shell-payload";

const KNOT_X = [20, 40, 60, 80, 100];

export function QuipuLayerCord({ active, kinds }: { active: number; kinds: OrbKind[] }) {
  return (
    <svg className="kipu-shell-cord" viewBox="0 0 120 14" aria-hidden="true">
      <path className="kipu-shell-cord__line" d="M7 7 H113" />
      {kinds.map((kind, index) => (
        <circle
          key={kind}
          className="kipu-shell-cord__knot"
          data-active={index === active ? "true" : "false"}
          cx={KNOT_X[index]}
          cy="7"
          r={index === active ? 3.9 : 2.1}
        />
      ))}
    </svg>
  );
}
