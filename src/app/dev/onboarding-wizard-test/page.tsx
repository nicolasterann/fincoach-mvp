import {
  accountReviewable,
  buildOnboardingDraft,
  composeFxRateString,
  debtReviewable,
  expenseReviewable,
  goalReviewable,
  incomeReviewable,
  parseFxRateString,
  parseFxRateValue,
  parseMoney,
  sanitizeIsoDate,
  sumGoalContributions,
  wizardFxMissing,
  wizardReadiness,
  type WizardAccount,
  type WizardAsset,
  type WizardDebt,
  type WizardExpense,
  type WizardGoal,
  type WizardIncome,
  type WizardState,
} from "@/lib/onboarding/wizard-model";
import { GOAL_DEFAULT_NAMES } from "@/lib/onboarding/wizard-constants";
import { isDebtPayoffGoalWithoutAmount } from "@/lib/onboarding/onboarding-guards";
import { buildTemplateCsv, parseTemplateCsv } from "@/lib/onboarding/csv-template";
import { WEEKS_PER_MONTH, buildDraftCapacity, buildDraftMargenPreview } from "@/lib/onboarding/draft-margen-preview";
import type { CurrencyCode } from "@/types/financial";

// Stage 22 / 22.1 — deterministic gate for the structured onboarding (separate
// from the 158-assertion capture-test). Open /dev/onboarding-wizard-test → N/N.

type Check = { name: string; pass: boolean; detail: string };

function acc(o: Partial<WizardAccount>): WizardAccount {
  return { id: "a", name: "", type: "bank", balance: "", currency: "USD", liquidity: "liquid", isGoalAccount: false, isPrimary: false, returnRate: "", ...o };
}
function inc(o: Partial<WizardIncome>): WizardIncome {
  return { id: "i", name: "", amount: "", currency: "USD", frequency: "monthly", expectedDay: "", lastPayDate: "", isVariable: false, minAmount: "", maxAmount: "", destinationAccountId: "", ...o };
}
function exp(o: Partial<WizardExpense>): WizardExpense {
  return { id: "e", name: "", amount: "", currency: "USD", category: "housing", frequency: "monthly", expectedDay: "", isEssential: true, paymentSourceId: "", ...o };
}
function debt(o: Partial<WizardDebt>): WizardDebt {
  return { id: "d", name: "", type: "credit_card", balance: "", currentMonthPayment: "", minimumPayment: "", currency: "USD", dueDay: "", cutoffDay: "", interestRate: "", defaultPaymentAccountId: "", ...o };
}
function goal(o: Partial<WizardGoal>): WizardGoal {
  return { id: "g", name: "", archetype: "specific_purchase", targetAmount: "", currentAmount: "", currency: "USD", targetDate: "", ...o };
}
function asset(o: Partial<WizardAsset>): WizardAsset {
  return { id: "as", name: "", assetClass: "investment", value: "", currency: "USD", liquid: false, includeInNetWorth: true, expectedReturn: "", ...o };
}
function baseState(over: Partial<WizardState> = {}): WizardState {
  return {
    profile: { fullName: "Gabriel", country: "Argentina", baseCurrency: "ARS" as CurrencyCode },
    accounts: [], incomes: [], expenses: [], debts: [], noDebts: false, goals: [],
    reserves: { monthlySavings: "", monthlyInvestment: "" },
    categoryBudgets: [],
    categoryBudgetCurrency: "",
    prefs: { tone: "playful", strictness: "balanced" }, fxRate: "", note: "",
    ...over,
  };
}

