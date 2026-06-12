import { applyOnboardingDraftPatch } from "@/lib/ai/onboarding/apply-onboarding-draft-patch";
import {
  evaluateSeedGate,
  executeOnboardingTool,
} from "@/lib/ai/onboarding/onboarding-agent";
import type { OnboardingDraft } from "@/lib/onboarding/draft-types";
import { createInitialOnboardingConversationState } from "@/lib/onboarding/helpers";
import {
  buildDebtQuickFormPatch,
  countStalledTurn,
  describeDebtQuickFormResult,
  isDebtPayoffGoalWithoutAmount,
  resolveCollectionAdvance,
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

  // ── 5. Goal hygiene: "pagar mi deuda" never becomes a dead goal ────────
  assert(
    '"Pagar deuda de tarjeta" sin monto se filtra (no es meta de ahorro)',
    isDebtPayoffGoalWithoutAmount("Pagar deuda de tarjeta", undefined) &&
      isDebtPayoffGoalWithoutAmount("pagar mi tarjeta", 0) &&
      !isDebtPayoffGoalWithoutAmount("Pagar deuda de tarjeta", 500) &&
      !isDebtPayoffGoalWithoutAmount("Viaje a Europa", undefined),
    "payoff sin monto → fuera; con monto explícito o meta normal → pasa",
  );

  // ── 6. Direct review edits land on the draft (and only on the target) ──
  const editPatch = applyOnboardingDraftPatch(result, {
    accounts: { upsert: [] },
    profile: { essentialMonthlyEstimate: 550, monthlySavings: 250 },
  });
  const edited = applyOnboardingDraftPatch(editPatch, {
    fixedExpenses: { upsert: [{ draftId: "fix-1", name: "Spotify", amount: 7.99 }] },
  });
  const editedAgain = applyOnboardingDraftPatch(edited, {
    fixedExpenses: { upsert: [{ draftId: "fix-1", amount: 8.99 }] },
  });
  const spotify = editedAgain.fixedExpenses.find((f) => f.draftId === "fix-1");
  assert(
    "Ediciones directas del review: estimados al perfil y monto in-place",
    editedAgain.profile.essentialMonthlyEstimate === 550 &&
      editedAgain.profile.monthlySavings === 250 &&
      spotify?.amount === 8.99 &&
      spotify?.name === "Spotify" &&
      editedAgain.fixedExpenses.length === 1,
    JSON.stringify({
      esenciales: editedAgain.profile.essentialMonthlyEstimate,
      ahorro: editedAgain.profile.monthlySavings,
      spotify: spotify?.amount,
    }),
  );

  // ── 7. AI-first advance: phrasing never vetoes, only seed quality does ──
  const aiAdvanceOk = resolveCollectionAdvance({
    aiProposedAdvance: true,
    stepComplete: true,
    markedEmptyByPatch: false,
    userClosedFallback: false, // "ahí estamos ok" — no regex matched, AI understood
  });
  const seedVeto = resolveCollectionAdvance({
    aiProposedAdvance: true,
    stepComplete: false, // money goal still without amount
    markedEmptyByPatch: false,
    userClosedFallback: true,
  });
  const emptyOk = resolveCollectionAdvance({
    aiProposedAdvance: false,
    stepComplete: false,
    markedEmptyByPatch: true, // "no tengo deudas"
    userClosedFallback: false,
  });
  const noSignal = resolveCollectionAdvance({
    aiProposedAdvance: false,
    stepComplete: true,
    markedEmptyByPatch: false,
    userClosedFallback: false,
  });
  assert(
    'AI-first: "ahí estamos ok" avanza por decisión del AI; el código solo veta por semilla',
    aiAdvanceOk === "advance" &&
      seedVeto === "stay" &&
      emptyOk === "advance" &&
      noSignal === "stay",
    `aiAdvance=${aiAdvanceOk}, seedVeto=${seedVeto}, empty=${emptyOk}, noSignal=${noSignal}`,
  );

  // ── 8. Onboarding memory survives the patch pipeline ───────────────────
  const withNotes = applyOnboardingDraftPatch(initialDraft, {
    userContextNotes: [
      {
        draftId: "note-1",
        content: "El arriendo (900) sube cada ~3 meses; revisar el monto periódicamente.",
        noteType: "constraint",
        createdAt: new Date().toISOString(),
      },
    ],
  });
  assert(
    "userContextNotes se conservan en el draft (semilla de memoria del coach)",
    withNotes.userContextNotes.length === 1 &&
      withNotes.userContextNotes[0].content.includes("arriendo"),
    `notas: ${withNotes.userContextNotes.length}`,
  );

  // ════ Agent tool-layer field simulation (Stage 11.6) ════════════════════
  // Drives the EXACT executors + seed gate the live agent uses, replaying the
  // production QA transcript as tool calls — zero AI, runs on every build.

  const run = (draft: OnboardingDraft, name: string, args: Record<string, unknown>) =>
    applyOnboardingDraftPatch(draft, executeOnboardingTool(name, args, draft).patch);

  let sim = createInitialOnboardingConversationState().draft;
  sim = run(sim, "set_profile", { fullName: "Nico Terán", country: "Ecuador", currency: "usd" });
  sim = run(sim, "upsert_accounts", {
    accounts: [
      { name: "Pichincha", balance: 450, isPrimary: true },
      { name: "Produbanco", balance: 350 },
      { name: "Efectivo", balance: 80, type: "cash" },
      { name: "Deuna", balance: 21, type: "wallet" },
    ],
  });
  sim = run(sim, "upsert_debts", {
    debts: [
      { name: "Visa Pichincha", minimumPayment: 20, dueDay: 21 },
      { name: "Mastercard Produbanco", minimumPayment: 50, dueDay: 1 },
      { name: "Amigo (fútbol)", kind: "other_debt", totalBalance: 25 },
    ],
  });

  // ── 9. Card safety: minimum-only must BLOCK the gate ───────────────────
  const gateMinOnly = evaluateSeedGate(sim);
  assert(
    "Gate de tarjetas: con solo el pago mínimo NO se puede cerrar (anti-trampa del mínimo)",
    !gateMinOnly.ready &&
      gateMinOnly.missing.some((m) => m.includes("pago TOTAL") && m.includes("Visa Pichincha")),
    gateMinOnly.missing.filter((m) => m.includes("TOTAL")).join(" | ") || "(sin missing de tarjeta)",
  );

  // The agent asks, the user answers — re-mention updates IN PLACE.
  sim = run(sim, "upsert_debts", {
    debts: [
      { name: "Visa Pichincha", monthPaymentDue: 80 },
      { name: "mastercard produbanco", monthPaymentDue: 50 },
    ],
  });
  const visaSim = sim.debtAccounts.find((d) => d.name === "Visa Pichincha");
  assert(
    "Re-mención por nombre actualiza la misma tarjeta (mín 20 + mes 80, sin duplicar)",
    sim.debtAccounts.length === 3 &&
      visaSim?.minimumPayment === 20 &&
      visaSim?.currentMonthPayment === 80 &&
      visaSim?.dueDay === 21,
    JSON.stringify({ n: sim.debtAccounts.length, visa: { min: visaSim?.minimumPayment, mes: visaSim?.currentMonthPayment } }),
  );

  sim = run(sim, "upsert_incomes", {
    incomes: [
      { name: "Sueldo (fin de mes)", amount: 500, expectedDay: 30, destinationAccountName: "Produbanco" },
      { name: "Sueldo (inicio de mes)", amount: 1500, expectedDay: 1, destinationAccountName: "Pichincha" },
      { name: "Emprendimiento", minAmount: 0, maxAmount: 300 },
    ],
  });
  const inc1 = sim.incomeSources[0];
  assert(
    "Sueldo dividido: dos pagos con día y cuenta destino resuelta por nombre",
    sim.incomeSources.length === 3 &&
      inc1?.expectedDay === 30 &&
      Boolean(inc1?.destinationAccountDraftId) &&
      sim.incomeSources[2]?.maxExpectedAmount === 300,
    JSON.stringify({ n: sim.incomeSources.length, dia: inc1?.expectedDay, dest: Boolean(inc1?.destinationAccountDraftId) }),
  );

  // ── 10. Netflix can't be lost: named-without-amount BLOCKS ─────────────
  sim = run(sim, "upsert_fixed_expenses", {
    expenses: [
      { name: "Arriendo", amount: 900, expectedDay: 3 },
      { name: "Internet", amount: 25, expectedDay: 10 },
      { name: "Netflix" },
    ],
  });
  const gateNetflix = evaluateSeedGate(sim);
  assert(
    "Gate anti-pérdida: Netflix sin monto bloquea el cierre",
    !gateNetflix.ready && gateNetflix.missing.some((m) => m.includes("Netflix")),
    gateNetflix.missing.filter((m) => m.includes("Netflix")).join(" | ") || "(no bloqueó)",
  );
  sim = run(sim, "upsert_fixed_expenses", { expenses: [{ name: "netflix", amount: 7 }] });
  assert(
    "El monto de Netflix llega por re-mención case-insensitive sin duplicar",
    sim.fixedExpenses.length === 3 &&
      sim.fixedExpenses.find((f) => f.name?.toLowerCase() === "netflix")?.amount === 7,
    JSON.stringify({ n: sim.fixedExpenses.length }),
  );

  sim = run(sim, "set_commitments", { essentialMonthly: 550, monthlySavings: 0, monthlyInvestment: 250 });

  // ── 11. Goal seed: amount alone is NOT enough ───────────────────────────
  sim = run(sim, "upsert_goal", { name: "Crucero a Europa", targetAmount: 3500 });
  const gateGoal = evaluateSeedGate(sim);
  assert(
    "Gate de meta: sin lo guardado y sin fecha NO cierra (la meta no se cierra rápido)",
    !gateGoal.ready &&
      gateGoal.missing.some((m) => m.includes("guardado")) &&
      gateGoal.missing.some((m) => m.includes("fecha")),
    gateGoal.missing.filter((m) => m.includes("guardado") || m.includes("fecha")).join(" | "),
  );
  sim = run(sim, "upsert_goal", { name: "Crucero a Europa", currentAmount: 0, targetDate: "2027-07-01" });
  sim = run(sim, "remember_note", { noteType: "goal_context", content: "Meta para 'el próximo año' (fecha aproximada jul 2027)." });
  sim = run(sim, "set_tone", { tone: "playful" });

  // ── 12. Full seed passes; vague-date alternative passes with confirm ───
  const gateFinal = evaluateSeedGate(sim);
  assert(
    "Semilla completa del QA de campo: el gate abre la revisión",
    gateFinal.ready,
    gateFinal.ready ? "ready" : `faltan: ${gateFinal.missing.join("; ")}`,
  );
  const goalNoDate = (() => {
    let d = createInitialOnboardingConversationState().draft;
    d = run(d, "set_profile", { fullName: "Ana", country: "Ecuador", currency: "USD" });
    d = run(d, "upsert_accounts", { accounts: [{ name: "Banco", balance: 100, isPrimary: true }] });
    d = run(d, "mark_no_debts", {});
    d = run(d, "upsert_incomes", { incomes: [{ name: "Sueldo", amount: 800, expectedDay: 1 }] });
    d = run(d, "set_commitments", { essentialMonthly: 200, monthlySavings: 0 });
    d = run(d, "upsert_goal", { name: "Colchón", targetAmount: 500, currentAmount: 0 });
    d = run(d, "set_tone", { tone: "clear" });
    return d;
  })();
  // Ana has zero fixed expenses, so her gate ALSO requires the explicit
  // no-fixed confirmation (the sim-found rule): both confirms together pass.
  assert(
    'Meta sin fecha y sin fijos: bloquea normal, pasa SOLO con los confirms explícitos ("no sé"/"no tengo")',
    !evaluateSeedGate(goalNoDate).ready &&
      !evaluateSeedGate(goalNoDate, { confirmNoGoalDate: true }).ready &&
      evaluateSeedGate(goalNoDate, {
        confirmNoGoalDate: true,
        confirmNoFixedExpenses: true,
      }).ready,
    `normal=${evaluateSeedGate(goalNoDate).ready}, soloFecha=${evaluateSeedGate(goalNoDate, { confirmNoGoalDate: true }).ready}, ambos=${evaluateSeedGate(goalNoDate, { confirmNoGoalDate: true, confirmNoFixedExpenses: true }).ready}`,
  );

  assert(
    "El review recibe todo: notas, tono, commitments e ingresos con destino",
    sim.userContextNotes.length >= 1 &&
      sim.coachPreferences.tone === "playful" &&
      sim.profile.monthlyInvestment === 250 &&
      sim.profile.essentialMonthlyEstimate === 550,
    JSON.stringify({ notas: sim.userContextNotes.length, tono: sim.coachPreferences.tone, inv: sim.profile.monthlyInvestment }),
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
