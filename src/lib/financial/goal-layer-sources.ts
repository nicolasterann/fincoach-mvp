// M7 · C5 — identity-only view model for the Metas layer. No amount enters or
// leaves this module: it joins the names that already accompany goals, savings
// plans and investments, preserving null when a source did not expose a name.

export type GoalLayerSourceKind = "goal" | "savings" | "investment";

export interface GoalLayerSource {
  id: string;
  kind: GoalLayerSourceKind;
  name: string | null;
  label: string;
  nameAvailable: boolean;
}

export interface GoalLayerSources {
  items: GoalLayerSource[];
  readable: {
    goals: boolean;
    savingsPlans: boolean;
    investments: boolean;
  };
}

const visibleName = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

function source(
  id: string,
  kind: GoalLayerSourceKind,
  name: string | null | undefined,
): GoalLayerSource {
  const readableName = visibleName(name);
  return {
    id,
    kind,
    name: readableName,
    label: readableName ?? "Nombre no disponible",
    nameAvailable: readableName !== null,
  };
}

export function buildGoalLayerSources({
  goals,
  savingsPlans,
  investments,
  readable,
}: {
  goals: { id: string; name: string | null | undefined }[];
  savingsPlans: {
    id: string;
    kind: "savings" | "investment";
    name: string | null | undefined;
  }[];
  investments: { id: string; name: string | null | undefined }[];
  readable: GoalLayerSources["readable"];
}): GoalLayerSources {
  return {
    items: [
      ...goals.map((item) => source(item.id, "goal", item.name)),
      ...savingsPlans.map((item) =>
        source(item.id, item.kind, item.name),
      ),
      ...investments.map((item) =>
        source(item.id, "investment", item.name),
      ),
    ],
    readable,
  };
}
