import {
  accountReviewable,
  buildOnboardingDraft,
  composeFxRateString,
  computeDraftNetWorth,
  debtReviewable,
  expenseReviewable,
  goalReviewable,
  incomeReviewable,
  leftoverTone,
  parseFxRateString,
  parseFxRateValue,
  parseMoney,
  sanitizeIsoDate,
  seedMonthISO,
  sumGoalContributions,
  sumReservesByKind,
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
    reserves: [],
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
    reserves: [
      { id: "res1", kind: "savings", amount: "300", currency: "ARS" as CurrencyCode },
      { id: "res2", kind: "investment", amount: "200", currency: "ARS" as CurrencyCode },
    ],
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
  // O1 (#3) — Arriendo (housing) es esencial POR DEFINICIÓN: buildOnboardingDraft
  // fuerza esencial=true aunque el toggle guardado diga false (el motor lo reserva
  // como "required"). Las categorías ambiguas sí respetan el toggle (ver capture-test).
  eq("O1 categoría esencial-por-def fuerza esencial (ignora un false)", d.fixedExpenses[0].isEssential, true);
  eq("draft expense source = debt_account", d.fixedExpenses[0].paymentSourceType, "debt_account");
  eq("draft goal currentAmount", d.goals[0].currentAmount, 1200);
  eq("draft goal BAD date sanitized to undefined", d.goals[0].targetDate, undefined);
  eq("draft savings reserve parsed (ARS card)", d.profile.monthlySavings, 300);
  eq("draft investment reserve parsed (ARS card)", d.profile.monthlyInvestment, 200);
  // O2.1 — reserve cards sum by kind, each converted to base with the user's rate.
  // A USD card at 1 USD=1200 ARS → 120000 ARS savings; an unknown-currency card drops.
  eq("O2.1 reserves summed by kind + FX to base", sumReservesByKind(
    [
      { id: "r1", kind: "savings", amount: "100", currency: "USD" as CurrencyCode },
      { id: "r2", kind: "savings", amount: "500", currency: "ARS" as CurrencyCode },
      { id: "r3", kind: "investment", amount: "200", currency: "ARS" as CurrencyCode },
      { id: "r4", kind: "investment", amount: "9", currency: "EUR" as CurrencyCode },
    ],
    (amt, cur) => (cur === "ARS" ? amt : cur === "USD" ? amt * 1200 : undefined),
  ), { monthlySavings: 120500, monthlyInvestment: 200 });
  // ── Stage 38 — reserves become scheduled, account-linked savings_plans ──
  // Weekly weighting: sumReservesByKind returns MONTHLY-equivalent (100/sem ≈ 428.57/mes).
  eq("S38 weekly reserve → monthly-equivalent", sumReservesByKind(
    [{ id: "w1", kind: "savings", amount: "100", currency: "USD" as CurrencyCode, frequency: "weekly" }],
    (a) => a,
  ), { monthlySavings: 428.57, monthlyInvestment: 0 });
  // A yearly reserve of 1200 → 100/month monthly-equivalent (÷12) in the aggregate.
  eq("S38 yearly reserve → monthly-equivalent (÷12)", sumReservesByKind(
    [{ id: "y1", kind: "investment", amount: "1200", currency: "USD" as CurrencyCode, frequency: "yearly" }],
    (a) => a,
  ), { monthlySavings: 0, monthlyInvestment: 100 });
  const s38 = buildOnboardingDraft(baseState({
    accounts: [acc({ id: "s38acc", name: "Efectivo", balance: "0", currency: "ARS" })],
    reserves: [
      { id: "s38r1", kind: "investment", amount: "150", currency: "ARS" as CurrencyCode, frequency: "monthly", expectedDay: "5", destinationId: "s38acc" },
      { id: "s38r2", kind: "savings", amount: "50", currency: "ARS" as CurrencyCode, frequency: "weekly" },
    ],
  }));
  eq("S38 draft emits one savings_plan per reserve", s38.savingsPlans?.length, 2);
  // The monthly plan carries per-occurrence base amount + day + destination draft id.
  eq("S38 monthly reserve plan mapped", {
    amount: s38.savingsPlans?.[0].amount,
    day: s38.savingsPlans?.[0].expectedDay,
    dest: s38.savingsPlans?.[0].destinationDraftId,
    freq: s38.savingsPlans?.[0].frequency,
    kind: s38.savingsPlans?.[0].kind,
  }, { amount: 150, day: 5, dest: "s38acc", freq: "monthly", kind: "investment" });
  // The weekly plan keeps its PER-OCCURRENCE amount (50) — the calendar dates each one.
  eq("S38 weekly reserve plan keeps per-occurrence amount + cadence", {
    amount: s38.savingsPlans?.[1].amount, freq: s38.savingsPlans?.[1].frequency,
  }, { amount: 50, freq: "weekly" });
  // The aggregate profile.monthly* is the SUMMED monthly-equivalent of the SAME reserves
  // (150 monthly + 50×30/7 weekly ≈ 214.29) — single source, so no double count downstream.
  eq("S38 aggregate monthlyInvestment (monthly reserve)", s38.profile.monthlyInvestment, 150);
  eq("S38 aggregate monthlySavings (weekly→monthly-equiv)", s38.profile.monthlySavings, 214.29);
  // A reserve whose currency has no known rate is DROPPED from both the plan list and
  // the aggregate (never converted at a fabricated 1:1).
  const s38drop = buildOnboardingDraft(baseState({
    reserves: [{ id: "d1", kind: "savings", amount: "9", currency: "EUR" as CurrencyCode, frequency: "monthly" }],
  }));
  eq("S38 unknown-rate reserve dropped from plans", s38drop.savingsPlans?.length, 0);

  // O3 — leftover health: negative → over, positive-but-<12% → tight (amber), else ok.
  eq("O3 leftover negative → over", leftoverTone(-5, 1000), "over");
  eq("O3 leftover tight (<12% of disposable) → tight", leftoverTone(50, 1000), "tight");
  eq("O3 leftover zero → tight (nothing for día a día)", leftoverTone(0, 1000), "tight");
  eq("O3 leftover healthy (≥12%) → ok", leftoverTone(200, 1000), "ok");
  eq("O3 no disposable → ok (never warn)", leftoverTone(0, 0), "ok");
  // O11 — net worth (balance sheet) = accounts + assets − debts, each FX'd to base.
  eq("O11 net worth = accounts + assets − debts (FX to base)", computeDraftNetWorth(
    baseState({
      accounts: [acc({ id: "c1", name: "Banco", balance: "1000", currency: "USD" })],
      assets: [asset({ id: "as1", name: "Acciones", value: "500", currency: "USD" })],
      debts: [debt({ id: "d1", name: "Visa", balance: "300", currency: "USD" })],
    }),
    (amt, cur) => (cur === "ARS" ? amt : cur === "USD" ? amt * 1200 : undefined),
  ), { tienes: 1800000, debes: 360000, neto: 1440000 });
  eq("draft essentials = SUM of category budgets (400+200)", d.profile.essentialMonthlyEstimate, 600);
  eq("draft categoryBudgets mapped", d.categoryBudgets, [{ category: "food", amount: 400 }, { category: "transport", amount: 200 }]);
  // Item 2 — a habitual budget in its OWN currency converts per-row (USD 5 → 6000 ARS at 1200).
  eq("item2 per-row habitual currency → base", buildOnboardingDraft(baseState({
    categoryBudgets: [{ category: "food", amount: "5", currency: "USD" as CurrencyCode }],
    fxRate: "1 USD = 1200 ARS",
  })).categoryBudgets, [{ category: "food", amount: 6000 }]);
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
  // A2 — the onboarding capacity/Margen preview EXCLUDES occasional income exactly like
  // the live engines, so preview == live (a 5000 ocasional must not inflate the 1000 base).
  const occCap = buildDraftCapacity(buildOnboardingDraft(baseState({
    incomes: [
      inc({ id: "reg1", amount: "1000", currency: "ARS" }),
      inc({ id: "occ1", amount: "5000", currency: "ARS", isOccasional: true }),
    ],
  })));
  eq("A2: el preview del onboarding EXCLUYE el ingreso ocasional (1000, no 6000)", occCap?.monthlyIncome, 1000);
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

  // ═══ S32 — "Presupuesto vivo": per-category seed + expense pay anchor ═══

  // ── S32.1: seed threading (base currency, same units) ──
  const seedDraft = buildOnboardingDraft(baseState({
    categoryBudgets: [{ category: "food", amount: "500", mtdSeed: "150" }],
  }));
  eq("S32.1 seed threads to draft.categoryBudgets.mtdSeed", seedDraft.categoryBudgets?.[0], { category: "food", amount: 500, mtdSeed: 150 });
  eq("S32.1b essentials sum stays the FULL estimate (seed never shrinks it)", seedDraft.profile.essentialMonthlyEstimate, 500);

  // ── S32.2: seed converts with the SAME fx rate as the amount ──
  const seedFx = buildOnboardingDraft(baseState({
    categoryBudgets: [{ category: "food", amount: "400", mtdSeed: "150" }],
    categoryBudgetCurrency: "USD",
    fxRate: "1 USD = 1000 ARS",
  }));
  eq("S32.2 seed converted like the amount (USD→ARS @1000)", seedFx.categoryBudgets?.[0], { category: "food", amount: 400000, mtdSeed: 150000 });

  // ── S32.3: a seed WITHOUT an estimate amount is ignored (row dropped) ──
  const seedNoAmount = buildOnboardingDraft(baseState({
    categoryBudgets: [{ category: "food", amount: "", mtdSeed: "100" }, { category: "transport", amount: "200" }],
  }));
  eq("S32.3 seed without amount → row dropped (nothing to track against)", seedNoAmount.categoryBudgets, [{ category: "transport", amount: 200 }]);

  // ── S32.4: unparseable / non-positive seeds are ignored, amount kept ──
  const seedBad = buildOnboardingDraft(baseState({
    categoryBudgets: [{ category: "food", amount: "500", mtdSeed: "abc" }, { category: "transport", amount: "200", mtdSeed: "-50" }],
  }));
  eq("S32.4 garbage seed → undefined, amount kept", seedBad.categoryBudgets?.[0], { category: "food", amount: 500 });
  eq("S32.4b negative seed → undefined, amount kept", seedBad.categoryBudgets?.[1], { category: "transport", amount: 200 });

  // ── S32.5: seed > estimate is allowed (already over — warn softly, never block) ──
  const seedOver = buildOnboardingDraft(baseState({
    categoryBudgets: [{ category: "food", amount: "400", mtdSeed: "600" }],
  }));
  eq("S32.5 seed > estimate still threads (soft warn, never blocks)", seedOver.categoryBudgets?.[0]?.mtdSeed, 600);

  // ── S32.6: seed_month stamp = first day of the clock's month (ONE helper for
  // save-actions and the preview) ──
  eq("S32.6 seedMonthISO mid-month", seedMonthISO(new Date(2026, 6, 15, 12)), "2026-07-01");
  eq("S32.6b seedMonthISO December", seedMonthISO(new Date(2026, 11, 31, 23)), "2026-12-01");

  // ── S32.7: pay anchor threads for weekly/biweekly expenses, NOT monthly ──
  const anchorDraft = buildOnboardingDraft(baseState({
    expenses: [
      exp({ id: "sx1", name: "Empleada", amount: "50000", currency: "ARS", frequency: "biweekly", payAnchorDate: "2026-07-10" }),
      exp({ id: "sx2", name: "Arriendo", amount: "400000", currency: "ARS", frequency: "monthly", expectedDay: "5", payAnchorDate: "2026-07-10" }),
      exp({ id: "sx3", name: "Feria", amount: "20000", currency: "ARS", frequency: "weekly", payAnchorDate: "10/07/2026" }),
    ],
  }));
  eq("S32.7 biweekly expense payAnchorDate mapped", anchorDraft.fixedExpenses[0].payAnchorDate, "2026-07-10");
  eq("S32.7b monthly expense NEVER carries an anchor", anchorDraft.fixedExpenses[1].payAnchorDate, undefined);
  eq("S32.7c monthly expense keeps its día del mes", anchorDraft.fixedExpenses[1].expectedDay, 5);
  eq("S32.7d bad anchor date sanitized to undefined", anchorDraft.fixedExpenses[2].payAnchorDate, undefined);

  // ── S32.8: preview parity — a month-to-date seed RAISES the review Margen
  // (the 400k already spent is reflected in the low balance; without the seed the
  // engine reserved the full 500k AGAIN on top of it). Deterministic clock:
  // July 15 → 17 days left; income lands day 28, so the projection (not the
  // sustainable flow) binds and the seed's remaining-based reserve shows up. ──
  const s32Now = new Date(2026, 6, 15, 12);
  const s32State = (mtdSeed: string) => baseState({
    accounts: [acc({ id: "s32a", name: "Banco", balance: "200000", currency: "ARS" })],
    incomes: [inc({ id: "s32i", name: "Sueldo", amount: "5000000", currency: "ARS", expectedDay: "28" })],
    goals: [goal({ id: "s32g", archetype: "organize_month", currency: "ARS" })],
    categoryBudgets: [{ category: "food", amount: "500000", mtdSeed }],
  });
  const s32With = buildDraftMargenPreview(buildOnboardingDraft(s32State("400000")), s32Now);
  const s32Without = buildDraftMargenPreview(buildOnboardingDraft(s32State("")), s32Now);
  ok(
    "S32.8 preview with seed 400k/500k → margen HIGHER than without seed",
    s32With !== null && s32Without !== null && s32With.margenWeekly > s32Without.margenWeekly,
    `with ${s32With?.margenWeekly} · without ${s32Without?.margenWeekly}`,
  );

  // ── S34 — fixes de la auditoría profunda ────────────────────────────────────
  // S34.1 — meta YA lograda (llevas ya ≥ objetivo) no persiste aporte: nada que
  // financiar, el motor no debe reservar plata para siempre.
  const s34Achieved = buildOnboardingDraft(
    baseState({
      goals: [goal({ id: "ga", name: "Colchón", archetype: "emergency_savings", targetAmount: "1000", currentAmount: "1200", monthlyContribution: "150" })],
    }),
  );
  ok(
    "S34.1 achieved goal drops monthlyContribution (nothing left to fund)",
    s34Achieved.goals[0]?.monthlyContribution === undefined && s34Achieved.goals[0]?.targetAmount === 1000,
    `contribution=${String(s34Achieved.goals[0]?.monthlyContribution)}`,
  );

  // S34.2 — estimados en moneda extranjera con tasa SOLO del servidor (knownRates):
  // antes se dropeaban en silencio (el gate los dejaba pasar pero budgetToBase no
  // conocía la tasa); ahora convierten con la tasa del server y emiten los raw.
  const s34Fx = buildOnboardingDraft(
    baseState({
      categoryBudgets: [{ category: "food", amount: "148000" }],
      categoryBudgetCurrency: "ARS",
      profile: { fullName: "", country: "", baseCurrency: "USD" },
    }),
    [{ from: "USD", to: "ARS", rate: 1480 }],
  );
  ok(
    "S34.2 server-known rate converts category estimates (148000 ARS @1480 → 100$) + raw fields emitted for the server FX defense",
    s34Fx.categoryBudgets?.[0]?.amount === 100 &&
      s34Fx.categoryBudgetCurrency === "ARS" &&
      s34Fx.categoryBudgetsRaw?.[0]?.amount === 148000,
    `amount=${s34Fx.categoryBudgets?.[0]?.amount} rawCur=${s34Fx.categoryBudgetCurrency} raw=${s34Fx.categoryBudgetsRaw?.[0]?.amount}`,
  );

  // S34.3 — gasto fijo con monto negativo/cero: ni reviewable ni persistido
  // (antes se guardaba y quedaba invisible para todos los motores).
  ok(
    "S34.3 negative/zero fixed expense: not reviewable, amount dropped from draft",
    !expenseReviewable(exp({ amount: "-100" })) &&
      !expenseReviewable(exp({ amount: "0" })) &&
      buildOnboardingDraft(baseState({ expenses: [exp({ id: "en", name: "Raro", amount: "-100" })] })).fixedExpenses[0]?.amount === undefined,
    "",
  );

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
