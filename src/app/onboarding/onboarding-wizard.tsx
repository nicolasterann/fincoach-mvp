"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { saveOnboardingDraftAction } from "./save-actions";
import { importTemplateAction } from "./wizard-actions";
import {
  ACCOUNT_TYPES,
  COACH_TONES,
  COUNTRIES,
  CURRENCIES,
  DEBT_TYPES,
  EXPENSE_CATEGORIES,
  FREQUENCIES,
  GOAL_ARCHETYPES,
  GOAL_ARCHETYPE_NEEDS_AMOUNT,
  STRICTNESS_LEVELS,
  defaultCurrencyForCountry,
  type Option,
} from "@/lib/onboarding/wizard-constants";
import {
  accountReviewable,
  buildOnboardingDraft,
  debtReviewable,
  expenseReviewable,
  goalReviewable,
  incomeReviewable,
  parseMoney,
  wizardReadiness,
  type WizardAccount,
  type WizardCategoryBudget,
  type WizardDebt,
  type WizardExpense,
  type WizardGoal,
  type WizardIncome,
  type WizardState,
} from "@/lib/onboarding/wizard-model";
import type { ParsedTemplate } from "@/lib/onboarding/csv-template";
import { buildDraftMargenPreview } from "@/lib/onboarding/draft-margen-preview";
import { formatKipuMoney } from "@/lib/financial/money";
import type { CurrencyCode } from "@/types/financial";

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2);
}

function emptyState(baseCurrency: CurrencyCode): WizardState {
  return {
    profile: { fullName: "", country: "", baseCurrency },
    accounts: [],
    incomes: [],
    expenses: [],
    debts: [],
    noDebts: false,
    goals: [],
    reserves: { monthlySavings: "", monthlyInvestment: "" },
    categoryBudgets: seedCategoryBudgets(),
    prefs: { tone: "playful", strictness: "balanced" },
    fxRate: "",
    note: "",
  };
}

// Common VARIABLE-spend categories (housing/utilities are usually fixed → they
// go in "gastos fijos"). Pre-seeded as rows the user fills so Kipu can refine
// each one from real spend over time.
const VARIABLE_BUDGET_CATEGORIES = ["food", "transport", "entertainment", "shopping", "health", "other"] as const;
function seedCategoryBudgets(): WizardCategoryBudget[] {
  return VARIABLE_BUDGET_CATEGORIES.map((category) => ({ category, amount: "" }));
}
function categoryLabel(category: string): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

// Lazy initial state — restores an in-progress draft from localStorage. Safe to
// read here because this component is mounted client-only (ssr: false), so the
// browser API always exists and there is no hydration mismatch.
function loadInitialState(storageKey: string, baseCurrency: CurrencyCode): WizardState {
  if (typeof window === "undefined") return emptyState(baseCurrency);
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) return { ...emptyState(baseCurrency), ...(JSON.parse(raw) as WizardState) };
  } catch {
    // ignore corrupt local state
  }
  return emptyState(baseCurrency);
}

const STEPS = [
  { key: "intro", label: "Inicio" },
  { key: "accounts", label: "Cuentas", required: true },
  { key: "income", label: "Ingresos" },
  { key: "expenses", label: "Gastos" },
  { key: "debts", label: "Deudas" },
  { key: "goals", label: "Metas", required: true },
  { key: "style", label: "Estilo" },
  { key: "review", label: "Revisar" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

function moneyPreview(raw: string, currency: CurrencyCode): string | null {
  const n = parseMoney(raw);
  return n === undefined ? null : formatKipuMoney(n, currency);
}

// ── Small field primitives ────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-zinc-400">{children}</span>;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2.5 text-base text-zinc-50 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-4 focus:ring-emerald-500/10";

function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  inputMode?: "text" | "decimal" | "numeric";
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{props.label}</Label>
      <input
        className={`${inputClass} ${props.invalid ? "border-rose-500/50" : ""}`}
        value={props.value}
        inputMode={props.inputMode}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
      />
    </label>
  );
}

function MoneyField(props: {
  label: string;
  value: string;
  currency: CurrencyCode;
  onChange: (v: string) => void;
  requiredHint?: boolean;
}) {
  const preview = moneyPreview(props.value, props.currency);
  const showError = props.value.trim().length > 0 && preview === null;
  const showRequired = props.requiredHint && props.value.trim().length === 0;
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{props.label}</Label>
      <input
        className={`${inputClass} ${showError ? "border-rose-500/50" : ""}`}
        value={props.value}
        inputMode="decimal"
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="0"
      />
      {showError ? (
        <span className="text-xs text-rose-300">Escribe solo un número (ej. 1500 o 1.500,50).</span>
      ) : preview ? (
        <span className="text-xs text-emerald-300/80">≈ {preview}</span>
      ) : showRequired ? (
        <span className="text-xs text-zinc-600">Pon un número aproximado.</span>
      ) : null}
    </label>
  );
}

