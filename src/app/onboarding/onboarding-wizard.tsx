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
  collectWizardFxRates,
  composeFxRateString,
  computeAllocationView,
  debtReviewable,
  expenseReviewable,
  goalReviewable,
  incomeReviewable,
  parseFxRateValue,
  parseMoney,
  sanitizeIsoDate,
  seedMonthISO,
  wizardFxMissing,
  wizardReadiness,
  type WizardReadiness,
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
import type { OnboardingGoalArchetype } from "@/lib/onboarding/draft-types";
import { WEEKS_PER_MONTH, buildDraftCapacity, buildDraftMargenPreview } from "@/lib/onboarding/draft-margen-preview";
import { formatKipuMoney } from "@/lib/financial/money";
import { addMonthsISO, simulateByContribution, simulateByDate } from "@/lib/financial/goal-simulator";
import { MonthSankey, type SankeyFlow } from "@/app/app/components/living/MonthSankey";
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
  return VARIABLE_BUDGET_CATEGORIES.map((category) => ({ category, amount: "", mtdSeed: "" }));
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
  { key: "capacity", label: "Tu margen" },
  { key: "reserves", label: "Ahorro" },
  { key: "goalplan", label: "Metas", required: true },
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
  // S34 — server-known rates reach every conversion (draft + previews), so the
  // review number and the persisted truth match for a user whose rate was set
  // earlier via chat (the FX gate already honored them; the math now does too).
  const draft = useMemo(() => buildOnboardingDraft(state, knownRates), [state, knownRates]);
  const margen = useMemo(() => buildDraftMargenPreview(draft, new Date(), knownRates), [draft, knownRates]);
  // Capacity-first (#7): the monthly picture (income − fixed − debt − essentials).
  // Available before a liquid balance exists, so the reveal + allocation steps work.
  const capacity = useMemo(() => buildDraftCapacity(draft, knownRates), [draft, knownRates]);
  const allocation = useMemo(
    () => (capacity ? computeAllocationView(capacity.monthlyDisposableBeforeAllocations, state.reserves, state.goals) : null),
    [capacity, state.reserves, state.goals],
  );
  // S33 — reserves step shows the pool BEFORE goals (disposable − savings −
  // investment); its trulyFree is the base the goal simulator distributes.
  const reservesView = useMemo(
    () => (capacity ? computeAllocationView(capacity.monthlyDisposableBeforeAllocations, state.reserves, []) : null),
    [capacity, state.reserves],
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
  // S35 — the ONE FX signal used elsewhere: which used currencies still lack a rate.
  // It only backstops the review (points to the intro) — currency is declared up
  // front, so this is normally empty.
  const fxMissing = useMemo<string[]>(() => wizardFxMissing(state, knownRates), [state, knownRates]);

  // S34 — convert an amount typed in any currency to the base, with the user's OWN
  // rates (wizard-typed first, then server-loaded). Never fabricates: unknown rate →
  // undefined, and the caller shows the FX ask instead of lying. The goal simulator
  // needs this because goals can be typed in a foreign currency while the margin
  // (what's free per month) lives in base.
  const fxToBase = useMemo(() => {
    const rates: WizardFxRateLite[] = [...collectWizardFxRates(state), ...knownRates];
    const baseUpper = base.trim().toUpperCase();
    return (amount: number, currency: string): number | undefined => {
      const c = (currency ?? "").trim().toUpperCase();
      if (!c || c === baseUpper) return amount;
      for (const r of rates) {
        const from = (r.from ?? "").trim().toUpperCase();
        const to = (r.to ?? "").trim().toUpperCase();
        if (!(r.rate > 0)) continue;
        if (from === c && to === baseUpper) return Math.round(amount * r.rate * 100) / 100;
        if (from === baseUpper && to === c) return Math.round((amount / r.rate) * 100) / 100;
      }
      return undefined;
    };
  }, [state, knownRates, base]);

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
  // S35 — declare a foreign currency UP FRONT (intro step): add an empty rate
  // entry the user then fills, so every later amount converts from the first one
  // typed. Idempotent (won't duplicate a currency already declared).
  function addFxCurrency(target: string) {
    const key = (target ?? "").trim().toUpperCase();
    if (!key || key === base.trim().toUpperCase()) return;
    setState((s) => {
      const entries = [...(s.fxEntries ?? [])];
      if (entries.some((e) => (e.target ?? "").trim().toUpperCase() === key)) return s;
      entries.push({ target: key, value: "" });
      return syncFxMirror({ ...s, fxEntries: entries });
    });
  }
  function removeFxCurrency(target: string) {
    const key = (target ?? "").trim().toUpperCase();
    setState((s) => {
      const entries = (s.fxEntries ?? []).filter((e) => (e.target ?? "").trim().toUpperCase() !== key);
      return syncFxMirror({ ...s, fxEntries: entries });
    });
  }
  /** The declared foreign currencies (non-empty target, not the base). */
  const declaredFxCurrencies = (state.fxEntries ?? [])
    .map((e) => (e.target ?? "").trim().toUpperCase())
    .filter((t) => t && t !== base.trim().toUpperCase());
  // S35 — currency is declared ONLY at the intro (base + each foreign currency with
  // its rate). Every entity's "Moneda" dropdown offers just those, so you can never
  // enter an amount in a currency without a rate — which means NO other page has to
  // ask or confirm a rate. Need another currency? Add it at step 1.
  const allowedCurrencySet = new Set<string>([base.trim().toUpperCase(), ...declaredFxCurrencies]);
  const currencyOptions = CURRENCIES.filter((c) => allowedCurrencySet.has(c.value.toUpperCase()));
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
      parsed.accounts.length && `${parsed.accounts.length} ${parsed.accounts.length === 1 ? "cuenta" : "cuentas"}`,
      parsed.incomes.length && `${parsed.incomes.length} ${parsed.incomes.length === 1 ? "ingreso" : "ingresos"}`,
      parsed.expenses.length && `${parsed.expenses.length} ${parsed.expenses.length === 1 ? "gasto" : "gastos"}`,
      parsed.debts.length && `${parsed.debts.length} ${parsed.debts.length === 1 ? "deuda" : "deudas"}`,
      parsed.goals.length && `${parsed.goals.length} ${parsed.goals.length === 1 ? "meta" : "metas"}`,
    ].filter(Boolean);
    setImportMsg(counts.length ? `Importé ${counts.join(", ")}. Revísalo abajo antes de confirmar.` : "No encontré filas para importar.");
    setImportErrors(parsed.errors.map((e) => `Fila ${e.row}: ${e.message}`));
    go("review");
  }

  function confirmSave() {
    setSaveError(false);
    startSave(async () => {
      try {
        const payload = buildOnboardingDraft(state, knownRates);
        // S34 — the seed month is the month the USER saw ("¿ya gastaste algo ESTE
        // mes?"): stamp it client-side so a UTC server at the month edge can't
        // anchor the seed one month off.
        payload.clientSeedMonth = seedMonthISO(new Date());
        await saveOnboardingDraftAction(payload);
      } catch {
        // S34 — a rejected action (offline / 5xx) used to blow up the transition
        // silently; now the review shows the friendly retry box.
        setSaveError(true);
      }
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
            declaredFxCurrencies={declaredFxCurrencies}
            fxEntryValue={fxEntryValue}
            onFxEntry={setFxEntry}
            onAddFxCurrency={addFxCurrency}
            onRemoveFxCurrency={removeFxCurrency}
            onStart={goNext}
            onImport={handleImport}
            importing={importing}
            importErrors={importErrors}
          />
        )}

        {stepKey === "accounts" && (
          <StepShell
            title="¿Dónde tienes tu plata?"
            subtitle="Tus cuentas y efectivo. Este es el punto de partida de todo."
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
                  <SelectField label="Moneda" value={a.currency} options={currencyOptions} onChange={(v) => updateItem("accounts", a.id, { currency: v })} />
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
            subtitle="Lo que entra cada mes es la base de tu plan. Si varía, lo pones como un rango."
            footer={<Footer onBack={goBack} onNext={goNext} />}
          >
            {state.incomes.map((i) => {
              // S34 — "día del mes" solo tiene sentido mensual; un ingreso anual no
              // vive en un día-del-mes (el motor tampoco lo usa así).
              const showDay = i.frequency === "monthly";
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
                  <SelectField label="Moneda" value={i.currency} options={currencyOptions} onChange={(v) => updateItem("incomes", i.id, { currency: v })} />
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
              subtitle="Alquiler o renta, servicios, suscripciones, seguros, impuestos. Lo que llega casi con el mismo monto. No cada compra suelta."
            />
            {state.expenses.map((e) => (
              <ItemCard key={e.id} title="Gasto fijo" onRemove={() => patch({ expenses: state.expenses.filter((x) => x.id !== e.id) })}>
                <TextField label="Nombre" value={e.name} placeholder="Alquiler, internet…" onChange={(v) => updateItem("expenses", e.id, { name: v })} />
                <div className="grid grid-cols-2 gap-3">
                  <MoneyField label="Monto" value={e.amount} currency={e.currency} onChange={(v) => updateItem("expenses", e.id, { amount: v })} requiredHint />
                  <SelectField label="Moneda" value={e.currency} options={currencyOptions} onChange={(v) => updateItem("expenses", e.id, { currency: v })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Categoría" value={e.category} options={EXPENSE_CATEGORIES} onChange={(v) => updateItem("expenses", e.id, { category: v })} />
                  <SelectField label="Cada cuánto" value={e.frequency} options={FREQUENCIES} onChange={(v) => updateItem("expenses", e.id, { frequency: v })} />
                </div>
                {/* S32 (Item C) — a weekly/biweekly expense doesn't live on a "día del
                    mes": ask for a real payment date that anchors the 7/14-day cadence
                    (mirrors the income pay-anchor field). Monthly/yearly unchanged. */}
                {e.frequency === "weekly" || e.frequency === "biweekly" ? (
                  <>
                    <DateField label="¿Cuándo cae el próximo pago? (si ya pasó uno, esa fecha también sirve)" value={e.payAnchorDate ?? ""} onChange={(v) => updateItem("expenses", e.id, { payAnchorDate: v })} />
                    {!(e.payAnchorDate ?? "").trim() && (
                      <p className="-mt-1 text-xs text-amber-300/80">Sin esta fecha no sé en qué días cae y lo ubico desde hoy.</p>
                    )}
                  </>
                ) : e.frequency === "monthly" ? (
                  <TextField label="Día del mes (opcional)" value={e.expectedDay} inputMode="numeric" placeholder="1-31" onChange={(v) => updateItem("expenses", e.id, { expectedDay: v })} />
                ) : null}
                {payableSources.length > 1 && (
                  <SelectField label="Se paga desde (opcional)" value={e.paymentSourceId} options={payableSources} onChange={(v) => updateItem("expenses", e.id, { paymentSourceId: v })} />
                )}
                <Toggle label="Es esencial (difícil de recortar)" checked={e.isEssential} onChange={(v) => updateItem("expenses", e.id, { isEssential: v })} />
                {/* #2 — "Varía mes a mes" per-row toggle. */}
                <Toggle label="Varía mes a mes (luz, gas)" checked={Boolean(e.isVariable)} onChange={(v) => updateItem("expenses", e.id, { isVariable: v })} />
                {e.isVariable && (
                  <p className="-mt-1 text-xs text-zinc-500">Kipu lo trata como un monto que varía — no lo asume fijo.</p>
                )}
                <NoteField value={e.note ?? ""} onChange={(v) => updateItem("expenses", e.id, { note: v })} placeholder="Ej. el alquiler sube cada 3 meses, próximo aumento agosto" />
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
                subtitle="Esto es lo que hace tu Margen real desde el día 1, no un estimado a ciegas. Más o menos, ¿cuánto se te va al mes en cada cosa, sin contar lo que ya pusiste arriba como gastos fijos? Kipu te muestra cómo se compara con tu gasto real — un número aproximado hoy ya vale oro. Y si ya gastaste parte este mes, dímelo y no te lo descuento dos veces."
              />
              {currencyOptions.length > 1 && (
                <label className="mt-3 flex flex-col gap-1.5">
                  <Label>Moneda de estos estimados</Label>
                  <select
                    className={inputClass}
                    value={state.categoryBudgetCurrency || base}
                    onChange={(e) => setState((s) => ({ ...s, categoryBudgetCurrency: e.target.value === base ? "" : e.target.value }))}
                  >
                    {currencyOptions.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  {state.categoryBudgetCurrency && state.categoryBudgetCurrency !== base && (
                    <span className="text-xs text-zinc-500">Kipu los convierte a {base} con la tasa que diste al inicio.</span>
                  )}
                </label>
              )}
              <div className="mt-3 flex flex-col gap-3">
                {state.categoryBudgets.map((cb) => {
                  const cur = (state.categoryBudgetCurrency || base) as CurrencyCode;
                  const amount = parseMoney(cb.amount);
                  const seedRaw = (cb.mtdSeed ?? "").trim();
                  const seed = parseMoney(cb.mtdSeed);
                  const seedInvalid = seedRaw.length > 0 && seed === undefined;
                  return (
                    <div key={cb.category} className="flex flex-col gap-1.5">
                      <MoneyField
                        label={categoryLabel(cb.category)}
                        value={cb.amount}
                        currency={cur}
                        onChange={(v) => updateCategoryBudget(cb.category, { amount: v })}
                      />
                      {/* S32 — per-category month-to-date seed: only shown once the
                          estimate has an amount (a seed without estimate has nothing
                          to track against — it's ignored, and we say so below). */}
                      {amount !== undefined ? (
                        <label className="ml-2 flex flex-col gap-1 border-l-2 border-emerald-400/15 pl-3">
                          <span className="text-[11px] font-medium text-zinc-500">
                            ¿Ya gastaste algo de esto este mes? (opcional)
                          </span>
                          <input
                            className={`${inputClass} py-2 text-sm ${seedInvalid ? "border-rose-500/50" : ""}`}
                            value={cb.mtdSeed ?? ""}
                            inputMode="decimal"
                            onChange={(e) => updateCategoryBudget(cb.category, { mtdSeed: e.target.value })}
                            placeholder="0"
                          />
                          {seedInvalid ? (
                            <span className="text-xs text-rose-300">Escribe solo un número (ej. 150 o 1.500,50).</span>
                          ) : seed !== undefined && seed > 0 ? (
                            seed > amount ? (
                              /* Soft note only — being over budget never blocks. */
                              <span className="text-xs text-amber-300/90">
                                Ya pasaste tu estimado — ajústalo si quieres. Kipu lo tiene presente, sin drama.
                              </span>
                            ) : (
                              <span className="text-xs text-emerald-300/80">
                                ≈ {formatKipuMoney(seed, cur)} ya gastados · te quedan {formatKipuMoney(amount - seed, cur)} este mes
                              </span>
                            )
                          ) : null}
                        </label>
                      ) : seed !== undefined && seed > 0 ? (
                        <p className="ml-2 text-xs text-amber-300/80">
                          Anotaste {formatKipuMoney(seed, cur)} en {categoryLabel(cb.category).toLowerCase()}, pero me falta el estimado del mes para descontarlo — ponle un monto y listo.
                        </p>
                      ) : null}
                    </div>
                  );
                })}
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
                  <SelectField label="Moneda" value={d.currency} options={currencyOptions} onChange={(v) => updateItem("debts", d.id, { currency: v })} />
                </div>
                <MoneyField label="Total que debes hoy (saldo)" value={d.balance} currency={d.currency} onChange={(v) => updateItem("debts", d.id, { balance: v })} />
                {/* S31 (3.8) — "saldo" on a card is the ACCUMULATED debt, not the statement. */}
                {isCard && (
                  <p className="-mt-1 text-xs text-zinc-500">Todo lo que debes acumulado, no solo el estado de cuenta de este mes.</p>
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
                    <p className="-mt-1 text-xs text-zinc-500">Con el corte y el día de pago, Kipu aparta la plata del pago justo cuando toca — ni antes ni después.</p>
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
                  <SelectField label="Moneda" value={a.currency} options={currencyOptions} onChange={(v) => updateItem("assets", a.id, { currency: v })} />
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

        {/* S34 — the goals step merged INTO the goal-plan step (one page at the end):
            choosing a goal, its amount, and its date⇄contribution plan happen together,
            after the user already knows what's actually free. */}

        {stepKey === "capacity" && (
          <CapacityStep
            capacity={capacity}
            base={base}
            onBack={goBack}
            onNext={goNext}
            onGoToIncome={() => go("income")}
          />
        )}

        {stepKey === "reserves" && (
          <ReservesStep
            state={state}
            reservesView={reservesView}
            base={base}
            onBack={goBack}
            onNext={goNext}
            onReserves={(r) => patch({ reserves: { ...state.reserves, ...r } })}
          />
        )}

        {stepKey === "goalplan" && (
          <GoalPlanStep
            state={state}
            reservesView={reservesView}
            base={base}
            readiness={readiness}
            currencyOptions={currencyOptions}
            toBase={fxToBase}
            onBack={goBack}
            onNext={goNext}
            onAddGoal={(archetype) => patch({ goals: [...state.goals, newGoal(base, archetype)] })}
            onRemoveGoal={(id) => patch({ goals: state.goals.filter((x) => x.id !== id) })}
            onGoalPlan={(id, patchGoal) => updateItem("goals", id, patchGoal)}
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
            {/* S35 — FX lives ONLY at the intro; the style step is just tone + note. */}
            <label className="flex flex-col gap-1.5">
              <Label>¿Algo más que Kipu deba saber? (opcional)</Label>
              <textarea
                className={`${inputClass} min-h-[88px] resize-none`}
                value={state.note}
                maxLength={500}
                onChange={(e) => patch({ note: e.target.value })}
                placeholder="Inversiones y a qué tasa, seguros o pólizas, gastos que comparto con alguien, el alquiler sube cada 3 meses…"
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
            onGoToIntro={() => go("intro")}
            onBack={goBack}
            onConfirm={confirmSave}
            onEdit={(k) => go(k)}
          />
        )}
      </div>
    </main>
  );

  function updateCategoryBudget(
    category: WizardCategoryBudget["category"],
    patchBudget: Partial<Pick<WizardCategoryBudget, "amount" | "mtdSeed">>,
  ) {
    setState((s) => ({
      ...s,
      categoryBudgets: s.categoryBudgets.map((cb) => (cb.category === category ? { ...cb, ...patchBudget } : cb)),
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
  return { id: genId(), name: "", amount: "", currency, category: "housing", frequency: "monthly", expectedDay: "", isEssential: true, paymentSourceId: "", payAnchorDate: "", isVariable: false, note: "" };
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
// S35 — currency + rate live ONLY at the intro (base + declared currencies), so by
// the time we get here every amount is already convertible. This step no longer
// asks for or confirms a rate — it just shows the number and focuses on capacity.
function CapacityStep(props: {
  capacity: ReturnType<typeof buildDraftCapacity>;
  base: CurrencyCode;
  onBack: () => void;
  onNext: () => void;
  onGoToIncome?: () => void;
}) {
  const c = props.capacity;
  // S36 — "Tu mes" as a Sankey: income branches into its outflows and what's LEFT
  // to distribute. This is the PLANNING number (monthly, structural) — its copy
  // says apartar/repartir, never "gastar" (that's the Margen, the daily hero).
  const sankeyFlows: SankeyFlow[] = c
    ? [
        { key: "fixed", label: "Gastos fijos", amount: c.monthlyFixed, tone: "fixed" },
        { key: "debt", label: "Deudas", amount: c.monthlyDebtService, tone: "debt" },
        { key: "essential", label: "Lo que gastas", amount: c.monthlyEssentials, tone: "essential" },
        { key: "free", label: "Libre para repartir", amount: Math.max(0, c.monthlyDisposableBeforeAllocations), tone: "free" },
      ]
    : [];
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-50">Tu mes</h1>
        <p className="mt-1.5 text-sm leading-6 text-zinc-400">Así se reparte un mes típico tuyo. De aquí sale lo que puedes apartar a ahorro, inversión y metas — en el siguiente paso lo repartes.</p>
      </div>

      {c ? (
        <>
          <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-b from-emerald-500/10 to-transparent p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/80">De tu mes te queda para repartir</p>
            <p className="mt-1 text-3xl font-black text-zinc-50">{formatKipuMoney(c.monthlyDisposableBeforeAllocations, props.base)}</p>
            <p className="mt-1 text-xs text-zinc-400">al mes · antes de ahorro, inversión y metas</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Cómo se reparte</p>
            <MonthSankey income={c.monthlyIncome} flows={sankeyFlows} base={props.base} className="mt-3" />
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5 text-center">
          <p className="text-sm text-zinc-400">Para ver tu número me falta al menos un ingreso. Vuelve a Ingresos y agrégalo.</p>
          {props.onGoToIncome && (
            <button type="button" onClick={props.onGoToIncome} className="mt-3 rounded-xl border border-emerald-400/40 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/10">
              Ir a Ingresos
            </button>
          )}
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

// #7 — ALLOCATION. Post-capacity: the user decides how much to apart to savings,
// investment, and each goal, with a LIVE "te quedan X/mes (~/día) libres" and a
// gentle recommendation. Over-allocating is warned, never blocked.
// S33 — RESERVES: savings + investment ONLY, decided AFTER seeing the margin and
// BEFORE goals. Its trulyFree (disposable − savings − investment) is the pool the
// goal simulator distributes next.
function ReservesStep(props: {
  state: WizardState;
  reservesView: ReturnType<typeof computeAllocationView> | null;
  base: CurrencyCode;
  onBack: () => void;
  onNext: () => void;
  onReserves: (r: Partial<{ monthlySavings: string; monthlyInvestment: string }>) => void;
}) {
  const { reservesView: a, base } = props;
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-50">¿Cuánto guardas fijo cada mes?</h1>
        <p className="mt-1.5 text-sm leading-6 text-zinc-400">Ahorro e inversión primero: Kipu los protege antes de nada. Lo que quede es lo que reparten tus metas y tu día a día — lo armamos en el siguiente paso.</p>
      </div>

      {a && (
        <div className={`sticky top-2 z-10 rounded-2xl border p-4 text-center shadow-lg backdrop-blur ${a.overAllocated ? "border-rose-500/40 bg-rose-950/60" : "border-emerald-400/25 bg-emerald-950/50"}`}>
          <p className={`text-xs font-semibold uppercase tracking-widest ${a.overAllocated ? "text-rose-300/90" : "text-emerald-300/90"}`}>
            Después de ahorro e inversión te quedan
          </p>
          <p className={`mt-1 text-2xl font-black ${a.overAllocated ? "text-rose-200" : "text-zinc-50"}`}>
            {formatKipuMoney(a.trulyFree, base)}<span className="text-sm font-semibold text-zinc-400"> /mes</span>
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            para tus metas y el día a día · de {formatKipuMoney(a.monthlyDisposable, base)} libres
          </p>
          {a.overAllocated && (
            <p className="mt-2 text-xs leading-5 text-rose-200/90">
              Estás guardando más de lo que te queda ({formatKipuMoney(a.totalAllocated, base)}). No pasa nada por soñar, pero para que cuadre baja un poco.
            </p>
          )}
          {!a.overAllocated && <AllocationRecommendation a={a} base={base} />}
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Ahorro e inversión</p>
        <p className="mt-1 text-xs text-zinc-500">Lo que apartas fijo cada mes. Kipu lo protege antes de decirte cuánto puedes gastar.</p>
        {/* S31 (3.4) — prevent the savings/goal double-reserve. */}
        <p className="mt-1 text-xs text-zinc-500">Esto es aparte de tus metas — el aporte a cada meta lo decides en el siguiente paso.</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <MoneyField label="Ahorro al mes" value={props.state.reserves.monthlySavings} currency={base} onChange={(v) => props.onReserves({ monthlySavings: v })} />
          <MoneyField label="Inversión al mes" value={props.state.reserves.monthlyInvestment} currency={base} onChange={(v) => props.onReserves({ monthlyInvestment: v })} />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button type="button" onClick={props.onBack} className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-zinc-300 transition hover:border-white/25">
          Atrás
        </button>
        <button type="button" onClick={props.onNext} className="flex-1 rounded-2xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300">
          Armar el plan de mis metas
        </button>
      </div>
    </section>
  );
}

// Gentle, non-pushy savings suggestion. When nothing is saved yet and there's room,
// suggest a simple ~20%; otherwise affirm what's left is healthy.
function AllocationRecommendation({ a, base }: { a: NonNullable<ReturnType<typeof computeAllocationView>>; base: CurrencyCode }) {
  if (a.monthlyDisposable <= 0) return null;
  if (a.totalAllocated === 0) {
    const suggestion = Math.round((a.monthlyDisposable * 0.2) / 5) * 5; // ~20%, rounded to 5
    if (suggestion <= 0) return null;
    return (
      <p className="mt-2 text-xs leading-5 text-emerald-100/80">
        Una idea: guardar ~{formatKipuMoney(suggestion, base)} al mes (un 20%) ya te construye colchón sin apretarte. Tú decides.
      </p>
    );
  }
  return (
    <p className="mt-2 text-xs leading-5 text-emerald-100/70">
      Buen balance — guardas {formatKipuMoney(a.totalAllocated, base)} y te queda un margen sano para tus metas y el día a día.
    </p>
  );
}

// ── S33 — GOAL PLAN: the date ⇄ contribution simulator, final money step ───────
// The pool for goals = reserves trulyFree (disposable − savings − investment).
// Each money goal gets a bidirectional simulator; feasibility is checked against
// what's free for THAT goal (pool − the OTHER goals' committed contributions).
// S34 — GOALS, one page at the end: pick the goal, put the amount, and play the
// date ⇄ contribution plan right here — after the user already saw what's free.
// (The old separate "goals" step confused: goals at 7, capacity at 8, reserves at
// 9, then goals AGAIN at 10. Now it's a single final money step.)
function GoalPlanStep(props: {
  state: WizardState;
  reservesView: ReturnType<typeof computeAllocationView> | null;
  base: CurrencyCode;
  readiness: WizardReadiness;
  currencyOptions: Option<CurrencyCode>[];
  toBase: (amount: number, currency: string) => number | undefined;
  onBack: () => void;
  onNext: () => void;
  onAddGoal: (archetype: OnboardingGoalArchetype) => void;
  onRemoveGoal: (id: string) => void;
  onGoalPlan: (id: string, patch: Partial<WizardGoal>) => void;
}) {
  const { reservesView: rv, base } = props;
  // One "now" for the whole step so every card's date math is coherent.
  const now = useMemo(() => new Date(), []);
  const poolForGoals = rv ? rv.trulyFree : 0;

  const moneyGoals = props.state.goals.filter((g) => g.archetype !== "organize_month");
  const organizeGoals = props.state.goals.filter((g) => g.archetype === "organize_month");

  // S35 — no FX here: a goal can only be in a currency declared (with its rate) at
  // the intro, so props.toBase always resolves. This step focuses on the plan.

  // The header and per-goal availability count the plan each card DISPLAYS — the
  // stored contribution, or the same default the card is proposing (and Continuar
  // will materialize). Without this, the header says "apartas 0$" while a card
  // already shows a monthly, which reads broken.
  const displayMonthly = (g: WizardGoal): number => {
    if (g.archetype === "organize_month" || !goalReviewable(g)) return 0;
    const stored = parseMoney(g.monthlyContribution);
    if (stored !== undefined && stored > 0) return stored;
    const target = parseMoney(g.targetAmount) ?? 0;
    if (target <= 0) return 0;
    const targetBase = props.toBase(target, g.currency);
    if (targetBase === undefined) return 0;
    const currentBase = props.toBase(parseMoney(g.currentAmount) ?? 0, g.currency) ?? 0;
    const s = simulateByDate(
      { targetAmount: targetBase, currentAmount: currentBase, availableMonthly: poolForGoals, now },
      sanitizeIsoDate(g.targetDate) ?? addMonthsISO(now, 12),
    );
    return s.effectiveMonthly;
  };
  const committed = Math.round(props.state.goals.reduce((sum, g) => sum + displayMonthly(g), 0) * 100) / 100;
  const leftForDaily = Math.round((poolForGoals - committed) * 100) / 100;
  const overAllocated = committed > poolForGoals + 0.005;

  // An untouched-but-complete goal still leaves with a real plan: on Continuar,
  // any money goal missing its date or contribution gets the default 12-month
  // plan (or the date its typed contribution implies). Seeding at continue-time —
  // never while typing — so the defaults don't fight the user's input.
  const seedPlansAndContinue = () => {
    for (const g of props.state.goals) {
      if (g.archetype === "organize_month" || !goalReviewable(g)) continue;
      const target = parseMoney(g.targetAmount) ?? 0;
      if (target <= 0) continue;
      const targetBase = props.toBase(target, g.currency);
      if (targetBase === undefined) continue; // no rate yet — never invent one
      const currentBase = props.toBase(parseMoney(g.currentAmount) ?? 0, g.currency) ?? 0;
      const simInput = { targetAmount: targetBase, currentAmount: currentBase, availableMonthly: poolForGoals, now };
      const contribution = parseMoney(g.monthlyContribution);
      const hasContribution = contribution !== undefined && contribution > 0;
      const hasDate = sanitizeIsoDate(g.targetDate) !== undefined;
      if (hasContribution && hasDate) continue;
      if (hasContribution) {
        const s = simulateByContribution(simInput, contribution);
        if (s.reachDateISO) props.onGoalPlan(g.id, { targetDate: s.reachDateISO });
      } else {
        const dateISO = sanitizeIsoDate(g.targetDate) ?? addMonthsISO(now, 12);
        const s = simulateByDate(simInput, dateISO);
        props.onGoalPlan(g.id, { targetDate: dateISO, monthlyContribution: String(s.effectiveMonthly) });
      }
    }
    props.onNext();
  };

  const canFinish = props.readiness.reviewableGoals > 0;

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-50">¿Qué quieres lograr con tu plata?</h1>
        <p className="mt-1.5 text-sm leading-6 text-zinc-400">Elige una meta y arma el plan aquí mismo: mueves la fecha y Kipu te dice cuánto apartar al mes — o fijas cuánto puedes y te dice cuándo llegas.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {GOAL_ARCHETYPES.map((g) => {
          // Singleton archetypes shouldn't duplicate on a double-tap; "specific_purchase"
          // and "other" can repeat (multiple purchases / misc goals).
          const singleton = g.value !== "specific_purchase" && g.value !== "other";
          const already = singleton && props.state.goals.some((x) => x.archetype === g.value);
          const organize = g.value === "organize_month";
          return (
            <button
              key={g.value}
              type="button"
              disabled={already}
              title={g.hint}
              onClick={() => props.onAddGoal(g.value)}
              className={`rounded-full border px-3.5 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-30 ${organize ? "border-dashed border-white/20 text-zinc-400 hover:border-white/40 hover:text-zinc-200" : "border-white/15 text-zinc-200 hover:border-emerald-400/50 hover:text-emerald-100"}`}
            >
              {already ? "✓ " : "+ "}{g.label}
            </button>
          );
        })}
      </div>

      {props.state.goals.length === 0 && (
        <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
          <p className="text-xs leading-5 text-zinc-500">
            ¿Quieres juntar para algo — un colchón, un viaje, salir de una deuda? Tócalo arriba y armamos el plan. Y si por ahora solo quieres entender tu mes, <span className="text-zinc-300">«Solo ordenar mi mes»</span> es suficiente.
          </p>
        </div>
      )}

      {rv && moneyGoals.length > 0 && (
        <div className={`sticky top-2 z-10 rounded-2xl border p-4 text-center shadow-lg backdrop-blur ${overAllocated ? "border-rose-500/40 bg-rose-950/60" : "border-emerald-400/25 bg-emerald-950/50"}`}>
          <p className={`text-xs font-semibold uppercase tracking-widest ${overAllocated ? "text-rose-300/90" : "text-emerald-300/90"}`}>Te queda para el día a día</p>
          <p className={`mt-1 text-2xl font-black ${overAllocated ? "text-rose-200" : "text-zinc-50"}`}>
            {formatKipuMoney(leftForDaily, base)}<span className="text-sm font-semibold text-zinc-400"> /mes</span>
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            apartas {formatKipuMoney(committed, base)} a metas · de {formatKipuMoney(poolForGoals, base)} para repartir
          </p>
          {overAllocated && (
            <p className="mt-2 text-xs leading-5 text-rose-200/90">
              Tus metas juntas piden más de lo que te queda. Prueba alejar alguna fecha, bajar una meta, o guardar menos en el paso anterior.
            </p>
          )}
        </div>
      )}

      {moneyGoals.map((g) => {
        const otherContributions = Math.round((committed - displayMonthly(g)) * 100) / 100;
        const availableForGoal = Math.round((poolForGoals - otherContributions) * 100) / 100;
        return (
          <GoalSimCard
            key={g.id}
            goal={g}
            base={base}
            availableForGoal={availableForGoal}
            now={now}
            noIncomeYet={!props.state.incomes.some(incomeReviewable)}
            currencyOptions={props.currencyOptions}
            toBase={props.toBase}
            onRemove={() => props.onRemoveGoal(g.id)}
            onChange={(patch) => props.onGoalPlan(g.id, patch)}
          />
        );
      })}

      {organizeGoals.map((g) => (
        <div key={g.id} className="relative rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
          <button type="button" onClick={() => props.onRemoveGoal(g.id)} className="absolute right-3 top-3 text-xs text-zinc-500 transition hover:text-zinc-300">
            Quitar
          </button>
          <p className="text-sm font-semibold text-zinc-200">{g.name?.trim() || GOAL_DEFAULT_NAMES[g.archetype]}</p>
          <p className="mt-1 text-xs text-zinc-500">Listo — sin monto ni fecha. Kipu cuida tu margen y te ayuda a entender tu mes.</p>
        </div>
      ))}

      <div className="flex items-center gap-3 pt-2">
        <button type="button" onClick={props.onBack} className="rounded-2xl border border-white/10 px-5 py-3 text-sm font-semibold text-zinc-300 transition hover:border-white/25">
          Atrás
        </button>
        <div className="flex-1">
          <button
            type="button"
            disabled={!canFinish}
            onClick={seedPlansAndContinue}
            className="w-full rounded-2xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continuar
          </button>
          {!canFinish && (
            <p className="mt-1.5 text-center text-xs text-zinc-500">
              {props.state.goals.length > 0
                ? "Ponle el monto a tu meta para continuar — sin el número no puedo armar el plan."
                : "Elige al menos una — «Solo ordenar mi mes» también cuenta."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function formatMonthYearISO(iso: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  return m ? `${MONTHS_ES[Number(m[2]) - 1]} ${m[1]}` : "";
}
function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

// A single goal's bidirectional date ⇄ contribution simulator. Date slider drives
// the monthly (remaining/months); typing a monthly drives the date. Feasibility is
// vs `availableForGoal`; infeasible → red alert + a one-tap "ajustar a lo posible"
// (never a hard block — the aspirational date stays selectable, just honest-red).
function GoalSimCard(props: {
  goal: WizardGoal;
  base: CurrencyCode;
  availableForGoal: number;
  now: Date;
  noIncomeYet: boolean;
  currencyOptions: Option<CurrencyCode>[];
  toBase: (amount: number, currency: string) => number | undefined;
  onRemove: () => void;
  onChange: (patch: Partial<WizardGoal>) => void;
}) {
  const { goal: g, base, availableForGoal, now } = props;
  const name = g.name?.trim() || GOAL_DEFAULT_NAMES[g.archetype];
  const goalCur = g.currency;
  const archetypeLabel = GOAL_ARCHETYPES.find((o) => o.value === g.archetype)?.label ?? "Meta";
  const needsAmount = GOAL_ARCHETYPE_NEEDS_AMOUNT[g.archetype];

  // Amounts are typed in the GOAL's currency; the margin lives in base. Convert
  // with the user's own rate before simulating — never compare across currencies.
  const targetRaw = parseMoney(g.targetAmount) ?? 0;
  const currentRaw = parseMoney(g.currentAmount) ?? 0;
  const targetBase = props.toBase(targetRaw, goalCur);
  const currentBase = props.toBase(currentRaw, goalCur) ?? 0;

  // The WHAT — name, amount, currency, already-saved. Always visible: this card IS
  // the goal (S34 merged the old goals step into this one page).
  const whatFields = (
    <>
      <TextField label="Nombre de la meta" value={g.name} placeholder="Viaje, colchón…" onChange={(v) => props.onChange({ name: v })} />
      <div className="grid grid-cols-2 gap-3">
        <MoneyField label="¿Cuánto quieres juntar?" value={g.targetAmount} currency={goalCur} onChange={(v) => props.onChange({ targetAmount: v })} requiredHint={needsAmount} />
        <SelectField label="Moneda" value={goalCur} options={props.currencyOptions} onChange={(v) => props.onChange({ currency: v })} />
      </div>
      <MoneyField label="¿Cuánto llevas ya? (opcional)" value={g.currentAmount} currency={goalCur} onChange={(v) => props.onChange({ currentAmount: v })} />
    </>
  );
  const noteField = (
    <NoteField value={g.note ?? ""} onChange={(v) => props.onChange({ note: v })} placeholder="Ej. la boda es en marzo de 2028" />
  );
  const shell = (tone: string, children: React.ReactNode) => (
    <div className={`relative flex flex-col gap-3 rounded-2xl border ${tone} bg-zinc-900/50 p-4`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{archetypeLabel}</p>
        <button type="button" onClick={props.onRemove} className="text-xs text-zinc-500 transition hover:text-zinc-300">
          Quitar
        </button>
      </div>
      {children}
    </div>
  );

  // No amount yet → just the WHAT (the plan appears the moment there's a number).
  if (targetRaw <= 0) {
    return shell(
      "border-white/10",
      <>
        {whatFields}
        <p className="text-xs text-amber-300">Ponle un monto y aquí mismo armamos el plan: fecha y cuánto apartar al mes.</p>
        {noteField}
      </>,
    );
  }

  // S35 — this only happens if a currency was declared at the intro but its rate
  // left blank; the currency dropdown otherwise only offers declared-with-rate ones.
  // Point back to step 1 instead of asking here (currency lives only at the intro).
  if (targetBase === undefined) {
    return shell(
      "border-amber-500/30",
      <>
        {whatFields}
        <p className="text-xs text-amber-300">Te falta la tasa de {goalCur} — agrégala en el paso 1 (moneda) y aquí armo el plan.</p>
        {noteField}
      </>,
    );
  }

  const simBase = { targetAmount: targetBase, currentAmount: currentBase, availableMonthly: availableForGoal, now };

  // The CONTRIBUTION is the source of truth for display + feasibility (it's what
  // actually gets reserved); the date is derived from it. So the slider and "ajustar
  // a lo posible" set a contribution, and a max-affordable one-tap always lands
  // feasible — no date-rounding drift that could leave it a hair in the red.
  const storedContribution = parseMoney(g.monthlyContribution);
  const sim =
    storedContribution !== undefined && storedContribution > 0
      ? simulateByContribution(simBase, storedContribution)
      : simulateByDate(simBase, sanitizeIsoDate(g.targetDate) ?? addMonthsISO(now, 12));
  const effectiveDateISO = sim.reachDateISO || sanitizeIsoDate(g.targetDate) || addMonthsISO(now, 12);
  const sliderMonths = clampInt(Number.isFinite(sim.monthsToTarget) && sim.monthsToTarget > 0 ? sim.monthsToTarget : 12, 1, 120);

  const setByMonths = (months: number) => {
    const iso = addMonthsISO(now, months);
    const s = simulateByDate(simBase, iso);
    props.onChange({ targetDate: iso, monthlyContribution: String(s.effectiveMonthly) });
  };
  const setByContribution = (raw: string) => {
    const c = parseMoney(raw);
    if (c === undefined || c <= 0) {
      props.onChange({ monthlyContribution: raw });
      return;
    }
    const s = simulateByContribution(simBase, c);
    props.onChange({ monthlyContribution: raw, ...(s.reachDateISO ? { targetDate: s.reachDateISO } : {}) });
  };
  const adjustToPossible = () => {
    if (sim.maxAffordableMonthly <= 0 || !sim.earliestFeasibleDateISO) return;
    props.onChange({ targetDate: sim.earliestFeasibleDateISO, monthlyContribution: String(sim.maxAffordableMonthly) });
  };

  const tone =
    sim.status === "infeasible" || sim.status === "no_margin"
      ? { border: "border-rose-500/40", chip: "text-rose-300", big: "text-rose-300", bar: "bg-rose-400" }
      : sim.status === "tight"
        ? { border: "border-amber-500/30", chip: "text-amber-300", big: "text-amber-200", bar: "bg-amber-400" }
        : { border: "border-emerald-400/25", chip: "text-emerald-300", big: "text-emerald-200", bar: "bg-emerald-400" };
  const barPct = availableForGoal > 0 ? Math.min(100, Math.round((sim.effectiveMonthly / availableForGoal) * 100)) : 100;

  if (sim.status === "achieved") {
    return shell(
      "border-emerald-400/25",
      <>
        {whatFields}
        <p className="text-xs text-emerald-200/90">¡Ya la tienes! 🎉 Llevas {formatKipuMoney(currentRaw, goalCur)} de {formatKipuMoney(targetRaw, goalCur)}.</p>
        {noteField}
      </>,
    );
  }

  // Remaining shown in the currency the goal was typed in; the monthly plan in base
  // (that's the money that actually gets reserved from the margin).
  const remainingOriginal = Math.max(0, Math.round((targetRaw - currentRaw) * 100) / 100);

  return shell(
    tone.border,
    <>
      {whatFields}

      <div className="mt-1 border-t border-white/5 pt-3 text-center">
        <p className="text-xs text-zinc-500">faltan {formatKipuMoney(remainingOriginal, goalCur)} de {formatKipuMoney(targetRaw, goalCur)}{goalCur !== base ? ` · ≈ ${formatKipuMoney(sim.remaining, base)}` : ""}</p>
      </div>

      <div className="text-center">
        <p className={`text-xs font-semibold uppercase tracking-widest ${tone.chip}`}>Apartar al mes</p>
        <p className={`text-3xl font-black ${tone.big}`}>{formatKipuMoney(sim.effectiveMonthly, base)}</p>
        <p className="mt-0.5 text-xs text-zinc-400">
          {sim.reachDateISO ? <>llegas en {formatMonthYearISO(sim.reachDateISO)} · {clampInt(sim.monthsToTarget, 1, 9999)} meses</> : "elige una fecha o un aporte"}
        </p>
      </div>

      {/* Date slider — moving it recomputes the monthly. */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>¿Para cuándo?</span>
          <span className="tabular-nums text-zinc-300">{formatMonthYearISO(effectiveDateISO)}</span>
        </div>
        <input
          type="range"
          min={1}
          max={120}
          step={1}
          value={sliderMonths}
          onChange={(e) => setByMonths(Number(e.target.value))}
          className={`mt-2 w-full ${sim.feasible ? "accent-emerald-400" : "accent-rose-400"}`}
          aria-label={`Plazo para ${name}`}
        />
        <div className="flex justify-between text-[10px] uppercase tracking-wide text-zinc-600">
          <span>1 mes</span>
          <span>10 años</span>
        </div>
      </div>

      {/* Feasibility bar + the money-truth line. */}
      <div className="mt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div className={`h-full ${tone.bar} transition-all`} style={{ width: `${barPct}%` }} />
        </div>
        <p className="mt-1 text-xs text-zinc-400">
          {availableForGoal > 0
            ? <>de {formatKipuMoney(availableForGoal, base)} libres para esta meta</>
            : "ahora mismo no te queda margen para esta meta"}
        </p>
      </div>

      {/* Or fix the monthly and let the date move. */}
      <div className="mt-3">
        <MoneyField label="O fija cuánto puedes al mes" value={g.monthlyContribution ?? ""} currency={base} onChange={setByContribution} />
      </div>

      {/* Red alert + one-tap escape when the plan doesn't fit. Never blocks. */}
      {!sim.feasible && (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-950/40 p-3">
          {sim.earliestFeasibleDateISO ? (
            <p className="text-xs leading-5 text-rose-200/90">
              No alcanza: necesitas {formatKipuMoney(sim.effectiveMonthly, base)}/mes pero solo te quedan {formatKipuMoney(availableForGoal, base)}. Con lo que tienes, lo más pronto es <span className="font-semibold">{formatMonthYearISO(sim.earliestFeasibleDateISO)}</span>.
            </p>
          ) : (
            <p className="text-xs leading-5 text-rose-200/90">{props.noIncomeYet
              ? "Todavía no me diste ningún ingreso, así que tu margen es 0. Vuelve a «Ingresos» y con eso armamos el plan de verdad."
              : "No te queda margen para esta meta. Prueba guardar menos en ahorro o inversión (paso anterior), bajar la meta, o darle más tiempo a otra."}</p>
          )}
          {sim.earliestFeasibleDateISO && (
            <button type="button" onClick={adjustToPossible} className="mt-2 rounded-xl border border-rose-400/40 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-400/10">
              Ajustar a lo posible
            </button>
          )}
        </div>
      )}

      {noteField}
    </>,
  );
}

function IntroStep(props: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  declaredFxCurrencies: string[];
  fxEntryValue: (target: string) => string;
  onFxEntry: (target: string, next: { target?: string; value?: string }) => void;
  onAddFxCurrency: (target: string) => void;
  onRemoveFxCurrency: (target: string) => void;
  onStart: () => void;
  onImport: (file: File) => void;
  importing: boolean;
  importErrors: string[];
}) {
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const base = props.state.profile.baseCurrency;
  const baseUpper = base.trim().toUpperCase();
  // S35 — currencies still addable (not the base, not already declared).
  const addableCurrencies = CURRENCIES.filter(
    (c) => c.value.toUpperCase() !== baseUpper && !props.declaredFxCurrencies.includes(c.value.toUpperCase()),
  );
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
          label="Tu moneda principal (en la que Kipu te muestra tus totales)"
          value={props.state.profile.baseCurrency}
          options={CURRENCIES}
          onChange={(v) => {
            setCurrencyTouched(true);
            props.patch({ profile: { ...props.state.profile, baseCurrency: v } });
          }}
        />
        <p className="text-xs text-zinc-500">Es la moneda en la que Kipu suma y te muestra todo — elige la que más usas en tu día a día.</p>
      </div>

      {/* S35 — declare EVERY currency (and its rate) up front, before any amount.
          The founder's insight: asking the rate after all the expenses (at the
          capacity step) let the first "libre" number silently exclude everything in
          another currency. Set here → every amount converts from the first one. */}
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
        <div>
          <p className="text-sm font-semibold text-zinc-100">¿Usas más de una moneda?</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Si algo tuyo (una cuenta, tu sueldo, un gasto) está en otra moneda, agrégala aquí con su tipo de cambio. Kipu lo deja listo desde el principio y así tu número siempre está completo — nunca inventa una tasa.
          </p>
        </div>

        {props.declaredFxCurrencies.map((cur) => (
          <div key={cur} className="flex items-start gap-2">
            <div className="flex-1">
              <FxGuidedField
                base={base}
                target={cur}
                lockTarget
                value={props.fxEntryValue(cur)}
                missing={[]}
                onChange={(next) => props.onFxEntry(cur, next)}
              />
            </div>
            <button
              type="button"
              onClick={() => props.onRemoveFxCurrency(cur)}
              className="mt-8 shrink-0 rounded-xl border border-white/10 px-3 py-2.5 text-xs font-semibold text-zinc-400 transition hover:border-rose-400/40 hover:text-rose-200"
              aria-label={`Quitar ${cur}`}
            >
              Quitar
            </button>
          </div>
        ))}

        {addableCurrencies.length > 0 && (
          <SelectField
            label={props.declaredFxCurrencies.length > 0 ? "Agregar otra moneda" : "Agregar una moneda (opcional)"}
            value=""
            options={[
              { value: "", label: props.declaredFxCurrencies.length > 0 ? "+ Otra moneda…" : "+ Elige una moneda…" },
              ...addableCurrencies.map((c) => ({ value: c.value, label: c.label })),
            ]}
            onChange={(v) => v && props.onAddFxCurrency(v)}
          />
        )}
      </div>

      <button
        type="button"
        onClick={props.onStart}
        className="rounded-2xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300"
      >
        Empezar paso a paso
      </button>

      <div className="rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
        <p className="text-sm font-semibold text-zinc-200">¿Prefieres una plantilla?</p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          Descarga la plantilla, llénala en Excel o Google Sheets y súbela. Kipu la revisa contigo antes de guardar nada.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a href="/onboarding/template" className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-emerald-400/40 hover:text-emerald-200">
            Descargar plantilla (CSV)
          </a>
          <label className="cursor-pointer rounded-xl bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-700">
            {props.importing ? "Leyendo…" : "Subir plantilla llena"}
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
  onGoToIntro: () => void;
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

      {/* S35 — currency + rate live ONLY at the intro, so the review doesn't ask
          for a rate: if one is genuinely missing (declared but left blank), it just
          points back to step 1. This is the single backstop; it never embeds a rate
          input on this page. */}
      {fxBlocking && (
        <div className="flex flex-col gap-2 rounded-2xl border border-amber-500/40 bg-amber-950/30 p-4">
          <p className="text-sm leading-6 text-amber-100/90">
            Te falta el tipo de cambio de {fxMissing.join(", ")}. Vuelve al primer paso, agrégalo junto a tus monedas y todo tu número queda completo.
          </p>
          <button
            type="button"
            onClick={props.onGoToIntro}
            className="self-start rounded-xl border border-amber-400/40 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/10"
          >
            Ir al inicio (monedas)
          </button>
        </div>
      )}
      {props.importMsg && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100">{props.importMsg}</div>
      )}
      {props.importErrors.length > 0 && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          <p className="font-semibold">Revisa estas filas de tu plantilla:</p>
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
            Margen Kipu — {margen.confidence === "solid" ? "esto puedes gastar tranquilo" : "tu número (preliminar)"}
          </p>
          <p className="mt-1 text-3xl font-black text-zinc-50">{formatKipuMoney(margen.margenWeekly, base)}</p>
          <p className="mt-1 text-xs text-zinc-400">
            esta semana · ~{formatKipuMoney(margen.margenDaily, base)}/día
          </p>
          <p className="mt-2 text-xs leading-5 text-emerald-100/70">
            {margen.confidence === "solid"
              ? "Este es tu número del día a día — el que Kipu te da cuando quieras gastar. Se afina con tu uso."
              : margen.essentialsKnown
                ? "Este es tu número del día a día (preliminar); se afina con tus primeros días de uso."
                : "Este es tu número del día a día (preliminar): aún no sé cuánto gastas al día. Cuéntame tu gasto diario típico o registra tus primeros días y se vuelve real."}
          </p>
          {/* S36 — connect the two numbers: "Tu mes" (planning) → Margen (daily). */}
          {capacity && (
            <p className="mt-3 border-t border-white/10 pt-3 text-xs leading-5 text-zinc-400">
              Tu mes rinde ~{formatKipuMoney(capacity.monthlyDisposableBeforeAllocations, base)}
              {protectedTotal > 0 && <> · apartaste {formatKipuMoney(protectedTotal, base)} a ahorro y metas</>}. De ahí sale, según tu saldo y tus fechas, tu Margen para gastar.
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
          if (statement !== undefined) return `${name} · ${formatKipuMoney(statement, d.currency)} (lo pagas este mes)`;
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
      {(() => {
        // S34 — the review said "esto es lo que Kipu va a recordar" but omitted two
        // whole steps: the monthly estimates and the savings/investment reserves.
        const budgetLines = state.categoryBudgets
          .map((cb) => ({ cb, amount: parseMoney(cb.amount) }))
          .filter((x): x is { cb: WizardCategoryBudget; amount: number } => x.amount !== undefined && x.amount > 0)
          .map(({ cb, amount }) => {
            const label = EXPENSE_CATEGORIES.find((o) => o.value === cb.category)?.label ?? cb.category;
            const seed = parseMoney(cb.mtdSeed);
            const cur = (state.categoryBudgetCurrency || base) as CurrencyCode;
            return `${label} · ~${formatKipuMoney(amount, cur)}/mes${seed !== undefined && seed > 0 ? ` · ya llevas ${formatKipuMoney(seed, cur)}` : ""}`;
          });
        return (
          <ReviewBlock title="Gastos del mes (estimados)" count={budgetLines.length} onEdit={() => props.onEdit("expenses")}
            lines={budgetLines}
            emptyLabel="Sin estimados — Kipu los aprende de tus gastos reales." />
        );
      })()}
      {(() => {
        const sv = parseMoney(state.reserves.monthlySavings);
        const inv = parseMoney(state.reserves.monthlyInvestment);
        const lines: string[] = [];
        if (sv !== undefined && sv > 0) lines.push(`Ahorro · ${formatKipuMoney(sv, base)}/mes`);
        if (inv !== undefined && inv > 0) lines.push(`Inversión · ${formatKipuMoney(inv, base)}/mes`);
        return (
          <ReviewBlock title="Ahorro e inversión" count={lines.length} onEdit={() => props.onEdit("reserves")}
            lines={lines}
            emptyLabel="Sin monto fijo — puedes definirlo cuando quieras." />
        );
      })()}
      <ReviewBlock title="Metas" count={reviewGoals.length} onEdit={() => props.onEdit("goalplan")}
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
