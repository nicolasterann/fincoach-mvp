"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { saveOnboardingDraftAction } from "./save-actions";
import { importTemplateAction } from "./wizard-actions";
import {
  ACCOUNT_TYPES,
  COUNTRIES,
  CURRENCIES,
  DEBT_TYPES,
  EXPENSE_CATEGORIES,
  FREQUENCIES,
  GOAL_ARCHETYPES,
  GOAL_ARCHETYPE_NEEDS_AMOUNT,
  GOAL_DEFAULT_NAMES,
  defaultCurrencyForCountry,
  isEssentialByDefaultCategory,
  type Option,
} from "@/lib/onboarding/wizard-constants";
import {
  accountReviewable,
  buildOnboardingDraft,
  collectWizardFxRates,
  computeDraftNetWorth,
  composeFxRateString,
  computeAllocationView,
  debtReviewable,
  expenseReviewable,
  goalReviewable,
  incomeReviewable,
  leftoverTone,
  normalizeIanaTimezone,
  parseFxRateValue,
  parseMoney,
  sanitizeIsoDate,
  seedMonthISO,
  sumReservesByKind,
  wizardFxMissing,
  wizardReadiness,
  type DraftNetWorth,
  type WizardReadiness,
  type WizardAccount,
  type WizardAsset,
  type WizardCategoryBudget,
  type WizardDebt,
  type WizardExpense,
  type WizardFxRateLite,
  type WizardGoal,
  type WizardIncome,
  type WizardReserve,
  type WizardReserveKind,
  type WizardState,
} from "@/lib/onboarding/wizard-model";
import type { ParsedTemplate } from "@/lib/onboarding/csv-template";
import type { OnboardingGoalArchetype } from "@/lib/onboarding/draft-types";
import { WEEKS_PER_MONTH, buildDraftCapacity, buildDraftMargenPreview } from "@/lib/onboarding/draft-margen-preview";
import { formatKipuMoney } from "@/lib/financial/money";
import { addMonthsISO, simulateByContribution, simulateByDate } from "@/lib/financial/goal-simulator";
import { MonthSankey, type SankeyFlow } from "@/app/app/components/living/MonthSankey";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { CurrencyCode } from "@/types/financial";

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2);
}