function runChecks(): Check[] {
  const c: Check[] = [];
  const eq = (name: string, got: unknown, want: unknown) =>
    c.push({ name, pass: JSON.stringify(got) === JSON.stringify(want), detail: `got ${JSON.stringify(got)} · want ${JSON.stringify(want)}` });
  const ok = (name: string, pass: boolean, detail = "") => c.push({ name, pass, detail });

  // ── parseMoney ──
  eq("parseMoney 1500", parseMoney("1500"), 1500);
  eq("parseMoney 1.500 (dot thousands)", parseMoney("1.500"), 1500);
  eq("parseMoney 1,500 (comma thousands)", parseMoney("1,500"), 1500);
  eq("parseMoney 1500.50", parseMoney("1500.50"), 1500.5);
  eq("parseMoney 1.500,50 (LatAm)", parseMoney("1.500,50"), 1500.5);
  eq("parseMoney 1,500.50 (US)", parseMoney("1,500.50"), 1500.5);
  eq("parseMoney $1,250", parseMoney("$1,250"), 1250);
  eq("parseMoney '1250 ARS'", parseMoney("1250 ARS"), 1250);
  eq("parseMoney 3,5", parseMoney("3,5"), 3.5);
  eq("parseMoney 1.250.000", parseMoney("1.250.000"), 1250000);
  eq("parseMoney -200", parseMoney("-200"), -200);
  eq("parseMoney text→undefined", parseMoney("abc"), undefined);
  eq("parseMoney empty→undefined", parseMoney(""), undefined);
  eq("parseMoney spaces→undefined", parseMoney("   "), undefined);

  // ── sanitizeIsoDate (P0: a bad date must not reach the date column) ──
  eq("sanitizeIsoDate valid", sanitizeIsoDate("2026-12-31"), "2026-12-31");
  eq("sanitizeIsoDate 'dic 2026'→undefined", sanitizeIsoDate("dic 2026"), undefined);
  eq("sanitizeIsoDate '12/2026'→undefined", sanitizeIsoDate("12/2026"), undefined);
  eq("sanitizeIsoDate '2026-13-40'→undefined", sanitizeIsoDate("2026-13-40"), undefined);
  eq("sanitizeIsoDate empty→undefined", sanitizeIsoDate(""), undefined);

  // ── reviewability ──
  ok("account reviewable (name)", accountReviewable(acc({ name: "Banco" })));
  ok("account NOT reviewable (empty)", !accountReviewable(acc({ name: "  " })));
  ok("account NOT reviewable ('Cuenta')", !accountReviewable(acc({ name: "Cuenta" })));
  ok("income reviewable (amount)", incomeReviewable(inc({ amount: "1000" })));
  ok("income reviewable (variable min only)", incomeReviewable(inc({ isVariable: true, minAmount: "800" })));
  ok("income NOT reviewable (no amount/min)", !incomeReviewable(inc({})));
  ok("expense reviewable (amount)", expenseReviewable(exp({ amount: "400" })));
  ok("expense NOT reviewable (no amount)", !expenseReviewable(exp({})));
  ok("debt reviewable (name)", debtReviewable(debt({ name: "Visa" })));
  ok("debt reviewable (amount only)", debtReviewable(debt({ name: "", balance: "800" })));
  ok("debt NOT reviewable (empty)", !debtReviewable(debt({ name: "" })));
  ok("goal reviewable (organize, no amount)", goalReviewable(goal({ archetype: "organize_month" })));
  ok("goal NOT reviewable (purchase, no amount)", !goalReviewable(goal({ name: "Viaje", archetype: "specific_purchase" })));
  ok("goal reviewable (purchase + amount)", goalReviewable(goal({ name: "Viaje", archetype: "specific_purchase", targetAmount: "2000" })));

  // ── readiness = real /app gate (>=1 account AND >=1 goal) ──
  const ready = baseState({ accounts: [acc({ id: "a1", name: "Banco", balance: "1000", currency: "ARS" })], goals: [goal({ id: "g1", archetype: "organize_month", currency: "ARS" })] });
  ok("readiness canFinish (1 acct + 1 goal)", wizardReadiness(ready).canFinish);
  ok("readiness blocked (no goal)", !wizardReadiness(baseState({ accounts: ready.accounts })).canFinish);
  ok("readiness blocked (no account)", !wizardReadiness(baseState({ goals: ready.goals })).canFinish);

  // ── buildOnboardingDraft: full rich mapping ──
  const full = baseState({
    accounts: [
      acc({ id: "acc1", name: "Banco BA", balance: "1.250,50", currency: "ARS", isPrimary: true }),
      acc({ id: "acc2", name: "Broker", balance: "5000", currency: "USD", liquidity: "non_liquid", returnRate: "8" }),
    ],
    debts: [debt({ id: "deb1", name: "Visa", balance: "800", currentMonthPayment: "200", minimumPayment: "50", currency: "USD", dueDay: "15", cutoffDay: "28", interestRate: "38", defaultPaymentAccountId: "acc1" })],
    incomes: [
      inc({ id: "inc1", name: "Sueldo", amount: "2.250.000", currency: "ARS", frequency: "monthly", expectedDay: "1", destinationAccountId: "acc1" }),
      inc({ id: "inc2", name: "Freelance", isVariable: true, minAmount: "800", maxAmount: "2000", currency: "USD" }),
    ],
    expenses: [exp({ id: "exp1", name: "Arriendo", amount: "400", currency: "USD", category: "housing", paymentSourceId: "deb1", isEssential: false })],
    goals: [goal({ id: "goal1", name: "Colchón", archetype: "emergency_savings", targetAmount: "5000", currentAmount: "1200", currency: "USD", targetDate: "dic 2026" })],
    reserves: { monthlySavings: "300", monthlyInvestment: "200" },
    categoryBudgets: [{ category: "food", amount: "400" }, { category: "transport", amount: "200" }],
    fxRate: "1 USD = 1200 ARS",
  });
  const d = buildOnboardingDraft(full);
  eq("draft account balance parsed", d.accounts[0].currentBalance, 1250.5);
  eq("draft income amount parsed (grouping)", d.incomeSources[0].amount, 2250000);
  eq("draft VARIABLE income → min/max", [d.incomeSources[1].minExpectedAmount, d.incomeSources[1].maxExpectedAmount], [800, 2000]);
  eq("draft variable income isVariable", d.incomeSources[1].isVariable, true);
  eq("draft income destination wired", d.incomeSources[0].destinationAccountDraftId, "acc1");
  eq("draft debt total parsed", d.debtAccounts[0].totalBalance, 800);
  eq("draft debt 'a pagar este mes' (currentMonthPayment)", d.debtAccounts[0].currentMonthPayment, 200);
  eq("draft debt minimum", d.debtAccounts[0].minimumPayment, 50);
  eq("draft debt cutoffDay", d.debtAccounts[0].cutoffDay, 28);
  eq("draft expense isEssential=false honored", d.fixedExpenses[0].isEssential, false);
  eq("draft expense source = debt_account", d.fixedExpenses[0].paymentSourceType, "debt_account");
  eq("draft goal currentAmount", d.goals[0].currentAmount, 1200);
  eq("draft goal BAD date sanitized to undefined", d.goals[0].targetDate, undefined);
  eq("draft savings reserve parsed", d.profile.monthlySavings, 300);
  eq("draft essentials = SUM of category budgets (400+200)", d.profile.essentialMonthlyEstimate, 600);
  eq("draft categoryBudgets mapped", d.categoryBudgets, [{ category: "food", amount: 400 }, { category: "transport", amount: 200 }]);
  eq("draft fxRate parsed from string", d.fxRate, { from: "USD", to: "ARS", rate: 1200 });
  // context notes: fx rate + investment return rate
  const noteText = d.userContextNotes.map((n) => n.content).join(" | ");
  ok("draft note: fx rate captured", /1 USD = 1200 ARS/.test(noteText));
  ok("draft note: investment return rate captured", /Broker.*8% anual/.test(noteText));
  eq("draft explicitlyEmptySteps when noDebts", buildOnboardingDraft(baseState({ noDebts: true })).explicitlyEmptySteps, ["debt_accounts"]);
  // good ISO date passes through
  eq("draft goal GOOD date kept", buildOnboardingDraft(baseState({ goals: [goal({ name: "X", targetAmount: "100", targetDate: "2026-12-31" })] })).goals[0].targetDate, "2026-12-31");

  // ── FX-honest Margen preview: never sum non-base currency at 1:1 ──
  const mc = baseState({
    profile: { fullName: "Mile", country: "Argentina", baseCurrency: "ARS" as CurrencyCode },
    accounts: [acc({ id: "a1", name: "PayPal", balance: "545", currency: "USD" })],
    incomes: [inc({ id: "i1", name: "PayPal", amount: "545", currency: "USD" })],
    goals: [goal({ id: "g1", archetype: "organize_month", currency: "ARS" })],
  });
  // base is ARS but the only money is USD → preview must NOT pretend 545 USD = 545 ARS → returns null (honest).
  ok("Margen preview excludes non-base currency when NO rate (null)", buildDraftMargenPreview(buildOnboardingDraft(mc)) === null);
  // WITH the user's rate, the USD money is CONVERTED into ARS (not dropped, not 1:1).
  const mcRate = baseState({ ...mc, fxRate: "1 USD = 1200 ARS" });
  const mcPreview = buildDraftMargenPreview(buildOnboardingDraft(mcRate));
  ok("Margen preview converts non-base with the user's rate", mcPreview !== null && mcPreview.liquidCash >= 545 * 1000);
  const sameCur = baseState({
    accounts: [acc({ id: "a1", name: "Banco", balance: "100000", currency: "ARS" })],
    incomes: [inc({ id: "i1", name: "Sueldo", amount: "300000", currency: "ARS" })],
    goals: [goal({ id: "g1", archetype: "organize_month", currency: "ARS" })],
  });
  ok("Margen preview shows for base-currency money", buildDraftMargenPreview(buildOnboardingDraft(sameCur)) !== null);

  // ── parseFxRateString ──
  eq("fx '1 USD = 1200 ARS'", parseFxRateString("1 USD = 1200 ARS"), { from: "USD", to: "ARS", rate: 1200 });
  eq("fx 'USD ARS 1.200,50'", parseFxRateString("USD ARS 1.200,50"), { from: "USD", to: "ARS", rate: 1200.5 });
  eq("fx garbage → undefined", parseFxRateString("no sé"), undefined);
  eq("fx same currency → undefined", parseFxRateString("USD USD 1"), undefined);

  // ── biweekly anchor captured as a note ──
  const anchor = buildOnboardingDraft(baseState({
    accounts: [acc({ id: "a1", name: "Banco", balance: "1000" })],
    incomes: [inc({ id: "i1", name: "Sueldo", frequency: "biweekly", amount: "545", lastPayDate: "2026-06-13" })],
    goals: [goal({ id: "g1", archetype: "organize_month" })],
  }));
  eq("income payAnchorDate mapped", anchor.incomeSources[0].payAnchorDate, "2026-06-13");
  ok("biweekly anchor captured in a note", anchor.userContextNotes.some((n) => /2026-06-13/.test(n.content)));

  // ── CSV template + parser ──
  const tpl = buildTemplateCsv();
  ok("template has BOM", tpl.charCodeAt(0) === 0xfeff);
  ok("template has header", tpl.includes("tipo,nombre,monto"));
  const tplParsed = parseTemplateCsv(tpl);
  eq("template parse ignores examples (0 items)", tplParsed.accounts.length + tplParsed.incomes.length + tplParsed.expenses.length + tplParsed.debts.length + tplParsed.goals.length, 0);
  eq("template parse no errors", tplParsed.errors.length, 0);

  const filled = [
    "tipo,nombre,monto,moneda,categoria_o_tipo,frecuencia,dia,fecha_objetivo",
    "cuenta,Banco Pichincha,1200,USD,banco,,,",
    "ingreso,Sueldo,1500,USD,,mensual,1,",
    "gasto,Arriendo,400,USD,vivienda,mensual,5,",
    "deuda,Visa,800,USD,tarjeta,,15,",
    "meta,Ordenar mi mes,,USD,,,,",
    "meta,Viaje,2000,USD,,,,2026-12-31",
  ].join("\n");
  const p = parseTemplateCsv(filled);
  eq("csv counts (acc/inc/exp/debt/goal)", [p.accounts.length, p.incomes.length, p.expenses.length, p.debts.length, p.goals.length], [1, 1, 1, 1, 2]);
  eq("csv ordenar→organize_month", p.goals[0].archetype, "organize_month");
  eq("csv expense category mapped", p.expenses[0].category, "housing");
  eq("csv debt type mapped", p.debts[0].type, "credit_card");
  eq("csv no blocking errors", p.errors.length, 0);

  const bad = [
    "tipo,nombre,monto,moneda,categoria_o_tipo,frecuencia,dia,fecha_objetivo",
    "gasto,Comida,muchísimo,USD,comida,mensual,,",
    "meta,Carro nuevo,,USD,,,,",
    "banana,Cosa rara,10,USD,,,,",
  ].join("\n");
  const pb = parseTemplateCsv(bad);
  ok("csv flags non-numeric amount", pb.errors.some((e) => /no es un n|necesita un monto/i.test(e.message)));
  ok("csv flags meta without amount", pb.errors.some((e) => /monto objetivo/i.test(e.message)));
  ok("csv flags unknown tipo", pb.errors.some((e) => /no reconocido/i.test(e.message)));
  ok("csv drops bad gasto (0 expenses)", pb.expenses.length === 0);

  const ord = parseTemplateCsv("tipo,nombre,monto,moneda,categoria_o_tipo,frecuencia,dia,fecha_objetivo\nmeta,Comprar ordenador,1500,USD,,,,");
  eq("csv 'comprar ordenador' is specific_purchase", ord.goals[0]?.archetype, "specific_purchase");
  eq("csv 'comprar ordenador' keeps amount", ord.goals[0]?.targetAmount, "1500");

  // ═══ S31 — wizard clarity / honesty / FX correctness ═══

  // ── 5.1b: STRICT fx rate value parser (micro-rates work; garbage rejected) ──
  eq("fxValue '0.00072' → 0.00072", parseFxRateValue("0.00072"), 0.00072);
  eq("fxValue '0,00072' (comma) → 0.00072", parseFxRateValue("0,00072"), 0.00072);
  eq("fxValue '1480' → 1480", parseFxRateValue("1480"), 1480);
  eq("fxValue '1 480' (space) → undefined", parseFxRateValue("1 480"), undefined);
  eq("fxValue '1480 pesos' → undefined", parseFxRateValue("1480 pesos"), undefined);
  eq("fxValue '0' (non-positive) → undefined", parseFxRateValue("0"), undefined);
  eq("fxValue empty → undefined", parseFxRateValue(""), undefined);

  // ── 5.1a: compose embeds the PARSED number, never raw text; strict charset ──
  eq("compose micro-rate canonical", composeFxRateString("ARS", "USD", "0.00072"), "1 ARS = 0.00072 USD");
  eq("compose rejects '1 480'", composeFxRateString("USD", "ARS", "1 480"), "");
  eq("compose rejects '1480 pesos'", composeFxRateString("USD", "ARS", "1480 pesos"), "");
  eq("compose→parse round-trip (micro)", parseFxRateString(composeFxRateString("ARS", "USD", "0.00072")), { from: "ARS", to: "USD", rate: 0.00072 });
  eq("compose→parse round-trip (plain)", parseFxRateString(composeFxRateString("USD", "ARS", "1480")), { from: "USD", to: "ARS", rate: 1480 });
  eq("parseFxRateString micro decimal direct", parseFxRateString("1 ARS = 0.00072 USD"), { from: "ARS", to: "USD", rate: 0.00072 });
  eq("parseFxRateString legacy LatAm grouping intact", parseFxRateString("1 USD = 1.200,50 ARS"), { from: "USD", to: "ARS", rate: 1200.5 });

  // ── 5.1c: multi-rate entries → draft.fxRates (fxRate stays entry 0) ──
  const multi = baseState({
    accounts: [acc({ id: "ma1", name: "Banco", balance: "1000", currency: "ARS" })],
    incomes: [
      inc({ id: "mi1", name: "Cliente USD", amount: "800", currency: "USD" }),
      inc({ id: "mi2", name: "Cliente EUR", amount: "100", currency: "EUR" }),
    ],
    goals: [goal({ id: "mg1", archetype: "organize_month", currency: "ARS" })],
    fxEntries: [{ target: "USD", value: "0.0005" }, { target: "EUR", value: "0,0004" }],
  });
  const md = buildOnboardingDraft(multi);
  eq("draft.fxRates carries BOTH rates", md.fxRates, [{ from: "ARS", to: "USD", rate: 0.0005 }, { from: "ARS", to: "EUR", rate: 0.0004 }]);
  eq("draft.fxRate = first entry (back-compat)", md.fxRate, { from: "ARS", to: "USD", rate: 0.0005 });
  eq("fxMissing empty with one rate per currency", wizardFxMissing(multi), []);
  const mcap = buildDraftCapacity(md);
  ok(
    "capacity converts BOTH foreign incomes via entries",
    mcap !== null && Math.abs(mcap.monthlyIncome - (800 / 0.0005 + 100 / 0.0004)) < 1,
    `got ${mcap?.monthlyIncome}`,
  );
  ok("fx context note is CANONICAL (parsed, not raw)", md.userContextNotes.some((n) => /1 ARS = 0\.0005 USD/.test(n.content)));

  // ── 5.1d: gate covers assets + goals + budget currency; skips amount-less rows ──
  const fxState = baseState({
    accounts: [
      acc({ id: "fa1", name: "Banco", balance: "1000", currency: "ARS" }),
      acc({ id: "fa2", name: "PayPal", currency: "USD" }), // foreign but NO amount → must not block
    ],
    assets: [asset({ id: "fs1", name: "Fondo", value: "5000", currency: "EUR" })],
    goals: [goal({ id: "fg1", name: "Viaje", archetype: "specific_purchase", targetAmount: "2000", currency: "MXN" })],
    categoryBudgets: [{ category: "food", amount: "400" }],
    categoryBudgetCurrency: "CLP",
  });
  eq("fxMissing covers assets+goals+budget, skips amount-less", [...wizardFxMissing(fxState)].sort(), ["CLP", "EUR", "MXN"]);
  // 5.1f: server-known rates (e.g. set via chat) cover without re-typing.
  eq(
    "fxMissing honors server knownRates",
    wizardFxMissing(fxState, [
      { from: "ARS", to: "EUR", rate: 0.00075 },
      { from: "MXN", to: "ARS", rate: 60 },
      { from: "ARS", to: "CLP", rate: 0.8 },
    ]),
    [],
  );

  // ── 5.6 / 4.2: the "varía" toggle is authoritative ──
  const staleMin = buildOnboardingDraft(baseState({ incomes: [inc({ id: "sv1", amount: "1000", minAmount: "800" })] }));
  eq("toggle OFF → isVariable false despite stale min", staleMin.incomeSources[0].isVariable, false);
  eq("toggle OFF → min NOT emitted", staleMin.incomeSources[0].minExpectedAmount, undefined);
  ok("income NOT reviewable (min without toggle)", !incomeReviewable(inc({ minAmount: "800" })));
  ok("income NOT reviewable (variable max-only)", !incomeReviewable(inc({ isVariable: true, maxAmount: "900" })));

  // ── W-P1: income + goal notes reach the draft ──
  const noted = buildOnboardingDraft(baseState({
    incomes: [inc({ id: "ni1", amount: "100", note: " me suben el sueldo en enero " })],
    goals: [goal({ id: "ng1", name: "Boda", targetAmount: "1000", note: "la boda es en marzo de 2028" })],
  }));
  eq("income note → draft notes (trimmed)", noted.incomeSources[0].notes, "me suben el sueldo en enero");
  eq("goal note → draft notes", noted.goals[0].notes, "la boda es en marzo de 2028");

  // ── 5.12: contributions only count/persist for goals that will save ──
  const ghost = goal({ id: "gg1", archetype: "specific_purchase", monthlyContribution: "50" }); // no target → dropped at save
  const funded = goal({ id: "gg2", name: "Laptop", archetype: "specific_purchase", targetAmount: "1200", monthlyContribution: "20" });
  eq("sumGoalContributions skips non-persisting goal", sumGoalContributions([ghost, funded]), 20);
  const ghostDraft = buildOnboardingDraft(baseState({ goals: [ghost, funded] }));
  eq("draft strips contribution from non-persisting goal", ghostDraft.goals[0].monthlyContribution, undefined);
  eq("draft keeps contribution on persisting goal", ghostDraft.goals[1].monthlyContribution, 20);

  // ── 4.4a: payAnchorDate + variable min flow through BOTH preview builders ──
  const anchoredState = (withAnchor: boolean) => baseState({
    accounts: [acc({ id: "aa1", name: "Banco", balance: "500000", currency: "ARS" })],
    incomes: [inc({ id: "ai1", name: "Sueldo", frequency: "biweekly", amount: "300000", currency: "ARS", lastPayDate: withAnchor ? "2026-06-26" : "" })],
    goals: [goal({ id: "ag1", archetype: "organize_month", currency: "ARS" })],
    categoryBudgets: [{ category: "food", amount: "100000" }],
  });
  const withAnchor = buildDraftMargenPreview(buildOnboardingDraft(anchoredState(true)));
  const noAnchor = buildDraftMargenPreview(buildOnboardingDraft(anchoredState(false)));
  ok("preview passes payAnchorDate (no 'no_income_date' gap)", withAnchor !== null && !withAnchor.marginGaps.some((g) => g.code === "no_income_date"));
  ok("preview still flags a missing pay anchor", noAnchor !== null && noAnchor.marginGaps.some((g) => g.code === "no_income_date"));
  const varCap = buildDraftCapacity(buildOnboardingDraft(baseState({
    incomes: [inc({ id: "vi1", isVariable: true, minAmount: "800", maxAmount: "2000", currency: "ARS" })],
  })));
  eq("capacity uses the variable minimum", varCap?.monthlyIncome, 800);
  // 4.4d: one weeks-per-month truth — the preview mirrors margen-kipu.ts (30/7).
  eq("weeks-per-month mirrors engine (30/7)", WEEKS_PER_MONTH, 30 / 7);

  // ── 4.7: single goal default-name map ──
  eq("GOAL_DEFAULT_NAMES.organize_month", GOAL_DEFAULT_NAMES.organize_month, "Ordenar mi mes");
  eq(
    "draft goal default name from the ONE map",
    buildOnboardingDraft(baseState({ goals: [goal({ archetype: "emergency_savings", targetAmount: "1000" })] })).goals[0].name,
    "Fondo de emergencia",
  );

  // ── 4.8: wizard reviewability mirrors save-actions 1:1 (predicates below encode
  // save-actions.ts isReviewable* semantics as of S31 — if that file changes, this
  // parity block must change WITH it) ──
  const savePersistsIncome = (i: { amount?: number; minExpectedAmount?: number }) =>
    i.amount !== undefined || i.minExpectedAmount !== undefined;
  const savePersistsDebt = (d: { name?: string; totalBalance?: number; minimumPayment?: number; currentMonthPayment?: number; accumulatedBalance?: number }) => {
    const nm = d.name?.trim();
    return Boolean(nm && nm !== "Deuda") || d.totalBalance !== undefined || d.minimumPayment !== undefined || d.currentMonthPayment !== undefined || d.accumulatedBalance !== undefined;
  };
  const savePersistsGoal = (g: { name?: string; archetype?: string; targetAmount?: number }) => {
    if (g.name === "Mi meta" && g.targetAmount === undefined) return false;
    if (isDebtPayoffGoalWithoutAmount(g.name, g.targetAmount)) return false;
    const hasRealName = Boolean(g.name && g.name !== "Mi meta");
    if (!hasRealName && g.archetype === undefined) return false;
    if (g.archetype !== "organize_month" && g.targetAmount === undefined) return false;
    return true;
  };
  const parityIncomes = [
    inc({ id: "pi1", amount: "1000" }),
    inc({ id: "pi2", isVariable: true, minAmount: "800" }),
    inc({ id: "pi3", minAmount: "800" }),
    inc({ id: "pi4", isVariable: true, maxAmount: "900" }),
    inc({ id: "pi5", name: "Solo nombre" }),
  ];
  const parityDebts = [
    debt({ id: "pd1", name: "Visa" }),
    debt({ id: "pd2", balance: "800" }),
    debt({ id: "pd3", currentMonthPayment: "200" }),
    debt({ id: "pd4", minimumPayment: "50" }),
    debt({ id: "pd5", type: "loan", monthlyPayment: "60" }),
    debt({ id: "pd6" }),
  ];
  const parityGoals = [
    goal({ id: "pg1", archetype: "organize_month" }),
    goal({ id: "pg2", archetype: "specific_purchase" }),
    goal({ id: "pg3", archetype: "specific_purchase", targetAmount: "2000" }),
    goal({ id: "pg4", archetype: "pay_down_debt" }),
    goal({ id: "pg5", archetype: "other" }),
    goal({ id: "pg6", name: "Viaje", archetype: "other", targetAmount: "500" }),
  ];
  const parityDraft = buildOnboardingDraft(baseState({ incomes: parityIncomes, debts: parityDebts, goals: parityGoals }));
  const incomeMismatch = parityIncomes.filter((w, ix) => incomeReviewable(w) !== savePersistsIncome(parityDraft.incomeSources[ix]));
  const debtMismatch = parityDebts.filter((w, ix) => debtReviewable(w) !== savePersistsDebt(parityDraft.debtAccounts[ix]));
  const goalMismatch = parityGoals.filter((w, ix) => goalReviewable(w) !== savePersistsGoal(parityDraft.goals[ix]));
  ok("parity: incomeReviewable === save keeps (5 fixtures)", incomeMismatch.length === 0, `mismatch: ${incomeMismatch.map((x) => x.id).join(",")}`);
  ok("parity: debtReviewable === save keeps (6 fixtures)", debtMismatch.length === 0, `mismatch: ${debtMismatch.map((x) => x.id).join(",")}`);
  ok("parity: goalReviewable === save keeps (6 fixtures)", goalMismatch.length === 0, `mismatch: ${goalMismatch.map((x) => x.id).join(",")}`);

  return c;
}

export default async function OnboardingWizardTestPage() {
  const checks = runChecks();
  const failed = checks.filter((x) => !x.pass);
  const allPass = failed.length === 0;
  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-50">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-medium text-emerald-300">Kipu dev</p>
        <h1 className="mt-1 text-2xl font-bold">Onboarding wizard — gate</h1>
        <p
          className={`mt-3 inline-block rounded-xl px-3 py-1.5 text-sm font-bold ${allPass ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}
        >
          {allPass ? `✓ ${checks.length}/${checks.length} aserciones pasan` : `✗ ${failed.length} de ${checks.length} fallan`}
        </p>
        <ul className="mt-5 flex flex-col gap-1.5">
          {checks.map((x, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className={x.pass ? "text-emerald-400" : "text-rose-400"}>{x.pass ? "✓" : "✗"}</span>
              <span className="text-zinc-300">{x.name}</span>
              {!x.pass && <span className="text-zinc-600">— {x.detail}</span>}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