function DateField(props: { label: string; value: string; onChange: (v: string) => void }) {
  // Native date input → always emits YYYY-MM-DD (no free-typed "dic 2026" that
  // would break the goals.target_date insert).
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{props.label}</Label>
      <input
        className={`${inputClass} [color-scheme:dark]`}
        type="date"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <Label>{props.label}</Label>
      <select
        className={inputClass}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as T)}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      onClick={() => props.onChange(!props.checked)}
      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
        props.checked ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100" : "border-white/10 bg-zinc-950 text-zinc-400"
      }`}
    >
      <span>{props.label}</span>
      <span
        className={`flex h-5 w-9 items-center rounded-full p-0.5 transition ${props.checked ? "bg-emerald-400" : "bg-zinc-700"}`}
      >
        <span className={`h-4 w-4 rounded-full bg-zinc-950 transition ${props.checked ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}

function ItemCard(props: { children: React.ReactNode; onRemove: () => void; title: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{props.title}</span>
        <button type="button" onClick={props.onRemove} className="text-xs text-zinc-500 transition hover:text-rose-300">
          Quitar
        </button>
      </div>
      <div className="flex flex-col gap-3">{props.children}</div>
    </div>
  );
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-dashed border-white/15 px-4 py-3 text-sm font-medium text-zinc-300 transition hover:border-emerald-400/40 hover:text-emerald-200"
    >
      + {label}
    </button>
  );
}

// ── Wizard ─────────────────────────────────────────────────────────────────────