function emptyState(baseCurrency: CurrencyCode): WizardState {
  return {
    profile: { fullName: "", country: "", baseCurrency },
    // O6 — everyone has cash; seed an "Efectivo" account so the first step is never
    // empty and the user just fills the amount (or renames/removes it).
    accounts: [{ id: genId(), name: "Efectivo", type: "cash", balance: "", currency: baseCurrency, liquidity: "liquid", isGoalAccount: false, isPrimary: true, returnRate: "", note: "" }],
    incomes: [],
    expenses: [],
    debts: [],
    noDebts: false,
    assets: [],
    goals: [],
    reserves: [newReserve(baseCurrency, "savings")],
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

// O2.1 — reserve kinds. A reserve card is either monthly savings or investment.
const RESERVE_KINDS: Option<WizardReserveKind>[] = [
  { value: "savings", label: "Ahorro" },
  { value: "investment", label: "Inversión" },
];

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
// O1 — "habituales": essential-but-variable spend WITHOUT a fixed date, one card
// per category (removable/addable, symmetric with the ① list). "Otro esencial" is
// the catch-all for a habitual essential that doesn't fit the first three.
const HABITUAL_CATEGORIES = ["food", "transport", "health", "other"] as const;
function seedCategoryBudgets(): WizardCategoryBudget[] {
  // Start with only Comida so nobody forgets it; the rest are added on demand.
  return [{ category: "food", amount: "", mtdSeed: "" }];
}
function categoryLabel(category: string): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}
function habitualCategoryLabel(category: string): string {
  return category === "other" ? "Otro esencial" : categoryLabel(category);
}
// Restore a saved draft's habitual list to the current rules: drop categories no
// longer offered (old entretenimiento/compras seeds), de-dup, drop empty non-food
// rows, and always keep Comida present.
function cleanHabitualBudgets(list: WizardCategoryBudget[] | undefined): WizardCategoryBudget[] {
  const allowed = new Set<string>(HABITUAL_CATEGORIES);
  const seen = new Set<string>();
  const out: WizardCategoryBudget[] = [];
  for (const cb of list ?? []) {
    if (!allowed.has(cb.category) || seen.has(cb.category)) continue;
    const filled = (cb.amount ?? "").trim() !== "" || (cb.mtdSeed ?? "").trim() !== "";
    if (cb.category !== "food" && !filled) continue;
    seen.add(cb.category);
    // Item 2 — carry the per-row currency through a draft restore.
    out.push({ category: cb.category, amount: cb.amount ?? "", currency: cb.currency, mtdSeed: cb.mtdSeed ?? "" });
  }
  if (!out.some((cb) => cb.category === "food")) out.unshift({ category: "food", amount: "", mtdSeed: "" });
  return out;
}

// O2.1 — reserves became CARDS. Migrate a pre-cards draft: the old
// { monthlySavings, monthlyInvestment } object turns into one card per non-empty
// kind; an already-array draft is normalized in place; an empty legacy draft
// falls back to a single blank Ahorro card (the step's default).
function migrateReserves(raw: unknown, base: CurrencyCode): WizardReserve[] {
  if (Array.isArray(raw)) {
    const out = raw
      .filter((r): r is Partial<WizardReserve> => !!r && typeof r === "object")
      .map((r) => ({
        id: (r.id as string) || genId(),
        kind: (r.kind === "investment" ? "investment" : "savings") as WizardReserveKind,
        amount: String(r.amount ?? ""),
        currency: (r.currency || base) as CurrencyCode,
        // Stage 38 — carry the scheduling fields; a pre-38 card defaults to monthly.
        frequency: (r.frequency ?? "monthly") as WizardReserve["frequency"],
        expectedDay: String(r.expectedDay ?? ""),
        payAnchorDate: String(r.payAnchorDate ?? ""),
        destinationId: String(r.destinationId ?? ""),
      }));
    return out.length > 0 ? out : [newReserve(base, "savings")];
  }
  const out: WizardReserve[] = [];
  if (raw && typeof raw === "object") {
    const o = raw as { monthlySavings?: string; monthlyInvestment?: string };
    if ((o.monthlySavings ?? "").trim() !== "") out.push({ id: genId(), kind: "savings", amount: String(o.monthlySavings), currency: base });
    if ((o.monthlyInvestment ?? "").trim() !== "") out.push({ id: genId(), kind: "investment", amount: String(o.monthlyInvestment), currency: base });
  }
  return out.length > 0 ? out : [newReserve(base, "savings")];
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
      // O1 — bring a saved draft's habitual categories up to the current rules
      // (drops legacy entretenimiento/compras seeds, de-dups, keeps Comida).
      merged.categoryBudgets = cleanHabitualBudgets(merged.categoryBudgets);
      // O2.1 — normalize reserves (old object shape → cards).
      merged.reserves = migrateReserves(merged.reserves, baseCurrency);
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
// O11 (1+4) — two explicit chapters. Ch.1 "Tu mes" (the cashflow / estado de
// resultados) runs Cuentas→…→Metas so the Sankey builds continuous; then Ch.2
// "Tu patrimonio" (the balance general) is Activos, at the end, with its own net-worth
// view instead of the Sankey. The old "Estilo" step is gone — tone/notes default and
// live in Ajustes; per-row notes already cover the general note.
const STEPS = [
  { key: "intro", label: "Inicio" },
  { key: "accounts", label: "Cuentas", required: true },
  { key: "income", label: "Ingresos" },
  { key: "expenses", label: "Gastos" },
  { key: "debts", label: "Deudas" },
  { key: "reserves", label: "Ahorro" },
  { key: "goalplan", label: "Metas", required: true },
  { key: "assets", label: "Patrimonio" },
  { key: "review", label: "Revisar" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

// O11 — which chapter a step belongs to (shown in the header so the user reads the
// two-statement structure the way we do: first their month, then their patrimonio).
function stepChapter(key: StepKey): string | null {
  if (key === "assets") return "Tu patrimonio";
  if (key === "review") return "Resumen";
  if (key === "intro") return null;
  return "Tu mes";
}

// Polish (item 3) — resume where you left off. The current step persists next to the
// draft; it's validated against the current STEPS so a removed/renamed step (e.g. the
// retired "style"/"capacity") safely falls back to the intro instead of a blank screen.
function loadInitialStep(storageKey: string): StepKey {
  if (typeof window === "undefined") return "intro";
  try {
    const raw = window.localStorage.getItem(`${storageKey}-step`);
    if (raw && STEPS.some((s) => s.key === raw)) return raw as StepKey;
  } catch {
    // ignore corrupt local state
  }
  return "intro";
}

function moneyPreview(raw: string, currency: CurrencyCode): string | null {
  const n = parseMoney(raw);
  return n === undefined ? null : formatKipuMoney(n, currency);
}

// ── Small field primitives ────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-zinc-400">{children}</span>;
}

const inputClass =
  "w-full rounded-xl border border-line/10 bg-zinc-950 px-3 py-2.5 text-base text-zinc-50 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-4 focus:ring-emerald-500/10";

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
        props.checked ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100" : "border-line/10 bg-zinc-950 text-zinc-400"
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

// O12.1 — playful color identity per section. Each money concept gets its own
// hue so the onboarding reads alive (not a monochrome form): a tinted card
// surface + colored border + colored label + a small accent bar. All classes are
// themeable tokens, so the SAME hue works in dark (deep tint) and light (pale
// tint) with readable text either way. Keep it subtle — one hue per step.
type SectionTone = "zinc" | "emerald" | "teal" | "sky" | "amber" | "rose" | "violet";

const TONE: Record<
  SectionTone,
  { card: string; label: string; accent: string; badge: string; title: string; sub: string; underline: string; add: string }
> = {
  zinc: {
    card: "border-[1.5px] border-line/15 bg-[var(--tint-zinc)]",
    label: "text-zinc-400", accent: "bg-zinc-500", badge: "bg-line/10 text-zinc-300",
    title: "text-zinc-100", sub: "text-zinc-500", underline: "bg-zinc-500",
    add: "hover:border-zinc-400/50 hover:text-zinc-200",
  },
  emerald: {
    card: "border-[1.5px] border-emerald-400/45 bg-[var(--tint-emerald)]",
    label: "text-emerald-300", accent: "bg-emerald-400", badge: "bg-emerald-400/15 text-emerald-300",
    title: "text-emerald-100", sub: "text-emerald-100/70", underline: "bg-emerald-400",
    add: "hover:border-emerald-400/50 hover:text-emerald-200",
  },
  teal: {
    card: "border-[1.5px] border-teal-400/45 bg-[var(--tint-teal)]",
    label: "text-teal-300", accent: "bg-teal-400", badge: "bg-teal-400/15 text-teal-300",
    title: "text-teal-100", sub: "text-teal-100/70", underline: "bg-teal-400",
    add: "hover:border-teal-400/50 hover:text-teal-200",
  },
  sky: {
    card: "border-[1.5px] border-sky-400/45 bg-[var(--tint-sky)]",
    label: "text-sky-300", accent: "bg-sky-400", badge: "bg-sky-400/15 text-sky-300",
    title: "text-sky-100", sub: "text-sky-100/70", underline: "bg-sky-400",
    add: "hover:border-sky-400/50 hover:text-sky-200",
  },
  amber: {
    card: "border-[1.5px] border-amber-400/45 bg-[var(--tint-amber)]",
    label: "text-amber-300", accent: "bg-amber-400", badge: "bg-amber-400/15 text-amber-300",
    title: "text-amber-100", sub: "text-amber-100/70", underline: "bg-amber-400",
    add: "hover:border-amber-400/50 hover:text-amber-200",
  },
  rose: {
    card: "border-[1.5px] border-rose-400/45 bg-[var(--tint-rose)]",
    label: "text-rose-300", accent: "bg-rose-400", badge: "bg-rose-400/15 text-rose-300",
    title: "text-rose-100", sub: "text-rose-100/70", underline: "bg-rose-400",
    add: "hover:border-rose-400/50 hover:text-rose-200",
  },
  violet: {
    card: "border-[1.5px] border-violet-400/45 bg-[var(--tint-violet)]",
    label: "text-violet-300", accent: "bg-violet-400", badge: "bg-violet-400/15 text-violet-300",
    title: "text-violet-100", sub: "text-violet-100/70", underline: "bg-violet-400",
    add: "hover:border-violet-400/50 hover:text-violet-200",
  },
};

// N3B — `onRemove` pasa a ser opcional. Una tarjeta que hace UNA pregunta fija
// (la meta de respaldo, la de patrimonio) no se puede quitar: no es un ítem de
// una lista. Sin esto habría que ofrecer un botón «Quitar» que no quita nada.
function ItemCard(props: { children: React.ReactNode; onRemove?: () => void; title: string; tone?: SectionTone }) {
  const t = TONE[props.tone ?? "zinc"];
  return (
    <div className={`kipu-lift rounded-2xl p-4 ${t.card}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className={`h-3.5 w-1 rounded-full ${t.accent}`} aria-hidden />
          <span className={`text-xs font-semibold uppercase tracking-wide ${t.label}`}>{props.title}</span>
        </span>
        {props.onRemove && (
          <button type="button" onClick={props.onRemove} className="text-xs text-zinc-500 transition hover:text-rose-300">
            Quitar
          </button>
        )}
      </div>
      <div className="flex flex-col gap-3">{props.children}</div>
    </div>
  );
}

function AddButton({ onClick, label, tone = "emerald" }: { onClick: () => void; label: string; tone?: SectionTone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border border-dashed border-line/15 px-4 py-3 text-sm font-medium text-zinc-300 transition ${TONE[tone].add}`}
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
  // A failed save bounces back here with ?message=...; resume on Review with the data
  // restored. Otherwise resume at the step the user left off on (item 3), or the intro.
  const [stepKey, setStepKey] = useState<StepKey>(() =>
    saveErrored || saveErrorMessage ? "review" : loadInitialStep(storageKey),
  );
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
  // Item 3 — persist the current step so an interrupted onboarding reopens where it
  // was left, instead of resetting to the intro and feeling like the data was lost.
  useEffect(() => {
    try {
      localStorage.setItem(`${storageKey}-step`, stepKey);
    } catch {
      // non-fatal
    }
  }, [stepKey, storageKey]);

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
  // S34 — convert an amount typed in any currency to the base, with the user's OWN
  // rates (wizard-typed first, then server-loaded). Never fabricates: unknown rate →
  // undefined, and the caller shows the FX ask instead of lying. Defined before the
  // allocation view because reserves (O2.1 cards) and goals can be in any currency.
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
  // O2.1 — reserve cards summed to base by kind (savings/investment) feed the view.
  const reserveTotals = useMemo(() => sumReservesByKind(state.reserves, fxToBase), [state.reserves, fxToBase]);
  // O11 — the balance sheet (stock): net worth = accounts + assets − debts.
  const netWorth = useMemo(() => computeDraftNetWorth(state, fxToBase), [state, fxToBase]);
  const allocation = useMemo(
    () => (capacity ? computeAllocationView(capacity.monthlyDisposableBeforeAllocations, reserveTotals, state.goals) : null),
    [capacity, reserveTotals, state.goals],
  );
  // S33 — reserves step shows the pool BEFORE goals (disposable − savings −
  // investment); its trulyFree is the base the goal simulator distributes.
  const reservesView = useMemo(
    () => (capacity ? computeAllocationView(capacity.monthlyDisposableBeforeAllocations, reserveTotals, []) : null),
    [capacity, reserveTotals],
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

  // Stage 38 — a reserve lands in an account OR an asset (efectivo, banco, etoro,
  // póliza…). Assets are declared on a later step, so only those already entered show;
  // the destination is optional (refined later from chat) and never changes the math.
  const reserveDestinations = useMemo<Option<string>[]>(
    () => [
      { value: "", label: "— (sin especificar)" },
      ...state.accounts.filter(accountReviewable).map((a) => ({ value: a.id, label: a.name })),
      ...(state.assets ?? [])
        .filter((a) => (a.name?.trim().length ?? 0) > 0)
        .map((a) => ({ value: a.id, label: `${a.name.trim()} (activo)` })),
    ],
    [state.accounts, state.assets],
  );

  // FX guard, computed live (S31 5.1d/f — the full mirror lives in wizard-model so
  // the dev gate exercises it). Covers accounts/debts/incomes/expenses/goals/assets
  // and the budget-estimate currency, counts only rows with a parseable amount, and
  // honors both wizard-typed rates and the server-loaded ones. Never invents a rate.
  // S35 — the ONE FX signal used elsewhere: which used currencies still lack a rate.
  // It only backstops the review (points to the intro) — currency is declared up
  // front, so this is normally empty.
  const fxMissing = useMemo<string[]>(() => wizardFxMissing(state, knownRates), [state, knownRates]);

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
        // Stage H — the DB stamps objective versions with the month of the user's
        // OWN timezone; tell it which one that is instead of letting it guess.
        // The lookup stays inside its own guard: an Intl that throws must not
        // take the whole save down with it (the server refuses on its own terms
        // when the month actually matters).
        let tz: string | null = null;
        try {
          tz = normalizeIanaTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
        } catch {
          tz = null;
        }
        if (tz) payload.clientTimezone = tz;
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
        <ProgressHeader stepIdx={idx} chapter={stepChapter(stepKey)} readiness={readiness} />

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

        {/* O11 — Cuentas has NO Sankey: it's the stock setup, not a mes. The cashflow
           Sankey belongs to the flow chapter and starts at Ingresos, so going back to
           Cuentas no longer repeats the income graphic. */}
        {stepKey === "accounts" && (
          <StepShell
            title="¿Dónde tienes tu plata?"
            tone="emerald"
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
              <ItemCard key={a.id} tone="emerald" title="Cuenta" onRemove={() => patch({ accounts: state.accounts.filter((x) => x.id !== a.id) })}>
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
            <AddButton tone="emerald" label="Agregar una cuenta" onClick={() => patch({ accounts: [...state.accounts, newAccount(base, state.accounts.length === 0)] })} />
          </StepShell>
        )}

        {stepKey === "income" && (
          <StepShell
            title="¿De dónde entra tu plata?"
            tone="teal"
            reparto={<RepartoFooter capacity={capacity} allocation={allocation} base={base} stage="income" />}
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
              <ItemCard key={i.id} tone="teal" title="Ingreso" onRemove={() => patch({ incomes: state.incomes.filter((x) => x.id !== i.id) })}>
                <TextField label="Nombre" value={i.name} placeholder="Sueldo, freelance, pensión…" onChange={(v) => updateItem("incomes", i.id, { name: v })} />
                {/* S31 (5.6) — the toggle is authoritative: turning it OFF clears the range. */}
                <Toggle
                  label="Varía mes a mes (no es fijo)"
                  checked={i.isVariable}
                  onChange={(v) => updateItem("incomes", i.id, v ? { isVariable: true } : { isVariable: false, minAmount: "", maxAmount: "" })}
                />
                {/* A2 — occasional/windfall: lands every few months, so it must NOT inflate
                    the monthly plan. Kipu remembers it and counts it when it actually enters. */}
                <Toggle
                  label="Es ocasional (solo cae a veces — freelance cada tanto, un bono). No lo sumo a tu mes."
                  checked={Boolean(i.isOccasional)}
                  onChange={(v) => updateItem("incomes", i.id, { isOccasional: v })}
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
                  <TextField label="Día del mes que lo recibes" value={i.expectedDay} inputMode="numeric" placeholder="1-31" onChange={(v) => updateItem("incomes", i.id, { expectedDay: v })} />
                )}
                {(i.frequency === "weekly" || i.frequency === "biweekly") && (
                  <>
                    <DateField label="¿Cuándo fue tu último pago? (para calcular el próximo)" value={i.lastPayDate} onChange={(v) => updateItem("incomes", i.id, { lastPayDate: v })} />
                    {/* S31 (3.5) — the anchor drives future cashflow and the Saldo refill; be honest about the cost of skipping it. */}
                    {!i.lastPayDate && (
                      <p className="-mt-1 text-xs text-amber-300/80">Sin esta fecha no sé cuándo te pagan, y tu Saldo sale más bajo.</p>
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
            <AddButton tone="teal" label="Agregar un ingreso" onClick={() => patch({ incomes: [...state.incomes, newIncome(base)] })} />
          </StepShell>
        )}

        {stepKey === "expenses" && (
          <StepShell
            title="¿En qué gastas cada mes?"
            tone="sky"
            reparto={<RepartoFooter capacity={capacity} allocation={allocation} base={base} stage="expenses" />}
            subtitle={
              <>
                Separamos tus gastos en dos para calcular mejor tu dinero:
                <span className="mt-1.5 block"><span className="font-semibold text-zinc-200">Con fecha</span> — tienen un día definido de pago.</span>
                <span className="block"><span className="font-semibold text-zinc-200">Habituales</span> — ocurren durante el mes, sin una fecha fija.</span>
              </>
            }
            footer={<Footer onBack={goBack} onNext={goNext} />}
          >
            {/* O1 (#1) — two visually distinct zones so the user never mixes them:
                ① "con fecha" (sky) holds recurring expenses with a payment date. */}
            <div className="flex flex-col gap-4 rounded-2xl border border-sky-400/20 bg-sky-950/20 p-4">
              <SectionHeader
                badge="1"
                tone="sky"
                title="Gastos con fecha"
                subtitle="Tienen un día específico de pago cada mes. Ej.: alquiler, luz, agua, Netflix."
              />
            {state.expenses.map((e) => (
              <ItemCard key={e.id} tone="sky" title="Gasto con fecha" onRemove={() => patch({ expenses: state.expenses.filter((x) => x.id !== e.id) })}>
                <TextField label="Nombre" value={e.name} placeholder="Alquiler, internet…" onChange={(v) => updateItem("expenses", e.id, { name: v })} />
                <div className="grid grid-cols-2 gap-3">
                  <MoneyField label="Monto" value={e.amount} currency={e.currency} onChange={(v) => updateItem("expenses", e.id, { amount: v })} requiredHint />
                  <SelectField label="Moneda" value={e.currency} options={currencyOptions} onChange={(v) => updateItem("expenses", e.id, { currency: v })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {/* O1 (#3) — changing category resets the essential default:
                      essential-by-def categories → essential; ambiguous → not (the
                      toggle below lets the user opt in). */}
                  <SelectField label="Categoría" value={e.category} options={EXPENSE_CATEGORIES} onChange={(v) => updateItem("expenses", e.id, { category: v, isEssential: isEssentialByDefaultCategory(v) })} />
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
                  <TextField label="Día del mes que lo pagas" value={e.expectedDay} inputMode="numeric" placeholder="1-31" onChange={(v) => updateItem("expenses", e.id, { expectedDay: v })} />
                ) : null}
                {payableSources.length > 1 && (
                  <SelectField label="Se paga desde (opcional)" value={e.paymentSourceId} options={payableSources} onChange={(v) => updateItem("expenses", e.id, { paymentSourceId: v })} />
                )}
                {/* O1 (#3) — only ask on categories where it's genuinely ambiguous.
                    Arriendo/servicios/salud/comida/transporte/educación/deuda ya son
                    esenciales por definición → no preguntamos. */}
                {!isEssentialByDefaultCategory(e.category) && (
                  <Toggle label="¿Es un gasto esencial?" checked={e.isEssential} onChange={(v) => updateItem("expenses", e.id, { isEssential: v })} />
                )}
                {/* #2 — "Varía mes a mes" per-row toggle. */}
                <Toggle label="Varía mes a mes" checked={Boolean(e.isVariable)} onChange={(v) => updateItem("expenses", e.id, { isVariable: v })} />
                {e.isVariable && (
                  <p className="-mt-1 text-xs text-zinc-500">Kipu lo trata como un monto que varía — no lo asume fijo.</p>
                )}
                <NoteField value={e.note ?? ""} onChange={(v) => updateItem("expenses", e.id, { note: v })} placeholder="Ej. el alquiler sube cada 3 meses, próximo aumento agosto" />
              </ItemCard>
            ))}
              <AddButton tone="sky" label="Agregar un gasto con fecha" onClick={() => patch({ expenses: [...state.expenses, newExpense(base)] })} />
            </div>

            {/* O1 (#1) — Section ② "habituales": no fixed date, estimated by category
                (essential-but-variable spend). Its own amber zone. */}
            <div className="rounded-2xl border border-amber-400/25 bg-amber-950/20 p-4">
              <SectionHeader
                badge="2"
                tone="amber"
                title="Gastos habituales"
                subtitle="Los haces todos los meses, pero sin una fecha o frecuencia fija. Ej.: comida, transporte, salud."
              />
              <p className="mt-1.5 text-xs leading-5 text-zinc-400">Comida y transporte llevan un <span className="font-semibold text-zinc-300">objetivo mensual</span>: tú decides cuánto quieres gastar y Kipu te avisa a tiempo si vas a pasarte — dentro del objetivo, tu Saldo ni se entera. Para lo demás, un aproximado ya sirve. No repitas lo que ya pusiste arriba.</p>
              {/* O1 (#4/founder) — habitual expenses as removable/addable cards,
                  symmetric with the ① list: start with Comida, add Transporte/Salud/
                  Otro esencial, remove what you don't have. Each category appears at
                  most once (the select only offers unused ones). */}
              <div className="mt-3 flex flex-col gap-4">
                {state.categoryBudgets.map((cb) => {
                  // Item 2 — each habitual gasto in its OWN currency (falls back to base).
                  const cur = (cb.currency || state.categoryBudgetCurrency || base) as CurrencyCode;
                  const amount = parseMoney(cb.amount);
                  const seedRaw = (cb.mtdSeed ?? "").trim();
                  const seed = parseMoney(cb.mtdSeed);
                  const seedInvalid = seedRaw.length > 0 && seed === undefined;
                  const usedByOthers = new Set(state.categoryBudgets.filter((x) => x.category !== cb.category).map((x) => x.category));
                  const catOptions = HABITUAL_CATEGORIES.filter((c) => c === cb.category || !usedByOthers.has(c)).map((c) => ({ value: c, label: habitualCategoryLabel(c) }));
                  return (
                    <ItemCard key={cb.category} tone="amber" title="Gasto habitual" onRemove={() => removeCategoryBudget(cb.category)}>
                      <div className="grid grid-cols-2 gap-3">
                        <SelectField label="Categoría" value={cb.category} options={catOptions} onChange={(v) => changeCategoryBudgetCategory(cb.category, v)} />
                        <SelectField label="Moneda" value={cur} options={currencyOptions} onChange={(v) => updateCategoryBudget(cb.category, { currency: v })} />
                      </div>
                      <MoneyField
                        label={cb.category === "food" || cb.category === "transport" ? "Objetivo mensual" : "Monto al mes"}
                        value={cb.amount}
                        currency={cur}
                        onChange={(v) => updateCategoryBudget(cb.category, { amount: v })}
                      />
                      {(cb.category === "food" || cb.category === "transport") && (
                        <p className="ml-2 border-l-2 border-amber-400/15 pl-3 text-[11px] leading-4 text-zinc-500">
                          Es una decisión tuya, no una predicción: dentro del objetivo no toca tu Saldo; si te pasas, solo el exceso sale de ahí.
                        </p>
                      )}
                      {/* S32 — per-category month-to-date seed: only shown once the
                          estimate has an amount (a seed without estimate has nothing
                          to track against — it's ignored, and we say so below). */}
                      {amount !== undefined ? (
                        <label className="ml-2 flex flex-col gap-1 border-l-2 border-amber-400/15 pl-3">
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
                              <span className="text-xs text-amber-300/90">
                                {cb.category === "food" || cb.category === "transport"
                                  ? "Ya pasaste tu objetivo este mes — lo que sigue saldría de tu Saldo. Ajústalo si quieres; tú decides."
                                  : "Ya pasaste tu estimado — ajústalo si quieres. Kipu lo tiene presente, sin drama."}
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
                          Anotaste {formatKipuMoney(seed, cur)} en {habitualCategoryLabel(cb.category).toLowerCase()}, pero me falta el estimado del mes para descontarlo — ponle un monto y listo.
                        </p>
                      ) : null}
                    </ItemCard>
                  );
                })}
                {state.categoryBudgets.length < HABITUAL_CATEGORIES.length && (
                  <AddButton tone="amber" label="Agregar un gasto habitual" onClick={addCategoryBudget} />
                )}
              </div>
            </div>
          </StepShell>
        )}

        {stepKey === "debts" && (
          <StepShell
            title="¿Tienes deudas o tarjetas?"
            tone="rose"
            reparto={<RepartoFooter capacity={capacity} allocation={allocation} base={base} stage="debts" />}
            subtitle="Tarjetas, préstamos, o plata que le debes a alguien. Sin juicio — es para cuidarte."
            footer={<Footer onBack={goBack} onNext={goNext} />}
          >
            {state.debts.length === 0 && (
              <button
                type="button"
                onClick={() => { patch({ noDebts: true }); goNext(); }}
                className="rounded-xl border border-line/10 bg-[var(--tint-zinc)] px-4 py-3 text-sm font-medium text-zinc-300 transition hover:border-emerald-400/40 hover:text-emerald-200"
              >
                No tengo deudas
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
              <ItemCard key={d.id} tone="rose" title={isLoan ? "Préstamo" : isCard ? "Tarjeta" : "Deuda"} onRemove={() => patch({ debts: state.debts.filter((x) => x.id !== d.id) })}>
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
                      <TextField label="Día de corte" value={d.cutoffDay} inputMode="numeric" placeholder="1-31" onChange={(v) => updateItem("debts", d.id, { cutoffDay: v })} />
                      <TextField label="Día de pago" value={d.dueDay} inputMode="numeric" placeholder="1-31" onChange={(v) => updateItem("debts", d.id, { dueDay: v })} />
                    </div>
                    {/* O9 — high-value fields: lead with the benefit instead of "(opcional)". */}
                    <p className="-mt-1 text-xs text-zinc-500">Ponlos y Kipu aparta la plata del pago justo cuando toca — ni antes ni después. Si no los sabes, los agregas después.</p>
                    {/* S31 (3.9) — a due day + amount without the cutoff can't be placed in the calendar. */}
                    {!d.cutoffDay.trim() && d.dueDay.trim().length > 0 && parseMoney(d.currentMonthPayment) !== undefined && (
                      <p className="-mt-1 text-xs text-amber-300/80">Sin el día de corte no puedo ubicar el pago de tu tarjeta en el calendario.</p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <TextField label="Interés anual % (aprox.)" value={d.interestRate} inputMode="decimal" placeholder="38" onChange={(v) => updateItem("debts", d.id, { interestRate: v })} />
                      {accountSources.length > 1 && (
                        <SelectField label="Pagas desde (opcional)" value={d.defaultPaymentAccountId} options={accountSources} onChange={(v) => updateItem("debts", d.id, { defaultPaymentAccountId: v })} />
                      )}
                    </div>
                    {/* O10 — card interest is an estimate; it sharpens when a statement is imported. */}
                    <p className="-mt-1 text-xs text-zinc-500">Un estimado está bien — Kipu lo afina solo cuando subas un estado de cuenta.</p>
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
            <AddButton tone="rose" label="Agregar una deuda" onClick={() => patch({ debts: [...state.debts, newDebt(base)], noDebts: false })} />
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
            title="Ahora, ¿qué tienes? Tu patrimonio"
            tone="violet"
            reparto={<PatrimonioFooter netWorth={netWorth} base={base} showReservesLink />}
            subtitle="Esta es la otra hoja: tu balance, no tu mes. Inversiones, una propiedad, tu auto, cripto, o plata que te deben — con tus cuentas y deudas armamos tu patrimonio neto. Es opcional; sáltalo si no aplica. Si ya lo pusiste como cuenta de ahorro en Cuentas, no lo repitas aquí."
            footer={
              <Footer
                onBack={goBack}
                onNext={goNext}
                nextLabel={(state.assets ?? []).length === 0 ? "No tengo, ver mi resumen" : "Ver mi resumen"}
                nextDisabled={incompleteAssets.length > 0}
                nextHint={incompleteAssets.length > 0 ? "Ponle un valor a tu activo para guardarlo (o quítalo)." : undefined}
              />
            }
          >
            {/* N3B · EL TECHO DEL PATRIMONIO, preguntado. Revierte D-N2, que
                había decidido que Patrimonio no lleva nivel «porque no tiene
                techo honesto». Era verdad a medias: Kipu no puede DEDUCIR un
                techo de patrimonio, pero el usuario sí puede DECLARARLO — y
                `wealth_target` lo guarda desde antes de este bloque. En blanco
                no se escribe nada y el orbe sigue siendo cristal. */}
            <ItemCard tone="violet" title="Tu meta de patrimonio">
              <p className="text-xs text-zinc-500">
                ¿A cuánto quieres llegar? Es el número grande, el de años, no el
                del mes. Sirve para mostrarte cuánto llevas del camino. Si aún no
                lo tienes claro, déjalo en blanco — se puede fijar después por
                chat.
              </p>
              <MoneyField
                label="Meta de patrimonio (opcional)"
                value={state.profile.wealthTarget ?? ""}
                currency={base}
                onChange={(v) => patch({ profile: { ...state.profile, wealthTarget: v } })}
              />
            </ItemCard>

            {(state.assets ?? []).map((a) => (
              <ItemCard
                key={a.id}
                tone="violet"
                title={ASSET_CLASSES.find((c) => c.value === a.assetClass)?.label ?? "Activo"}
                onRemove={() => patch({ assets: (state.assets ?? []).filter((x) => x.id !== a.id) })}
              >
                <TextField label="Nombre" value={a.name} placeholder="Acciones, depa, auto…" onChange={(v) => updateItem("assets", a.id, { name: v })} />
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
                {/* A8 — the flag means "do you treat this as available money?", not market
                    liquidity. Reframe so an easy-to-sell-but-invested asset (e.g. stocks you
                    don't touch) is correctly marked as NOT available. */}
                <Toggle label="Puedo usar esta plata cuando quiera" checked={a.liquid} onChange={(v) => updateItem("assets", a.id, { liquid: v })} />
                {/* O5 — removed the "Cuéntalo en mi patrimonio" toggle; every asset counts
                    toward patrimonio by default (newAsset sets includeInNetWorth: true). */}
                <NoteField value={a.note ?? ""} onChange={(v) => updateItem("assets", a.id, { note: v })} placeholder="Ej. lo vendo para la boda en 2028" />
              </ItemCard>
            ))}
            <AddButton tone="violet" label="Agregar un activo" onClick={() => patch({ assets: [...(state.assets ?? []), newAsset(base)] })} />
            {/* C19 — the investment reserve's DESTINATION asset can only be picked once assets
                exist, and assets come after reserves. So capture the link HERE: an investment
                aporte pointed at a declared asset becomes a net-worth-neutral transfer on
                confirm (cuenta ↓ + activo ↑) instead of a plain reserve. */}
            {(() => {
              const namedAssets = (state.assets ?? []).filter((a) => a.name.trim().length > 0);
              const investmentReserves = state.reserves.filter((r) => r.kind === "investment");
              if (namedAssets.length === 0 || investmentReserves.length === 0) return null;
              const assetOptions: Option<string>[] = [
                { value: "", label: "— (solo lo reservo, no va a un activo)" },
                ...namedAssets.map((a) => ({ value: a.id, label: a.name.trim() })),
              ];
              return (
                <div className="mt-2 space-y-3 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-4">
                  <p className="text-sm font-medium text-violet-200">¿Tu aporte de inversión va a alguno de estos activos?</p>
                  <p className="-mt-1 text-xs text-zinc-500">Así, cuando confirmes el aporte, lo muevo de tu cuenta a ese activo (tu patrimonio no cambia, solo se acomoda).</p>
                  {investmentReserves.map((r) => {
                    const amt = moneyPreview(r.amount, r.currency);
                    return (
                      <SelectField
                        key={r.id}
                        label={amt ? `Aporte de ${amt}` : "Tu aporte de inversión"}
                        value={r.destinationId ?? ""}
                        options={assetOptions}
                        onChange={(v) => updateItem("reserves", r.id, { destinationId: v })}
                      />
                    );
                  })}
                </div>
              );
            })()}
          </StepShell>
          );
        })()}

        {/* S34 — the goals step merged INTO the goal-plan step (one page at the end):
            choosing a goal, its amount, and its date⇄contribution plan happen together,
            after the user already knows what's actually free. */}

        {stepKey === "reserves" && (
          <ReservesStep
            state={state}
            reservesView={reservesView}
            capacity={capacity}
            base={base}
            currencyOptions={currencyOptions}
            destinations={reserveDestinations}
            sources={accountSources}
            onBack={goBack}
            onNext={goNext}
            onAddReserve={(kind) => patch({ reserves: [...state.reserves, newReserve(base, kind)] })}
            onRemoveReserve={(id) => patch({ reserves: state.reserves.filter((x) => x.id !== id) })}
            onUpdateReserve={(id, patchReserve) => updateItem("reserves", id, patchReserve)}
            onProfile={(profile) => patch({ profile })}
          />
        )}

        {stepKey === "goalplan" && (
          <GoalPlanStep
            state={state}
            reservesView={reservesView}
            allocation={allocation}
            capacity={capacity}
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

        {/* O11 — the "Estilo" step is gone: tone/strictness default (changeable in
           Ajustes) and the general note is redundant with per-row notes. This keeps
           the two flows (Tu mes / Tu patrimonio) clean and ends straight at the resumen. */}

        {stepKey === "review" && (
          <ReviewStep
            state={state}
            margen={margen}
            capacity={capacity}
            allocation={allocation}
            netWorth={netWorth}
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
    patchBudget: Partial<Pick<WizardCategoryBudget, "amount" | "mtdSeed" | "currency">>,
  ) {
    setState((s) => ({
      ...s,
      categoryBudgets: s.categoryBudgets.map((cb) => (cb.category === category ? { ...cb, ...patchBudget } : cb)),
    }));
  }
  // O1 — add/remove/retype a habitual expense card (dynamic list, no duplicate
  // categories: the select already hides used ones, and change/add re-check).
  function addCategoryBudget() {
    setState((s) => {
      const used = new Set(s.categoryBudgets.map((cb) => cb.category));
      const next = HABITUAL_CATEGORIES.find((c) => !used.has(c));
      if (!next) return s;
      return { ...s, categoryBudgets: [...s.categoryBudgets, { category: next, amount: "", mtdSeed: "" }] };
    });
  }
  function removeCategoryBudget(category: WizardCategoryBudget["category"]) {
    setState((s) => ({ ...s, categoryBudgets: s.categoryBudgets.filter((cb) => cb.category !== category) }));
  }
  function changeCategoryBudgetCategory(oldCat: WizardCategoryBudget["category"], newCat: string) {
    setState((s) => {
      if (oldCat === newCat || s.categoryBudgets.some((cb) => cb.category === newCat)) return s;
      return { ...s, categoryBudgets: s.categoryBudgets.map((cb) => (cb.category === oldCat ? { ...cb, category: newCat as WizardCategoryBudget["category"] } : cb)) };
    });
  }

  // Generic typed updater for a collection item.
  function updateItem<K extends "accounts" | "incomes" | "expenses" | "debts" | "goals" | "assets" | "reserves">(
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
function newReserve(currency: CurrencyCode, kind: WizardReserveKind = "savings"): WizardReserve {
  // Stage 38 — reserves are scheduled like income/gastos: default monthly, no fixed
  // day/anchor, default destination (the read side falls back to the primary account).
  return { id: genId(), kind, amount: "", currency, frequency: "monthly", expectedDay: "", payAnchorDate: "", destinationId: "" };
}

// Stage 38 — the reserve amount is PER OCCURRENCE at its cadence; label it so the user
// reads "500 por semana" vs "500 al mes" correctly (matches income's "por pago" logic).
function reserveAmountLabel(freq: WizardReserve["frequency"]): string {
  switch (freq) {
    case "weekly":
      return "Por semana";
    case "biweekly":
      return "Cada 2 semanas";
    case "yearly":
      return "Al año";
    case "monthly":
    default:
      return "Al mes";
  }
}

// ── Composite UI ────────────────────────────────────────────────────────────────

function ProgressHeader({ stepIdx, chapter, readiness }: { stepIdx: number; chapter: string | null; readiness: ReturnType<typeof wizardReadiness> }) {
  const pct = Math.round((stepIdx / (STEPS.length - 1)) * 100);
  // O11 — the chapter name is the section marker; it shifts color when you cross from
  // "Tu mes" (flujo) into "Tu patrimonio" (balance), so the two statements read apart.
  const chapterClass =
    chapter === "Tu patrimonio" ? "text-violet-300" : chapter === "Tu mes" ? "text-teal-300" : "text-zinc-400";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-sm font-black tracking-tight">
          <span className="text-emerald-300">Kipu</span>
          <span className="text-zinc-600">·</span>
          <span className={chapterClass}>{chapter ?? "Configura tu cuenta"}</span>
        </span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">{Math.min(stepIdx + 1, STEPS.length)}/{STEPS.length}</span>
          <ThemeToggle />
        </div>
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

function StepShell(props: { title: string; subtitle: React.ReactNode; children: React.ReactNode; footer: React.ReactNode; tone?: SectionTone; reparto?: React.ReactNode }) {
  const t = TONE[props.tone ?? "emerald"];
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-zinc-50">{props.title}</h1>
        <span className={`mt-2 block h-1 w-9 rounded-full ${t.underline}`} aria-hidden />
        <p className="mt-2.5 text-sm leading-6 text-zinc-400">{props.subtitle}</p>
      </div>
      <div className="flex flex-col gap-4">{props.children}</div>
      {/* O2.1 — the "cómo se reparte" section: a clearly separated block at the
         bottom of every money step (a divider + its own heading) so it never
         blends with the data cards above. Updates live as the user fills in. */}
      {props.reparto}
      {props.footer}
    </section>
  );
}

// O2.1 — the live "cómo se reparte tu mes" section. Same component on every money
// step (Ingresos → Metas) and on the Review, so the layout is identical everywhere.
// It's a visually DISTINCT block (divider + its own heading + emerald tint) so it
// never blends with the data cards above. All monthly — the weekly Margen is NOT here.
// Stage picks the label + which flows are shown; "Gastos" merges fixed + essentials.
function RepartoFooter(props: {
  capacity: ReturnType<typeof buildDraftCapacity> | null;
  allocation: ReturnType<typeof computeAllocationView> | null;
  base: CurrencyCode;
  // O2.1 — the Sankey reveals PROGRESSIVELY: each step only peels off the
  // obligations for sections AT or BEFORE it, so going back to an earlier step
  // narrows the flow (income only → +gastos → +deudas → +ahorro → +metas). This is
  // what makes it feel alive instead of showing the full picture on every page.
  stage: "income" | "expenses" | "debts" | "ahorro" | "metas" | "review";
  // On the goals step the cards show a live PLAN (seeded defaults included) before
  // it's committed to state; pass that displayed total so the Sankey number matches
  // the cards instead of only counting already-stored contributions.
  goalsAmountOverride?: number;
}) {
  const c = props.capacity;
  const a = props.allocation;
  const heading = (
    <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-300/70">Cómo se reparte tu mes</p>
  );
  const wrap = (children: React.ReactNode) => (
    <div className="mt-1 border-t border-dashed border-line/20 pt-5">
      <div className="kipu-lift rounded-2xl border-[1.5px] border-emerald-400/35 bg-[var(--tint-emerald)] p-5">{children}</div>
    </div>
  );

  if (!c || c.monthlyIncome <= 0) {
    return wrap(
      <div className="text-center">
        {heading}
        <p className="mt-2 text-sm leading-6 text-zinc-400">Agrega un ingreso y aquí verás cómo se reparte tu mes.</p>
      </div>,
    );
  }

  // Progressive reveal — only count obligations up to the current step.
  const order = ["income", "expenses", "debts", "ahorro", "metas", "review"] as const;
  const at = order.indexOf(props.stage);
  const income = c.monthlyIncome;
  const gastos = at >= 1 ? c.monthlyFixed + c.monthlyEssentials : 0;
  const debt = at >= 2 ? c.monthlyDebtService : 0;
  const savings = at >= 3 ? (a ? a.savings + a.investment : 0) : 0;
  const goalsAmt = at >= 4 ? (props.goalsAmountOverride ?? (a ? a.goals : 0)) : 0;
  const disponible = Math.max(0, income - gastos - debt - savings - goalsAmt);
  const label =
    props.stage === "income"
      ? "Tu ingreso al mes"
      : props.stage === "expenses"
        ? "Disponible después de gastos"
        : props.stage === "debts"
          ? "Disponible después de deudas"
          : props.stage === "ahorro"
            ? "Disponible después de ahorro"
            : "Disponible para gastar";

  const flows: SankeyFlow[] = [];
  if (gastos > 0) flows.push({ key: "gastos", label: "Gastos", amount: gastos, tone: "essential" });
  if (debt > 0) flows.push({ key: "debt", label: "Deudas", amount: debt, tone: "debt" });
  if (savings > 0) flows.push({ key: "reserve", label: "Ahorro", amount: savings, tone: "reserve" });
  if (goalsAmt > 0) flows.push({ key: "goal", label: "Metas", amount: goalsAmt, tone: "goal" });
  flows.push({ key: "free", label: "Para gastar", amount: disponible, tone: "free" });

  return wrap(
    <>
      <div className="text-center">
        {heading}
        <p className="mt-2 text-base font-bold uppercase tracking-wide text-emerald-300">{label}</p>
        <p className="mt-1 text-4xl font-black text-zinc-50">
          {formatKipuMoney(disponible, props.base)}
          <span className="text-lg font-bold text-zinc-500"> /mes</span>
        </p>
      </div>
      <MonthSankey income={c.monthlyIncome} flows={flows} base={props.base} className="mt-4" />
    </>,
  );
}

// O2.1 — the review's written breakdown: every line of the cascade with its section
// color + a bold "Para gastar" total, so the numbers read clearly (not just the Sankey).
function MonthDesglose(props: {
  capacity: NonNullable<ReturnType<typeof buildDraftCapacity>>;
  allocation: ReturnType<typeof computeAllocationView> | null;
  daily: number;
  base: CurrencyCode;
}) {
  const c = props.capacity;
  const a = props.allocation;
  const rows = [
    { label: "Gastos con fecha", value: c.monthlyFixed, cls: "text-zinc-300" },
    { label: "Gastos habituales", value: c.monthlyEssentials, cls: "text-amber-300" },
    { label: "Deudas", value: c.monthlyDebtService, cls: "text-rose-300" },
    { label: "Ahorro", value: a ? a.savings : 0, cls: "text-sky-300" },
    { label: "Inversión", value: a ? a.investment : 0, cls: "text-sky-300" },
    { label: "Metas", value: a ? a.goals : 0, cls: "text-violet-300" },
  ].filter((r) => r.value > 0.005);
  return (
    <div className="kipu-lift rounded-2xl border border-line/10 bg-[var(--tint-zinc)] p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Desglose de tu mes</p>
      <div className="mt-3 flex flex-col gap-2.5 text-[15px]">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-emerald-200">Ingreso al mes</span>
          <span className="font-bold tabular-nums text-emerald-300">+{formatKipuMoney(c.monthlyIncome, props.base)}</span>
        </div>
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between">
            <span className={r.cls}>− {r.label}</span>
            <span className="tabular-nums text-zinc-300">{formatKipuMoney(r.value, props.base)}</span>
          </div>
        ))}
        <div className="mt-1 flex items-center justify-between border-t border-line/15 pt-3">
          <span className="text-base font-bold text-emerald-200">Para gastar al mes</span>
          <span className="text-xl font-black tabular-nums text-emerald-300">{formatKipuMoney(props.daily, props.base)}</span>
        </div>
      </div>
    </div>
  );
}

// O11 — the balance-sheet counterpart of RepartoFooter, for the "Tu patrimonio"
// chapter (Activos step + review). Same "consequence at the bottom" pattern but
// violet + honest STOCK content: net worth graphed as two scaled bars (tienes vs
// debes), kind about a negative net (very common, never a regaño).
function PatrimonioChart({ netWorth, base, className }: { netWorth: DraftNetWorth; base: CurrencyCode; className?: string }) {
  const { tienes, debes } = netWorth;
  const max = Math.max(tienes, debes, 1);
  const row = (label: string, value: number, barClass: string, textClass: string) => (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className={`font-semibold ${textClass}`}>{label}</span>
        <span className="tabular-nums font-bold text-zinc-200">{formatKipuMoney(value, base)}</span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-line/10">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${value > 0 ? Math.max(3, (value / max) * 100) : 0}%` }} />
      </div>
    </div>
  );
  return (
    <div className={`flex flex-col gap-3 ${className ?? ""}`}>
      {row("Tienes (cuentas + activos)", tienes, "bg-emerald-400", "text-emerald-300")}
      {row("Debes (deudas)", debes, "bg-rose-400", "text-rose-300")}
    </div>
  );
}

function PatrimonioFooter(props: { netWorth: DraftNetWorth; base: CurrencyCode; showReservesLink?: boolean }) {
  const { netWorth: nw, base } = props;
  const negative = nw.neto < -0.005;
  const empty = nw.tienes <= 0 && nw.debes <= 0;
  return (
    <div className="mt-1 border-t border-dashed border-line/20 pt-5">
      <div className="kipu-lift rounded-2xl border-[1.5px] border-violet-400/35 bg-[var(--tint-violet)] p-5">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-300/70">Tu patrimonio · balance</p>
          {empty ? (
            <p className="mt-2 text-sm leading-6 text-zinc-400">Aquí verás lo que tienes menos lo que debes — tu patrimonio neto.</p>
          ) : (
            <>
              <p className="mt-2 text-base font-bold uppercase tracking-wide text-violet-300">Patrimonio neto</p>
              <p className={`mt-1 text-4xl font-black ${negative ? "text-rose-300" : "text-zinc-50"}`}>
                {formatKipuMoney(nw.neto, base)}
              </p>
            </>
          )}
        </div>
        {!empty && <PatrimonioChart netWorth={nw} base={base} className="mt-4" />}
        {!empty && negative && (
          <p className="mt-3 text-center text-xs leading-5 text-violet-100/80">
            Hoy debes más de lo que tienes — es solo la foto de este momento. Con lo que apartas cada mes se va dando vuelta.
          </p>
        )}
        {!empty && !negative && props.showReservesLink && (
          <p className="mt-3 text-center text-xs leading-5 text-violet-100/70">
            Lo que apartas cada mes en Reservas hace crecer esto con el tiempo.
          </p>
        )}
      </div>
    </div>
  );
}

function Footer(props: { onBack?: () => void; onNext: () => void; nextDisabled?: boolean; nextLabel?: string; nextHint?: string }) {
  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex items-center gap-3">
        {props.onBack && (
          <button type="button" onClick={props.onBack} className="rounded-2xl border border-line/10 px-5 py-3 text-sm font-semibold text-zinc-300 transition hover:border-line/25">
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


// A labeled section divider so distinct concepts on one step read as distinct
// blocks. `badge` is a small step number chip. Tones come from the shared TONE
// map so section headers, cards and step titles all speak the same color.
function SectionHeader(props: { badge?: string; title: string; subtitle?: string; tone?: SectionTone }) {
  const t = TONE[props.tone ?? "zinc"];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {props.badge && (
          <span className={`flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-bold ${t.badge}`}>
            {props.badge}
          </span>
        )}
        <p className={`text-sm font-bold ${t.title}`}>{props.title}</p>
      </div>
      {props.subtitle && <p className={`text-xs leading-5 ${t.sub}`}>{props.subtitle}</p>}
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
        <span className="shrink-0 rounded-xl border border-line/10 bg-zinc-900 px-3 py-2.5 text-sm font-semibold text-zinc-300">
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
          <span className="shrink-0 rounded-xl border border-line/10 bg-zinc-900 px-3 py-2.5 text-sm font-semibold text-zinc-300">
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

// #7 — ALLOCATION. Post-capacity: the user decides how much to apart to savings,
// investment, and each goal, with a LIVE "te quedan X/mes (~/día) libres" and a
// gentle recommendation. Over-allocating is warned, never blocked.
// S33 — RESERVES: savings + investment ONLY, decided AFTER seeing the margin and
// BEFORE goals. Its trulyFree (disposable − savings − investment) is the pool the
// goal simulator distributes next.
function ReservesStep(props: {
  state: WizardState;
  reservesView: ReturnType<typeof computeAllocationView> | null;
  capacity: ReturnType<typeof buildDraftCapacity> | null;
  base: CurrencyCode;
  currencyOptions: Option<CurrencyCode>[];
  destinations: Option<string>[];
  sources: Option<string>[];
  onBack: () => void;
  onNext: () => void;
  onAddReserve: (kind: WizardReserveKind) => void;
  onRemoveReserve: (id: string) => void;
  onUpdateReserve: (id: string, patch: Partial<WizardReserve>) => void;
  onProfile: (profile: WizardState["profile"]) => void;
}) {
  const { reservesView: a, capacity, base } = props;
  // O2.1 — dynamic microtext: anchor the ask to what's actually free this month.
  const disp = capacity && capacity.monthlyIncome > 0 ? capacity.monthlyDisposableBeforeAllocations : null;
  const subtitle =
    disp !== null && disp > 0 ? (
      <>
        De <span className="font-semibold text-zinc-200">{formatKipuMoney(disp, base)}</span> disponibles después de tus gastos, ¿cuánto quieres apartar para ahorro e inversión? Kipu los protege antes de nada — lo que quede reparten tus metas y tu día a día.
      </>
    ) : (
      "Ahorro e inversión primero: Kipu los protege antes de nada. Lo que quede es lo que reparten tus metas y tu día a día."
    );
  return (
    <StepShell
      title="¿Cuánto guardas cada mes?"
      tone="teal"
      subtitle={subtitle}
      reparto={<RepartoFooter capacity={capacity} allocation={a} base={base} stage="ahorro" />}
      footer={<Footer onBack={props.onBack} onNext={props.onNext} nextLabel="Armar el plan de mis metas" />}
    >
      {/* N3B · EL TECHO DEL RESPALDO, preguntado.
          El founder: «tenemos que usar las metas para que reservas y patrimonio
          tengan tope, lo podemos preguntar siempre en el onboarding». Sin este
          número el orbe de Reserva no puede mostrar un nivel —no hay contra qué
          medir— y cambia de materia. Cambiar de materia es honesto, pero deja al
          usuario mirando un cristal que no explica nada. Preguntarlo es mejor.
          Y sigue siendo opcional: en blanco NO se escribe nada, y el orbe hace
          lo que hacía. Kipu no inventa un techo. */}
      <ItemCard tone="teal" title="Tu meta de respaldo">
        <p className="text-xs text-zinc-500">
          ¿Cuánto quieres llegar a tener guardado para imprevistos? Sirve para
          mostrarte cuánto llevas. Si aún no lo sabes, déjalo en blanco — lo
          puedes decidir después por chat.
        </p>
        <MoneyField
          label="Meta de respaldo (opcional)"
          value={props.state.profile.reserveTarget ?? ""}
          currency={base}
          onChange={(v) =>
            props.onProfile({ ...props.state.profile, reserveTarget: v })
          }
        />
      </ItemCard>

      {props.state.reserves.map((r) => {
        const freq = r.frequency ?? "monthly";
        const isWeeklyish = freq === "weekly" || freq === "biweekly";
        return (
        <ItemCard key={r.id} tone="teal" title={r.kind === "investment" ? "Inversión" : "Ahorro"} onRemove={() => props.onRemoveReserve(r.id)}>
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Tipo" value={r.kind} options={RESERVE_KINDS} onChange={(v) => props.onUpdateReserve(r.id, { kind: v })} />
            <SelectField label="Moneda" value={r.currency} options={props.currencyOptions} onChange={(v) => props.onUpdateReserve(r.id, { currency: v })} />
          </div>
          {/* Stage 38 — cadence + amount, homogenized with income/gastos (frequency above). */}
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Cada cuánto" value={freq} options={FREQUENCIES} onChange={(v) => props.onUpdateReserve(r.id, { frequency: v })} />
            <MoneyField label={reserveAmountLabel(freq)} value={r.amount} currency={r.currency} onChange={(v) => props.onUpdateReserve(r.id, { amount: v })} />
          </div>
          {freq === "monthly" && (
            <TextField label="Día del mes que lo apartas" value={r.expectedDay ?? ""} inputMode="numeric" placeholder="1-31" onChange={(v) => props.onUpdateReserve(r.id, { expectedDay: v })} />
          )}
          {isWeeklyish && (
            <DateField label="¿Cuándo apartas el próximo? (para calcular el ritmo)" value={r.payAnchorDate ?? ""} onChange={(v) => props.onUpdateReserve(r.id, { payAnchorDate: v })} />
          )}
          {/* Savings sits IN a cash account → pick it here. An investment reserve's
              destination is an ASSET (declared later), so it's linked on the Patrimonio
              step instead — here we only capture where the money comes FROM. */}
          {r.kind === "savings" && props.destinations.length > 1 && (
            <SelectField label="Se guarda en (opcional)" value={r.destinationId ?? ""} options={props.destinations} onChange={(v) => props.onUpdateReserve(r.id, { destinationId: v })} />
          )}
          {r.kind === "investment" && props.sources.length > 1 && (
            <SelectField label="Sale de (cuenta)" value={r.sourceId ?? ""} options={props.sources} onChange={(v) => props.onUpdateReserve(r.id, { sourceId: v })} />
          )}
        </ItemCard>
        );
      })}
      <AddButton tone="teal" label="Agregar ahorro o inversión" onClick={() => props.onAddReserve("savings")} />
      {/* S31 (3.4) — prevent the savings/goal double-reserve. */}
      <p className="text-xs leading-5 text-zinc-500">Esto es aparte de tus metas — el aporte a cada meta lo decides en el siguiente paso.</p>
      {a && a.monthlyDisposable > 0 && (() => {
        // O3 — three states: over-allocated (rose), tight/near-zero (amber), healthy (green).
        const tone = leftoverTone(a.trulyFree, a.monthlyDisposable);
        if (tone === "over")
          return (
            <AllocationNote tone="over">
              Estás guardando más de lo que te queda ({formatKipuMoney(a.totalAllocated, base)}). No pasa nada por soñar, pero para que cuadre baja un poco.
            </AllocationNote>
          );
        if (tone === "tight")
          return (
            <AllocationNote tone="tight">
              Te queda poco para tus metas y tu día a día ({formatKipuMoney(a.trulyFree, base)}/mes). Cuida que no se apriete — puedes bajar un poco lo que guardas.
            </AllocationNote>
          );
        return (
          <div className="rounded-2xl border border-line/10 bg-[var(--tint-zinc)] p-3">
            <AllocationRecommendation a={a} base={base} />
          </div>
        );
      })()}
    </StepShell>
  );
}

// O3 — a soft alert for the day-to-day leftover: rose when over-allocated, amber when
// it's positive but tight (nears zero). Same shape on the reserves and goals steps.
function AllocationNote({ tone, children }: { tone: "over" | "tight"; children: React.ReactNode }) {
  const c =
    tone === "over"
      ? "border-rose-500/30 bg-rose-950/20 text-rose-100/90"
      : "border-amber-500/40 bg-amber-950/25 text-amber-100/90";
  return <div className={`rounded-2xl border p-3 text-xs leading-5 ${c}`}>{children}</div>;
}

// Gentle, non-pushy savings suggestion. When nothing is saved yet and there's room,
// suggest a simple ~20%; otherwise affirm what's left is healthy.
function AllocationRecommendation({ a, base }: { a: NonNullable<ReturnType<typeof computeAllocationView>>; base: CurrencyCode }) {
  if (a.monthlyDisposable <= 0) return null;
  const target = Math.round((a.monthlyDisposable * 0.2) / 5) * 5; // ~20%, rounded to 5
  if (a.totalAllocated === 0) {
    if (target <= 0) return null;
    return (
      <p className="mt-2 text-xs leading-5 text-emerald-100/80">
        Una idea: guardar ~{formatKipuMoney(target, base)} al mes (un 20%) ya te construye tu Reserva sin apretarte. Tú decides.
      </p>
    );
  }
  // Polish — when what's set aside is low vs what's free (< ~10%), nudge up toward 20%.
  if (a.totalAllocated < 0.1 * a.monthlyDisposable && target > a.totalAllocated) {
    return (
      <p className="mt-2 text-xs leading-5 text-emerald-100/80">
        Vas bien, pero es poco — si puedes, apunta a ~{formatKipuMoney(target, base)} al mes (un 20%). Aún te queda plata libre y tu Reserva crece más rápido.
      </p>
    );
  }
  return (
    <p className="mt-2 text-xs leading-5 text-emerald-100/70">
      Buen balance — guardas {formatKipuMoney(a.totalAllocated, base)} y te queda plata libre sana para tus metas y el día a día.
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
  allocation: ReturnType<typeof computeAllocationView> | null;
  capacity: ReturnType<typeof buildDraftCapacity> | null;
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
  // O3 — the day-to-day money left after savings + goals, and the pool it's carved
  // from, so we can warn amber BEFORE it goes negative (see leftoverTone).
  const leftForDaily = Math.round((poolForGoals - committed) * 100) / 100;
  const disposableForTone = rv ? rv.monthlyDisposable : 0;

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
        <span className="mt-2 block h-1 w-9 rounded-full bg-emerald-400" aria-hidden />
        <p className="mt-2.5 text-sm leading-6 text-zinc-400">Elige una meta y arma el plan aquí mismo: mueves la fecha y Kipu te dice cuánto apartar al mes — o fijas cuánto puedes y te dice cuándo llegas.</p>
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
              className={`rounded-full border px-3.5 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-30 ${organize ? "border-dashed border-line/20 text-zinc-400 hover:border-line/40 hover:text-zinc-200" : "border-line/15 text-zinc-200 hover:border-emerald-400/50 hover:text-emerald-100"}`}
            >
              {already ? "✓ " : "+ "}{g.label}
            </button>
          );
        })}
      </div>

      {props.state.goals.length === 0 && (
        <div className="kipu-lift rounded-2xl border border-line/10 bg-[var(--tint-zinc)] p-4">
          <p className="text-xs leading-5 text-zinc-500">
            ¿Quieres juntar para algo — una reserva, un viaje, salir de una deuda? Tócalo arriba y armamos el plan. Y si por ahora solo quieres entender tu mes, <span className="text-zinc-300">«Solo ordenar mi mes»</span> es suficiente.
          </p>
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
        <div key={g.id} className="relative kipu-lift rounded-2xl border border-line/10 bg-[var(--tint-zinc)] p-4">
          <button type="button" onClick={() => props.onRemoveGoal(g.id)} className="absolute right-3 top-3 text-xs text-zinc-500 transition hover:text-zinc-300">
            Quitar
          </button>
          <p className="text-sm font-semibold text-zinc-200">{g.name?.trim() || GOAL_DEFAULT_NAMES[g.archetype]}</p>
          <p className="mt-1 text-xs text-zinc-500">Listo — sin monto ni fecha. Kipu cuida tu Saldo y te ayuda a entender tu mes.</p>
        </div>
      ))}

      {/* O2.1 — the same "cómo se reparte" section as every step, closing the cascade:
         "Para gastar" now peels goals too. goalsAmountOverride = the plan the cards
         DISPLAY (seeded defaults included) so the number matches them before commit. */}
      <RepartoFooter capacity={props.capacity} allocation={props.allocation} base={base} stage="metas" goalsAmountOverride={committed} />
      {(() => {
        // O3 — over-allocated (rose) or tight/near-zero (amber). moneyGoals.length gate
        // keeps the warning off the "solo ordenar mi mes" path where nothing is committed.
        if (moneyGoals.length === 0) return null;
        const tone = leftoverTone(leftForDaily, disposableForTone);
        if (tone === "over")
          return (
            <AllocationNote tone="over">
              Tus metas juntas piden más de lo que te queda. Prueba alejar alguna fecha, bajar una meta, o guardar menos en el paso anterior.
            </AllocationNote>
          );
        if (tone === "tight")
          return (
            <AllocationNote tone="tight">
              Te queda poco para tu día a día ({formatKipuMoney(leftForDaily, base)}/mes). Tus metas están apretando el mes — prueba alejar una fecha o bajar una meta.
            </AllocationNote>
          );
        return null;
      })()}

      <div className="flex items-center gap-3 pt-2">
        <button type="button" onClick={props.onBack} className="rounded-2xl border border-line/10 px-5 py-3 text-sm font-semibold text-zinc-300 transition hover:border-line/25">
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
      <TextField label="Nombre de la meta" value={g.name} placeholder="Viaje, fondo de emergencia…" onChange={(v) => props.onChange({ name: v })} />
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
  // Goals keep a STATE border (emerald = plan is feasible, amber = needs a rate)
  // over a subtle EMERALD tint + accent — the same green as the "día a día"
  // capacity hero on this step, so page 9 reads as one colour.
  const shell = (tone: string, children: React.ReactNode) => (
    <div className={`kipu-lift relative flex flex-col gap-3 rounded-2xl border-[1.5px] ${tone} bg-[var(--tint-emerald)] p-4`}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="h-3.5 w-1 rounded-full bg-emerald-400" aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-wide text-emerald-300">{archetypeLabel}</span>
        </span>
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
      "border-line/10",
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
        <p className="text-xs text-emerald-200/90">¡Ya la tienes! Llevas {formatKipuMoney(currentRaw, goalCur)} de {formatKipuMoney(targetRaw, goalCur)}.</p>
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

      <div className="mt-1 border-t border-line/5 pt-3 text-center">
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
        <div className="h-2 w-full overflow-hidden rounded-full bg-line/10">
          <div className={`h-full ${tone.bar} transition-all`} style={{ width: `${barPct}%` }} />
        </div>
        <p className="mt-1 text-xs text-zinc-400">
          {availableForGoal > 0
            ? <>de {formatKipuMoney(availableForGoal, base)} libres para esta meta</>
            : "ahora mismo no te queda plata libre para esta meta"}
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
              ? "Todavía no me diste ningún ingreso, así que tu plata libre del mes es 0. Vuelve a «Ingresos» y con eso armamos el plan de verdad."
              : "No te queda plata libre para esta meta. Prueba guardar menos en ahorro o inversión (paso anterior), bajar la meta, o darle más tiempo a otra."}</p>
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
          Unos pasos cortos y Kipu ya sabrá cuánto puedes gastar tranquilo. Pon montos aproximados sin miedo — mientras más datos le des, mejor calcula, y todo se afina solo con el tiempo.
        </p>
      </div>

      <div className="flex flex-col gap-3 kipu-lift rounded-2xl border border-line/10 bg-[var(--tint-zinc)] p-4">
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
      <div className="flex flex-col gap-3 kipu-lift rounded-2xl border border-line/10 bg-[var(--tint-zinc)] p-4">
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
              className="mt-8 shrink-0 rounded-xl border border-line/10 px-3 py-2.5 text-xs font-semibold text-zinc-400 transition hover:border-rose-400/40 hover:text-rose-200"
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

      <div className="kipu-lift rounded-2xl border border-line/10 bg-[var(--tint-zinc)] p-4">
        <p className="text-sm font-semibold text-zinc-200">¿Prefieres una plantilla?</p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          Descarga la plantilla, llénala en Excel o Google Sheets y súbela. Kipu la revisa contigo antes de guardar nada.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a href="/onboarding/template" className="rounded-xl border border-line/15 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-emerald-400/40 hover:text-emerald-200">
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
  netWorth: DraftNetWorth;
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
  const { state, capacity, allocation, readiness, fxMissing } = props;
  const base = state.profile.baseCurrency;
  const fxBlocking = fxMissing.length > 0;
  const reviewAccounts = state.accounts.filter(accountReviewable);
  const reviewIncome = state.incomes.filter(incomeReviewable);
  const reviewExpenses = state.expenses.filter(expenseReviewable);
  const reviewDebts = state.debts.filter(debtReviewable);
  const reviewAssets = (state.assets ?? []).filter((x) => x.name.trim().length > 0 || parseMoney(x.value) !== undefined);
  const reviewGoals = state.goals.filter(goalReviewable);
  const monthlyDaily = allocation ? Math.max(0, allocation.trulyFree) : capacity ? capacity.monthlyDisposableBeforeAllocations : 0;
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

      {/* O2.1 — the review closes the flow with the SAME "cómo se reparte" Sankey as
         every step (merged Gastos, colored, hover-lift) + a written DESGLOSE so every
         number is legible. All monthly; the current Saldo lives on the dashboard. */}
      {capacity ? (
        <>
          <RepartoFooter capacity={capacity} allocation={allocation} base={base} stage="review" />
          <MonthDesglose capacity={capacity} allocation={allocation} daily={monthlyDaily} base={base} />
        </>
      ) : (
        <div className="kipu-lift rounded-2xl border border-line/10 bg-[var(--tint-zinc)] p-5 text-center text-sm text-zinc-400">
          Para ver cómo se reparte tu mes, agrega un ingreso en tu moneda principal ({base}).
        </div>
      )}

      {/* O11 — the second hoja: tu patrimonio (balance general), graphed. */}
      <PatrimonioFooter netWorth={props.netWorth} base={base} />

      <ReviewBlock title="Cuentas" tone="emerald" count={reviewAccounts.length} onEdit={() => props.onEdit("accounts")}
        lines={reviewAccounts.map((a) => {
          const bal = parseMoney(a.balance);
          // S31 (3.16) — mark protected savings + whether a note travels with the row.
          return `${a.name}${bal !== undefined ? ` · ${formatKipuMoney(bal, a.currency)}` : ""}${a.liquidity === "non_liquid" ? " · guardada (no cuenta para gastar)" : ""}${(a.note ?? "").trim() ? " · nota ✓" : ""}`;
        })} />
      <ReviewBlock title="Ingresos" tone="teal" count={reviewIncome.length} onEdit={() => props.onEdit("income")}
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
      <ReviewBlock title="Gastos con fecha" tone="sky" count={reviewExpenses.length} onEdit={() => props.onEdit("expenses")}
        lines={reviewExpenses.map((e) => `${e.name || "Gasto"} · ${formatKipuMoney(parseMoney(e.amount) ?? 0, e.currency)}`)} />
      {/* O2.1 — the two "gastos" tables sit together (con fecha + estimados), not
         split across Deudas/Activos, so the spending picture reads as one block. */}
      {(() => {
        const budgetLines = state.categoryBudgets
          .map((cb) => ({ cb, amount: parseMoney(cb.amount) }))
          .filter((x): x is { cb: WizardCategoryBudget; amount: number } => x.amount !== undefined && x.amount > 0)
          .map(({ cb, amount }) => {
            const label = habitualCategoryLabel(cb.category);
            const seed = parseMoney(cb.mtdSeed);
            // Item 2 — show each estimate in its own currency.
            const cur = (cb.currency || state.categoryBudgetCurrency || base) as CurrencyCode;
            const isObjective = cb.category === "food" || cb.category === "transport";
            return `${label} · ${isObjective ? `objetivo ${formatKipuMoney(amount, cur)}` : `~${formatKipuMoney(amount, cur)}`}/mes${seed !== undefined && seed > 0 ? ` · ya llevas ${formatKipuMoney(seed, cur)}` : ""}`;
          });
        return (
          <ReviewBlock title="Objetivos y gastos del mes" tone="amber" count={budgetLines.length} onEdit={() => props.onEdit("expenses")}
            lines={budgetLines}
            emptyLabel="Sin objetivos ni estimados — los esenciales Kipu los aprende de tus gastos reales; tu objetivo de comida lo pones tú cuando quieras." />
        );
      })()}
      <ReviewBlock title="Deudas" tone="rose" count={reviewDebts.length} onEdit={() => props.onEdit("debts")}
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
        emptyLabel={state.noDebts ? "Sin deudas" : undefined} />
      <ReviewBlock title="Activos" tone="violet" count={reviewAssets.length} onEdit={() => props.onEdit("assets")}
        lines={reviewAssets.map((a) => {
          const val = parseMoney(a.value);
          return `${a.name || "Activo"}${val !== undefined ? ` · ${formatKipuMoney(val, a.currency)}` : " · sin valor (no se guardará)"}`;
        })}
        emptyLabel="Sin activos (puedes agregarlos luego)." />
      {(() => {
        // O2.1 — reserves are cards now; show each in its own currency.
        const lines = state.reserves
          .map((r) => ({ r, amount: parseMoney(r.amount) }))
          .filter((x): x is { r: WizardReserve; amount: number } => x.amount !== undefined && x.amount > 0)
          .map(({ r, amount }) => {
            // Stage 38 — the amount is per-occurrence; label its cadence honestly.
            const cad = r.frequency === "weekly" ? "/sem" : r.frequency === "biweekly" ? "/quincena" : r.frequency === "yearly" ? "/año" : "/mes";
            return `${r.kind === "investment" ? "Inversión" : "Ahorro"} · ${formatKipuMoney(amount, r.currency)}${cad}`;
          });
        return (
          <ReviewBlock title="Ahorro e inversión" tone="teal" count={lines.length} onEdit={() => props.onEdit("reserves")}
            lines={lines}
            emptyLabel="Sin monto fijo — puedes definirlo cuando quieras." />
        );
      })()}
      <ReviewBlock title="Metas" tone="emerald" count={reviewGoals.length} onEdit={() => props.onEdit("goalplan")}
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
        <button type="button" onClick={props.onBack} className="rounded-2xl border border-line/10 px-5 py-3 text-sm font-semibold text-zinc-300 transition hover:border-line/25">
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

// O2.1 — each review block wears its SECTION color (not all gray) and reads at a
// comfortable size (the old text-xs was too compact/tiny per founder feedback).
function ReviewBlock(props: { title: string; count: number; lines: string[]; onEdit: () => void; emptyLabel?: string; tone?: SectionTone }) {
  const t = TONE[props.tone ?? "zinc"];
  return (
    <div className={`kipu-lift rounded-2xl p-4 ${t.card}`}>
      <div className="flex items-center justify-between">
        <p className={`text-sm font-bold ${t.title}`}>
          {props.title} <span className="font-semibold opacity-60">· {props.count}</span>
        </p>
        <button type="button" onClick={props.onEdit} className={`text-xs font-bold ${t.label} transition hover:opacity-75`}>
          Editar
        </button>
      </div>
      {props.lines.length > 0 ? (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {props.lines.slice(0, 6).map((l, i) => (
            <li key={i} className="truncate text-sm text-zinc-300">{l}</li>
          ))}
          {props.lines.length > 6 && <li className="text-sm text-zinc-500">y {props.lines.length - 6} más…</li>}
        </ul>
      ) : (
        <p className="mt-2.5 text-sm text-zinc-500">{props.emptyLabel ?? "Nada por ahora (puedes agregarlo luego)."}</p>
      )}
    </div>
  );
}
