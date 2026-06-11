import { applyOnboardingDraftPatch } from "@/lib/ai/onboarding/apply-onboarding-draft-patch";
import { createInitialOnboardingConversationState } from "@/lib/onboarding/helpers";
import {
  buildDebtQuickFormPatch,
  countStalledTurn,
  describeDebtQuickFormResult,
  shouldBreakStall,
  type DebtQuickFormRow,
} from "@/lib/onboarding/onboarding-guards";

// Internal QA for the onboarding anti-loop guards (Stage 11.2). Deterministic
// assertions over the pure modules — reproduces the EXACT field-QA scenario
// (Visa Pichincha mín 20 / Produbanco total 50 / Amex sin deuda) so the
// card/debt clarification loop class can never ship silently again.

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

function runChecks(): Check[] {
  const checks: Check[] = [];
  const assert = (name: string, pass: boolean, detail: string) => {
    checks.push({ name, pass, detail });
  };

  // ── 1. Stall counter & breaker ─────────────────────────────────────────
  const s1 = countStalledTurn({
    previousStalls: 0,
    draftChanged: false,
    stepAdvanced: false,
    isCollectionStep: true,
  });
  const s2 = countStalledTurn({
    previousStalls: s1,
    draftChanged: false,
    stepAdvanced: false,
    isCollectionStep: true,
  });
  assert(
    "Dos turnos sin progreso en un paso de colección disparan el breaker",
    s1 === 1 && s2 === 2 && shouldBreakStall(s2) && !shouldBreakStall(s1),
    `stalls: ${s1} → ${s2}; break en el segundo`,
  );

  const reset = countStalledTurn({
    previousStalls: 1,
    draftChanged: true,
    stepAdvanced: false,
    isCollectionStep: true,
  });
  const advance = countStalledTurn({
    previousStalls: 1,
    draftChanged: false,
    stepAdvanced: true,
    isCollectionStep: true,
  });
  assert(
    "Progreso real (draft o avance) resetea el contador",
    reset === 0 && advance === 0,
    `con cambio de draft: ${reset}; con avance de paso: ${advance}`,
  );

  // ── 2. Field-QA scenario through the structured form ───────────────────
  const initialDraft = createInitialOnboardingConversationState().draft;
  const withCards = applyOnboardingDraftPatch(initialDraft, {
    debtAccounts: {
      upsert: [
        { draftId: "debt-1", name: "Visa Pichincha", type: "credit_card" },
        { draftId: "debt-2", name: "Tarjeta Produ", type: "credit_card" },
        { draftId: "debt-3", name: "Amex Guayaquil", type: "credit_card" },
      ],
    },
  });

  const rows: DebtQuickFormRow[] = [
    { draftId: "debt-1", name: "Visa Pichincha", hasDebt: true, amount: 20, kind: "minimum", dueDay: 15 },
    { draftId: "debt-2", name: "Tarjeta Produ", hasDebt: true, amount: 50, kind: "total" },
    { draftId: "debt-3", name: "Amex Guayaquil", hasDebt: false, kind: "total" },
  ];
  const patch = buildDebtQuickFormPatch(rows, withCards.debtAccounts);
  const result = applyOnboardingDraftPatch(withCards, patch);

  const visa = result.debtAccounts.find((d) => d.draftId === "debt-1");
  const produ = result.debtAccounts.find((d) => d.draftId === "debt-2");
  const amex = result.debtAccounts.find((d) => d.draftId === "debt-3");

  assert(
    "Atribución exacta: 20 = mínimo de Visa Pichincha (con día 15)",
    visa?.minimumPayment === 20 &&
      visa?.amountInterpretation === "minimum_payment" &&
      visa?.dueDay === 15 &&
      visa?.totalBalance === undefined,
    JSON.stringify({ min: visa?.minimumPayment, interp: visa?.amountInterpretation, due: visa?.dueDay }),
  );
  assert(
    "Atribución exacta: 50 = total de Tarjeta Produ",
    produ?.totalBalance === 50 && produ?.amountInterpretation === "total_balance",
    JSON.stringify({ total: produ?.totalBalance, interp: produ?.amountInterpretation }),
  );
  assert(
    "Amex queda explícitamente sin deuda (0, no ambigua)",
    amex?.totalBalance === 0 && amex?.amountInterpretation === "total_balance",
    JSON.stringify({ total: amex?.totalBalance, interp: amex?.amountInterpretation }),
  );
  assert(
    "Sin duplicados: siguen siendo exactamente 3 deudas",
    result.debtAccounts.length === 3,
    `deudas: ${result.debtAccounts.length}`,
  );

  // ── 3. Re-applying the form updates in place (no dupes, no loss) ───────
  const rows2: DebtQuickFormRow[] = [
    { draftId: "debt-2", name: "Tarjeta Produ", hasDebt: true, amount: 80, kind: "month", dueDay: 5 },
  ];
  const result2 = applyOnboardingDraftPatch(
    result,
    buildDebtQuickFormPatch(rows2, result.debtAccounts),
  );
  const produ2 = result2.debtAccounts.find((d) => d.draftId === "debt-2");
  assert(
    "Reaplicar el formulario actualiza la misma deuda (sin duplicar)",
    result2.debtAccounts.length === 3 &&
      produ2?.currentMonthPayment === 80 &&
      produ2?.amountInterpretation === "current_month_payment" &&
      produ2?.dueDay === 5,
    JSON.stringify({ n: result2.debtAccounts.length, mes: produ2?.currentMonthPayment, due: produ2?.dueDay }),
  );

  // ── 4. Human confirmation line ─────────────────────────────────────────
  const summary = describeDebtQuickFormResult(rows);
  assert(
    "Resumen humano de confirmación",
    summary.includes("Visa Pichincha mínimo 20") &&
      summary.includes("Tarjeta Produ debes 50") &&
      summary.includes("Amex Guayaquil sin deuda"),
    summary,
  );

  return checks;
}

export default function OnboardingLoopTestPage() {
  const checks = runChecks();
  const failed = checks.filter((c) => !c.pass);

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
      <section className="mx-auto w-full max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
          Dev · QA interno onboarding
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          Anti-loop de tarjetas/deudas
        </h1>
        <p
          className={`mt-3 text-sm font-bold ${failed.length === 0 ? "text-emerald-400" : "text-rose-400"}`}
        >
          {failed.length === 0
            ? `✓ ${checks.length}/${checks.length} aserciones pasan`
            : `✗ ${failed.length} de ${checks.length} aserciones fallan`}
        </p>
        <div className="mt-5 space-y-2">
          {checks.map((c) => (
            <div
              key={c.name}
              className={`rounded-xl border p-3 ${c.pass ? "border-emerald-500/20 bg-emerald-950/30" : "border-rose-500/30 bg-rose-950/30"}`}
            >
              <p className="text-sm font-medium">
                {c.pass ? "✓" : "✗"} {c.name}
              </p>
              <p className="mt-1 break-all font-mono text-xs text-zinc-500">{c.detail}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