export default function OnboardingWizard({
  userEmail,
  defaultBaseCurrency,
  saveErrored = false,
}: {
  userEmail: string;
  defaultBaseCurrency: CurrencyCode;
  saveErrored?: boolean;
}) {
  const storageKey = `kipu-onboarding-wizard-v3:${userEmail}`;
  const [state, setState] = useState<WizardState>(() => loadInitialState(storageKey, defaultBaseCurrency));
  // A failed save bounces back here with ?message=...; resume on Review with the data restored.
  const [stepKey, setStepKey] = useState<StepKey>(saveErrored ? "review" : "intro");
  const [saveError, setSaveError] = useState(saveErrored);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, startImport] = useTransition();
  const [saving, startSave] = useTransition();

  // Persist progress (writes to an external system only — no setState here).
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // storage full / unavailable — non-fatal
    }
  }, [state, storageKey]);

  const base = state.profile.baseCurrency;
  const readiness = useMemo(() => wizardReadiness(state), [state]);
  const draft = useMemo(() => buildOnboardingDraft(state), [state]);
  const margen = useMemo(() => buildDraftMargenPreview(draft), [draft]);
  const payableSources = useMemo<Option<string>[]>(
    () => [
      { value: "", label: "— (sin especificar)" },
      ...state.accounts.filter(accountReviewable).map((a) => ({ value: a.id, label: a.name })),
      ...state.debts.filter(debtReviewable).map((d) => ({ value: d.id, label: `${d.name} (deuda)` })),
    ],
    [state.accounts, state.debts],
  );
  const accountSources = useMemo<Option<string>[]>(
    () => [
      { value: "", label: "— (sin especificar)" },
      ...state.accounts.filter(accountReviewable).map((a) => ({ value: a.id, label: a.name })),
    ],
    [state.accounts],
  );

  function patch(p: Partial<WizardState>) {
    setState((s) => ({ ...s, ...p }));
  }
  function go(next: StepKey) {
    setStepKey(next);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const idx = STEPS.findIndex((s) => s.key === stepKey);
  const goNext = () => go(STEPS[Math.min(idx + 1, STEPS.length - 1)].key);
  const goBack = () => go(STEPS[Math.max(idx - 1, 0)].key);

  function handleImport(file: File) {
    setImportMsg(null);
    setImportErrors([]);
    const fd = new FormData();
    fd.set("file", file);
    startImport(async () => {
      const res = await importTemplateAction(fd);
      if (!res.ok) {
        setImportErrors([res.error]);
        return;
      }
      mergeParsed(res.parsed);
    });
  }

  function mergeParsed(parsed: ParsedTemplate) {
    setState((s) => ({
      ...s,
      accounts: [...s.accounts, ...parsed.accounts],
      incomes: [...s.incomes, ...parsed.incomes],
      expenses: [...s.expenses, ...parsed.expenses],
      debts: [...s.debts, ...parsed.debts],
      goals: [...s.goals, ...parsed.goals],
      noDebts: s.noDebts && parsed.debts.length === 0,
    }));
    const counts = [
      parsed.accounts.length && `${parsed.accounts.length} cuenta(s)`,
      parsed.incomes.length && `${parsed.incomes.length} ingreso(s)`,
      parsed.expenses.length && `${parsed.expenses.length} gasto(s)`,
      parsed.debts.length && `${parsed.debts.length} deuda(s)`,
      parsed.goals.length && `${parsed.goals.length} meta(s)`,
    ].filter(Boolean);
    setImportMsg(counts.length ? `Importé ${counts.join(", ")}. Revísalo abajo antes de confirmar.` : "No encontré filas para importar.");
    setImportErrors(parsed.errors.map((e) => `Fila ${e.row}: ${e.message}`));
    go("review");
  }

  function confirmSave() {
    setSaveError(false);
    startSave(async () => {
      await saveOnboardingDraftAction(buildOnboardingDraft(state));
    });
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-zinc-950 px-5 pb-28 pt-6 text-zinc-50">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="kipu-breathe absolute -top-40 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-[130px]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-xl flex-col gap-6">
        <ProgressHeader stepIdx={idx} readiness={readiness} />

        {stepKey === "intro" && (
          <IntroStep
            state={state}
            patch={patch}
            onStart={goNext}
            onImport={handleImport}
            importing={importing}
            importErrors={importErrors}
          />
        )}

        {stepKey === "accounts" && (
          <StepShell
            title="¿Dónde tienes tu plata?"
            subtitle="Tus cuentas y efectivo. Con esto Kipu sabe cuánto puedes gastar tranquilo."
            footer={
              <Footer
                onBack={goBack}
                onNext={goNext}
                nextDisabled={readiness.reviewableAccounts === 0}
                nextHint={readiness.reviewableAccounts === 0 ? "Agrega al menos una cuenta" : undefined}
              />
            }
          >
            {state.accounts.map((a) => (
              <ItemCard key={a.id} title="Cuenta" onRemove={() => patch({ accounts: state.accounts.filter((x) => x.id !== a.id) })}>
                <TextField label="Nombre" value={a.name} placeholder="Banco Pichincha, Efectivo…" onChange={(v) => updateItem("accounts", a.id, { name: v })} />
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Tipo" value={a.type} options={ACCOUNT_TYPES} onChange={(v) => updateItem("accounts", a.id, { type: v })} />
                  <SelectField label="Moneda" value={a.currency} options={CURRENCIES} onChange={(v) => updateItem("accounts", a.id, { currency: v })} />
                </div>
                <MoneyField label="Más o menos, ¿cuánto tienes ahí? (opcional)" value={a.balance} currency={a.currency} onChange={(v) => updateItem("accounts", a.id, { balance: v })} />
                <Toggle label="Esta plata la guardo, no la gasto día a día (ahorro / inversión)" checked={a.liquidity === "non_liquid"} onChange={(v) => updateItem("accounts", a.id, { liquidity: v ? "non_liquid" : "liquid" })} />
                {a.liquidity === "non_liquid" && (
                  <TextField label="Rendimiento anual % (opcional)" value={a.returnRate} inputMode="decimal" placeholder="ej. 5" onChange={(v) => updateItem("accounts", a.id, { returnRate: v })} />
                )}
              </ItemCard>
            ))}
            <AddButton label="Agregar una cuenta" onClick={() => patch({ accounts: [...state.accounts, newAccount(base, state.accounts.length === 0)] })} />
          </StepShell>
        )}

        {stepKey === "income" && (
          <StepShell
            title="¿De dónde entra tu plata?"
            subtitle="Con tu ingreso, Kipu calcula cuánto puedes gastar tranquilo. Si varía, lo pones como un rango."
            footer={<Footer onBack={goBack} onNext={goNext} />}
          >
            {state.incomes.map((i) => {
              const showDay = i.frequency === "monthly" || i.frequency === "yearly";
              return (
              <ItemCard key={i.id} title="Ingreso" onRemove={() => patch({ incomes: state.incomes.filter((x) => x.id !== i.id) })}>
                <TextField label="Nombre" value={i.name} placeholder="Sueldo, freelance, pensión…" onChange={(v) => updateItem("incomes", i.id, { name: v })} />
                <Toggle label="Varía mes a mes (no es fijo)" checked={i.isVariable} onChange={(v) => updateItem("incomes", i.id, { isVariable: v })} />
                {i.isVariable ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <MoneyField label="Mínimo / mes" value={i.minAmount} currency={i.currency} onChange={(v) => updateItem("incomes", i.id, { minAmount: v })} requiredHint />
                      <MoneyField label="Máximo / mes" value={i.maxAmount} currency={i.currency} onChange={(v) => updateItem("incomes", i.id, { maxAmount: v })} />
                    </div>
                    <p className="-mt-1 text-xs text-zinc-500">Kipu usa el mínimo para no pasarse, y te lo confirma cada mes — no lo asume.</p>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <MoneyField label="Monto" value={i.amount} currency={i.currency} onChange={(v) => updateItem("incomes", i.id, { amount: v })} requiredHint />
                    <SelectField label="Moneda" value={i.currency} options={CURRENCIES} onChange={(v) => updateItem("incomes", i.id, { currency: v })} />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Cada cuánto" value={i.frequency} options={FREQUENCIES} onChange={(v) => updateItem("incomes", i.id, { frequency: v })} />
                  {i.isVariable && (
                    <SelectField label="Moneda" value={i.currency} options={CURRENCIES} onChange={(v) => updateItem("incomes", i.id, { currency: v })} />
                  )}
                  {!i.isVariable && showDay && (
                    <TextField label="Día del mes (opcional)" value={i.expectedDay} inputMode="numeric" placeholder="1-31" onChange={(v) => updateItem("incomes", i.id, { expectedDay: v })} />
                  )}
                </div>
                {(i.frequency === "weekly" || i.frequency === "biweekly") && (
                  <DateField label="¿Cuándo fue tu último pago? (para calcular el próximo)" value={i.lastPayDate} onChange={(v) => updateItem("incomes", i.id, { lastPayDate: v })} />
                )}
                {accountSources.length > 1 && (
                  <SelectField label="Se deposita en (opcional)" value={i.destinationAccountId} options={accountSources} onChange={(v) => updateItem("incomes", i.id, { destinationAccountId: v })} />
                )}
              </ItemCard>
              );
            })}
            <AddButton label="Agregar un ingreso" onClick={() => patch({ incomes: [...state.incomes, newIncome(base)] })} />
          </StepShell>
        )}

        {stepKey === "expenses" && (
          <StepShell
            title="¿Qué pagas cada mes sí o sí?"
            subtitle="Lo que se repite: arriendo, servicios, suscripciones, seguros, impuestos. No cada compra suelta."
            footer={<Footer onBack={goBack} onNext={goNext} />}
          >
            {state.expenses.map((e) => (
              <ItemCard key={e.id} title="Gasto fijo" onRemove={() => patch({ expenses: state.expenses.filter((x) => x.id !== e.id) })}>
                <TextField label="Nombre" value={e.name} placeholder="Arriendo, internet…" onChange={(v) => updateItem("expenses", e.id, { name: v })} />
                <div className="grid grid-cols-2 gap-3">
                  <MoneyField label="Monto" value={e.amount} currency={e.currency} onChange={(v) => updateItem("expenses", e.id, { amount: v })} requiredHint />
                  <SelectField label="Moneda" value={e.currency} options={CURRENCIES} onChange={(v) => updateItem("expenses", e.id, { currency: v })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Categoría" value={e.category} options={EXPENSE_CATEGORIES} onChange={(v) => updateItem("expenses", e.id, { category: v })} />
                  <SelectField label="Cada cuánto" value={e.frequency} options={FREQUENCIES} onChange={(v) => updateItem("expenses", e.id, { frequency: v })} />
                </div>
                <TextField label="Día del mes (opcional)" value={e.expectedDay} inputMode="numeric" placeholder="1-31" onChange={(v) => updateItem("expenses", e.id, { expectedDay: v })} />
                {payableSources.length > 1 && (
                  <SelectField label="Se paga desde (opcional)" value={e.paymentSourceId} options={payableSources} onChange={(v) => updateItem("expenses", e.id, { paymentSourceId: v })} />
                )}
                <Toggle label="Es esencial (difícil de recortar)" checked={e.isEssential} onChange={(v) => updateItem("expenses", e.id, { isEssential: v })} />
              </ItemCard>
            ))}
            <AddButton label="Agregar un gasto fijo" onClick={() => patch({ expenses: [...state.expenses, newExpense(base)] })} />

            <div className="mt-2 rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Gasto variable estimado / mes (opcional)</p>
              <p className="mt-1 text-xs text-zinc-500">Más o menos, ¿cuánto gastas al mes en cada cosa? Kipu afina cada categoría con tu gasto real con el tiempo.</p>
              <div className="mt-3 flex flex-col gap-3">
                {state.categoryBudgets.map((cb) => (
                  <MoneyField
                    key={cb.category}
                    label={categoryLabel(cb.category)}
                    value={cb.amount}
                    currency={base}
                    onChange={(v) => updateCategoryBudget(cb.category, v)}
                  />
                ))}
              </div>
            </div>
          </StepShell>
        )}

        {stepKey === "debts" && (
          <StepShell
            title="¿Tienes deudas o tarjetas?"
            subtitle="Tarjetas, préstamos, o plata que le debes a alguien. Sin juicio — es para cuidarte."
            footer={<Footer onBack={goBack} onNext={goNext} />}
          >
            {state.debts.length === 0 && (
              <button
                type="button"
                onClick={() => { patch({ noDebts: true }); goNext(); }}
                className="rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-3 text-sm font-medium text-zinc-300 transition hover:border-emerald-400/40 hover:text-emerald-200"
              >
                No tengo deudas 🙌
              </button>
            )}
            {state.debts.map((d) => (
              <ItemCard key={d.id} title="Deuda" onRemove={() => patch({ debts: state.debts.filter((x) => x.id !== d.id) })}>
                <TextField label="Nombre" value={d.name} placeholder="Visa, préstamo…" onChange={(v) => updateItem("debts", d.id, { name: v })} />
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Tipo" value={d.type} options={DEBT_TYPES} onChange={(v) => updateItem("debts", d.id, { type: v })} />
                  <SelectField label="Moneda" value={d.currency} options={CURRENCIES} onChange={(v) => updateItem("debts", d.id, { currency: v })} />
                </div>
                <MoneyField label="Total que debes hoy (no el pago del mes)" value={d.balance} currency={d.currency} onChange={(v) => updateItem("debts", d.id, { balance: v })} />
                <div className="grid grid-cols-2 gap-3">
                  <MoneyField label="A pagar este mes (opcional)" value={d.currentMonthPayment} currency={d.currency} onChange={(v) => updateItem("debts", d.id, { currentMonthPayment: v })} />
                  <MoneyField label="Pago mínimo (opcional)" value={d.minimumPayment} currency={d.currency} onChange={(v) => updateItem("debts", d.id, { minimumPayment: v })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <TextField label="Día de pago (opcional)" value={d.dueDay} inputMode="numeric" placeholder="1-31" onChange={(v) => updateItem("debts", d.id, { dueDay: v })} />
                  <TextField label="Día de corte (opcional)" value={d.cutoffDay} inputMode="numeric" placeholder="1-31" onChange={(v) => updateItem("debts", d.id, { cutoffDay: v })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <TextField label="Interés anual % (opcional)" value={d.interestRate} inputMode="decimal" placeholder="38" onChange={(v) => updateItem("debts", d.id, { interestRate: v })} />
                  {accountSources.length > 1 && (
                    <SelectField label="Pagas desde (opcional)" value={d.defaultPaymentAccountId} options={accountSources} onChange={(v) => updateItem("debts", d.id, { defaultPaymentAccountId: v })} />
                  )}
                </div>
              </ItemCard>
            ))}
            <AddButton label="Agregar una deuda" onClick={() => patch({ debts: [...state.debts, newDebt(base)], noDebts: false })} />
          </StepShell>
        )}

        {stepKey === "goals" && (
          <StepShell
            title="¿Qué quieres lograr con tu plata?"
            subtitle="Elige al menos una. Si solo quieres entender tu mes, toca «Ordenar mi mes»."
            footer={
              <Footer
                onBack={goBack}
                onNext={goNext}
                nextDisabled={readiness.reviewableGoals === 0}
                nextHint={readiness.reviewableGoals === 0 ? "Elige al menos una meta" : undefined}
              />
            }
          >
            <div className="flex flex-wrap gap-2">
              {GOAL_ARCHETYPES.map((g) => {
                // Singleton archetypes shouldn't duplicate on a double-tap; "specific_purchase"
                // and "other" can repeat (multiple purchases / misc goals).
                const singleton = g.value !== "specific_purchase" && g.value !== "other";
                const already = singleton && state.goals.some((x) => x.archetype === g.value);
                return (
                  <button
                    key={g.value}
                    type="button"
                    disabled={already}
                    onClick={() => patch({ goals: [...state.goals, newGoal(base, g.value)] })}
                    className="rounded-full border border-white/15 px-3.5 py-2 text-sm text-zinc-200 transition hover:border-emerald-400/50 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    {already ? "✓ " : "+ "}{g.label}
                  </button>
                );
              })}
            </div>
            {state.goals.map((g) => {
              const needsAmount = GOAL_ARCHETYPE_NEEDS_AMOUNT[g.archetype];
              const reviewable = goalReviewable(g);
              return (
                <ItemCard key={g.id} title={GOAL_ARCHETYPES.find((o) => o.value === g.archetype)?.label ?? "Meta"} onRemove={() => patch({ goals: state.goals.filter((x) => x.id !== g.id) })}>
                  {g.archetype !== "organize_month" && (
                    <>
                      <TextField label="Nombre de la meta" value={g.name} placeholder="Viaje, colchón…" onChange={(v) => updateItem("goals", g.id, { name: v })} />
                      <div className="grid grid-cols-2 gap-3">
                        <MoneyField label="¿Cuánto quieres juntar?" value={g.targetAmount} currency={g.currency} onChange={(v) => updateItem("goals", g.id, { targetAmount: v })} requiredHint={needsAmount} />
                        <SelectField label="Moneda" value={g.currency} options={CURRENCIES} onChange={(v) => updateItem("goals", g.id, { currency: v })} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <MoneyField label="¿Cuánto llevas ya? (opcional)" value={g.currentAmount} currency={g.currency} onChange={(v) => updateItem("goals", g.id, { currentAmount: v })} />
                        <DateField label="¿Para cuándo? (opcional)" value={g.targetDate} onChange={(v) => updateItem("goals", g.id, { targetDate: v })} />
                      </div>
                      {!reviewable && (
                        <p className="text-xs text-amber-300">Ponle un monto para que Kipu pueda planear esta meta.</p>
                      )}
                    </>
                  )}
                  {g.archetype === "organize_month" && (
                    <p className="text-sm text-zinc-400">Listo — Kipu te ayudará a entender y ordenar tu mes. No necesitas un monto.</p>
                  )}
                </ItemCard>
              );
            })}

            <div className="mt-2 rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Ahorro e inversión (opcional)</p>
              <p className="mt-1 text-xs text-zinc-500">Lo que apartas fijo cada mes para guardar o invertir. Kipu lo protege antes de decirte cuánto puedes gastar.</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <MoneyField label="Ahorro / mes" value={state.reserves.monthlySavings} currency={base} onChange={(v) => patch({ reserves: { ...state.reserves, monthlySavings: v } })} />
                <MoneyField label="Inversión / mes" value={state.reserves.monthlyInvestment} currency={base} onChange={(v) => patch({ reserves: { ...state.reserves, monthlyInvestment: v } })} />
              </div>
            </div>
          </StepShell>
        )}

        {stepKey === "style" && (
          <StepShell
            title="¿Cómo quieres que Kipu te hable?"
            subtitle="Puedes cambiarlo cuando quieras desde Ajustes."
            footer={<Footer onBack={goBack} onNext={goNext} nextLabel="Revisar todo" />}
          >
            <div className="flex flex-col gap-2">
              <Label>Tono</Label>
              <ChipRow options={COACH_TONES} value={state.prefs.tone} onChange={(v) => patch({ prefs: { ...state.prefs, tone: v } })} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>¿Qué tan encima quieres que esté Kipu?</Label>
              <ChipRow options={STRICTNESS_LEVELS} value={state.prefs.strictness} onChange={(v) => patch({ prefs: { ...state.prefs, strictness: v } })} />
              <p className="text-xs text-zinc-500">Cuánto te recuerda y te empuja con tus gastos y metas — nunca con juicio.</p>
            </div>
            <label className="flex flex-col gap-1.5">
              <Label>¿Manejas más de una moneda? Tu tipo de cambio (opcional)</Label>
              <input
                className={inputClass}
                value={state.fxRate}
                onChange={(e) => patch({ fxRate: e.target.value })}
                placeholder="Ej. 1 USD = 1200 ARS"
              />
              <span className="text-xs text-zinc-600">Kipu usa esta tasa (nunca inventa una). La puedes cambiar cuando quieras en Ajustes.</span>
            </label>
            <label className="flex flex-col gap-1.5">
              <Label>¿Algo más que Kipu deba saber? (opcional)</Label>
              <textarea
                className={`${inputClass} min-h-[88px] resize-none`}
                value={state.note}
                onChange={(e) => patch({ note: e.target.value })}
                placeholder="Inversiones y a qué tasa, seguros o pólizas, gastos que comparto con alguien, el arriendo sube cada 3 meses…"
              />
            </label>
          </StepShell>
        )}

        {stepKey === "review" && (
          <ReviewStep
            state={state}
            margen={margen}
            readiness={readiness}
            importMsg={importMsg}
            importErrors={importErrors}
            saveError={saveError}
            saving={saving}
            onBack={goBack}
            onConfirm={confirmSave}
            onEdit={(k) => go(k)}
          />
        )}
      </div>
    </main>
  );

  function updateCategoryBudget(category: WizardCategoryBudget["category"], amount: string) {
    setState((s) => ({
      ...s,
      categoryBudgets: s.categoryBudgets.map((cb) => (cb.category === category ? { ...cb, amount } : cb)),
    }));
  }

  // Generic typed updater for a collection item.
  function updateItem<K extends "accounts" | "incomes" | "expenses" | "debts" | "goals">(
    key: K,
    id: string,
    patchItem: Partial<WizardState[K][number]>,
  ) {
    setState((s) => ({
      ...s,
      [key]: (s[key] as { id: string }[]).map((it) => (it.id === id ? { ...it, ...patchItem } : it)),
    }));
  }
}

// ── Item factories ─────────────────────────────────────────────────────────────

function newAccount(currency: CurrencyCode, primary: boolean): WizardAccount {
  return { id: genId(), name: "", type: "bank", balance: "", currency, liquidity: "liquid", isGoalAccount: false, isPrimary: primary, returnRate: "" };
}
function newIncome(currency: CurrencyCode): WizardIncome {
  return { id: genId(), name: "", amount: "", currency, frequency: "monthly", expectedDay: "", lastPayDate: "", isVariable: false, minAmount: "", maxAmount: "", destinationAccountId: "" };
}
function newExpense(currency: CurrencyCode): WizardExpense {
  return { id: genId(), name: "", amount: "", currency, category: "housing", frequency: "monthly", expectedDay: "", isEssential: true, paymentSourceId: "" };
}
function newDebt(currency: CurrencyCode): WizardDebt {
  return { id: genId(), name: "", type: "credit_card", balance: "", currentMonthPayment: "", minimumPayment: "", currency, dueDay: "", cutoffDay: "", interestRate: "", defaultPaymentAccountId: "" };
}
function newGoal(currency: CurrencyCode, archetype: WizardGoal["archetype"]): WizardGoal {
  return { id: genId(), name: "", archetype, targetAmount: "", currentAmount: "", currency, targetDate: "" };
}

// ── Composite UI ────────────────────────────────────────────────────────────────

function ProgressHeader({ stepIdx, readiness }: { stepIdx: number; readiness: ReturnType<typeof wizardReadiness> }) {
  const pct = Math.round((stepIdx / (STEPS.length - 1)) * 100);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-sm font-black tracking-tight">
          <span className="text-emerald-300">Kipu</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-400">Configura tu cuenta</span>
        </span>
        <span className="text-xs text-zinc-500">{Math.min(stepIdx + 1, STEPS.length)}/{STEPS.length}</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progreso de configuración"
        className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800"
      >
        <div className="h-full rounded-full bg-emerald-400 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      {!readiness.canFinish && stepIdx > 0 && (
        <p className="text-xs text-zinc-600">Para terminar: {readiness.missing.join(" ")}</p>
      )}
    </div>
  );
}

function StepShell(props: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-50">{props.title}</h1>
        <p className="mt-1.5 text-sm leading-6 text-zinc-400">{props.subtitle}</p>
      </div>
      <div className="flex flex-col gap-4">{props.children}</div>
      {props.footer}
    </section>
  );
}

