import {
  accountReviewable,
  buildOnboardingDraft,
  debtReviewable,
  expenseReviewable,
  goalReviewable,
  incomeReviewable,
  parseMoney,
  wizardReadiness,
  type WizardState,
} from "@/lib/onboarding/wizard-model";
import { buildTemplateCsv, parseTemplateCsv } from "@/lib/onboarding/csv-template";

// Stage 22 — deterministic gate for the structured onboarding (separate from the
// 158-assertion capture-test). Open /dev/onboarding-wizard-test and confirm N/N.

type Check = { name: string; pass: boolean; detail: string };

function baseState(): WizardState {
  return {
    profile: { fullName: "Gabriel", country: "Argentina", baseCurrency: "ARS" },
    accounts: [],
    incomes: [],
    expenses: [],
    debts: [],
    noDebts: false,
    goals: [],
    reserves: { monthlySavings: "", monthlyInvestment: "", essentialMonthlyEstimate: "" },
    prefs: { tone: "playful", strictness: "balanced" },
    note: "",
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

  // ── reviewability mirrors ──
  ok("account reviewable (name)", accountReviewable({ id: "a", name: "Banco", type: "bank", balance: "", currency: "USD", liquidity: "liquid", isGoalAccount: false, isPrimary: false }));
  ok("account NOT reviewable (empty)", !accountReviewable({ id: "a", name: "  ", type: "bank", balance: "", currency: "USD", liquidity: "liquid", isGoalAccount: false, isPrimary: false }));
  ok("account NOT reviewable ('Cuenta')", !accountReviewable({ id: "a", name: "Cuenta", type: "bank", balance: "", currency: "USD", liquidity: "liquid", isGoalAccount: false, isPrimary: false }));
  ok("income reviewable (amount)", incomeReviewable({ id: "i", name: "Sueldo", amount: "1000", currency: "USD", frequency: "monthly", expectedDay: "", isVariable: false, destinationAccountId: "" }));
  ok("income NOT reviewable (no amount)", !incomeReviewable({ id: "i", name: "Sueldo", amount: "", currency: "USD", frequency: "monthly", expectedDay: "", isVariable: false, destinationAccountId: "" }));
  ok("expense reviewable (amount)", expenseReviewable({ id: "e", name: "Arriendo", amount: "400", currency: "USD", category: "housing", frequency: "monthly", expectedDay: "", isEssential: true, paymentSourceId: "" }));
  ok("expense NOT reviewable (no amount)", !expenseReviewable({ id: "e", name: "Arriendo", amount: "", currency: "USD", category: "housing", frequency: "monthly", expectedDay: "", isEssential: true, paymentSourceId: "" }));
  ok("debt reviewable (name)", debtReviewable({ id: "d", name: "Visa", type: "credit_card", balance: "", minimumPayment: "", currency: "USD", dueDay: "", interestRate: "", defaultPaymentAccountId: "" }));
  ok("debt reviewable (amount only)", debtReviewable({ id: "d", name: "", type: "credit_card", balance: "800", minimumPayment: "", currency: "USD", dueDay: "", interestRate: "", defaultPaymentAccountId: "" }));
  ok("debt NOT reviewable (empty)", !debtReviewable({ id: "d", name: "", type: "credit_card", balance: "", minimumPayment: "", currency: "USD", dueDay: "", interestRate: "", defaultPaymentAccountId: "" }));
  ok("goal reviewable (organize, no amount)", goalReviewable({ id: "g", name: "", archetype: "organize_month", targetAmount: "", currency: "USD", targetDate: "" }));
  ok("goal NOT reviewable (purchase, no amount)", !goalReviewable({ id: "g", name: "Viaje", archetype: "specific_purchase", targetAmount: "", currency: "USD", targetDate: "" }));
  ok("goal reviewable (purchase + amount)", goalReviewable({ id: "g", name: "Viaje", archetype: "specific_purchase", targetAmount: "2000", currency: "USD", targetDate: "" }));

  // ── wizardReadiness = real /app gate (>=1 account AND >=1 goal) ──
  const ready = baseState();
  ready.accounts = [{ id: "a1", name: "Banco", type: "bank", balance: "1000", currency: "ARS", liquidity: "liquid", isGoalAccount: false, isPrimary: true }];
  ready.goals = [{ id: "g1", name: "", archetype: "organize_month", targetAmount: "", currency: "ARS", targetDate: "" }];
  ok("readiness canFinish (1 acct + 1 goal)", wizardReadiness(ready).canFinish);
  const noGoal = { ...ready, goals: [] };
  ok("readiness blocked (no goal)", !wizardReadiness(noGoal).canFinish);
  const noAcct = { ...ready, accounts: [] };
  ok("readiness blocked (no account)", !wizardReadiness(noAcct).canFinish);

  // ── buildOnboardingDraft mapping ──
  const full = baseState();
  full.accounts = [{ id: "acc1", name: "Banco BA", type: "bank", balance: "1.250,50", currency: "ARS", liquidity: "liquid", isGoalAccount: false, isPrimary: true }];
  full.debts = [{ id: "deb1", name: "Visa", type: "credit_card", balance: "800", minimumPayment: "50", currency: "USD", dueDay: "15", interestRate: "38", defaultPaymentAccountId: "acc1" }];
  full.incomes = [{ id: "inc1", name: "Sueldo", amount: "2.250.000", currency: "ARS", frequency: "monthly", expectedDay: "1", isVariable: false, destinationAccountId: "acc1" }];
  full.expenses = [{ id: "exp1", name: "Tarjeta", amount: "800", currency: "USD", category: "debt", frequency: "monthly", expectedDay: "15", isEssential: true, paymentSourceId: "deb1" }];
  full.goals = [{ id: "goal1", name: "Colchón", archetype: "emergency_savings", targetAmount: "5000", currency: "USD", targetDate: "2026-12-31" }];
  full.reserves = { monthlySavings: "300", monthlyInvestment: "200", essentialMonthlyEstimate: "" };
  const draft = buildOnboardingDraft(full);
  eq("draft account balance parsed", draft.accounts[0].currentBalance, 1250.5);
  eq("draft income amount parsed (grouping)", draft.incomeSources[0].amount, 2250000);
  eq("draft debt dueDay parsed", draft.debtAccounts[0].dueDay, 15);
  eq("draft expense source = debt_account", draft.fixedExpenses[0].paymentSourceType, "debt_account");
  eq("draft expense source draftId", draft.fixedExpenses[0].paymentSourceDraftId, "deb1");
  eq("draft goal archetype", draft.goals[0].archetype, "emergency_savings");
  eq("draft goal target parsed", draft.goals[0].targetAmount, 5000);
  eq("draft savings reserve parsed", draft.profile.monthlySavings, 300);
  eq("draft base currency", draft.profile.baseCurrency, "ARS");
  const emptyDebts = buildOnboardingDraft({ ...full, debts: [], noDebts: true });
  eq("draft explicitlyEmptySteps (noDebts)", emptyDebts.explicitlyEmptySteps, ["debt_accounts"]);
  // expense source falls back to account when not a debt id
  const expAcc = buildOnboardingDraft({ ...full, expenses: [{ ...full.expenses[0], paymentSourceId: "acc1" }] });
  eq("draft expense source = account", expAcc.fixedExpenses[0].paymentSourceType, "account");

  // ── CSV template + parser ──
  const tpl = buildTemplateCsv();
  ok("template has BOM", tpl.charCodeAt(0) === 0xfeff);
  ok("template has header", tpl.includes("tipo,nombre,monto"));
  ok("template has EJEMPLO rows", tpl.includes("EJEMPLO"));
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
  eq("csv account count", p.accounts.length, 1);
  eq("csv income count", p.incomes.length, 1);
  eq("csv expense count", p.expenses.length, 1);
  eq("csv debt count", p.debts.length, 1);
  eq("csv goal count", p.goals.length, 2);
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

  // "ordenador" (computer) must NOT be misread as organize_month (which would drop its amount).
  const ord = parseTemplateCsv("tipo,nombre,monto,moneda,categoria_o_tipo,frecuencia,dia,fecha_objetivo\nmeta,Comprar ordenador,1500,USD,,,,");
  eq("csv 'comprar ordenador' is specific_purchase", ord.goals[0]?.archetype, "specific_purchase");
  eq("csv 'comprar ordenador' keeps amount", ord.goals[0]?.targetAmount, "1500");
  eq("csv 'comprar ordenador' no error", ord.errors.length, 0);
  const om = parseTemplateCsv("tipo,nombre,monto,moneda,categoria_o_tipo,frecuencia,dia,fecha_objetivo\nmeta,Ordenar mi mes,,USD,,,,");
  eq("csv 'ordenar mi mes' is organize_month", om.goals[0]?.archetype, "organize_month");

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
