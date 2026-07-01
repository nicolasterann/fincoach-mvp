import {
  accountReviewable,
  buildOnboardingDraft,
  debtReviewable,
  expenseReviewable,
  goalReviewable,
  incomeReviewable,
  parseFxRateString,
  parseMoney,
  sanitizeIsoDate,
  wizardReadiness,
  type WizardAccount,
  type WizardDebt,
  type WizardExpense,
  type WizardGoal,
  type WizardIncome,
  type WizardState,
} from "@/lib/onboarding/wizard-model";
import { buildTemplateCsv, parseTemplateCsv } from "@/lib/onboarding/csv-template";
import { buildDraftMargenPreview } from "@/lib/onboarding/draft-margen-preview";
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
function baseState(over: Partial<WizardState> = {}): WizardState {
  return {
    profile: { fullName: "Gabriel", country: "Argentina", baseCurrency: "ARS" as CurrencyCode },
    accounts: [], incomes: [], expenses: [], debts: [], noDebts: false, goals: [],
    reserves: { monthlySavings: "", monthlyInvestment: "" },
    categoryBudgets: [],
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
