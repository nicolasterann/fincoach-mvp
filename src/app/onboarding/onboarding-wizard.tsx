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
  GOAL_DEFAULT_NAMES,
  STRICTNESS_LEVELS,
  defaultCurrencyForCountry,
  type Option,
} from "@/lib/onboarding/wizard-constants";
import {
  accountReviewable,
  buildOnboardingDraft,
  composeFxRateString,
  computeAllocationView,
  debtReviewable,
  expenseReviewable,
  goalReviewable,
  incomeReviewable,
  parseFxRateValue,
  parseMoney,
  wizardFxMissing,
  wizardReadiness,
  type WizardAccount,
  type WizardAsset,
  type WizardCategoryBudget,
  type WizardDebt,
  type WizardExpense,
  type WizardFxRateLite,
  type WizardGoal,
  type WizardIncome,
  type WizardState,
} from "@/lib/onboarding/wizard-model";
import type { ParsedTemplate } from "@/lib/onboarding/csv-template";
import { WEEKS_PER_MONTH, buildDraftCapacity, buildDraftMargenPreview } from "@/lib/onboarding/draft-margen-preview";
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
    assets: [],
    goals: [],
    reserves: { monthlySavings: "", monthlyInvestment: "" },
    categoryBudgets: seedCategoryBudgets(),
    categoryBudgetCurrency: "",
    prefs: { tone: "playful", strictness: "balanced" },
    fxRate: "",
    fxTargetCurrency: "",
    fxRateValue: "",
    fxEntries: [],
    note: "",
  };
}

// Asset classes offered in onboarding (#6). Map to investment_accounts.asset_class.
const ASSET_CLASSES: Option<string>[] = [
  { value: "investment", label: "Inversión" },
  { value: "property", label: "Propiedad" },
  { value: "vehicle", label: "Vehículo" },
  { value: "crypto", label: "Cripto" },
  { value: "receivable", label: "Por cobrar" },
  { value: "other", label: "Otro" },
];

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
    if (raw) {
      const merged = { ...emptyState(baseCurrency), ...(JSON.parse(raw) as WizardState) };
      // S31 (5.1c) — hydrate a pre-multi-rate draft: its single guided pair becomes
      // fxEntries[0] so the new per-currency controls resume where the user left off.
      if (
        (merged.fxEntries ?? []).length === 0 &&
        (merged.fxTargetCurrency ?? "").trim() &&
        (merged.fxRateValue ?? "").trim()
      ) {
        merged.fxEntries = [{ target: merged.fxTargetCurrency!.trim().toUpperCase(), value: merged.fxRateValue! }];
      }
      return merged;
    }
  } catch {
    // ignore corrupt local state
  }
  return emptyState(baseCurrency);
}