function Footer(props: { onBack?: () => void; onNext: () => void; nextDisabled?: boolean; nextLabel?: string; nextHint?: string }) {
  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex items-center gap-3">
        {props.onBack && (
          <button type="button" onClick={props.onBack} className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-zinc-300 transition hover:border-white/25">
            Atrás
          </button>
        )}
        <button
          type="button"
          onClick={props.onNext}
          disabled={props.nextDisabled}
          className="flex-1 rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {props.nextLabel ?? "Continuar"}
        </button>
      </div>
      {props.nextHint && <p className="text-center text-xs text-zinc-500">{props.nextHint}</p>}
    </div>
  );
}

function ChipRow<T extends string>({ options, value, onChange }: { options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3.5 py-2 text-sm transition ${value === o.value ? "bg-emerald-400 font-semibold text-zinc-950" : "border border-white/15 text-zinc-300 hover:border-white/30"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function IntroStep(props: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  onStart: () => void;
  onImport: (file: File) => void;
  importing: boolean;
  importErrors: string[];
}) {
  const [currencyTouched, setCurrencyTouched] = useState(false);
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-zinc-50">Vamos a conocer tu plata</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Unos pasos cortos y Kipu ya sabrá cuánto puedes gastar tranquilo. Puedes poner montos aproximados — se ajustan después.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Tu nombre (opcional)" value={props.state.profile.fullName} placeholder="¿Cómo te llamas?" onChange={(v) => props.patch({ profile: { ...props.state.profile, fullName: v } })} />
          <SelectField
            label="País"
            value={props.state.profile.country || ""}
            options={[{ value: "", label: "Elige tu país" }, ...COUNTRIES.map((c) => ({ value: c.value, label: c.label }))]}
            onChange={(v) => {
              // Only auto-pick the currency if the user hasn't chosen one — don't clobber a deliberate choice.
              const cur = (!currencyTouched ? defaultCurrencyForCountry(v) : undefined) ?? props.state.profile.baseCurrency;
              props.patch({ profile: { ...props.state.profile, country: v, baseCurrency: cur } });
            }}
          />
        </div>
        <SelectField
          label="La moneda en la que Kipu te muestra tus totales"
          value={props.state.profile.baseCurrency}
          options={CURRENCIES}
          onChange={(v) => {
            setCurrencyTouched(true);
            props.patch({ profile: { ...props.state.profile, baseCurrency: v } });
          }}
        />
        <p className="text-xs text-zinc-500">Cada cuenta o ingreso puede tener su propia moneda — esto es solo cómo te muestro los totales.</p>
      </div>

      <button
        type="button"
        onClick={props.onStart}
        className="rounded-2xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300"
      >
        Empezar paso a paso
      </button>

      <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
        <p className="text-sm font-semibold text-zinc-200">¿Prefieres una planilla?</p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          Descarga la plantilla, llénala en Excel o Google Sheets y súbela. Kipu la revisa contigo antes de guardar nada.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a href="/onboarding/template" className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-emerald-400/40 hover:text-emerald-200">
            Descargar plantilla (CSV)
          </a>
          <label className="cursor-pointer rounded-xl bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-700">
            {props.importing ? "Leyendo…" : "Subir planilla llena"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) props.onImport(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {props.importErrors.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {props.importErrors.map((er, i) => (
              <li key={i} className="text-xs text-rose-300">• {er}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ReviewStep(props: {
  state: WizardState;
  margen: ReturnType<typeof buildDraftMargenPreview>;
  readiness: ReturnType<typeof wizardReadiness>;
  importMsg: string | null;
  importErrors: string[];
  saveError: boolean;
  saving: boolean;
  onBack: () => void;
  onConfirm: () => void;
  onEdit: (k: StepKey) => void;
}) {
  const { state, margen, readiness } = props;
  const base = state.profile.baseCurrency;
  const reviewAccounts = state.accounts.filter(accountReviewable);
  const reviewIncome = state.incomes.filter(incomeReviewable);
  const reviewExpenses = state.expenses.filter(expenseReviewable);
  const reviewDebts = state.debts.filter(debtReviewable);
  const reviewGoals = state.goals.filter(goalReviewable);

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-50">Revisa antes de empezar</h1>
        <p className="mt-1.5 text-sm leading-6 text-zinc-400">Esto es lo que Kipu va a recordar. Edita lo que quieras; nada se guarda hasta que confirmes.</p>
      </div>

      {props.saveError && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          No pude guardar tus datos (algo falló de nuestro lado). Tu información sigue aquí — vuelve a tocar «Confirmar» en un momento.
        </div>
      )}
      {props.importMsg && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100">{props.importMsg}</div>
      )}
      {props.importErrors.length > 0 && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          <p className="font-semibold">Revisa estas filas de tu planilla:</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {props.importErrors.slice(0, 8).map((e, i) => (
              <li key={i} className="text-xs">• {e}</li>
            ))}
          </ul>
        </div>
      )}

      {margen ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-b from-emerald-500/10 to-transparent p-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/80">Esto puedes gastar tranquilo</p>
          <p className="mt-1 text-3xl font-black text-zinc-50">{formatKipuMoney(margen.margenWeekly, base)}</p>
          <p className="mt-1 text-xs text-zinc-400">esta semana · ~{formatKipuMoney(margen.margenDaily, base)}/día (estimado · se afina con el uso)</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5 text-center text-sm text-zinc-400">
          Para tu primer Margen, agrega un saldo a una cuenta y un ingreso en tu moneda principal ({base}).
        </div>
      )}

      <ReviewBlock title="Cuentas" count={reviewAccounts.length} onEdit={() => props.onEdit("accounts")}
        lines={reviewAccounts.map((a) => {
          const bal = parseMoney(a.balance);
          return `${a.name}${bal !== undefined ? ` · ${formatKipuMoney(bal, a.currency)}` : ""}`;
        })} />
      <ReviewBlock title="Ingresos" count={reviewIncome.length} onEdit={() => props.onEdit("income")}
        lines={reviewIncome.map((i) => `${i.name || "Ingreso"} · ${formatKipuMoney(parseMoney(i.amount) ?? 0, i.currency)}`)} />
      <ReviewBlock title="Gastos fijos" count={reviewExpenses.length} onEdit={() => props.onEdit("expenses")}
        lines={reviewExpenses.map((e) => `${e.name || "Gasto"} · ${formatKipuMoney(parseMoney(e.amount) ?? 0, e.currency)}`)} />
      <ReviewBlock title="Deudas" count={reviewDebts.length} onEdit={() => props.onEdit("debts")}
        lines={reviewDebts.map((d) => `${d.name} · ${formatKipuMoney(parseMoney(d.balance) ?? 0, d.currency)}`)}
        emptyLabel={state.noDebts ? "Sin deudas 🙌" : undefined} />
      <ReviewBlock title="Metas" count={reviewGoals.length} onEdit={() => props.onEdit("goals")}
        lines={reviewGoals.map((g) => g.name || "Meta")} />

      {!readiness.canFinish && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          Falta un poco: {readiness.missing.join(" ")}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button type="button" onClick={props.onBack} className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-zinc-300 transition hover:border-white/25">
          Atrás
        </button>
        <button
          type="button"
          onClick={props.onConfirm}
          disabled={!readiness.canFinish || props.saving}
          className="flex-1 rounded-2xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {props.saving ? "Guardando…" : "Confirmar y entrar a Kipu"}
        </button>
      </div>
    </section>
  );
}

function ReviewBlock(props: { title: string; count: number; lines: string[]; onEdit: () => void; emptyLabel?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-100">
          {props.title} <span className="text-zinc-500">· {props.count}</span>
        </p>
        <button type="button" onClick={props.onEdit} className="text-xs font-semibold text-emerald-300 transition hover:text-emerald-200">
          Editar
        </button>
      </div>
      {props.lines.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {props.lines.slice(0, 6).map((l, i) => (
            <li key={i} className="truncate text-xs text-zinc-400">{l}</li>
          ))}
          {props.lines.length > 6 && <li className="text-xs text-zinc-600">y {props.lines.length - 6} más…</li>}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-zinc-600">{props.emptyLabel ?? "Nada por ahora (puedes agregarlo luego)."}</p>
      )}
    </div>
  );
}
