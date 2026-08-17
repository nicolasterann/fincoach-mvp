import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function normalizeBehaviorText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizedTerminalQuestion(reply) {
  const trimmed = String(reply ?? "").trim();
  if (!trimmed.endsWith("?")) return null;
  const inverted = trimmed.lastIndexOf("¿");
  if (inverted >= 0) return normalizeBehaviorText(trimmed.slice(inverted));
  const boundary = Math.max(
    trimmed.lastIndexOf("\n"),
    trimmed.lastIndexOf("."),
    trimmed.lastIndexOf("!"),
  );
  return normalizeBehaviorText(trimmed.slice(boundary + 1));
}

export function repeatedQuestionWithoutProgress(previous, current) {
  const sameUserDelivery =
    normalizeBehaviorText(previous?.user) ===
    normalizeBehaviorText(current?.user);
  const sameReply =
    normalizeBehaviorText(previous?.reply) ===
    normalizeBehaviorText(current?.reply);
  // An exact redelivery answered exactly the same way is neutral: neither the
  // user nor the assistant supplied new information that could constitute
  // progress. Replay must not be mislabeled as a conversational loop.
  if (sameUserDelivery && sameReply) return false;
  const previousQuestion = normalizedTerminalQuestion(previous?.reply);
  const currentQuestion = normalizedTerminalQuestion(current?.reply);
  return Boolean(
    previousQuestion &&
      currentQuestion === previousQuestion &&
      current?.progress === previous?.progress,
  );
}

export function currentPlanManifest(rows, planVersion) {
  const currentVersion = Number(planVersion);
  if (!Number.isInteger(currentVersion) || currentVersion < 1) return null;
  const matches = Array.isArray(rows)
    ? rows.filter((row) => Number(row?.plan_version) === currentVersion)
    : [];
  return matches.length === 1 ? matches[0] : null;
}

export function behaviorContractIR332e() {
  const frozen = "{\"operations\":[],\"transactions\":[]}";
  const replay = repeatedQuestionWithoutProgress(
    {
      user: "¿Qué acabas de registrar y de dónde salió cada monto?",
      reply: "Registré 50 USD desde Produbanco. ¿Quieres el comprobante?",
      progress: frozen,
    },
    {
      user: "¿Qué acabas de registrar y de dónde salió cada monto?",
      reply: "Registré 50 USD desde Produbanco. ¿Quieres el comprobante?",
      progress: frozen,
    },
  );
  const embedded = repeatedQuestionWithoutProgress(
    {
      user: "Explícame el registro.",
      reply: "¿De dónde salió el monto? Salió del receipt y no necesito otro dato.",
      progress: frozen,
    },
    {
      user: "Dame el detalle.",
      reply: "¿De dónde salió el monto? Salió del receipt y no necesito otro dato.",
      progress: frozen,
    },
  );
  const realRepeat = repeatedQuestionWithoutProgress(
    {
      user: "Salió de Produbanco.",
      reply: "Todavía falta la fuente. ¿Desde qué cuenta salió?",
      progress: frozen,
    },
    {
      user: "Ya te dije la cuenta.",
      reply: "No pude probarla. ¿Desde qué cuenta salió?",
      progress: frozen,
    },
  );
  const progressed = repeatedQuestionWithoutProgress(
    {
      user: "Salió de Produbanco.",
      reply: "¿Desde qué cuenta salió?",
      progress: frozen,
    },
    {
      user: "Desde Produbanco.",
      reply: "¿Desde qué cuenta salió?",
      progress: `${frozen}:changed`,
    },
  );
  return {
    ok: !replay && !embedded && realRepeat && !progressed,
    replay,
    embedded,
    realRepeat,
    progressed,
  };
}

export function behaviorContractIR339() {
  const predecessor = {
    id: "manifest-v1",
    plan_version: 1,
    status: "rejected",
  };
  const successor = {
    id: "manifest-v2",
    plan_version: 2,
    status: "verified",
    verification: { authorized_count: 8, verified_count: 8 },
  };
  const selected = currentPlanManifest([predecessor, successor], 2);
  const missing = currentPlanManifest([predecessor, successor], 3);
  const ambiguous = currentPlanManifest([successor, { ...successor }], 2);
  return {
    ok:
      selected === successor &&
      selected.status === "verified" &&
      selected.verification.verified_count === 8 &&
      missing === null &&
      ambiguous === null,
    selected,
    missing,
    ambiguous,
  };
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  for (const [detector, result] of [
    ["IR332e", behaviorContractIR332e()],
    ["IR339", behaviorContractIR339()],
  ]) {
    if (!result.ok) {
      console.error(`${detector} · FAIL · ${JSON.stringify(result)}`);
      process.exitCode = 1;
    } else {
      console.log(`${detector} · PASS · ${JSON.stringify(result)}`);
    }
  }
}