// Stage 30 (#7) — capacity-first order. The user sees their real capacity BEFORE
// committing savings/investment/goal money: … → assets → capacity reveal →
// allocation (savings/investment + goal contributions with live truly-free) → …
const STEPS = [
  { key: "intro", label: "Inicio" },
  { key: "accounts", label: "Cuentas", required: true },
  { key: "income", label: "Ingresos" },
  { key: "expenses", label: "Gastos" },
  { key: "debts", label: "Deudas" },
  { key: "assets", label: "Activos" },
  { key: "goals", label: "Metas", required: true },
  { key: "capacity", label: "Tu margen" },
  { key: "allocation", label: "Repartir" },
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

// Stage 30 (#8) — the optional per-row "Nota para Kipu". Persists to the row's
// notes column so Kipu reads it as memory ("el arriendo sube en agosto").
function NoteField(props: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <Label>Nota para Kipu (opcional)</Label>
      <textarea
        className={`${inputClass} min-h-[44px] resize-none py-2 text-sm`}
        rows={1}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder ?? "Algo que Kipu deba recordar de esto…"}
      />
    </label>
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
  saveErrorMessage = null,
  knownRates = [],
}: {
  userEmail: string;
  defaultBaseCurrency: CurrencyCode;
  saveErrored?: boolean;
  /** S31 (4.1) — the decoded server save error, rendered VERBATIM on Review. */
  saveErrorMessage?: string | null;
  /** S31 (5.1f) — fx_rates already known server-side (e.g. set via chat), so a
   *  pre-existing rate never re-blocks the client FX gate. */
  knownRates?: WizardFxRateLite[];
}) {
  // v5: Stage 30 reordered steps + added assets/allocation/guided-FX fields. Bump so
  // a stale v4 draft doesn't resume into the new step machine half-populated.
  const storageKey = `kipu-onboarding-wizard-v5:${userEmail}`;
  const [state, setState] = useState<WizardState>(() => loadInitialState(storageKey, defaultBaseCurrency));
  // A failed save bounces back here with ?message=...; resume on Review with the data restored.
  const [stepKey, setStepKey] = useState<StepKey>(saveErrored || saveErrorMessage ? "review" : "intro");
  const [saveError, setSaveError] = useState(saveErrored || Boolean(saveErrorMessage));
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
  // Capacity-first (#7): the monthly picture (income − fixed − debt − essentials).
  // Available before a liquid balance exists, so the reveal + allocation steps work.
  const capacity = useMemo(() => buildDraftCapacity(draft), [draft]);
  const allocation = useMemo(
    () => (capacity ? computeAllocationView(capacity.monthlyDisposableBeforeAllocations, state.reserves, state.goals) : null),
    [capacity, state.reserves, state.goals],
  );
  const payableSources = useMemo<Option<string>[]>(
    () => [
      { value: "", label: "— (sin especificar)" },
      ...state.accounts.filter(accountReviewable).map((a) => ({ value: a.id, label: a.name })),
      // S31 (3.12) — say what the source IS: a card reads as "(tarjeta)", not "(deuda)".
      ...state.debts.filter(debtReviewable).map((d) => ({ value: d.id, label: `${d.name || "Deuda"} ${d.type === "credit_card" ? "(tarjeta)" : "(deuda)"}` })),
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

  // FX guard, computed live (S31 5.1d/f — the full mirror lives in wizard-model so
  // the dev gate exercises it). Covers accounts/debts/incomes/expenses/goals/assets
  // and the budget-estimate currency, counts only rows with a parseable amount, and
  // honors both wizard-typed rates and the server-loaded ones. Never invents a rate.
  const fxMissing = useMemo<string[]>(() => wizardFxMissing(state, knownRates), [state, knownRates]);
  // Currencies whose guided-FX control should be visible on the Style/Review steps:
  // everything still missing PLUS every currency the user already gave a rate for
  // (so a field doesn't vanish mid-typing the moment its rate becomes valid).
  const fxVisibleTargets = useMemo<string[]>(() => {
    const baseUpper = base.trim().toUpperCase();
    const set = new Set<string>(fxMissing);
    for (const e of state.fxEntries ?? []) {
      const t = (e.target ?? "").trim().toUpperCase();
      if (t && t !== baseUpper) set.add(t);
    }
    return [...set];
  }, [fxMissing, state.fxEntries, base]);

  function patch(p: Partial<WizardState>) {
    setState((s) => ({ ...s, ...p }));
  }
  // Guided FX (#3 / S31 5.1c): every rate lives in fxEntries (one per foreign
  // currency); the legacy single-pair fields + the canonical `fxRate` string keep
  // mirroring entry 0 so parseFxRateString consumers and restored drafts stay
  // valid. Never fabricates a rate — an empty/invalid value composes "".
  function syncFxMirror(s: WizardState): WizardState {
    const first = (s.fxEntries ?? [])[0];
    return {
      ...s,
      fxTargetCurrency: first?.target ?? "",
      fxRateValue: first?.value ?? "",
      fxRate: first ? composeFxRateString(s.profile.baseCurrency, first.target, first.value) : "",
    };
  }
  /** Update the rate entry for one target currency (per-currency locked fields). */
  function setFxEntry(target: string, next: { target?: string; value?: string }) {
    setState((s) => {
      const key = (next.target ?? target).trim().toUpperCase();
      const prevKey = target.trim().toUpperCase();
      const entries = [...(s.fxEntries ?? [])];
      const idx = entries.findIndex((e) => (e.target ?? "").trim().toUpperCase() === prevKey);
      const prev = idx >= 0 ? entries[idx] : { target: key, value: "" };
      const updated = { target: key, value: next.value ?? prev.value ?? "" };
      if (idx >= 0) entries[idx] = updated;
      else entries.push(updated);
      return syncFxMirror({ ...s, fxEntries: entries });
    });
  }
  /** The single optional control (no currency missing yet) edits entry 0. */
  function setFxFree(next: { target?: string; value?: string }) {
    setState((s) => {
      const entries = [...(s.fxEntries ?? [])];
      const prev = entries[0] ?? { target: "", value: "" };
      entries[0] = {
        target: (next.target ?? prev.target ?? "").trim().toUpperCase(),
        value: next.value ?? prev.value ?? "",
      };
      return syncFxMirror({ ...s, fxEntries: entries });
    });
  }
  /** Current raw value typed for a target currency's rate. */
  function fxEntryValue(target: string): string {
    const key = target.trim().toUpperCase();
    return (state.fxEntries ?? []).find((e) => (e.target ?? "").trim().toUpperCase() === key)?.value ?? "";
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
    fd.set("baseCurrency", state.profile.baseCurrency);
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
                nextHint={
                  readiness.reviewableAccounts === 0
                    ? state.accounts.length > 0
                      ? "Ponle un nombre a tu cuenta para continuar"
                      : "Agrega al menos una cuenta"
                    : undefined
                }
              />
            }
          >
            {state.accounts.map((a) => (
              <ItemCard key={a.id} title="Cuenta" onRemove={() => patch({ accounts: state.accounts.filter((x) => x.id !== a.id) })}>
                <TextField label="Nombre" value={a.name} placeholder="Banco Pichincha, Efectivo…" onChange={(v) => updateItem("accounts", a.id, { name: v })} />
                {/* S31 (3.15) — a row with data but no valid name is dropped at save; say so. */}
                {!accountReviewable(a) && (parseMoney(a.balance) !== undefined || (a.note ?? "").trim().length > 0) && (
                  <p className="-mt-1 text-xs text-amber-300">Una cuenta sin nombre no se guardará — ponle un nombre o bórrala.</p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Tipo" value={a.type} options={ACCOUNT_TYPES} onChange={(v) => updateItem("accounts", a.id, { type: v })} />
                  <SelectField label="Moneda" value={a.currency} options={CURRENCIES} onChange={(v) => updateItem("accounts", a.id, { currency: v })} />
                </div>
                <MoneyField label="Más o menos, ¿cuánto tienes ahí? (opcional)" value={a.balance} currency={a.currency} onChange={(v) => updateItem("accounts", a.id, { balance: v })} />
                <Toggle label="Esta plata la guardo, no la gasto día a día (ahorro / inversión)" checked={a.liquidity === "non_liquid"} onChange={(v) => updateItem("accounts", a.id, { liquidity: v ? "non_liquid" : "liquid" })} />
                {a.liquidity === "non_liquid" && (
                  <>
                    {/* S31 (3.1) — point pure investments to the Activos step. */}
                    <p className="-mt-1 text-xs leading-5 text-zinc-500">
                      Solo cuentas donde entra y sale plata. Si es una inversión con rendimiento (plazo fijo, fondo, cripto), agrégala más adelante en Activos — ahí cuenta en tu patrimonio y te proyecto su rendimiento.
                    </p>
                    <TextField label="Rendimiento anual % (opcional)" value={a.returnRate} inputMode="decimal" placeholder="ej. 5" onChange={(v) => updateItem("accounts", a.id, { returnRate: v })} />
                  </>
                )}
                <NoteField value={a.note ?? ""} onChange={(v) => updateItem("accounts", a.id, { note: v })} placeholder="Ej. cuenta de emergencias, no tocar" />
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
              // S31 (4.2) — a variable min/max is PER PAYMENT; show the honest monthly
              // equivalent with the SAME factor the engine uses (30/7 weeks per month).
              const perPayFactor = i.frequency === "weekly" ? WEEKS_PER_MONTH : i.frequency === "biweekly" ? WEEKS_PER_MONTH / 2 : 1;
              const minParsed = parseMoney(i.minAmount);
              const maxOnly = i.isVariable && minParsed === undefined && parseMoney(i.maxAmount) !== undefined;
              return (
              <ItemCard key={i.id} title="Ingreso" onRemove={() => patch({ incomes: state.incomes.filter((x) => x.id !== i.id) })}>
                <TextField label="Nombre" value={i.name} placeholder="Sueldo, freelance, pensión…" onChange={(v) => updateItem("incomes", i.id, { name: v })} />
                {/* S31 (5.6) — the toggle is authoritative: turning it OFF clears the range. */}
                <Toggle
                  label="Varía mes a mes (no es fijo)"
                  checked={i.isVariable}
                  onChange={(v) => updateItem("incomes", i.id, v ? { isVariable: true } : { isVariable: false, minAmount: "", maxAmount: "" })}
                />
                {/* S31 (4.2) — frequency ABOVE the amounts, so "por pago" reads right. */}
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Cada cuánto" value={i.frequency} options={FREQUENCIES} onChange={(v) => updateItem("incomes", i.id, { frequency: v })} />
                  <SelectField label="Moneda" value={i.currency} options={CURRENCIES} onChange={(v) => updateItem("incomes", i.id, { currency: v })} />
                </div>
                {i.isVariable ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <MoneyField label="Mínimo por pago" value={i.minAmount} currency={i.currency} onChange={(v) => updateItem("incomes", i.id, { minAmount: v })} requiredHint />
                      <MoneyField label="Máximo por pago" value={i.maxAmount} currency={i.currency} onChange={(v) => updateItem("incomes", i.id, { maxAmount: v })} />
                    </div>
                    {minParsed !== undefined && perPayFactor !== 1 && (
                      <p className="-mt-1 text-xs text-emerald-300/80">
                        ≈ {formatKipuMoney(Math.round(minParsed * perPayFactor * 100) / 100, i.currency)} al mes (con tu mínimo)
                      </p>
                    )}
                    {maxOnly && (
                      <p className="-mt-1 text-xs text-amber-300">Este ingreso no se guardará sin el mínimo — ponle al menos el mínimo por pago.</p>
                    )}
                    <p className="-mt-1 text-xs text-zinc-500">Kipu usa el mínimo para no pasarse.</p>
                  </>
                ) : (
                  <MoneyField label="Monto" value={i.amount} currency={i.currency} onChange={(v) => updateItem("incomes", i.id, { amount: v })} requiredHint />
                )}
                {/* S31 (5.11) — a variable income can still have a fixed payday. */}
                {showDay && (
                  <TextField label="Día del mes (opcional)" value={i.expectedDay} inputMode="numeric" placeholder="1-31" onChange={(v) => updateItem("incomes", i.id, { expectedDay: v })} />
                )}
                {(i.frequency === "weekly" || i.frequency === "biweekly") && (
                  <>
                    <DateField label="¿Cuándo fue tu último pago? (para calcular el próximo)" value={i.lastPayDate} onChange={(v) => updateItem("incomes", i.id, { lastPayDate: v })} />
                    {/* S31 (3.5) — the anchor drives the weekly Margen; be honest about the cost of skipping it. */}
                    {!i.lastPayDate && (
                      <p className="-mt-1 text-xs text-amber-300/80">Sin esta fecha no sé qué semana te pagan, y tu Margen sale más bajo.</p>
                    )}
                  </>
                )}
                {accountSources.length > 1 && (
                  <SelectField label="Se deposita en (opcional)" value={i.destinationAccountId} options={accountSources} onChange={(v) => updateItem("incomes", i.id, { destinationAccountId: v })} />
                )}
                <NoteField value={i.note ?? ""} onChange={(v) => updateItem("incomes", i.id, { note: v })} placeholder="Ej. me suben el sueldo en enero" />
              </ItemCard>
              );
            })}
            <AddButton label="Agregar un ingreso" onClick={() => patch({ incomes: [...state.incomes, newIncome(base)] })} />
          </StepShell>
        )}

        {stepKey === "expenses" && (
          <StepShell
            title="¿Qué gastas cada mes?"
            subtitle="Son dos cosas distintas: lo que se repite igual (fijo) y lo que gastas normalmente (varía). Kipu separa las dos."
            footer={<Footer onBack={goBack} onNext={goNext} />}
          >
            {/* #1 — Section A: truly-fixed, recurring expenses. Clear header so it's
                visually distinct from the variable estimate below. */}
            <SectionHeader
              badge="1"
              title="Gastos fijos (se repiten igual)"
              subtitle="Arriendo, servicios, suscripciones, seguros, impuestos. Lo que llega casi con el mismo monto. No cada compra suelta."
            />
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
                {/* #2 — "Varía mes a mes" per-row toggle. */}
                <Toggle label="Varía mes a mes (luz, gas)" checked={Boolean(e.isVariable)} onChange={(v) => updateItem("expenses", e.id, { isVariable: v })} />
                {e.isVariable && (
                  <p className="-mt-1 text-xs text-zinc-500">Kipu lo trata como un monto que varía — no lo asume fijo.</p>
                )}
                <NoteField value={e.note ?? ""} onChange={(v) => updateItem("expenses", e.id, { note: v })} placeholder="Ej. el arriendo sube cada 3 meses, próximo aumento agosto" />
              </ItemCard>
            ))}
            <AddButton label="Agregar un gasto fijo" onClick={() => patch({ expenses: [...state.expenses, newExpense(base)] })} />

            {/* #1 — Section B: the variable "normal spend" estimate, clearly its own
                block with a distinct header — NOT merged with the fixed list. */}
            <div className="mt-2 rounded-2xl border border-emerald-400/25 bg-emerald-950/20 p-4">
              <SectionHeader
                badge="2"
                tone="emerald"
                title="Cuánto gastas normalmente"
                subtitle="Esto es lo que hace tu Margen real desde el día 1, no un estimado a ciegas. Más o menos, ¿cuánto se te va al mes en cada cosa, sin contar lo que ya pusiste arriba como gastos fijos? Kipu te muestra cómo se compara con tu gasto real — un número aproximado hoy ya vale oro."
              />
              <label className="mt-3 flex flex-col gap-1.5">
                <Label>Moneda de estos estimados</Label>
                <select
                  className={inputClass}
                  value={state.categoryBudgetCurrency || base}
                  onChange={(e) => setState((s) => ({ ...s, categoryBudgetCurrency: e.target.value === base ? "" : e.target.value }))}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                {state.categoryBudgetCurrency && state.categoryBudgetCurrency !== base && (
                  <span className="text-xs text-zinc-500">Kipu los convierte a {base} con tu tipo de cambio — te lo pido en el paso Estilo. Sin esa tasa, estos estimados no se pueden guardar.</span>
                )}
              </label>
              <div className="mt-3 flex flex-col gap-3">
                {state.categoryBudgets.map((cb) => (
                  <MoneyField
                    key={cb.category}
                    label={categoryLabel(cb.category)}
                    value={cb.amount}
                    currency={(state.categoryBudgetCurrency || base) as CurrencyCode}
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
            {state.debts.map((d) => {
              // #4 — a loan/préstamo is an amortized fixed cuota (no cutoff, no
              // revolving statement); a credit card is a revolving cycle. Show the
              // shape that matches the type: loans ask for the monthly cuota; cards
              // ask for cutoff/statement. family/other debts keep a simple shape.
              const isLoan = d.type === "loan";
              const isCard = d.type === "credit_card";
              return (
              <ItemCard key={d.id} title={isLoan ? "Préstamo" : isCard ? "Tarjeta" : "Deuda"} onRemove={() => patch({ debts: state.debts.filter((x) => x.id !== d.id) })}>
                <TextField label="Nombre" value={d.name} placeholder={isLoan ? "Préstamo estudiantil, auto…" : "Visa, Diners…"} onChange={(v) => updateItem("debts", d.id, { name: v })} />
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Tipo" value={d.type} options={DEBT_TYPES} onChange={(v) => updateItem("debts", d.id, { type: v })} />
                  <SelectField label="Moneda" value={d.currency} options={CURRENCIES} onChange={(v) => updateItem("debts", d.id, { currency: v })} />
                </div>
                <MoneyField label="Total que debes hoy (saldo)" value={d.balance} currency={d.currency} onChange={(v) => updateItem("debts", d.id, { balance: v })} />
                {/* S31 (3.8) — "saldo" on a card is the ACCUMULATED debt, not the statement. */}
                {isCard && (
                  <p className="-mt-1 text-xs text-zinc-500">Todo lo que debes acumulado, no solo el resumen de este mes.</p>
                )}

                {isLoan ? (
                  <>
                    {/* LOAN form — fixed cuota is the source of truth; no cutoff. */}
                    <MoneyField label="Cuota fija al mes" value={d.monthlyPayment ?? ""} currency={d.currency} onChange={(v) => updateItem("debts", d.id, { monthlyPayment: v })} requiredHint />
                    <div className="grid grid-cols-2 gap-3">
                      <TextField label="Día de pago (opcional)" value={d.dueDay} inputMode="numeric" placeholder="1-31" onChange={(v) => updateItem("debts", d.id, { dueDay: v })} />
                      <TextField label="Cuotas que faltan (opcional)" value={d.installmentsRemaining ?? ""} inputMode="numeric" placeholder="ej. 18" onChange={(v) => updateItem("debts", d.id, { installmentsRemaining: v })} />
                    </div>
                    <TextField label="Interés anual % (opcional)" value={d.interestRate} inputMode="decimal" placeholder="ej. 12" onChange={(v) => updateItem("debts", d.id, { interestRate: v })} />
                    <p className="-mt-1 text-xs text-zinc-500">El interés ya va incluido en tu cuota — es solo para que Kipu lo tenga presente.</p>
                    {accountSources.length > 1 && (
                      <SelectField label="Pagas desde (opcional)" value={d.defaultPaymentAccountId} options={accountSources} onChange={(v) => updateItem("debts", d.id, { defaultPaymentAccountId: v })} />
                    )}
                  </>
                ) : isCard ? (
                  <>
                    {/* CARD form — revolving cycle: statement + cutoff/due days. */}
                    <div className="grid grid-cols-2 gap-3">
                      <MoneyField label="A pagar este mes (opcional)" value={d.currentMonthPayment} currency={d.currency} onChange={(v) => updateItem("debts", d.id, { currentMonthPayment: v })} />
                      <MoneyField label="Pago mínimo (opcional)" value={d.minimumPayment} currency={d.currency} onChange={(v) => updateItem("debts", d.id, { minimumPayment: v })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <TextField label="Día de corte (opcional)" value={d.cutoffDay} inputMode="numeric" placeholder="1-31" onChange={(v) => updateItem("debts", d.id, { cutoffDay: v })} />
                      <TextField label="Día de pago (opcional)" value={d.dueDay} inputMode="numeric" placeholder="1-31" onChange={(v) => updateItem("debts", d.id, { dueDay: v })} />
                    </div>
                    <p className="-mt-1 text-xs text-zinc-500">Con el corte y el día de pago, Kipu reserva tu tarjeta el día justo — no te la cobra antes de tiempo.</p>
                    {/* S31 (3.9) — a due day + amount without the cutoff can't be placed in the calendar. */}
                    {!d.cutoffDay.trim() && d.dueDay.trim().length > 0 && parseMoney(d.currentMonthPayment) !== undefined && (
                      <p className="-mt-1 text-xs text-amber-300/80">Sin el día de corte no puedo ubicar el pago de tu tarjeta en el calendario.</p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <TextField label="Interés anual % (opcional)" value={d.interestRate} inputMode="decimal" placeholder="38" onChange={(v) => updateItem("debts", d.id, { interestRate: v })} />
                      {accountSources.length > 1 && (
                        <SelectField label="Pagas desde (opcional)" value={d.defaultPaymentAccountId} options={accountSources} onChange={(v) => updateItem("debts", d.id, { defaultPaymentAccountId: v })} />
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {/* family/other debt — simple monthly payment, no cycle. */}
                    <div className="grid grid-cols-2 gap-3">
                      <MoneyField label="Pago al mes (opcional)" value={d.currentMonthPayment} currency={d.currency} onChange={(v) => updateItem("debts", d.id, { currentMonthPayment: v })} />
                      <TextField label="Día de pago (opcional)" value={d.dueDay} inputMode="numeric" placeholder="1-31" onChange={(v) => updateItem("debts", d.id, { dueDay: v })} />
                    </div>
                    {accountSources.length > 1 && (
                      <SelectField label="Pagas desde (opcional)" value={d.defaultPaymentAccountId} options={accountSources} onChange={(v) => updateItem("debts", d.id, { defaultPaymentAccountId: v })} />
                    )}
                  </>
                )}
                <NoteField value={d.note ?? ""} onChange={(v) => updateItem("debts", d.id, { note: v })} placeholder="Ej. la Visa sube el cupo en agosto" />
              </ItemCard>
              );
            })}
            <AddButton label="Agregar una deuda" onClick={() => patch({ debts: [...state.debts, newDebt(base)], noDebts: false })} />
          </StepShell>
        )}

        {stepKey === "assets" && (() => {
          // S31 (3.15 / W-P1) — a NAMED asset with no parseable value would persist
          // as 0 patrimonio while the user believes it saved: warn + soft-block.
          const incompleteAssets = (state.assets ?? []).filter(
            (a) => a.name.trim().length > 0 && parseMoney(a.value) === undefined,
          );
          return (
          <StepShell
            title="¿Tienes activos o inversiones?"
            subtitle="Inversiones, una propiedad, tu auto, cripto, o plata que te deben. Es opcional — sáltalo si no aplica. Si ya lo pusiste como cuenta de ahorro en el paso Cuentas, no lo repitas aquí."
            footer={
              <Footer
                onBack={goBack}
                onNext={goNext}
                nextLabel={(state.assets ?? []).length === 0 ? "No tengo, continuar" : "Continuar"}
                nextDisabled={incompleteAssets.length > 0}
                nextHint={incompleteAssets.length > 0 ? "Ponle un valor a tu activo para guardarlo (o quítalo)." : undefined}
              />
            }
          >
            {/* #6 — assets build PATRIMONIO, they don't raise the Margen. Symmetric to
                the debts step but on the other side of the balance sheet. */}
            <div className="rounded-2xl border border-sky-400/20 bg-sky-950/20 p-4">
              <p className="text-xs leading-5 text-sky-100/80">
                Esto <span className="font-semibold text-sky-100">no sube</span> tu Margen — es plata apartada. Suma a tu patrimonio (lo que tienes), no a lo que puedes gastar.
              </p>
            </div>
            {(state.assets ?? []).map((a) => (
              <ItemCard
                key={a.id}
                title={ASSET_CLASSES.find((c) => c.value === a.assetClass)?.label ?? "Activo"}
                onRemove={() => patch({ assets: (state.assets ?? []).filter((x) => x.id !== a.id) })}
              >
                <TextField label="Nombre" value={a.name} placeholder="Fondo indexado, depa, auto…" onChange={(v) => updateItem("assets", a.id, { name: v })} />
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Tipo" value={a.assetClass} options={ASSET_CLASSES} onChange={(v) => updateItem("assets", a.id, { assetClass: v })} />
                  <SelectField label="Moneda" value={a.currency} options={CURRENCIES} onChange={(v) => updateItem("assets", a.id, { currency: v })} />
                </div>
                <MoneyField label="¿Cuánto vale hoy? (aprox.)" value={a.value} currency={a.currency} onChange={(v) => updateItem("assets", a.id, { value: v })} requiredHint />
                {a.name.trim().length > 0 && parseMoney(a.value) === undefined && (
                  <p className="-mt-1 text-xs text-amber-300">Ponle un valor para guardarlo — sin valor no suma a tu patrimonio.</p>
                )}
                <TextField label="Rendimiento anual % (opcional)" value={a.expectedReturn} inputMode="decimal" placeholder="ej. 7" onChange={(v) => updateItem("assets", a.id, { expectedReturn: v })} />
                {/* S31 (3.14) — say what the % is FOR, and its shape. */}
                <p className="-mt-1 text-xs text-zinc-500">Con esto te proyecto su crecimiento — escribe 7 para 7%.</p>
                <Toggle label="Lo puedo convertir en efectivo fácil" checked={a.liquid} onChange={(v) => updateItem("assets", a.id, { liquid: v })} />
                <Toggle label="Cuéntalo en mi patrimonio" checked={a.includeInNetWorth} onChange={(v) => updateItem("assets", a.id, { includeInNetWorth: v })} />
                <NoteField value={a.note ?? ""} onChange={(v) => updateItem("assets", a.id, { note: v })} placeholder="Ej. lo vendo para la boda en 2028" />
              </ItemCard>
            ))}
            <AddButton label="Agregar un activo" onClick={() => patch({ assets: [...(state.assets ?? []), newAsset(base)] })} />
          </StepShell>
          );
        })()}

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
                  {/* S31 (W-P1) — goals.notes existed but had no input; now it does. */}
                  <NoteField value={g.note ?? ""} onChange={(v) => updateItem("goals", g.id, { note: v })} placeholder="Ej. la boda es en marzo de 2028" />
                </ItemCard>
              );
            })}

            {/* #7 — savings/investment + goal contributions moved OUT of here, into the
                post-capacity allocation step, so the user decides how much to apart
                AFTER seeing what they can actually afford. */}
            <div className="mt-2 rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
              <p className="text-xs leading-5 text-zinc-500">
                Define aquí <span className="text-zinc-300">qué</span> quieres lograr. En un momento, cuando veas cuánto te queda libre, decides <span className="text-zinc-300">cuánto</span> apartar a cada meta y a tu ahorro.
              </p>
            </div>
          </StepShell>
        )}

        {stepKey === "capacity" && (
          <CapacityStep
            capacity={capacity}
            base={base}
            fxBlockedCurrencies={fxMissing}
            fxEntryValue={fxEntryValue}
            onFxEntry={setFxEntry}
            onBack={goBack}
            onNext={goNext}
          />
        )}

        {stepKey === "allocation" && (
          <AllocationStep
            state={state}
            allocation={allocation}
            base={base}
            onBack={goBack}
            onNext={goNext}
            onReserves={(r) => patch({ reserves: { ...state.reserves, ...r } })}
            onGoalContribution={(id, v) => updateItem("goals", id, { monthlyContribution: v })}
          />
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
            {/* #3 / S31 (5.1c) — guided FX, ONE field per foreign currency: fixed
                "1 {base} =" label + number + locked target. Composes the same string
                the parser expects; never fabricates a rate. With no currency in play,
                a single optional field (selectable target) remains available. */}
            {fxVisibleTargets.length > 0 ? (
              fxVisibleTargets.map((cur) => (
                <FxGuidedField
                  key={cur}
                  base={base}
                  target={cur}
                  lockTarget
                  value={fxEntryValue(cur)}
                  missing={fxMissing.includes(cur) ? [cur] : []}
                  onChange={(next) => setFxEntry(cur, next)}
                />
              ))
            ) : (
              <FxGuidedField
                base={base}
                target={state.fxTargetCurrency ?? ""}
                value={state.fxRateValue ?? ""}
                missing={[]}
                onChange={setFxFree}
              />
            )}
            <label className="flex flex-col gap-1.5">
              <Label>¿Algo más que Kipu deba saber? (opcional)</Label>
              <textarea
                className={`${inputClass} min-h-[88px] resize-none`}
                value={state.note}
                maxLength={500}
                onChange={(e) => patch({ note: e.target.value })}
                placeholder="Inversiones y a qué tasa, seguros o pólizas, gastos que comparto con alguien, el arriendo sube cada 3 meses…"
              />
              {/* S31 (2.4) — the column caps at 500; count down instead of silently truncating. */}
              {state.note.length > 0 && (
                <span className={`self-end text-xs ${state.note.length >= 500 ? "text-amber-300" : "text-zinc-600"}`}>
                  {state.note.length}/500
                </span>
              )}
            </label>
          </StepShell>
        )}

        {stepKey === "review" && (
          <ReviewStep
            state={state}
            margen={margen}
            capacity={capacity}
            allocation={allocation}
            readiness={readiness}
            importMsg={importMsg}
            importErrors={importErrors}
            saveError={saveError}
            saveErrorMessage={saveErrorMessage}
            saving={saving}
            fxMissing={fxMissing}
            fxEntryValue={fxEntryValue}
            onFxEntry={setFxEntry}
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
  function updateItem<K extends "accounts" | "incomes" | "expenses" | "debts" | "goals" | "assets">(
    key: K,
    id: string,
    patchItem: Partial<NonNullable<WizardState[K]>[number]>,
  ) {
    setState((s) => ({
      ...s,
      [key]: ((s[key] ?? []) as { id: string }[]).map((it) => (it.id === id ? { ...it, ...patchItem } : it)),
    }));
  }
}

// ── Item factories ─────────────────────────────────────────────────────────────

function newAccount(currency: CurrencyCode, primary: boolean): WizardAccount {
  return { id: genId(), name: "", type: "bank", balance: "", currency, liquidity: "liquid", isGoalAccount: false, isPrimary: primary, returnRate: "", note: "" };
}
function newIncome(currency: CurrencyCode): WizardIncome {
  return { id: genId(), name: "", amount: "", currency, frequency: "monthly", expectedDay: "", lastPayDate: "", isVariable: false, minAmount: "", maxAmount: "", destinationAccountId: "", note: "" };
}
function newExpense(currency: CurrencyCode): WizardExpense {
  return { id: genId(), name: "", amount: "", currency, category: "housing", frequency: "monthly", expectedDay: "", isEssential: true, paymentSourceId: "", isVariable: false, note: "" };
}
function newDebt(currency: CurrencyCode): WizardDebt {
  return { id: genId(), name: "", type: "credit_card", balance: "", currentMonthPayment: "", minimumPayment: "", currency, dueDay: "", cutoffDay: "", interestRate: "", defaultPaymentAccountId: "", monthlyPayment: "", installmentsRemaining: "", note: "" };
}
function newAsset(currency: CurrencyCode): WizardAsset {
  return { id: genId(), name: "", assetClass: "investment", value: "", currency, liquid: false, includeInNetWorth: true, expectedReturn: "", note: "" };
}
function newGoal(currency: CurrencyCode, archetype: WizardGoal["archetype"]): WizardGoal {
  return { id: genId(), name: "", archetype, targetAmount: "", currentAmount: "", currency, targetDate: "", monthlyContribution: "", note: "" };
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

// A labeled section divider so distinct concepts on one step read as distinct
// blocks (#1: fixed vs variable). `badge` is a small step number chip.
function SectionHeader(props: { badge?: string; title: string; subtitle?: string; tone?: "zinc" | "emerald" }) {
  const emerald = props.tone === "emerald";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {props.badge && (
          <span className={`flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-bold ${emerald ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-zinc-300"}`}>
            {props.badge}
          </span>
        )}
        <p className={`text-sm font-bold ${emerald ? "text-emerald-100" : "text-zinc-100"}`}>{props.title}</p>
      </div>
      {props.subtitle && <p className={`text-xs leading-5 ${emerald ? "text-emerald-100/70" : "text-zinc-500"}`}>{props.subtitle}</p>}
    </div>
  );
}

// Compact inverse for the FX echo line: "1 ARS = 0.00072 USD (1 USD ≈ 1388.89 ARS)".
function fxInverseLabel(rate: number): string {
  const inv = 1 / rate;
  return inv >= 1 ? String(Math.round(inv * 100) / 100) : String(Number(inv.toPrecision(3)));
}

// #3 / S31 (5.1) — guided FX control: a fixed "1 {base} =" prefix, one STRICT
// numeric field, and the target currency (locked when the parent renders one field
// per missing currency). Under the field, Kipu ECHOES exactly what it parsed
// (3.10) — the cheapest honest mitigation for every rate-parsing bug class.
// Turns amber when a foreign amount needs a rate that isn't set yet.
function FxGuidedField(props: {
  base: CurrencyCode;
  target: string;
  value: string;
  missing: string[];
  lockTarget?: boolean;
  onChange: (next: { target?: string; value?: string }) => void;
}) {
  const blocking = props.missing.length > 0;
  const parsed = parseFxRateValue(props.value);
  const invalid = props.value.trim().length > 0 && parsed === undefined;
  const targetOptions = CURRENCIES.filter((c) => c.value !== props.base);
  return (
    <div className={`flex flex-col gap-2 ${blocking ? "rounded-2xl border border-amber-500/40 bg-amber-950/20 p-4" : ""}`}>
      <Label>
        {blocking
          ? `Tu tipo de cambio para ${props.missing.join(", ")} (lo necesito)`
          : props.lockTarget
            ? `Tu tipo de cambio para ${props.target}`
            : "¿Manejas más de una moneda? Tu tipo de cambio (opcional)"}
      </Label>
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-sm font-semibold text-zinc-300">
          1 {props.base} =
        </span>
        <input
          className={`${inputClass} ${invalid ? "border-rose-500/50" : blocking ? "border-amber-500/50" : ""}`}
          value={props.value}
          inputMode="decimal"
          onChange={(e) => props.onChange({ value: e.target.value })}
          placeholder="1480"
        />
        {props.lockTarget ? (
          <span className="shrink-0 rounded-xl border border-white/10 bg-zinc-900 px-3 py-2.5 text-sm font-semibold text-zinc-300">
            {props.target}
          </span>
        ) : (
          <select
            className={`${inputClass} w-auto shrink-0`}
            value={props.target}
            onChange={(e) => props.onChange({ target: e.target.value })}
          >
            <option value="">Moneda</option>
            {targetOptions.map((c) => (
              <option key={c.value} value={c.value}>{c.value}</option>
            ))}
          </select>
        )}
      </div>
      {invalid ? (
        <span className="text-xs text-rose-300">Escribe solo el número de la tasa (ej. 1480 o 0.00072).</span>
      ) : parsed !== undefined && props.target ? (
        <span className="text-xs text-emerald-300/80">
          Entendí: 1 {props.base} = {String(parsed)} {props.target} (1 {props.target} ≈ {fxInverseLabel(parsed)} {props.base}).
        </span>
      ) : null}
      <span className={`text-xs ${blocking ? "text-amber-200/80" : "text-zinc-600"}`}>
        {blocking
          ? `Metiste montos en ${props.missing.join(", ")}. Con tu tasa, Kipu los guarda bien en ${props.base} — nunca inventa una. La puedes cambiar cuando quieras en Ajustes.`
          : "Kipu usa esta tasa (nunca inventa una). La puedes cambiar cuando quieras en Ajustes."}
      </span>
    </div>
  );
}

// #7 — CAPACITY REVEAL. Before the user commits any savings/investment/goal money,
// show what the month actually leaves free: income − fixed − debt − essentials.
// S31 (5.1e): when a foreign-currency income was EXCLUDED for a missing rate, ask
// for that rate right here — the honest fix — instead of a wrong "agrega un ingreso".
function CapacityStep(props: {
  capacity: ReturnType<typeof buildDraftCapacity>;
  base: CurrencyCode;
  fxBlockedCurrencies: string[];
  fxEntryValue: (target: string) => string;
  onFxEntry: (target: string, next: { target?: string; value?: string }) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const c = props.capacity;
  const fxAsk = props.fxBlockedCurrencies.length > 0 && (
    <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/40 bg-amber-950/30 p-4">
      <p className="text-xs leading-5 text-amber-200/90">
        {c
          ? `Ojo: este número aún NO incluye lo que está en ${props.fxBlockedCurrencies.join(", ")} — me falta tu tipo de cambio. Dámelo aquí y el número se completa.`
          : `Tienes montos en ${props.fxBlockedCurrencies.join(", ")} y aún no tengo tu tipo de cambio — sin la tasa no puedo sumarlos honestamente. Dámela aquí y te muestro tu número real.`}
      </p>
      {props.fxBlockedCurrencies.map((cur) => (
        <FxGuidedField
          key={cur}
          base={props.base}
          target={cur}
          lockTarget
          value={props.fxEntryValue(cur)}
          missing={[cur]}
          onChange={(next) => props.onFxEntry(cur, next)}
        />
      ))}
    </div>
  );
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-50">Esto es lo que te queda cada mes</h1>
        <p className="mt-1.5 text-sm leading-6 text-zinc-400">Antes de apartar nada, mira tu número real. De aquí sale lo que puedes ahorrar, invertir y gastar tranquilo.</p>
      </div>

      {c ? (
        <>
          <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-b from-emerald-500/10 to-transparent p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/80">Con lo que me diste, te quedan</p>
            <p className="mt-1 text-3xl font-black text-zinc-50">{formatKipuMoney(c.monthlyDisposableBeforeAllocations, props.base)}</p>
            <p className="mt-1 text-xs text-zinc-400">libres al mes · antes de ahorro, inversión y metas</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Cómo sale ese número</p>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <CapacityRow label="Lo que entra (ingresos)" amount={c.monthlyIncome} base={props.base} positive />
              <CapacityRow label="Gastos fijos" amount={-c.monthlyFixed} base={props.base} />
              <CapacityRow label="Pagos de deudas" amount={-c.monthlyDebtService} base={props.base} />
              <CapacityRow label="Lo que gastas normalmente" amount={-c.monthlyEssentials} base={props.base} />
              <div className="my-1 h-px bg-white/10" />
              <CapacityRow label="Te queda libre" amount={c.monthlyDisposableBeforeAllocations} base={props.base} strong />
            </div>
          </div>
          {fxAsk}
        </>
      ) : fxAsk ? (
        fxAsk
      ) : (
        <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5 text-center text-sm text-zinc-400">
          Para ver tu número, agrega un ingreso en tu moneda principal ({props.base}). Puedes volver atrás y agregarlo.
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button type="button" onClick={props.onBack} className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-zinc-300 transition hover:border-white/25">
          Atrás
        </button>
        <button type="button" onClick={props.onNext} className="flex-1 rounded-2xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300">
          Ahora sí, repartir mi plata
        </button>
      </div>
    </section>
  );
}

function CapacityRow(props: { label: string; amount: number; base: CurrencyCode; positive?: boolean; strong?: boolean }) {
  const neg = props.amount < 0;
  return (
    <div className="flex items-center justify-between">
      <span className={props.strong ? "font-semibold text-zinc-100" : "text-zinc-400"}>{props.label}</span>
      <span className={`tabular-nums ${props.strong ? "font-bold text-emerald-300" : neg ? "text-zinc-400" : "text-zinc-200"}`}>
        {neg ? "−" : props.positive ? "+" : ""}{formatKipuMoney(Math.abs(props.amount), props.base)}
      </span>
    </div>
  );
}

// #7 — ALLOCATION. Post-capacity: the user decides how much to apart to savings,
// investment, and each goal, with a LIVE "te quedan X/mes (~/día) libres" and a
// gentle recommendation. Over-allocating is warned, never blocked.
function AllocationStep(props: {
  state: WizardState;
  allocation: ReturnType<typeof computeAllocationView> | null;
  base: CurrencyCode;
  onBack: () => void;
  onNext: () => void;
  onReserves: (r: Partial<{ monthlySavings: string; monthlyInvestment: string }>) => void;
  onGoalContribution: (id: string, v: string) => void;
}) {
  const { allocation: a, base } = props;
  // S31 (5.12) — only goals that will actually PERSIST accept a contribution;
  // a money goal still missing its amount gets a pointer instead of a dead input.
  const moneyGoals = props.state.goals.filter((g) => g.archetype !== "organize_month");
  const contributableGoals = moneyGoals.filter(goalReviewable);
  const pendingGoals = moneyGoals.filter((g) => !goalReviewable(g));

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-50">Reparte lo que te queda</h1>
        <p className="mt-1.5 text-sm leading-6 text-zinc-400">Decide cuánto apartas. Kipu te muestra en vivo lo que te queda para el día a día — sin dramatizar, con la verdad.</p>
      </div>

      {a && (
        <div className={`sticky top-2 z-10 rounded-2xl border p-4 text-center shadow-lg backdrop-blur ${a.overAllocated ? "border-amber-500/40 bg-amber-950/60" : "border-emerald-400/25 bg-emerald-950/50"}`}>
          <p className={`text-xs font-semibold uppercase tracking-widest ${a.overAllocated ? "text-amber-300/90" : "text-emerald-300/90"}`}>
            Te queda para el día a día
          </p>
          <p className={`mt-1 text-2xl font-black ${a.overAllocated ? "text-amber-200" : "text-zinc-50"}`}>
            {formatKipuMoney(a.trulyFree, base)}<span className="text-sm font-semibold text-zinc-400"> /mes</span>
          </p>
          {/* S31 (W-P2) — no awkward "~-3.67$/día": the per-day slice hides when
              negative (the over-allocation warning below already explains). */}
          <p className="mt-0.5 text-xs text-zinc-400">
            {a.trulyFree >= 0 && <>~{formatKipuMoney(a.trulyFreeDaily, base)}/día · </>}de {formatKipuMoney(a.monthlyDisposable, base)} libres
          </p>
          {a.overAllocated && (
            <p className="mt-2 text-xs leading-5 text-amber-200/90">
              Estás apartando más de lo que te queda ({formatKipuMoney(a.totalAllocated, base)}). No pasa nada por soñar, pero para que cuadre, baja un poco alguna.
            </p>
          )}
          {!a.overAllocated && <AllocationRecommendation a={a} base={base} />}
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Ahorro e inversión</p>
        <p className="mt-1 text-xs text-zinc-500">Lo que apartas fijo cada mes. Kipu lo protege antes de decirte cuánto puedes gastar.</p>
        {/* S31 (3.4) — prevent the savings/goal double-reserve. */}
        <p className="mt-1 text-xs text-zinc-500">Esto es aparte de tus metas — si tu ahorro va a una meta de abajo, ponlo solo en la meta.</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <MoneyField label="Ahorro / mes" value={props.state.reserves.monthlySavings} currency={base} onChange={(v) => props.onReserves({ monthlySavings: v })} />
          <MoneyField label="Inversión / mes" value={props.state.reserves.monthlyInvestment} currency={base} onChange={(v) => props.onReserves({ monthlyInvestment: v })} />
        </div>
      </div>

      {(contributableGoals.length > 0 || pendingGoals.length > 0) && (
        <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Cuánto a cada meta / mes</p>
          <p className="mt-1 text-xs text-zinc-500">Lo que le metes a cada meta cada mes. Puedes dejar una en blanco por ahora.</p>
          <div className="mt-3 flex flex-col gap-3">
            {contributableGoals.map((g) => (
              <MoneyField
                key={g.id}
                label={g.name?.trim() || GOAL_DEFAULT_NAMES[g.archetype]}
                value={g.monthlyContribution ?? ""}
                currency={base}
                onChange={(v) => props.onGoalContribution(g.id, v)}
              />
            ))}
            {pendingGoals.map((g) => (
              <p key={g.id} className="text-xs text-amber-300/80">
                {g.name?.trim() || GOAL_DEFAULT_NAMES[g.archetype]}: ponle un monto a la meta para poder apartarle plata.
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button type="button" onClick={props.onBack} className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-zinc-300 transition hover:border-white/25">
          Atrás
        </button>
        <button type="button" onClick={props.onNext} className="flex-1 rounded-2xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300">
          Continuar
        </button>
      </div>
    </section>
  );
}

// Gentle, non-pushy suggestion. When nothing is allocated yet and there's room,
// suggest a simple split; otherwise just affirm what's left is healthy.
function AllocationRecommendation({ a, base }: { a: NonNullable<ReturnType<typeof computeAllocationView>>; base: CurrencyCode }) {
  if (a.monthlyDisposable <= 0) return null;
  if (a.totalAllocated === 0) {
    const suggestion = Math.round((a.monthlyDisposable * 0.2) / 5) * 5; // ~20%, rounded to 5
    if (suggestion <= 0) return null;
    return (
      <p className="mt-2 text-xs leading-5 text-emerald-100/80">
        Una idea: apartar ~{formatKipuMoney(suggestion, base)} al mes (un 20%) ya te construye colchón sin apretarte. Tú decides.
      </p>
    );
  }
  return (
    <p className="mt-2 text-xs leading-5 text-emerald-100/70">
      Buen balance — apartas {formatKipuMoney(a.totalAllocated, base)} y te queda un margen sano para el día a día.
    </p>
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
        <p className="text-xs text-zinc-500">Cada cuenta o ingreso puede tener su propia moneda. Esta es la moneda en la que Kipu suma y te muestra todo — elige la que más usas en tu día a día.</p>
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
  capacity: ReturnType<typeof buildDraftCapacity>;
  allocation: ReturnType<typeof computeAllocationView> | null;
  readiness: ReturnType<typeof wizardReadiness>;
  importMsg: string | null;
  importErrors: string[];
  saveError: boolean;
  saveErrorMessage?: string | null;
  saving: boolean;
  fxMissing: string[];
  fxEntryValue: (target: string) => string;
  onFxEntry: (target: string, next: { target?: string; value?: string }) => void;
  onBack: () => void;
  onConfirm: () => void;
  onEdit: (k: StepKey) => void;
}) {
  const { state, margen, capacity, allocation, readiness, fxMissing } = props;
  const base = state.profile.baseCurrency;
  const fxBlocking = fxMissing.length > 0;
  const reviewAccounts = state.accounts.filter(accountReviewable);
  const reviewIncome = state.incomes.filter(incomeReviewable);
  const reviewExpenses = state.expenses.filter(expenseReviewable);
  const reviewDebts = state.debts.filter(debtReviewable);
  const reviewAssets = (state.assets ?? []).filter((x) => x.name.trim().length > 0 || parseMoney(x.value) !== undefined);
  const reviewGoals = state.goals.filter(goalReviewable);
  // #8 — one-line capacity summary under the headline.
  const protectedTotal = allocation ? allocation.totalAllocated : 0;
  // S31 (4.1) — the server's real message, VERBATIM. An FX ask renders amber (it's
  // a fixable data ask, not a failure); anything else stays rose.
  const serverMessage = (props.saveErrorMessage ?? "").trim();
  const serverMessageIsFx = /tasa|tipo de cambio/i.test(serverMessage);

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-50">Revisa antes de empezar</h1>
        <p className="mt-1.5 text-sm leading-6 text-zinc-400">Esto es lo que Kipu va a recordar. Edita lo que quieras; nada se guarda hasta que confirmes.</p>
      </div>

      {props.saveError && (
        serverMessage ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              serverMessageIsFx
                ? "border-amber-500/40 bg-amber-950/30 text-amber-200"
                : "border-rose-500/30 bg-rose-950/40 text-rose-200"
            }`}
          >
            {serverMessage}
          </div>
        ) : (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
            No pude guardar tus datos (algo falló de nuestro lado). Tu información sigue aquí — vuelve a tocar «Confirmar» en un momento.
          </div>
        )
      )}

      {/* FX recovery in place: instead of bouncing at Confirm, we ask for the
          missing rate(s) right here — one field per currency (S31 5.1c). */}
      {fxBlocking && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/40 bg-amber-950/30 p-4">
          {fxMissing.map((cur) => (
            <FxGuidedField
              key={cur}
              base={base}
              target={cur}
              lockTarget
              value={props.fxEntryValue(cur)}
              missing={[cur]}
              onChange={(next) => props.onFxEntry(cur, next)}
            />
          ))}
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
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/80">
            {margen.confidence === "solid" ? "Esto puedes gastar tranquilo" : "Tu primer Margen (preliminar)"}
          </p>
          <p className="mt-1 text-3xl font-black text-zinc-50">{formatKipuMoney(margen.margenWeekly, base)}</p>
          <p className="mt-1 text-xs text-zinc-400">
            esta semana · ~{formatKipuMoney(margen.margenDaily, base)}/día
          </p>
          <p className="mt-2 text-xs leading-5 text-emerald-100/70">
            {margen.confidence === "solid"
              ? "Con lo que me diste, este número ya es confiable — se afina con tu uso."
              : margen.essentialsKnown
                ? "Este es tu Margen preliminar; se afina con tus primeros días de uso."
                : "Este es tu Margen preliminar: aún no sé cuánto gastas al día. Cuéntame tu gasto diario típico o registra tus primeros días y se vuelve real."}
          </p>
          {/* #8 — one-line capacity summary so the finish is honest about the month. */}
          {capacity && (
            <p className="mt-3 border-t border-white/10 pt-3 text-xs leading-5 text-zinc-400">
              Al mes te quedan ~{formatKipuMoney(capacity.monthlyDisposableBeforeAllocations, base)}
              {protectedTotal > 0 && <> · con {formatKipuMoney(protectedTotal, base)} apartado, ~{formatKipuMoney(capacity.monthlyDisposableBeforeAllocations - protectedTotal, base)} libres</>}.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5 text-center text-sm text-zinc-400">
          Para tu primer Margen, agrega un saldo a una cuenta y un ingreso en tu moneda principal ({base}).
        </div>
      )}

      <ReviewBlock title="Cuentas" count={reviewAccounts.length} onEdit={() => props.onEdit("accounts")}
        lines={reviewAccounts.map((a) => {
          const bal = parseMoney(a.balance);
          // S31 (3.16) — mark protected savings + whether a note travels with the row.
          return `${a.name}${bal !== undefined ? ` · ${formatKipuMoney(bal, a.currency)}` : ""}${a.liquidity === "non_liquid" ? " · guardada (no cuenta para gastar)" : ""}${(a.note ?? "").trim() ? " · nota ✓" : ""}`;
        })} />
      <ReviewBlock title="Ingresos" count={reviewIncome.length} onEdit={() => props.onEdit("income")}
        lines={reviewIncome.map((i) => {
          // S31 (4.3) — a variable income never reads "· 0$": show the real range + cadence.
          const freqLabel = FREQUENCIES.find((f) => f.value === i.frequency)?.label.toLowerCase() ?? "";
          const suffix = freqLabel ? ` · ${freqLabel}` : "";
          if (i.isVariable) {
            const min = parseMoney(i.minAmount);
            const max = parseMoney(i.maxAmount);
            const range =
              min !== undefined && max !== undefined
                ? `${formatKipuMoney(min, i.currency)}–${formatKipuMoney(max, i.currency)} (variable)`
                : min !== undefined
                  ? `desde ${formatKipuMoney(min, i.currency)}`
                  : "variable";
            return `${i.name || "Ingreso"} · ${range}${suffix}`;
          }
          const amount = parseMoney(i.amount);
          return `${i.name || "Ingreso"}${amount !== undefined ? ` · ${formatKipuMoney(amount, i.currency)}` : ""}${suffix}`;
        })} />
      <ReviewBlock title="Gastos fijos" count={reviewExpenses.length} onEdit={() => props.onEdit("expenses")}
        lines={reviewExpenses.map((e) => `${e.name || "Gasto"} · ${formatKipuMoney(parseMoney(e.amount) ?? 0, e.currency)}`)} />
      <ReviewBlock title="Deudas" count={reviewDebts.length} onEdit={() => props.onEdit("debts")}
        lines={reviewDebts.map((d) => {
          // S31 (4.3/3.16) — honest debt lines: fallback name, loan cuota as cuota,
          // and a statement-only card says the saldo shown IS this month's payment.
          const name = d.name || (d.type === "loan" ? "Préstamo" : d.type === "credit_card" ? "Tarjeta" : "Deuda");
          const bal = parseMoney(d.balance);
          const cuota = d.type === "loan" ? parseMoney(d.monthlyPayment) : undefined;
          if (bal !== undefined && cuota !== undefined)
            return `${name} · ${formatKipuMoney(bal, d.currency)} · cuota ${formatKipuMoney(cuota, d.currency)}/mes`;
          if (bal !== undefined) return `${name} · ${formatKipuMoney(bal, d.currency)}`;
          if (cuota !== undefined) return `${name} · ${formatKipuMoney(cuota, d.currency)}/mes (cuota)`;
          const statement = parseMoney(d.currentMonthPayment);
          if (statement !== undefined) return `${name} · ${formatKipuMoney(statement, d.currency)} (saldo → pago del mes)`;
          const min = parseMoney(d.minimumPayment);
          if (min !== undefined) return `${name} · mínimo ${formatKipuMoney(min, d.currency)}`;
          return name;
        })}
        emptyLabel={state.noDebts ? "Sin deudas 🙌" : undefined} />
      <ReviewBlock title="Activos" count={reviewAssets.length} onEdit={() => props.onEdit("assets")}
        lines={reviewAssets.map((a) => {
          const val = parseMoney(a.value);
          return `${a.name || "Activo"}${val !== undefined ? ` · ${formatKipuMoney(val, a.currency)}` : " · sin valor (no se guardará)"}`;
        })}
        emptyLabel="Sin activos (puedes agregarlos luego)." />
      <ReviewBlock title="Metas" count={reviewGoals.length} onEdit={() => props.onEdit("goals")}
        lines={reviewGoals.map((g) => {
          const contribution = parseMoney(g.monthlyContribution);
          // S31 (W-P2) — archetype goals show their real name, never a generic "Meta".
          return `${g.name.trim() || GOAL_DEFAULT_NAMES[g.archetype]}${contribution !== undefined && contribution > 0 ? ` · ${formatKipuMoney(contribution, base)}/mes` : ""}`;
        })} />

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
          disabled={!readiness.canFinish || fxBlocking || props.saving}
          className="flex-1 rounded-2xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {props.saving ? "Guardando…" : "Confirmar y entrar a Kipu"}
        </button>
      </div>
      {fxBlocking && (
        <p className="text-center text-xs text-amber-300/80">
          Agrega el tipo de cambio de arriba para poder guardar.
        </p>
      )}
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
