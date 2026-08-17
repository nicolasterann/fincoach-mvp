import { createHash } from "crypto";
import { planWithdrawal } from "@/lib/financial/treasury";
import { readLatestClose, resolveMonthClose } from "@/lib/financial/objective-closes-store";
import { upsertBudgetObjective } from "@/lib/financial/objective-versions-store";
import { isObjectiveCategory } from "@/lib/financial/objectives";
import { planHypotheticalPurchase } from "@/lib/financial/hypothetical-purchase";
import {
  detectExplicitCurrency,
  inferFinancialCategory,
} from "@/lib/financial/basic-intent-parser";
import { makeDayKey } from "@/lib/financial/margen-kipu";
import { moneyReadPublishable } from "@/lib/financial/money-read";
import { insertIdempotentUserRow } from "@/lib/financial/idempotent-user-create";
import { readActiveInstallmentPlans, installmentProgress, deferredByCard } from "@/lib/financial/installment-plans-store";
import type OpenAI from "openai";
import { searchConversationArchive } from "@/lib/chat-memory/chat-messages";
import {
  applyChatTransactionIntent as applyChatTransactionIntentWriter,
  applyLedgerEntriesAtomic,
  applyLedgerEntry,
  buildLedgerEntryPayload,
  channelToInputChannel,
  correctTransactionByReplacement,
  correctTransactionMetadata,
  isOwnershipViolation,
  reconcileAccountBalance,
  reverseStoredTransaction,
  reverseStoredTransactionsAtomically,
  reverseAgentOperation,
  type LedgerEntryInput,
  applyRepaymentEntry,
  applyCardPaymentEntry,
  applyMultiSourceCardPayment,
  applyPersonLoanOut,
  applyDebtProceeds,
  applyFixedExpenseWithPayment,
  applyInstallmentPlanPurchase,
  applyFxTransfer,
  closeInstallmentPlanAtomically,
  closeDebtAccountAtomically,
  closeAccountAtomically,
  reopenAccountAtomically,
  reverseFxTransferByTransaction,
  type MultiSourceCardPaymentLeg,
  changeAccountCurrencyWith,
  changeBaseCurrencyWith,
  planCardPaymentStatement,
  planCashAccountForCurrency,
  type ApplyChatTransactionIntentInput,
} from "@/lib/ai/apply-chat-transaction-intent";
import {
  readRecentCompletedAgentOperations,
  searchCompletedAgentOperations,
} from "@/lib/ai/agent/agent-operation-store";
import {
  movementFingerprint,
  nextDedupeKey,
  reconcileOperationId,
} from "@/lib/ai/operation-identity";
import { planStatementDueDate, validCalendarDateISO } from "@/lib/financial/card-cycle";
import {
  correctionIdentityToken,
  correctivePhrasing,
  movementCorrectionTargets,
  recentExactDuplicate,
  recentNearDuplicate,
  refundOriginalTarget,
  refundOriginalWasNotRecorded,
  refundRegistrationDecision,
  type RecentMovementKey,
  type RefundRegistrationDecision,
} from "@/lib/capture/capture-matching";
import { planStatedAmount } from "@/lib/capture/stated-amount";
import { inferMultiSourceAllocations, planMultiSourcePayment } from "@/lib/capture/multi-source";
import {
  isConcreteLenderName,
} from "@/lib/capture/borrowed-funds";
import {
  planIncomeOccurrenceReply,
  statesIncomeArrivedToday,
} from "@/lib/capture/recurring-reply";
import { matchFixedExpense } from "@/lib/financial/fixed-expense-matcher";
import {
  explicitActionConfirmation,
  guardServerConfirmedActionWith,
} from "@/lib/ai/agent/agent-action-guard";
import {
  storedFactAuthoritiesForAction,
  type AgentValueProvenance,
} from "@/lib/ai/agent/agent-operation-authority";
import {
  monetaryClaimsFromToolArgs,
  statedAmounts,
  type NamedStoredMoneyFact,
} from "@/lib/capture/amount-evidence";
import type { AgentActionChallengeDeps } from "@/lib/ai/agent/agent-action-challenges";
import {
  openCardPaymentCaptureDraft,
  readOpenCardPaymentCaptureDraft,
  retractsMultiSource,
  type CardPaymentCaptureDraft,
} from "@/lib/capture/card-payment-draft";
import {
  resolveMovementCurrency,
  type CurrencyResolution,
} from "@/lib/financial/currency-resolver";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import type { AdvisorySnapshot } from "@/lib/ai/advisory-handler";
import {
  classifyAdvisoryItemKind,
  evaluateAdvisoryDecision,
} from "@/lib/financial/advisory-decision-engine";
import { saveAmbientPrefs, type AmbientPrefPatch } from "@/lib/ambient/ambient-store";
import type { CoachingBriefing } from "@/lib/financial/coaching-signals";
import { payoffInputsFromHealth, type CardHealth } from "@/lib/financial/debt-health";
import { decideApplyObligations } from "@/lib/financial/debt-statement";
import { planPayoff, type PayoffStrategy } from "@/lib/financial/debt-payoff";
import { compareDebtVsInvestment } from "@/lib/financial/debt-vs-investment";
import { comparePayments, costOfDelay, type RateKind } from "@/lib/financial/interest-math";
import { simulateScenario, type ScenarioSpec } from "@/lib/financial/cashflow-scenario";
import { merchantKey, merchantDedupeToken, type MerchantOverride } from "@/lib/financial/merchant-normalization";
import { saveMerchantCorrection, loadMerchantMemory } from "@/lib/financial/merchant-memory-store";
import { createGoalRow, updateGoalRow, updateGoalDefinition, registerInvestmentRow, setGoalPrefs, type CreateGoalArgs } from "@/lib/financial/goals-wealth-store";
import { setPersonalizationPref, setCommunicationPref, upsertLifeContext, removeLifeContext, resetPersonalization, logPreferenceEvent } from "@/lib/financial/personalization-store";
import { readHouseholdData, createHousehold, addNonUserParticipant, inviteMember, respondInvite, addSharedExpense, markReimbursementPaid, createSharedGoal, leaveHousehold, transferHouseholdOwnership, setHouseholdPrivacy, createInviteLink, acceptInviteByToken, createRecurringSharedExpense, readRecurringSharedExpenses, logRecurringSharedExpense, settleHousehold, settledCountFromRpcData, updateSharedExpense, cancelSharedExpense, removeMember, removeRecurringSharedExpense } from "@/lib/household/household-store";
import { computeSettlement } from "@/lib/household/settlement-engine";
import { buildHouseholdIntelligence, householdVisibilityExplainer } from "@/lib/household/household-intelligence";
import type { LoadedHousehold, LoadedSharedExpense, HouseholdType } from "@/lib/household/household-intelligence";
import type { SplitMethod, SplitParticipant } from "@/lib/household/split-engine";
import { getPersonalityQuestions, scorePersonalityTest, type TestAnswer } from "@/lib/personality/personality-test";
import { mapTestToPersonalization } from "@/lib/personality/personality-mapping";
import {
  savePersonalityResult,
  readPersonalityResult,
  deletePersonalityResult,
} from "@/lib/personality/personality-store";
import { readFxRates, upsertFxRate, loadLatestCachedRates, cacheProviderRate, setFxAutoRefresh, usableCurrentRates } from "@/lib/fx/fx-store";
import { resolveRate } from "@/lib/fx/fx-resolver";
import { convert as convertFx, rateToBase } from "@/lib/fx/fx-rates";
import type { FxRate } from "@/lib/fx/fx-rates";
import { frankfurterProvider } from "@/lib/fx/fx-provider-frankfurter";
import type { FinancialPhilosophy } from "@/types/financial";
import { evaluatePurchase, planMiniGoal } from "@/lib/financial/mini-goal";
import type { AssetClass } from "@/lib/financial/net-worth";
import type { AmbitionMode, GoalArchetype, GoalCadence } from "@/types/financial";
import { formatKipuMoney as formatMoney } from "@/lib/financial/money";
import {
  markWeekReconciled,
  setEngagementMode,
  setMargenCommitments,
} from "@/lib/financial/coach-state-store";
import {
  repaymentRegistrationDecision,
  readOpenReceivables,
  createFixedExpense,
  createScheduledPayment,
  readFixedExpenseCatalog,
  readSimilarFixedExpenses,
  getFixedExpenseCurrency,
  readUpcomingScheduledPayments,
  overrideDebtDue,
  setCardStatementDue,
  setEntityNote,
  setScheduledPaymentStatus,
  updateFixedExpenseFields,
  updateScheduledPaymentFields,
} from "@/lib/financial/commitments-store";
import {
  resolveOccurrence,
  matchOpenOccurrence,
  type ResolveAction,
  type ResolveInput,
} from "@/lib/financial/recurring-resolve";
import {
  createOccurrenceIfAbsent,
  readOccurrenceById,
  readFixedExpenseCycleOccurrences,
} from "@/lib/financial/recurring-occurrences-store";
import {
  earlyVariableFixedCycleVerdict,
  reportedOccurrenceDate,
  reportedOccurrenceIsPlausible,
} from "@/lib/financial/recurring-occurrence";
import {
  matchKnownVariableFixedBillCycle,
  readKnownVariableFixedBills,
  readVariableFixedForecasts,
  variableFixedForecastMatchesPlan,
} from "@/lib/financial/variable-fixed-store";
import {
  insertAssetRow,
  removeAssetRow,
  updateAssetRow,
} from "@/lib/financial/assets-store";
import { cardCyclePhaseFor, type CardCyclePhase } from "@/lib/financial/card-cycle";
import { cardNativeStatementExpected } from "@/lib/financial/card-statement-amount";
import {
  createIncomeSource,
  readIncomeSources,
  updateIncomeSourceFields,
  type IncomeFrequency,
  type IncomeSource as StoredIncomeSource,
} from "@/lib/financial/income-store";
import {
  cancelScheduledChange,
  createScheduledChange,
  readScheduledChanges,
  scheduledChangesForDecision,
  type ScheduledCadence,
  type ScheduledChange,
  type ScheduledChangeKind,
  type ScheduledPlanField,
  type ScheduledTargetType,
} from "@/lib/scheduled/scheduled-changes-store";
import {
  findDuplicateCandidates,
  findUndoTarget,
  isUndoEligible,
  readRecentTransactionsForCorrection,
  readTransactionById,
  type CompleteRecentTransactionsRead,
  type RecentTransactions,
  type StoredTransaction,
  type TransactionByIdRead,
} from "@/lib/financial/transaction-recovery";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { saveUserFeedback, type FeedbackKind } from "@/lib/feedback-store";
import type {
  Account,
  Asset,
  CurrencyCode,
  DebtAccount,
  FinancialCategory,
  FinancialGoal,
  FixedExpense,
  IncomeSource as FinancialIncomeSource,
  PaymentFrequency,
  UserContextNote,
} from "@/types/financial";
import type {
  DebtPaymentIntent,
  ExpenseIntent,
  GoalContributionIntent,
  IncomeIntent,
  RefundIntent,
  TransferIntent,
} from "@/types/transaction-intents";

type AgentChatTransactionIntentInput = Omit<
  ApplyChatTransactionIntentInput,
  "responseMode"
>;

// The primary agent has one response-authoring pass after all writes and a
// verified context refresh. The canonical applier is reused only as a writer:
// it must not call a second coach model whose output is then discarded.
function applyAgentChatTransactionIntent(
  input: AgentChatTransactionIntentInput,
) {
  return applyChatTransactionIntentWriter({
    ...input,
    responseMode: "receipt_only",
  });
}

// The safe, typed capability surface the Kipu agent can call. The LLM decides
// WHICH tool and WHAT args; these executors VALIDATE against real state and
// execute through the existing single writer (ledger) or domain store. The LLM
// never writes the DB directly and never issues raw SQL. A tool returns a
// structured result so the agent can ask a smart follow-up instead of guessing.

export interface AgentContext {
  userId: string;
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
  /** Complete income catalog from the same fail-closed financial snapshot.
   * Optional only for legacy fixtures; production always supplies it. */
  incomeSources?: FinancialIncomeSource[];
  /** Current complete fixed-expense catalog from the same financial-context
   * snapshot. It is optional only for old deterministic fixtures; production
   * always supplies it. A fixedExpenseId cannot be trusted when it is absent. */
  fixedExpenses?: FixedExpense[];
  // Stage 30 — the user's assets (from investment_accounts), surfaced so the
  // asset-CRUD + note tools resolve targets by name without re-querying. NEVER
  // spendable money: assets feed net worth only, never Saldo.
  // Optional so callers that build the context directly (gate/sims) still type.
  assets?: Asset[];
  // Punto 10 (re-auditoría) — false cuando la LECTURA de activos falló: las tools no
  // pueden afirmar "no tiene activos" ni ofrecer registrar de nuevo. No apaga el
  // Saldo (los activos son patrimonio, no tanque). Ausente ⇒ lectura sana (legacy).
  assetsAvailable?: boolean;
  /** Complete learned-memory catalog loaded by the financial-context builder.
   * The prompt deliberately shows only a bounded excerpt; the read-only
   * `search_learned_memory` tool searches this complete catalog when a relevant
   * fact may have been omitted. Undefined is an unproven legacy/test context,
   * never proof that the user has no saved memory. */
  userContextNotes?: UserContextNote[];
  userContextNotesAvailable?: boolean;
  // Household money and membership resolution must come from one COMPLETE
  // snapshot. The old display loader collapsed failure/truncation to an empty
  // array and let writers assert "no group" or settle against partial data.
  households?: LoadedHousehold[];
  householdsAvailable?: boolean;
  // Derived forward-cashflow/debt snapshot. The canonical Saldo lives in the
  // briefing below so read-only tools can reason about purchases deterministically.
  snapshot: AdvisorySnapshot;
  // Proactive coaching briefing (Saldo, signals and next-best-action), computed
  // once per turn so the agent can coach proactively and reconcile.
  briefing: CoachingBriefing;
  // Stage H — FALSE when the briefing could not be built (or a mid-turn refresh
  // failed), so `briefing` is either a neutral placeholder or STALE. Any figure
  // derived from the Saldo/margen family is then a lie: emptyBriefing quotes 0,
  // and a stale one quotes the state BEFORE the movement just written. Tools MUST
  // refuse instead of returning a number — a prompt rule alone would leave the
  // safety of the money figure up to the model ignoring its own tool's output.
  saldoAvailable?: boolean;
  /** False means the FX catalog could not be read. An empty `fxRates` with
   * this flag true means no matching rate is configured; those are different
   * conversational facts and must never produce the same question. */
  fxRatesReadOk?: boolean;
  // Bloque J — typed provenance for the immediately preceding recurring
  // notification. If that notification is what the user is answering but the
  // open-occurrence set cannot be proven complete, generic movement writers
  // must not guess and create a duplicate. Both values are server-derived.
  calendarOccurrencesAvailable?: boolean;
  calendarReplyExpected?: boolean;
  channel?: ChatChannel;
  chatId?: string | null;
  rawMessage: string;
  /** Immutable user-authored root requests from the exact durable operation
   * being continued. They can prove an entity the user already named, never a
   * new amount or an entity introduced by assistant prose. */
  entityAuthorityMessages?: string[];
  /** M0 — capabilities selected only after the model produced a validated
   * plan. When present, the executor refuses every tool outside that plan even
   * if a future orchestration bug accidentally exposes it. */
  plannedCapabilities?: Set<string>;
  durableOperationId?: string | null;
  /** Live server-issued lease for this exact durable operation worker. Domain
   * RPCs compare it under lock so a timed-out worker cannot write during a
   * later continuation's lease. */
  durableOperationLeaseToken?: string | null;
  /** True only after PostgreSQL authorized the exact operation-level manifest
   * for this plan version. Individual tools may verify state/provenance, but
   * must not reinterpret the user's confirmation or issue per-tool proposals. */
  operationManifestAuthorized?: boolean;
  loopDispatcherAuthorized?: boolean;
  /** Loop-only complete typed catalog facts used to subtract a named stored
   * amount from the generic multi-money trigger. Undefined preserves v44/on. */
  serverVerifiedDeclaredStoredFacts?: readonly NamedStoredMoneyFact[];
  operationManifestHash?: string | null;
  operationTransitionKind?: string | null;
  plannedActions?: Array<{
    id: string;
    capability: string;
    arguments: Record<string, unknown>;
    effects: Array<Record<string, unknown>>;
    provenance: AgentValueProvenance[];
    dependsOn: string[];
    consumed: boolean;
    outcome: "pending" | "succeeded" | "needs_input" | "failed";
  }>;
  activePlannedAction?: {
    id: string;
    capability: string;
    arguments: Record<string, unknown>;
    effects: Array<Record<string, unknown>>;
    provenance: AgentValueProvenance[];
  } | null;
  /** Present only while preflighting an atomic replacement group. It proves
   * that a corrective log_movement is paired with the append-only reversal of
   * the exact prior durable operation in the same database transaction. */
  atomicCorrectionTargetOperationId?: string | null;
  // The user's base/display currency, so card-obligation base conversion stays
  // honest when a card is in another currency.
  baseCurrency: CurrencyCode;
  timezone?: string;
  // The user's KNOWN fx rates (manual + cached), loaded once per turn, so a
  // cross-currency movement resolves with the rate the user already set instead
  // of asking again. Empty/absent → tools ask (never invent a rate).
  fxRates?: FxRate[];
  // Trusted evidence provenance for THIS run, set by the capture pipeline (never
  // by the model). Every movement written this turn is linked to it.
  evidenceId?: string | null;
  // Phase 3 — trusted, server-derived operation namespace for THIS turn, stable
  // across retries of the same delivery (Telegram update_id / web submission id /
  // evidence id). Drives deterministic per-movement dedupe keys so a redelivered
  // turn is idempotent at the ledger boundary. `dedupeOcc` counts identical
  // fingerprints within the turn; `reconcileSeq` numbers reconciliations.
  operationId?: string | null;
  // First-principles J closure: sensitive/destructive actions and any monetary
  // values absent from the current user delivery need a durable server-issued
  // challenge. Tests inject this seam; production uses the locked DB RPCs.
  challengeDeps?: AgentActionChallengeDeps;
  dedupeOcc?: Map<string, number>;
  reconcileSeq?: { n: number };
  // Within-turn freshness: write executors set `dirty` after a successful write
  // so every Saldo/margen-dependent tool refreshes the snapshot/briefing BEFORE
  // reasoning. `refresh` rebuilds live financial state in place. It is optional
  // for read-only gate/sim contexts, but a dirty context without a refresher is
  // deliberately fail-closed: a pre-write money figure is not publishable.
  dirty?: boolean;
  refresh?: () => Promise<void>;
}

/** One FX adapter for every agent writer. The financial-context snapshot owns
 * both the rates and their read verdict; individual tools may choose an
 * instrument, but may not silently drop the known-rate catalog or perform a
 * second, inconsistent read. */
export function resolveAgentMovementCurrency(
  ctx: Pick<AgentContext, "baseCurrency" | "fxRates">,
  input: {
    explicit?: string | null;
    instruments?: (string | null | undefined)[];
  },
) {
  return resolveMovementCurrency({
    ...input,
    primary: ctx.baseCurrency,
    knownRates: ctx.fxRates ?? [],
  });
}

export type ToolStatus = "done" | "redirect" | "needs_info" | "refused" | "error";

export interface ToolResult {
  status: ToolStatus;
  // A short FACTUAL summary for the agent to reason over (not the user reply).
  summary: string;
  data?: unknown;
  /** Observable effect of this call. `noop` is materially different from a
   * successful write: the orchestrator must not dirty state or narrate it as a
   * new action. Omitted keeps the legacy per-tool classification. */
  effect?: "read" | "wrote" | "noop";
  /** Internal executor ownership. Some database writers settle the current
   * operation step inside the same transaction as the domain write. The
   * orchestrator must not append a second receipt for those calls. This is a
   * runtime fact emitted by the writer, never a model-authored argument. */
  operationStepReceipt?: "writer";
}

/** Request-local authority produced only by a loop economic preflight. It is
 * bound to the already staged step and lets the dispatcher execute that exact
 * call after every economic call in the turn has been classified. It is never
 * model-authored or persisted. */
export interface LoopEconomicExecutionPermit {
  stepKey: string;
  capability: string;
  authorizedArgs: Record<string, unknown>;
  serverAuthorized: boolean;
}

export function guardUnavailableCalendarReplyWrite(
  ctx: Pick<AgentContext, "calendarReplyExpected" | "calendarOccurrencesAvailable">,
  options: { confirmedUnrelated?: boolean } = {},
): ToolResult | null {
  if (
    ctx.calendarReplyExpected === true &&
    ctx.calendarOccurrencesAvailable === false &&
    options.confirmedUnrelated !== true
  ) {
    return {
      status: "needs_info",
      summary:
        "No pude verificar el aviso del calendario al que parece responder este turno. NO registré ningún movimiento nuevo. Pregúntale si esto responde al aviso anterior o es un movimiento distinto; si confirma que es distinto, reintenta como movimiento nuevo.",
    };
  }
  return null;
}

export const FINANCIAL_CATEGORY_ENUM = [
  "food",
  "transport",
  "shopping",
  "subscriptions",
  "travel",
  "housing",
  "utilities",
  "health",
  "education",
  "entertainment",
  "family",
  "debt",
  "savings",
  "income",
  "other",
] as const satisfies readonly FinancialCategory[];

export const PURCHASE_CATEGORY_ENUM = FINANCIAL_CATEGORY_ENUM.filter(
  (value) => value !== "income",
);

const VALID_CATEGORIES = new Set<FinancialCategory>(
  FINANCIAL_CATEGORY_ENUM,
);
const VALID_PURCHASE_CATEGORIES = new Set<FinancialCategory>(
  PURCHASE_CATEGORY_ENUM,
);

const VALID_NOTE_TYPES = new Set([
  "general",
  "preference",
  "constraint",
  "goal_context",
  "risk_context",
  "behavior_pattern",
]);

// Tool schemas (OpenAI function-calling). Kept small for Stage 1; grows as the
// agent absorbs more of the legacy capability set.
export const KIPU_TOOL_SCHEMAS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_financial_context",
      description:
        "Re-read the user's current financial snapshot (balances, Saldo Kipu, forward cashflow, debts, goal, fixed expenses). Use when you need fresh numbers before answering or acting.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "log_movement",
      description:
        "Record a real financial movement the user already made. expense lowers an account OR raises a card debt (card = debt, never available money). income raises an account. debt_payment lowers an account and lowers a debt. goal_contribution lowers an account and raises a goal. NEVER use it to CORRECT something already recorded (\"no era con Pichincha, era Supervielle\", \"no eran 200, eran 250\", \"eso no era comida\") — that is correct_movement; logging it again charges the same money twice. NEVER use it for a purchase paid in cuotas/installments (that is create_installment_plan — logging it here would drain the Saldo for the full total), NOR for a statement row that is the monthly cuota of an ACTIVE plan listed in the briefing (e.g. \"TELE 3/12\" — it already lives inside the card debt). Source rule: if the user NAMED an account/card, pass it; if they did NOT and no stored preference exists, you MAY call with the instrument OMITTED as long as the currency is stated — the tool auto-assigns the single ordinary account in that currency (or the stored currency default) and will tell you, or it returns the exact clarification to ask. Only ask yourself when the amount itself is unclear.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["expense", "income", "debt_payment", "goal_contribution"],
          },
          amount: { type: "number" },
          description: { type: "string", description: "Short human label in Spanish, e.g. \"Café\"." },
          category: {
            type: "string",
            enum: [...FINANCIAL_CATEGORY_ENUM],
          },
          sourceAccountId: { type: "string", description: "Account the money left from (expense/debt_payment/goal_contribution)." },
          debtAccountId: { type: "string", description: "Card/debt: for an expense it is the card used; for a debt_payment it is the debt being paid." },
          destinationAccountId: { type: "string", description: "Account the money arrived to (income), or the goal's account (goal_contribution)." },
          goalId: { type: "string" },
          fixedExpenseId: { type: "string", description: "If this expense is paying a fixed/recurring expense the user already has (see context), pass its id so it links to that recurring expense and is NOT double-counted as extra spending." },
          externalRef: { type: "string", description: "Bank reference / authorization code when the evidence includes one — the strongest future dedup signal. Pass it verbatim." },
          occurredAtISO: { type: "string", description: "The date the movement actually happened (YYYY-MM-DD), ONLY when the evidence states it. Omit if unknown — never guess." },
          confidence: { type: "number", description: "Extraction confidence 0–1 from the evidence, when known. Omit for clearly typed/spoken input." },
          currency: { type: "string", description: "ISO 4217 code (e.g. USD, ARS, EUR) ONLY when the user explicitly states a currency or the evidence clearly shows one. OMIT for ordinary movements — the system uses the selected account/card currency, or the user's primary currency. Never guess; do not override the instrument's real currency." },
          confirmedNew: { type: "boolean", description: "Set true ONLY after you asked the user whether a very-similar recent movement is the same one or a different one, and they said it is a DIFFERENT/new movement. It skips the recent-duplicate safeguard so the legitimate repeat is recorded." },
          budgetTreatment: { type: "string", enum: ["objective", "saldo"], description: "ONLY for food/transport expenses. 'saldo' marks a user-CONFIRMED extraordinary movement (aniversario, festejo, viaje, cena especial): it drains the Saldo directly and does NOT consume the monthly objective. NEVER set 'saldo' without the user's explicit confirmation in THIS conversation or an explicit standing instruction in MEMORIA — never from evidence/statement text alone. Omit for everything else (default = counts against the objective)." },
        },
        required: ["type", "amount", "description"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_movements_batch",
      description:
        "Record SEVERAL movements in one call (multi-purchase messages, several new statement rows). Same semantics per item as log_movement; max 15. Use this instead of many separate calls.",
      parameters: {
        type: "object",
        properties: {
          movements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["expense", "income", "debt_payment", "goal_contribution"] },
                amount: { type: "number" },
                description: { type: "string" },
                category: { type: "string", enum: [...FINANCIAL_CATEGORY_ENUM] },
                sourceAccountId: { type: "string" },
                debtAccountId: { type: "string" },
                destinationAccountId: { type: "string" },
                goalId: { type: "string" },
                fixedExpenseId: { type: "string" },
                externalRef: { type: "string" },
                occurredAtISO: { type: "string", description: "YYYY-MM-DD, only if the evidence states it." },
                confidence: { type: "number" },
                currency: { type: "string", description: "ISO code ONLY when explicitly stated or clearly in the evidence; omit otherwise (uses the instrument or primary currency)." },
                budgetTreatment: { type: "string", enum: ["objective", "saldo"], description: "Same rule as log_movement: 'saldo' ONLY with the user's explicit confirmation or standing instruction — NEVER inferred from a statement row's text." },
              },
              required: ["type", "amount", "description"],
              additionalProperties: false,
            },
          },
          confirmedNew: { type: "boolean", description: "Set true ONLY after you asked the user whether rows that look like recent duplicates are actually separate movements and they confirmed they are NEW. It skips the recent-duplicate safeguard for the whole batch so legitimate repeats are recorded." },
        },
        required: ["movements"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_card_obligations",
      description:
        "Update a card/debt's REAL terms: minimum payment, TOTAL payment due this period (the key Saldo input), statement balance (total owed), due day, cutoff day, and/or annual interest rate. Use it from a statement OR from chat (\"esta tarjeta cierra el 6 y vence el 21\", \"la tasa es 15.6%\"). Pass ONLY the fields the evidence/user gave. If this comes from a statement, ALWAYS pass statementDate (the statement's emission date): Kipu refuses to overwrite newer obligations with an OLDER statement, and tells the user it kept the current ones. This keeps Saldo Kipu and debt protection honest.",
      parameters: {
        type: "object",
        properties: {
          debtAccountId: { type: "string" },
          minimumPayment: { type: "number" },
          totalDueThisMonth: { type: "number" },
          statementBalance: { type: "number", description: "Total accumulated balance owed on the card." },
          dueDay: { type: "number" },
          cutoffDay: { type: "number" },
          interestRate: { type: "number", description: "Annual interest rate in percent (e.g. 15.6). Never invent it; only pass it if the statement or user gave it." },
          interestRateKind: { type: "string", enum: ["annual_nominal", "annual_effective", "monthly"], description: "How to read interestRate. Default annual_nominal." },
          statementDate: { type: "string", description: "Statement emission date YYYY-MM-DD. REQUIRED when the data comes from a statement, so an older statement can't overwrite newer obligations." },
          statementPeriodEnd: { type: "string", description: "Statement period end date YYYY-MM-DD, if shown." },
          calendarOccurrenceId: { type: "string", description: "If this answers a card_statement row from FLUJOS DEL CALENDARIO, pass that occurrenceId. The atomic statement writer closes that exact pending ask together with the card update." },
          statementDueDate: { type: "string", description: "The due DATE printed on THIS statement (YYYY-MM-DD), when the user states it (\"tengo que pagar hasta el 23\"). Different from dueDay, which is the card's RECURRING rule: a bank moving one cycle for a holiday does NOT change the rule. Pass the date; never rewrite dueDay from a single statement." },
        },
        required: ["debtAccountId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_debt_health",
      description:
        "Read-only. Returns the deterministic CARD/DEBT HEALTH of the user: per-card state (due soon/today, overdue, needs-payment-confirmation, high-interest, revolving, stale statement), totals, debt pressure, highest-interest card, and the single next action. Use it to answer \"¿cómo van mis tarjetas/deudas?\", \"¿qué tarjeta está en riesgo?\", or before advising on debt. Interest figures are estimates; payment-status flags are cautious (ASK, don't assert).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_debt_payoff",
      description:
        "Read-only. Builds a cashflow-aware debt PAYOFF plan (always pays minimums first, steers extra to one focus debt). Use for \"hazme un plan para salir de deuda\", \"¿qué tarjeta pago primero?\", \"¿conviene abonar 100 extra?\". All months/interest are estimates.",
      parameters: {
        type: "object",
        properties: {
          strategy: { type: "string", enum: ["avalanche", "snowball", "urgency_first", "hybrid"], description: "avalanche=tasa más alta primero; snowball=saldo más chico primero; urgency_first=vencidos/por vencer primero; hybrid=default." },
          extraMonthly: { type: "number", description: "Extra monthly amount the user can put toward debt, if they said one." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_debt_vs_investment",
      description:
        "Read-only PERSONAL-FINANCE guidance (NOT investment advice) comparing paying a debt (guaranteed saving = its rate) vs investing (uncertain return), protecting reserves. Use for \"¿pago deuda o invierto?\". Needs the debt's rate; if missing, it will say so. Never advises skipping a minimum to invest.",
      parameters: {
        type: "object",
        properties: {
          debtAccountId: { type: "string", description: "Which debt; default = highest-interest debt with balance." },
          expectedReturnPct: { type: "number", description: "Expected annual investment return %, if the user gave one." },
          cashAvailable: { type: "number", description: "Cash the user is considering using." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "estimate_card_interest",
      description:
        "Read-only. Estimates the interest cost of a card under FULL vs MINIMUM vs a PARTIAL payment, and the cost of delaying. Use for \"¿pago mínimo o total?\", \"¿cuánto interés me cuesta?\", \"¿cuánto me cuesta esperar una semana?\". Requires the card's rate; if missing, asks for it instead of inventing. All figures are estimates.",
      parameters: {
        type: "object",
        properties: {
          debtAccountId: { type: "string", description: "Which card; default = a card with balance." },
          partialAmount: { type: "number", description: "A partial payment the user is weighing, if any." },
          delayDays: { type: "number", description: "Days the user is considering waiting before paying, if any." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cashflow_outlook",
      description:
        "Read-only. Forward-looking CASHFLOW projection: how much spending the calendar can support today/this week, whether the user reaches the next income without running short, the next risk, and confidence. This projection is NOT the current Saldo Kipu; if both are cited, label them separately. Use for \"¿cuánto puedo gastar hoy/esta semana/hasta mi sueldo?\", \"¿llego a fin de mes?\", \"¿qué cuido esta semana?\". Answer SIMPLE: current Saldo, projection, one thing to watch.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "simulate_scenario",
      description:
        "Read-only what-if on the cashflow. Use for \"¿puedo comprar esto?\", \"¿qué pasa si gasto 80 hoy?\", \"¿y si me pagan antes/después?\", \"¿y si agrego un gasto fijo?\", \"quiero proteger mi fondo de emergencia\". Returns how today's/this-week's safe spend, runway and end-of-month change, with an honest verdict (recommended / possible but tight / not recommended). All estimates.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["spend_today", "income_earlier", "income_later", "add_monthly_expense", "change_goal_contribution", "protect_reserve"], description: "spend_today=comprar/pagar algo hoy; income_earlier/later=ingreso antes/después; add_monthly_expense=nuevo gasto fijo; change_goal_contribution=cambiar aporte; protect_reserve=apartar una reserva." },
          amount: { type: "number", description: "Para spend_today: monto que gastaría hoy." },
          days: { type: "number", description: "Para income_earlier/later: cuántos días." },
          monthlyAmount: { type: "number", description: "Para add_monthly_expense: monto mensual." },
          weeklyDelta: { type: "number", description: "Para change_goal_contribution: cambio por semana (+ aporta más)." },
          reserveAmount: { type: "number", description: "Para protect_reserve: reserva a mantener." },
          label: { type: "string", description: "Nombre natural del escenario, ej. \"comprar audífonos\"." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_cashflow",
      description:
        "Read-only. Builds a SHORT practical money plan (3–5 steps) from the cashflow: what to spend, what's coming, what to watch. Use for \"organízame la semana\", \"hazme un plan hasta mi sueldo\", \"cómo salgo de la semana sin tocar mis ahorros\", \"qué hago hoy con mi plata\". Supports pessimistic/optimistic tone.",
      parameters: {
        type: "object",
        properties: {
          horizon: { type: "string", enum: ["week", "until_income"], description: "Alcance del plan." },
          tone: { type: "string", enum: ["neutral", "pessimistic", "optimistic"], description: "Tono pedido por el usuario." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "where_did_money_go",
      description:
        "Read-only. Explains WHERE the user's money goes — top spending categories by real impact (per month/week) plus detected recurring/subscription burden — from learned baselines, NOT raw transactions. Use for \"¿en qué se me va la plata?\", \"¿en qué gasto más?\", \"¿por qué se me acaba el dinero?\". Transfers, card payments, refunds and income are NOT spending. Answer simple (the 2–3 things that matter); honest about confidence with little data.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "why_margin_changed",
      description:
        "Read-only. Explains which spending categories changed versus the user's learned normal. It does NOT reconstruct exact Saldo history, so never claim these drivers are the exact reason the Saldo moved. Use for \"¿qué cambió en mis gastos?\", \"¿qué me está dejando sin plata?\". Name the driver(s), not a wall of numbers.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "spending_anomalies",
      description:
        "Read-only. Surfaces graded, non-noisy anomalies in recent spending: a possible duplicate charge, a charge well above the user's normal, a large one-off that dents the week. Use for \"¿algo raro en mis gastos?\", \"¿me cobraron de más?\", \"¿hay algún cobro extraño?\". NEVER overreact to a single normal purchase; if nothing stands out, say so calmly.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "my_subscriptions",
      description:
        "Read-only. Lists detected recurring charges / subscriptions (merchant, amount, cadence, next charge estimate) and which are NOT yet modeled as fixed expenses. Use for \"¿qué suscripciones tengo?\", \"¿en qué pagos recurrentes se me va?\", \"¿qué me cobran cada mes?\". To CONVERT one into a fixed expense, ASK the user first, then use create_fixed_expense — never auto-create from a weak pattern.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "budget_suggestion",
      description:
        "Read-only. The dynamic, non-shaming budget view: which FEW categories are above the user's learned normal THIS week and the single practical adjustment to get back on track, tied to safe spend. Use for \"¿cómo voy con mis gastos?\", \"¿me estoy pasando?\", \"¿en qué me cuido esta semana?\". Frame as control, never as failing a budget. No 30-category lecture.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_cut",
      description:
        "Read-only. Recommends the single most useful, smallest move to free up room (e.g. \"con bajar ~$18 en delivery vuelves a tu ritmo\") from the behavioral-insight synthesis. Use for \"¿dónde recorto?\", \"ayúdame a ahorrar esta semana\", \"¿qué hago para que me alcance?\". One concrete nudge, zero judgment; never suggest skipping a minimum debt/card payment.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "learn_spending_correction",
      description:
        "Persist a GENERALIZABLE spending correction so Kipu stops repeating it on FUTURE transactions — e.g. \"eso no es comida, es transporte\", \"PAYU*XYZ siempre es mi gym\", \"ese cargo es Uber\". Writes to structured merchant memory keyed by the merchant text, so every future matching charge is categorized right. Use this IN ADDITION to correct_movement when the user is teaching a rule (not just fixing one row). Don't invent a rule the user didn't state.",
      parameters: {
        type: "object",
        properties: {
          merchantText: { type: "string", description: "The merchant text/descriptor the rule is about, as it appears or as the user names it, e.g. \"PAYU*XYZ\", \"Uber\", \"ese cargo de la farmacia\"." },
          category: { type: "string", enum: [...FINANCIAL_CATEGORY_ENUM], description: "The correct category, when the user stated/implied it." },
          merchantFamily: { type: "string", description: "Readable merchant name to show, e.g. \"Uber\", \"Mi gimnasio\". Optional." },
          isRecurring: { type: "boolean", description: "True if the user says it's a recurring/subscription charge." },
          note: { type: "string", description: "Short provenance note, e.g. \"el usuario lo aclaró el 17/06\". Optional." },
        },
        required: ["merchantText"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "evaluate_purchase_as_goal",
      description:
        "Read-only. The IMPULSE-SAFE purchase check. For \"quiero comprar X\", \"¿puedo comprarlo hoy?\", \"¿de contado o lo ahorro?\": first compares the purchase with the CURRENT Saldo Kipu and warns any protected-layer crossing, then evaluates forward cashflow and can propose a MINI-GOAL (weekly set-aside + realistic date). Saldo and cashflow projection are different facts; never call the projection Saldo. Always offer both options when safe. If the price is unknown, ask for it in one line.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Estimated price of the item. If unknown, omit and the tool will tell you to ask." },
          currency: { type: "string", description: "ISO currency of the stated price. Omit only when the price was not given." },
          onCard: { type: "boolean", description: "True if the user would put it on a credit card." },
          label: { type: "string", description: "What it is, e.g. \"AirPods\", for natural phrasing." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_goal",
      description:
        "Create a goal (or wealth/emergency/investment goal). Use for \"quiero viajar a Brasil\", \"quiero ahorrar para mi mamá\", \"quiero una laptop en 3 meses\", \"quiero un fondo de emergencia\". Ask for the amount if missing; the date is optional (flexible goals are fine). Set isPrimary only if the user says it's their main goal. A committed cadence+contribution will RESERVE money in their plan — only set it when the user agrees to a contribution.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          targetAmount: { type: "number" },
          targetDate: { type: "string", description: "ISO date YYYY-MM-DD if the user gave one; omit for a flexible goal." },
          archetype: { type: "string", enum: ["savings", "travel", "purchase", "emergency", "debt_payoff", "investment", "wealth", "family", "lifestyle", "custom"] },
          isPrimary: { type: "boolean" },
          cadence: { type: "string", enum: ["weekly", "biweekly", "monthly"], description: "Only if the user commits to a recurring contribution." },
          contributionAmount: { type: "number", description: "Committed amount per cadence (reserves money). Only with an agreed contribution." },
          currency: { type: "string", description: "ISO code only if stated; omit for the user's primary currency." },
        },
        required: ["name", "targetAmount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_mini_goal",
      description:
        "Create a MINI-GOAL for an impulse-safe purchase the user accepted (after evaluate_purchase_as_goal). Reserves a small weekly amount from the joy budget so they buy it without touching card payments, the main goal or the reserve. If weeklyContribution is omitted, Kipu computes a cashflow-safe amount. Link to a parent goal only if it's a sub-target.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "What they're saving for, e.g. \"AirPods\"." },
          price: { type: "number" },
          weeklyContribution: { type: "number", description: "Weekly set-aside. Omit to let Kipu pick a safe amount." },
          parentGoalId: { type: "string" },
          currency: { type: "string", description: "ISO currency of the stated price; omit only when it is the user's base currency." },
        },
        required: ["name", "price"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "prioritize_goals",
      description:
        "Read-only. For \"ordena mis metas\", \"¿qué meta priorizo?\", \"¿cómo reparto entre deuda, metas e inversión?\", \"tengo muchas metas\". Returns the priority order, how the free surplus would be split (reserve → extra debt → goals → joy, human-realistic — never 100% to debt), conflicts (too many goals, deadline impossible, a mini-goal slowing the main one) and the practical next move. Answer simple: which 1–2 to focus, what to pause/extend.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "update_goal",
      description:
        "Update a goal: pause/resume/cancel, change its target amount, currency (only before any money/history and together with a new target), target date or committed contribution, make it primary, or mark it flexible. Use list/context to resolve which goal; if ambiguous, ask. Never relabel accumulated goal money into another currency.",
      parameters: {
        type: "object",
        properties: {
          goalId: { type: "string" },
          status: { type: "string", enum: ["active", "paused", "cancelled"], description: "cancelled = soft delete (stops counting, drops from plan). Requires confirm=true." },
          targetDate: { type: "string", description: "New ISO date YYYY-MM-DD." },
          targetAmount: { type: "number", description: "New positive target in the goal currency." },
          currency: { type: "string", description: "New ISO currency. Allowed only before any money/history and requires targetAmount in the same call." },
          contributionAmount: { type: "number" },
          cadence: { type: "string", enum: ["weekly", "biweekly", "monthly"] },
          makePrimary: { type: "boolean" },
          flexibleDeadline: { type: "boolean" },
          confirm: { type: "boolean", description: "Required true for status='cancelled', ONLY after the user explicitly confirmed. Never set it on the first call." },
        },
        required: ["goalId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "register_investment",
      description:
        "Register an investment/asset the user already has so it counts in net worth and (with a rate) in projections. Use for \"tengo una póliza de 5000 al 5% anual\", \"tengo acciones/ETFs por X\", \"tengo un terreno/carro\", \"me deben un préstamo con interés\". NEVER invent a value, price or return — use only what the user states; if no return is given, it counts for net worth but no growth is projected. NEVER recommend a specific security.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          assetClass: { type: "string", enum: ["cash", "investment", "fixed_term", "crypto", "property", "vehicle", "business", "receivable", "other"] },
          value: { type: "number", description: "Current value the user states (base currency)." },
          expectedReturnPct: { type: "number", description: "Annual % the user states (e.g. 5). Omit if unknown — no fabricated return." },
          returnKind: { type: "string", enum: ["annual_nominal", "annual_effective", "monthly"] },
          liquid: { type: "boolean" },
          currency: { type: "string" },
        },
        required: ["name", "assetClass", "value"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "net_worth",
      description:
        "Read-only. For \"¿cuál es mi patrimonio?\", \"¿cómo voy con mi meta de 500k?\", \"¿cuánto tengo invertido?\". Returns net worth (assets − debts, liquid vs total), investment value + projection, and wealth-target progress + required monthly. Everything ESTIMATED and labeled; never claims real-time market values or a connected broker unless verified.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "set_wealth_target",
      description:
        "Set a long-term net-worth goal. Use for \"quiero llegar a 500k de patrimonio\". Returns current progress + an estimated required monthly. Projections are estimates and depend on a return the user provides.",
      parameters: {
        type: "object",
        properties: { amount: { type: "number" } },
        required: ["amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_ambition_mode",
      description:
        "Set how aggressively Kipu pushes goals vs preserving everyday joy: light_touch (mostly enjoy, gentle goals), steady (balanced, default), power_builder (push goals/debt hard, tighter joy). Use when the user says \"quiero ir paso a paso\" / \"quiero atacar fuerte mis metas\" / \"no quiero dejar de vivir\". Affects the allocation split only, never the safety guardrails.",
      parameters: {
        type: "object",
        properties: { mode: { type: "string", enum: ["light_touch", "steady", "power_builder"] } },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_financial_philosophy",
      description:
        "Set the user's LIFE PHILOSOPHY toward money (the core personalization lever). Use when they reveal it: \"prefiero disfrutar mi plata / vivir experiencias / no me obsesiona ahorrar\" → experiences; \"quiero construir patrimonio / ser disciplinado\" → wealth; \"quiero lograr metas concretas\" → builder; \"equilibrio entre disfrutar y ahorrar\" → balanced. This changes how Kipu FRAMES advice and the joy-vs-goals posture — it NEVER changes the money math, minimums or cashflow. Don't label the user; just set what they expressed.",
      parameters: {
        type: "object",
        properties: { philosophy: { type: "string", enum: ["experiences", "balanced", "builder", "wealth"] } },
        required: ["philosophy"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_personalization_profile",
      description:
        "Read-only. Returns how Kipu is currently adapting to this user (life philosophy, tone, detail level, orientation, risk posture, usage style, nudge sensitivity, confidence) and whether each trait is explicit or inferred. Use for \"¿cómo me tienes configurado?\", or before changing a preference. Speak it simply, no internal labels.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "set_communication_preference",
      description:
        "Set the user's preferred TONE and/or default DETAIL level. Use for \"háblame más directo / más suave / más motivador / más al grano\", \"respuestas cortas\" (detail short), \"explícame con más detalle\" (detail detailed). Tone/detail change how Kipu speaks and how much it expands WHEN ASKED — they never make routine confirmations long.",
      parameters: {
        type: "object",
        properties: {
          tone: { type: "string", enum: ["calm", "direct", "motivating", "analytical", "gentle", "playful", "coach"] },
          detail: { type: "string", enum: ["short", "balanced", "detailed"] },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_risk_preference",
      description:
        "Set the user's risk posture: conservative (more cushion, prudent framing), moderate, or aggressive (tolerates more ambitious plans). Use for \"soy conservador / prefiero ir seguro\" or \"soy agresivo / tolero más riesgo\". Affects framing/reserve emphasis only; never changes money math or recommends specific securities.",
      parameters: {
        type: "object",
        properties: { risk: { type: "string", enum: ["conservative", "moderate", "aggressive"] } },
        required: ["risk"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_onboarding_mode",
      description:
        "Set whether the user wants a SIMPLE (minimal, fast, more automation) or POWER (detailed setup, more control, deeper surfaces) experience. Use for \"hazlo simple / no quiero complicarme\" → simple; \"quiero el control / dame todo el detalle\" → power. Even in power mode, default answers stay short.",
      parameters: {
        type: "object",
        properties: { mode: { type: "string", enum: ["simple", "power"] } },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_nudge_sensitivity",
      description:
        "Set how many proactive reminders the user wants: low (more reminders OK), normal, high (only the truly important; fewer). Use for \"mándame menos recordatorios\" → high, \"recuérdame más seguido\" → low. Always respects quiet hours and the daily cap.",
      parameters: {
        type: "object",
        properties: { sensitivity: { type: "string", enum: ["low", "normal", "high"] } },
        required: ["sensitivity"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_life_context",
      description:
        "Record a NON-SENSITIVE, user-stated life context that affects money advice — e.g. \"soy estudiante\", \"trabajo freelance / ingreso irregular\", \"mantengo a mi familia\", \"viajo mucho\", \"tengo sueldo fijo\", \"estoy emprendiendo\". Only store what the user explicitly says; NEVER infer sensitive attributes. Use it to make advice more relevant, not to label them.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", description: "short slug, e.g. student, freelancer, salaried, parent, supporting_family, traveler, entrepreneur, irregular_income" },
          label: { type: "string", description: "short human label as the user said it" },
        },
        required: ["kind", "label"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget_life_context",
      description:
        "Retract a life context the user declared before and no longer wants Kipu to consider (\"ya no soy estudiante\", \"olvida que viajo\", \"ya no mantengo a nadie\"). Pass the same kind slug it was stored with. Removes only that declared item; financial data and goals are untouched.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", description: "the kind slug to forget, e.g. student, freelancer, traveler, supporting_family" },
        },
        required: ["kind"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_personalization",
      description:
        "Read-only. Explains WHY Kipu adapted — why a tone, why a dashboard surface, why a nudge was sent or skipped, why an answer was short. Use for \"¿por qué me hablas así?\", \"¿por qué cambió mi dashboard?\", \"¿por qué me preguntas esto?\". Answer honestly from the user's own preferences/usage, simply, never creepy, and remind them they can change it.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "personalization_feedback",
      description:
        "Record explicit feedback about Kipu's behavior so it learns: a nudge was annoying/useful, a recommendation too strict/too soft, the dashboard too busy/too sparse. Use for \"ese recordatorio fue molesto\", \"me gustó ese aviso\", \"me estás restringiendo mucho\", \"quiero que me exijas más\". Explicit feedback overrides inferred behavior; apply the obvious preference change too when clear.",
      parameters: {
        type: "object",
        properties: {
          aspect: { type: "string", enum: ["nudge", "strictness", "detail", "dashboard", "tone"] },
          sentiment: { type: "string", enum: ["too_much", "too_little", "good", "annoying", "useful"] },
          note: { type: "string", description: "short non-sensitive note in the user's words" },
        },
        required: ["aspect", "sentiment"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reset_personalization_preference",
      description:
        "Reset Kipu's personalization back to neutral defaults (clears philosophy/UX preferences; keeps financial facts). Use for \"olvida cómo me tienes configurado\", \"vuelve a lo normal\", \"resetea mis preferencias\". Confirm briefly; financial data and goals are untouched.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  // ── Stage 19 — Household / shared finance (permission-aware; never exposes a
  //    member's private personal data; shared expenses counted once; reimbursements
  //    are NOT income; neutral, no blame). ──────────────────────────────────────
  {
    type: "function",
    function: {
      name: "create_household",
      description:
        "Create a shared-finance group. Use for \"crea un hogar/grupo con mi novia\", \"un grupo para el viaje\", \"compartir gastos con mis roomies\". type: couple|family|roommates|trip|custom. The creator becomes owner. Add other people with add_household_participant (non-Kipu people like 'mi mamá') or invite_household_member (Kipu users).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ["couple", "family", "roommates", "trip", "custom"] },
          baseCurrency: { type: "string", description: "3-letter ISO code; omit only to use the user's proven base currency." },
        },
        required: ["name", "type"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_household_participant",
      description:
        "Add a NON-Kipu-user participant to a household/group (\"mi mamá\", \"un amigo del viaje\"). They can be in splits and owe/be owed, but Kipu never messages them. Use the person's name. For someone who HAS Kipu, use invite_household_member instead.",
      parameters: {
        type: "object",
        properties: { householdName: { type: "string", description: "which group, if the user has more than one" }, displayName: { type: "string" } },
        required: ["displayName"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "invite_household_member",
      description:
        "Invite a Kipu user to a household (only owner/admin). They are NOT in until they accept. Never auto-add anyone. Use a label or, if known, their user id.",
      parameters: {
        type: "object",
        properties: { householdName: { type: "string" }, label: { type: "string", description: "who you're inviting (name)" }, role: { type: "string", enum: ["member", "viewer", "contributor"] } },
        required: ["label"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "respond_household_invite",
      description: "Accept or decline a pending household invitation addressed to the user. Use for \"acepto la invitación\", \"no, gracias\".",
      parameters: {
        type: "object",
        properties: { inviteId: { type: "string" }, accept: { type: "boolean" }, displayName: { type: "string", description: "how the user wants to appear in the group" } },
        required: ["inviteId", "accept"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_shared_expense",
      description:
        "Record a SHARED expense and split it. Use for \"pagué el súper de la casa, divídelo con mi novia\", \"este viaje lo pagamos entre cuatro\", \"yo pago 60 y ella 40\", \"fue mi invitación\". The payer's OWN personal expense (the real money they paid) is logged separately with log_movement — this only records the SHARED truth (who owes whom). Counted ONCE. method: equal|percentage|fixed|income_weighted|custom|payer_absorbs ('mi invitación'). participants are names in the group ('me'/'yo' = the user). For percentage give percent; fixed/custom give amount; income_weighted give weight (income).",
      parameters: {
        type: "object",
        properties: {
          householdName: { type: "string" },
          description: { type: "string" },
          total: { type: "number", description: "total amount actually paid" },
          currency: { type: "string" },
          category: { type: "string", enum: [...PURCHASE_CATEGORY_ENUM] },
          payer: { type: "string", description: "who paid ('me'/'yo' or a participant name)" },
          method: { type: "string", enum: ["equal", "percentage", "fixed", "income_weighted", "custom", "payer_absorbs"] },
          participants: {
            type: "array",
            items: { type: "object", properties: { name: { type: "string" }, percent: { type: "number" }, amount: { type: "number" }, weight: { type: "number" } }, required: ["name"], additionalProperties: false },
          },
        },
        required: ["description", "total", "currency", "payer", "method", "participants"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "household_summary",
      description:
        "Read-only. Who owes whom in a group, the simplest way to settle, shared spend this month, pending reimbursements and shared-goal progress. Use for \"¿quién le debe a quién?\", \"¿cuánto me debe Emi?\", \"cerramos cuentas del viaje\", \"¿cómo vamos en el hogar?\". Neutral, no blame, never exposes anyone's private personal finances.",
      parameters: { type: "object", properties: { householdName: { type: "string" } }, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_reimbursement_paid",
      description:
        "Record that one member paid another back (settles part/all of a balance). Use for \"Nico ya me pagó su parte\", \"le devolví a Ana lo del viaje\". A reimbursement is NOT new income and NOT a new expense category — it settles the shared balance. from/to are names ('me'/'yo' = the user).",
      parameters: {
        type: "object",
        properties: { householdName: { type: "string" }, from: { type: "string", description: "who paid the reimbursement" }, to: { type: "string", description: "who received it" }, amount: { type: "number" }, currency: { type: "string", description: "ISO currency of the stated reimbursement amount." }, status: { type: "string", enum: ["paid", "pending"] } },
        required: ["from", "to", "amount", "currency"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_shared_goal",
      description:
        "Create a goal that belongs to a household (shared trip, rent deposit, wedding, household appliance). Use for \"crea una meta compartida para Brasil\". Each member is responsible only for their OWN committed contribution (never auto-assigned). Optionally set the user's own weekly contribution.",
      parameters: {
        type: "object",
        properties: { householdName: { type: "string" }, name: { type: "string" }, target: { type: "number" }, currency: { type: "string" }, myWeekly: { type: "number", description: "the user's own committed weekly contribution" } },
        required: ["name", "target", "currency"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "leave_household",
      description: "The user leaves a household/group. Use for \"salir del grupo\", \"ya no quiero estar en el hogar\". Their shared history stays for settlement; they stop being an active member. The current owner must first use transfer_household_ownership so the group is never orphaned.",
      parameters: { type: "object", properties: { householdName: { type: "string" } }, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "transfer_household_ownership",
      description:
        "Transfer household ownership to another ACTIVE Kipu user in the same group. Use before the current owner leaves, or when they explicitly ask to make another member the owner. This changes group authority: first call proposes the exact successor; after explicit confirmation re-call with confirm=true. An external participant without a Kipu user cannot own the group.",
      parameters: {
        type: "object",
        properties: {
          householdName: { type: "string" },
          successorName: {
            type: "string",
            description: "display name of the exact active member who will become owner",
          },
          confirm: {
            type: "boolean",
            description: "true only after the user confirmed this exact successor",
          },
        },
        required: ["successorName"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_household_visibility",
      description: "Set how much the household shares by default (only owner/admin): minimal (only the shared expense), standard, or full. Default is minimal. Use for \"no quiero que se vea de más\". Never exposes private personal data regardless.",
      parameters: { type: "object", properties: { householdName: { type: "string" }, privacy: { type: "string", enum: ["minimal", "standard", "full"] } }, required: ["privacy"], additionalProperties: false },
    },
  },
  // ── Stage 20 PASS 2 — household completion for beta ──────────────────────────
  {
    type: "function",
    function: {
      name: "household_invite_link",
      description:
        "Create a shareable invite LINK/CODE for a household (owner/admin only) so the user can send it however they want (WhatsApp, etc.) — there is no email delivery. Use for \"mándame el link para invitar a mi novia\", \"genérame un código para el grupo\". The person joins by opening the link; only then do they enter. Returns a link and a code.",
      parameters: { type: "object", properties: { householdName: { type: "string" }, label: { type: "string", description: "who it's for (name, optional)" }, role: { type: "string", enum: ["member", "viewer", "contributor"] } }, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "accept_household_invite",
      description:
        "Accept a household invite the user received as a CODE/LINK. Use for \"me invitaron al hogar, el código es ...\", \"acepto, aquí está el link ...\". Pass the code (the token from the link). Only the intended user can accept; expired/invalid codes are refused gently.",
      parameters: { type: "object", properties: { code: { type: "string", description: "the invite code/token (last part of the link)" }, displayName: { type: "string" } }, required: ["code"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "add_recurring_shared_expense",
      description:
        "Set up a RECURRING shared bill (rent, utilities, internet, a shared subscription, family support, a trip installment). Use for \"la renta son 800 cada mes, la dividimos\", \"el internet 40 mensual entre los roomies\", \"le mando 100 a mi mamá cada mes\". This is a SCHEDULE/reminder only — the real money is logged each cycle with log_recurring_shared_expense (so it's never double-counted). cadence: weekly|biweekly|monthly|annual. anchorDay: day-of-month (1-28) for monthly, weekday (0=Sun..6=Sat) for weekly. payer is who pays ('me'/'yo' or a name). For family support use method payer_absorbs.",
      parameters: {
        type: "object",
        properties: {
          householdName: { type: "string" },
          description: { type: "string" },
          amount: { type: "number" },
          currency: { type: "string" },
          payer: { type: "string", description: "who pays ('me'/'yo' or a participant)" },
          method: { type: "string", enum: ["equal", "percentage", "fixed", "income_weighted", "custom", "payer_absorbs"] },
          cadence: { type: "string", enum: ["weekly", "biweekly", "monthly", "annual"] },
          anchorDay: { type: "number", description: "day-of-month 1-28 (monthly/annual) or weekday 0-6 (weekly/biweekly)" },
        },
        required: ["description", "amount", "currency", "payer", "method", "cadence"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_recurring_shared_expense",
      description:
        "Log THIS cycle of a recurring shared bill as the real shared expense (e.g. \"ya pagué la renta de este mes\"). Splits it across the group per the template. This is the only money event; the recurring entry is just the schedule. Match by the bill's description.",
      parameters: { type: "object", properties: { householdName: { type: "string" }, description: { type: "string", description: "which recurring bill (e.g. 'renta')" } }, required: ["description"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "settle_household",
      description:
        "Close out / settle a household's shared accounts — record the simplest set of reimbursements as paid so balances reset to zero (owner/admin). Use for \"cerramos el viaje\", \"ya quedamos a mano\", \"cuadramos todo\". Optionally archive the group (e.g. a finished trip). Reimbursements are NOT income.",
      parameters: { type: "object", properties: { householdName: { type: "string" }, archive: { type: "boolean", description: "true to archive the group after settling (e.g. a finished trip)" } }, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "household_visibility_explainer",
      description:
        "Read-only. Explain in plain words WHAT a household can and cannot see (privacy boundary). Use for \"¿qué pueden ver los demás?\", \"¿ven mis cuentas?\". Always reassure that personal accounts/Saldo/debt are never shared.",
      parameters: { type: "object", properties: { householdName: { type: "string" } }, additionalProperties: false },
    },
  },
  // ── Stage 24 — household CONTROL tools (edit/cancel/remove/share/unshare).
  //    Destructive ops require confirm=true, set ONLY after the user explicitly
  //    said yes (same convention as confirmedNew in log_movement).
  {
    type: "function",
    function: {
      name: "edit_shared_expense",
      description:
        "Edit an existing shared expense of a household: fix the amount (\"ese gasto compartido no era 40, era 30\") and/or the description (\"cámbiale la descripción\"). Resolves the expense by a fragment of its description (or exact expenseId if you already listed it). Amount edits only work on EQUAL splits with nobody else's payment recorded — the tool refuses honestly otherwise. If the match was fuzzy and money changes, ask the user first and re-call with confirm=true.",
      parameters: {
        type: "object",
        properties: {
          householdName: { type: "string", description: "which group, if the user has more than one" },
          expense: { type: "string", description: "fragment of the shared expense's description (e.g. 'súper', 'cena')" },
          expenseId: { type: "string", description: "exact id when a previous call listed candidates" },
          newAmount: { type: "number", description: "the corrected total, in the group's currency" },
          newDescription: { type: "string" },
          confirm: { type: "boolean", description: "Set true ONLY after the user confirmed the matched expense is the right one." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_shared_expense",
      description:
        "Cancel/remove a shared expense from a household (\"borra ese gasto compartido\", \"cancela la cena del grupo\"). Append-only: it stops counting in who-owes-whom but stays in the group history. DESTRUCTIVE: ALWAYS ask the user first and re-call with confirm=true; never cancel on a guess.",
      parameters: {
        type: "object",
        properties: {
          householdName: { type: "string" },
          expense: { type: "string", description: "fragment of the shared expense's description" },
          expenseId: { type: "string", description: "exact id when a previous call listed candidates" },
          confirm: { type: "boolean", description: "Set true ONLY after the user explicitly confirmed the cancellation." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_household_member",
      description:
        "Remove a person from a household (\"saca a Juan del hogar\"). Only the owner/admin can. Their already-recorded shared expenses stay in the group's history; they just stop being an active member. DESTRUCTIVE and social: ALWAYS confirm with the user first, then re-call with confirm=true. If the user wants to leave the group themselves, use leave_household instead.",
      parameters: {
        type: "object",
        properties: {
          householdName: { type: "string" },
          name: { type: "string", description: "who to remove (display name)" },
          confirm: { type: "boolean", description: "Set true ONLY after the user explicitly confirmed the removal." },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_recurring_shared_expense",
      description:
        "Stop a recurring shared bill (\"ya no compartimos el arriendo\", \"quita el gasto recurrente de internet\"). Deactivates the schedule going forward; the cycles already logged stay untouched. Confirm with the user first, then re-call with confirm=true.",
      parameters: {
        type: "object",
        properties: {
          householdName: { type: "string" },
          description: { type: "string", description: "which recurring bill (e.g. 'arriendo')" },
          confirm: { type: "boolean", description: "Set true ONLY after the user explicitly confirmed." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "share_movement",
      description:
        "Turn one of the user's RECENT personal expenses into a shared household expense (\"ese gasto era compartido con Mile\", \"el súper de ayer era del hogar\"). Finds the personal movement (last ~30 days), links it, and registers the shared expense split EQUALLY among the group's active members with the user as payer. The personal movement is NOT touched (their Saldo already reflects it); this only records who owes whom, once. Refuses if that movement is already shared. If the user has no household yet, offer to create one first (create_household).",
      parameters: {
        type: "object",
        properties: {
          householdName: { type: "string" },
          hint: { type: "string", description: "fragment of the personal movement's description (e.g. 'súper', 'cena de ayer')" },
          transactionId: { type: "string", description: "exact movement id (from list_recent_movements or a previous candidates list)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "unshare_movement",
      description:
        "Undo sharing: a personal movement that was marked as shared no longer is (\"al final ese gasto no era compartido\"). Cancels ONLY the linked shared expense (append-only, stops counting in who-owes-whom); the personal movement stays untouched. Confirm with the user first, then re-call with confirm=true.",
      parameters: {
        type: "object",
        properties: {
          householdName: { type: "string" },
          hint: { type: "string", description: "fragment of the shared expense/movement description" },
          transactionId: { type: "string", description: "the personal movement's id, when known" },
          confirm: { type: "boolean", description: "Set true ONLY after the user explicitly confirmed." },
        },
        additionalProperties: false,
      },
    },
  },
  // ── Stage 20 — Personality / life-philosophy test (optional, fun, honest; the
  //    result feeds Stage 18 personalization — real behavior, not a decorative label;
  //    never diagnoses/labels creepily; explicit later prefs still win). ──────────
  {
    type: "function",
    function: {
      name: "get_personality_test",
      description:
        "Read-only. Returns Kipu's lightweight lifestyle/personality test (a few situational questions) so you can ASK them conversationally, one or two at a time. Use when the user accepts taking the test (\"sí, hagamos el test\", \"quiero que me conozcas mejor\") or asks for it. Present it as a fun way for Kipu to adapt — never as a diagnosis. The user can skip anytime.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_personality_test",
      description:
        "Submit the user's answers to the personality test (after asking them). Scores them, sets the user's archetype, and adapts Kipu (life philosophy, risk posture, detail level, reminder style) — real product behavior. Pass the answers you collected as {questionId, optionId} pairs (the ids from get_personality_test). Partial answers are OK (lower confidence). Tell the user their archetype warmly and that they can change anything anytime.",
      parameters: {
        type: "object",
        properties: {
          answers: {
            type: "array",
            items: { type: "object", properties: { questionId: { type: "string" }, optionId: { type: "string" } }, required: ["questionId", "optionId"], additionalProperties: false },
          },
        },
        required: ["answers"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "personality_test_result",
      description: "Read-only. Returns the user's saved personality archetype + how confident it is, or that they haven't taken it. Use for \"¿qué tipo soy?\", \"¿cómo me ves?\". Say it warm and human, no internal labels/numbers.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "reset_personality_test",
      description: "Forget the user's saved personality-test result. Use for \"olvida el test\", \"borra eso\". Their current preferences stay as they are (they can reset those separately); this only removes the saved test record.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  // ── Stage 20 — FX / multicurrency (Kipu NEVER invents a rate: it uses a rate the
  //    user confirmed/cached, or asks). ──────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "set_exchange_rate",
      description:
        "Save an exchange rate the user tells you, so Kipu can convert their multi-currency money without guessing. Use for \"el dólar está a 4000 pesos\", \"1 USD = 38 UYU\". from/to are 3-letter codes; rate = how many `to` per 1 `from` (e.g. from=USD,to=COP,rate=4000). Never invent a rate — only save what the user states. By default the row is PINNED (the provider never overwrites it), but current-money valuation accepts it for at most 4 calendar days; after that Kipu asks for a fresh rate instead of treating it as eternal. autoRefresh: set true ONLY when the user explicitly asks Kipu to keep the rate updated automatically from the live market (\"mantén el dólar al día solo\", \"actualízalo tú\") — today only USD↔ARS auto-updates (Argentine blue/market rate, daily); pass the current rate too. Omit it for a normal rate statement.",
      parameters: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" }, rate: { type: "number" }, autoRefresh: { type: "boolean" } },
        required: ["from", "to", "rate"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "convert_currency",
      description:
        "Convert an amount between currencies using a rate the user already gave Kipu. Read-only. If Kipu has no rate for that pair, it returns that it needs the rate — then ASK the user for it (and save it with set_exchange_rate). Never invent a rate.",
      parameters: {
        type: "object",
        properties: { amount: { type: "number" }, from: { type: "string" }, to: { type: "string" } },
        required: ["amount", "from", "to"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_card",
      description:
        "Register a NEW card/debt that isn't in the context yet — e.g. the user uploads a statement for a card they never added. Use ONLY after the user confirms they want to add it (never auto-create, never apply a statement to a different existing card). Returns the new card's id so you can immediately update its obligations and import its movements in the same turn.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Card/debt name as the user calls it, e.g. \"Mastercard Pichincha\"." },
          kind: { type: "string", enum: ["credit_card", "loan", "family_debt", "other_debt"], description: "Default credit_card for a card." },
          currency: { type: "string", description: "ISO code ONLY if the user states it or the statement shows it; omit to use the user's primary currency. Never guess." },
          currentBalance: { type: "number", description: "Current debt owed if known (e.g. statement balance). Omit if unknown." },
          minimumPayment: { type: "number" },
          totalDueThisMonth: { type: "number" },
          dueDay: { type: "number" },
          cutoffDay: { type: "number" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_account",
      description:
        "Register a NEW account/payment method the user names but isn't in the context yet — e.g. the source account of a statement payment they want to add from chat. Use ONLY after the user confirms. Returns the new account id so you can use it as a source in the same turn. Not for cards/debts (use create_card).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Account name as the user calls it, e.g. \"Cuenta Pichincha\"." },
          kind: { type: "string", enum: ["bank", "cash", "wallet"], description: "Default bank." },
          currency: { type: "string", description: "ISO code ONLY if stated; omit to use the user's primary currency." },
          currentBalance: { type: "number", description: "Current balance if known; omit if unknown (starts at 0)." },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "transfer_between_accounts",
      description:
        "Move money between the user's OWN accounts. Not spending, not income. For same-currency accounts, amount is the amount moved. For DIFFERENT currencies (e.g. buy USD with ARS), amount is what LEFT the source and receivedAmount is the exact native amount that ARRIVED at the destination; both must come from the user. The executor commits both legs atomically.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number" },
          receivedAmount: {
            type: "number",
            description:
              "Required only when account currencies differ: exact amount that arrived in the destination account, in its native currency.",
          },
          sourceAccountId: { type: "string" },
          destinationAccountId: { type: "string" },
          description: { type: "string" },
        },
        required: ["amount", "sourceAccountId", "destinationAccountId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_reserve_withdrawal",
      description:
        "READ-ONLY Tesorería planner: el usuario quiere JUNTAR un monto en una cuenta destino (p.ej. sacar de la Reserva para un pago grande) y necesita saber QUÉ movimientos hacer entre sus cuentas. Devuelve dónde vive su plata libre, cuánto ya está en el destino, los movimientos exactos (respetando el piso operativo de cada cuenta) y qué capa cruza. NO mueve dinero.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Monto objetivo a reunir en la cuenta destino (moneda base)." },
          destinationAccountId: { type: "string", description: "Cuenta donde el usuario necesita la plata." },
        },
        required: ["amount", "destinationAccountId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_open_receivables",
      description:
        "Read-only complete catalog of money other people currently owe the user. Use it before planning inflowKind=loan_repayment so the plan names the exact receivableIds, currency, counterparty and outstanding amounts. A failed/incomplete read never proves that no loan exists.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_learned_memory",
      description:
        "Read-only search over the user's complete active learned-memory catalog (preferences, constraints, aliases, people, corrections and behavior patterns). Use it when the financial-context excerpt says memoryOmitted > 0 or a relevant standing fact may be outside the prompt. A failed or top-limited read never proves absence.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Natural-language concepts/entities to find in learned memory, e.g. 'Pichincha cuenta habitual' or 'aniversarios Saldo'.",
          },
          limit: { type: "number", description: "1–50; defaults to 20." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_conversation_history",
      description:
        "Read-only cross-channel search/page over the user's durable Kipu conversation history. Use it when the relevant answer, correction, amount, decision or explanation may be older than the context currently shown. Search by concepts, by an ISO date interval, or both; this lets you answer 'what did I tell you that day?' without guessing the old wording. Never infer absence when the result says complete=false or the read fails.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Optional Spanish web-search query containing the relevant entities/concepts, not instructions or SQL. May be omitted when before/after bounds identify the period.",
          },
          before: { type: "string", description: "Optional ISO timestamp upper bound." },
          after: { type: "string", description: "Optional ISO timestamp lower bound." },
          limit: { type: "number", description: "1–80; defaults to 30." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recent_movements",
      description:
        "List the user's recent movements with their id, description, amount, the account/card name they came from, type, and whether they're already reversed. ALWAYS call this to resolve ambiguity before undoing/correcting a specific movement — it gives you the ids and the source names so you can present concrete options and then act by id. Never re-ask the same vague question; list and pick.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recent_agent_operations",
      description:
        "Read-only searchable audit of COMPLETED Kipu operations, including every planned step, its verified result and affected transaction refs. Use this before explaining what Kipu just registered, where each amount came from, or correcting/undoing a multi-step instruction (for example, 'que acabas de registrar' or 'lo que te dije hace meses estaba mal'). Conversation prose proves what was said, not what landed. Search by concepts/entities, ISO date interval, or both; omitting all filters returns the newest operations. Never reconstruct an operation from timestamp proximity and never infer absence when complete=false.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Optional concepts/entities from the user's original instruction, e.g. 'Diners Produbanco'.",
          },
          before: { type: "string", description: "Optional ISO completion timestamp upper bound." },
          after: { type: "string", description: "Optional ISO completion timestamp lower bound." },
          limit: { type: "number", description: "1–20 matching operations; defaults to 12." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "undo_agent_operation",
      description:
        "Undo every reversible financial write from ONE completed durable Kipu operation as an append-only atomic correction. First call list_recent_agent_operations and use its exact operation id. If any write lacks a reversible receipt, nothing is undone. This is for a whole prior instruction, not one movement.",
      parameters: {
        type: "object",
        properties: {
          targetOperationId: { type: "string" },
        },
        required: ["targetOperationId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "undo_movement",
      description:
        "Reverse ONE movement (append-only, idempotent, balance restored). Prefer passing the exact transactionId from list_recent_movements. A free-text hint is allowed but may be ambiguous; if it is, call list_recent_movements and undo by id instead. With neither, the single most recent eligible movement is undone.",
      parameters: {
        type: "object",
        properties: {
          transactionId: { type: "string" },
          hint: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "undo_recent_movements",
      description:
        "Reverse the last N eligible movements in one safe batch (for 'borra los últimos dos', 'deshaz los 3 últimos'). Idempotent; skips already-reversed. Use this for count-based multi-undo instead of undoing one by one.",
      parameters: {
        type: "object",
        properties: { count: { type: "number" } },
        required: ["count"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "correct_movement",
      description:
        "Correct one movement by id. Amount/source/date changes reverse the old effect and apply the corrected one safely; category/description changes only update metadata (no balance change). Get the id from list_recent_movements.",
      parameters: {
        type: "object",
        properties: {
          transactionId: { type: "string" },
          newAmount: { type: "number" },
          newSourceAccountId: { type: "string" },
          newDebtAccountId: { type: "string" },
          newOccurredAtISO: { type: "string", description: "Corrected calendar date in YYYY-MM-DD. Omit unless the user explicitly corrected the date." },
          newCategory: { type: "string", enum: [...FINANCIAL_CATEGORY_ENUM] },
          newDescription: { type: "string" },
          newBudgetTreatment: { type: "string", enum: ["objective", "saldo"], description: "Flip a food/transport movement between the monthly objective (default) and extraordinary-from-Saldo. 'saldo' = the user says it should come out of their Saldo directly (no objective consumed); 'objective' = put it back into the objective. No balance change." },
        },
        required: ["transactionId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_duplicate",
      description:
        "Remove a duplicate movement (something logged twice — sent twice, Telegram delay). Reverses only the MORE RECENT copy and keeps one; never both. Pass transactionId for the exact copy to remove, or leave empty to let Kipu find the obvious duplicate pair. If several possible pairs exist, this returns them so you can confirm which.",
      parameters: {
        type: "object",
        properties: { transactionId: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_person_payment",
      description:
        "Money to/from ANOTHER person (not an internal transfer). direction 'out': the user sent money to someone — records an expense from the chosen account/card (or a loan if isLoan, which also opens a receivable). direction 'in': choose by ECONOMIC EFFECT from the validated plan, never by a keyword: 'income' (salary/gift), 'refund' (reimbursement for a purchase), 'loan_repayment' (cash up + an EXISTING receivable down), 'capital_return_unrecorded' (cash up, original loan by the user was never in Kipu; not income and creates no receivable), or 'borrowed' (cash up + the USER'S existing liability up). For borrowed money pass the concrete lender and existing non-card debtAccountId. For a refund, the executor derives the original purchase and ignores model guesses. Requires amount and the user's account; ask if missing.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["out", "in"] },
          amount: { type: "number" },
          occurredAtISO: { type: "string", description: "YYYY-MM-DD when the money actually moved, only when the evidence states it. Omit to use the user's proven current local day; never invent a date." },
          person: { type: "string" },
          reason: { type: "string" },
          category: { type: "string", enum: [...FINANCIAL_CATEGORY_ENUM] },
          accountId: { type: "string", description: "The user's OWN account the money left from (out) or arrived to (in)." },
          debtAccountId: { type: "string", description: "Card used for an outgoing person payment, or the existing non-card liability that grows when inflowKind=borrowed." },
          isLoan: { type: "boolean" },
          inflowKind: { type: "string", enum: ["income", "refund", "loan_repayment", "capital_return_unrecorded", "borrowed"] },
          budgetTreatment: { type: "string", enum: ["objective", "saldo"], description: "Advisory hint only. The refund executor never trusts this value: it inherits the ORIGINAL purchase's persisted treatment." },
          originalTransactionId: { type: "string", description: "For a refund, the exact expense id returned in record_person_payment.refundCandidates (or by list_recent_movements) when automatic matching was ambiguous or partial. Never invent an id." },
          receivableIds: {
            type: "array",
            items: { type: "string" },
            description: "For loan_repayment, the exact open receivable id(s) returned by list_open_receivables. Required by the validated plan; never infer or invent ids.",
          },
          originalWasNotRecorded: { type: "boolean", description: "True only after the user explicitly says the original purchase was never registered in Kipu. The executor also verifies that statement in the current message." },
        },
        required: ["direction", "amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_fixed_expense",
      description:
        "Create a new recurring/fixed expense (gym, rent, subscription, utility). isVariable=true for a bill whose amount changes each cycle (luz/gas); amount is only its declared planning baseline. Does NOT log a payment today unless payNow=true. If payNow is true, the variable observation is created by the ledger writer in the same transaction.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "number" },
          currency: {
            type: "string",
            description:
              "ISO 4217 code ONLY when the user explicitly states the plan amount in that currency. Omit otherwise; the source account currency (or base currency when no source exists) is used. Never guess.",
          },
          frequency: { type: "string", enum: ["weekly", "biweekly", "monthly", "yearly"] },
          category: { type: "string", enum: [...PURCHASE_CATEGORY_ENUM] },
          isVariable: { type: "boolean" },
          startDate: { type: "string" },
          sourceAccountId: { type: "string" },
          payNow: { type: "boolean" },
        },
        required: ["name", "amount", "frequency"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_proactive_briefing",
      description:
        "Read the user's full proactive state: current Saldo Kipu and refill, explicitly labeled forward cashflow, what to watch (cards due, upcoming payments, money owed to them, goal risk), how long since they last logged anything, and one next-best-action. Use it for '¿cómo voy?', '¿qué debo cuidar?', 'ayúdame a cuadrar la semana', when the user comes back after a gap, or to lead proactively. READ-ONLY.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "evaluate_purchase",
      description:
        "READ-ONLY 'can I afford / should I buy X?' check for a HYPOTHETICAL purchase the user has NOT made. Returns the Saldo BEFORE and AFTER that spend plus a recommendation. Use this for any affordability/should-I question; answer from the AFTER state, never by repeating the current Saldo. ALWAYS pass `category` — for food/transport the tool applies the user's monthly objective (inside the objective it takes 0 from the Saldo; if the purchase itself crosses, only the part past the objective comes out). Does NOT record anything.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number" },
          currency: {
            type: "string",
            description: "ISO currency of the stated amount. REQUIRED: a hypothetical ARS price must be converted to the user's base currency before it is compared with Saldo.",
          },
          onCard: { type: "boolean", description: "true if it would go on a credit card." },
          itemDescription: { type: "string" },
          category: {
            type: "string",
            enum: [...PURCHASE_CATEGORY_ENUM],
            description: "The category the purchase would be logged as. REQUIRED and TYPED: on food/transport the monthly objective — not the raw amount — decides what leaves the Saldo, so a missing or free-text value (\"comida\") would silently fall back to charging the full price. Use \"other\" only when it genuinely fits none.",
          },
        },
        required: ["amount", "currency", "category", "onCard"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_fixed_expense",
      description:
        "Permanently change an existing fixed-expense PLAN going forward. It never records a monthly variable bill: use resolve_recurring_occurrence observe/confirm/correct for that. For a variable expense amount, amountScope='from_now' is mandatory and triggers an explicit server-side confirmation before changing the learning regime. action pause/resume/delete changes the plan; newName/dueDay/currency/isVariable/notes edit its definition. payNow is retained only for truly fixed expenses; a variable bill must use the calendar writer so observation, payment and forecast stay atomic.",
      parameters: {
        type: "object",
        properties: {
          fixedExpenseId: { type: "string" },
          newAmount: { type: "number" },
          amountScope: { type: "string", enum: ["from_now"], description: "Required when changing the declared amount of a variable fixed expense. Means the user explicitly says this is permanent, not just this month's bill." },
          startDate: { type: "string", description: "YYYY-MM-DD if the change/expense starts in the future." },
          action: { type: "string", enum: ["pause", "resume", "delete"], description: "pause = stop counting it now (cancelled subscription); resume = reactivate; delete = remove it (soft delete, stops counting immediately)." },
          newName: { type: "string", description: "New name, when the user renames it." },
          dueDay: { type: "number", description: "Day of month (1-31) it is charged, when the user states it." },
          currency: { type: "string", description: "ISO 4217 code ONLY if the user explicitly changes the expense's currency (always ask the new amount too)." },
          isVariable: { type: "boolean", description: "true if the amount changes month to month (luz, gas, agua); false if truly fixed (arriendo). Only set it when the user tells you." },
          notes: { type: "string", description: "Attach/replace a memory note about this expense; empty string clears it." },
          payNow: { type: "boolean" },
          sourceAccountId: { type: "string" },
          confirm: { type: "boolean", description: "Required true for action='delete', ONLY after the user explicitly confirmed. Never set it on the first call." },
        },
        required: ["fixedExpenseId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_payment",
      description:
        "Remember a FUTURE payment the user has NOT made yet (a reminder / future cost). No money moves today. dueDate is YYYY-MM-DD; set recurring=true if it repeats monthly. Ask for date/amount if missing.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "number" },
          dueDate: { type: "string" },
          recurring: { type: "boolean" },
          category: { type: "string", enum: [...PURCHASE_CATEGORY_ENUM] },
        },
        required: ["name", "dueDate"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_account_liquidity",
      description:
        "Mark one of the user's accounts as 'liquid' (spendable now — bank/cash/wallet) or 'non_liquid' (investments, long-term/protected savings that should NOT count as available-this-week money). Use when the user says an account is for saving/investing or not for daily spending. Non-liquid money is excluded from spendable margin and mentioned separately.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          liquidity: { type: "string", enum: ["liquid", "non_liquid"] },
        },
        required: ["accountId", "liquidity"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reconcile_account_balance",
      description:
        "Set ONE account to the real balance the user reports when it differs from Kipu's and they don't recall the exact missing movement. Records the difference as a balance ADJUSTMENT (never as income/expense, so it doesn't inflate income analysis). Use for 'en el banco tengo X' / cuadrar saldo. Pass the account id and the real balance. Prefer fixing the actual missing movement (log_movement / undo) when the user DOES remember what it was.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          realBalance: { type: "number", description: "The real balance the user reports for that account." },
        },
        required: ["accountId", "realBalance"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_savings_plan",
      description:
        "Save the user's monthly saving / investing commitments and/or their essential-spending estimate (food, transport, basics). These are RESERVED before Kipu computes Saldo Kipu, so the user can spend freely knowing savings/investments are protected. Use when the user says how much they save/invest monthly or estimates their essentials. Amounts are monthly, in base currency.",
      parameters: {
        type: "object",
        properties: {
          monthlySavings: { type: "number", description: "Monthly amount the user commits to saving." },
          monthlyInvestment: { type: "number", description: "Monthly amount the user commits to investing." },
          essentialMonthlyEstimate: { type: "number", description: "Estimated monthly essential variable spending (food/transport/basics). A learnable hypothesis." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_budget_category",
      description:
        "Update (or set) the user's MONTHLY budget for ONE spending category. For FOOD and TRANSPORT this is their OBJETIVO MENSUAL — a DECISION the user makes (\"mi objetivo de comida es 650\"), never a prediction you adjust to observed behavior: change it ONLY when the user explicitly decides to. For other categories it is a monthly estimate (\"pon salud en 40\"). This changes the PLAN (what the month reserves per category) — it never logs any spending. Pass category (internal value) or categoryLabel (the Spanish word the user said). Amount is per MONTH; pass currency ONLY if the user names one different from their base (Kipu converts with a KNOWN rate, never invented).",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: [...PURCHASE_CATEGORY_ENUM],
          },
          categoryLabel: { type: "string", description: "The category as the user said it in Spanish (\"comida\", \"transporte\", \"salidas\"), when you didn't map it to the internal value." },
          newMonthlyAmount: { type: "number", description: "The new MONTHLY budget for that category." },
          currency: { type: "string", description: "ISO 4217 code ONLY when the user explicitly states the amount in a currency different from their base. Omit otherwise; never guess." },
        },
        required: ["newMonthlyAmount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resolve_objective_close",
      description:
        "Record the user's decision about LAST month's objective close (the monthly report of their food/transport objectives). destination: 'reservas' (default — the surplus stays protected in their Reserva, NO money moves), 'meta' (they want it toward a goal), 'deuda' (extra debt payment) or 'otro'. RECORD-ONLY: this never moves money — if the user redirects to a goal or debt, ALSO execute the real movement with the corresponding tool (log_movement goal_contribution / register_card_payment / transfer_between_accounts). Use month YYYY-MM only if the user names a specific month; omit for the latest close.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string", enum: ["reservas", "meta", "deuda", "otro"] },
          month: { type: "string", description: "YYYY-MM; omit for the most recent close." },
        },
        required: ["destination"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_engagement_mode",
      description:
        "Set the user's coaching mode: 'paused' (stop proactive reminders/nudges for a while), 'light' (minimal, gentle), or 'normal'. Use when the user asks to pause, go light, or come back. Optionally pauseDays for a temporary pause.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["normal", "light", "paused"] },
          pauseDays: { type: "number" },
        },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_ambient_preferences",
      description:
        "Update how/when Kipu proactively reaches out on Telegram (the ambient check-in loop) when the user expresses it naturally: turn it on/off, snooze for a while or until a date, set quiet hours, set frequency (daily / weekly on specific days / off), max messages per day, or timezone. Interpret the user's intent and pass ONLY the fields they meant. Examples: \"no me escribas por ahora\" → enabled:false; \"recuérdame mañana\" / \"escríbeme el lunes\" → pauseUntilISO; \"solo los viernes\" → frequency:weekly, weekdays:[5]; \"una vez al día\" → maxPerDay:1; \"no me molestes en la noche\" → quietHoursStart/End; \"activa otra vez los recordatorios\" → resume:true.",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "Master on/off for proactive ambient messages." },
          resume: { type: "boolean", description: "Clear any pause/snooze and turn ambient back on." },
          pauseDays: { type: "number", description: "Snooze proactive messages for N days." },
          pauseUntilISO: { type: "string", description: "Snooze until this date (YYYY-MM-DD), e.g. mañana / el lunes." },
          quietHoursStart: { type: "number", description: "Local hour 0-23 when quiet hours begin (no messages)." },
          quietHoursEnd: { type: "number", description: "Local hour 0-23 when quiet hours end." },
          frequency: { type: "string", enum: ["auto", "daily", "weekly", "off"], description: "How often: auto (Kipu decides), daily, weekly (use weekdays), or off." },
          weekdays: { type: "array", items: { type: "number" }, description: "For weekly: days 0=Sun..6=Sat (e.g. only Fridays → [5])." },
          maxPerDay: { type: "number", description: "Max proactive messages per day (default 1)." },
          timezone: { type: "string", description: "IANA timezone (e.g. America/Guayaquil) ONLY if the user states their location/timezone." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_week_reconciled",
      description:
        "Record that the user just confirmed their week is reconciled (balances look right). Use after a weekly reconciliation the user agreed with.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_fact",
      description:
        "Persist something you learned about the user so Kipu improves over time: an alias ('Pichincha = the bank account'), a preference, a behavioral pattern, a person, or a correction. Use whenever the user teaches or corrects you.",
      parameters: {
        type: "object",
        properties: {
          noteType: {
            type: "string",
            enum: ["preference", "behavior_pattern", "goal_context", "risk_context", "constraint", "general"],
          },
          content: { type: "string" },
        },
        required: ["noteType", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_income",
      description:
        "Change an EXISTING income/salary going forward (\"mi sueldo ahora es 1200\", \"desde ya me pagan quincenal\", \"pausa ese ingreso\"). Updates the income PLAN — it NEVER logs a movement (a salary change is not money received today; for money that actually arrived use log_movement). Amounts stay in the income's own currency. action pauses/resumes/ends the income instead of editing fields. VARIABLE incomes (\"gano entre 800 y 1200\"): Kipu plans with the MINIMUM — use isVariable + minAmount/maxAmount to set or realign the range, or isVariable=false when it stops varying.",
      parameters: {
        type: "object",
        properties: {
          incomeName: { type: "string", description: "How the user refers to the income (\"mi sueldo\", \"freelance\", the employer's name)." },
          newAmount: { type: "number", description: "New amount per period, in the income's own currency." },
          currency: { type: "string", description: "ISO 4217 code ONLY if the user explicitly changes the income's currency." },
          frequency: { type: "string", enum: ["weekly", "biweekly", "monthly", "yearly"] },
          expectedDay: { type: "number", description: "Day of month (1-31) it is paid, for monthly incomes." },
          payAnchorDate: { type: "string", description: "YYYY-MM-DD of the LAST real payday, for weekly/biweekly incomes (anchors the cycle)." },
          isVariable: { type: "boolean", description: "true when the income varies period to period (freelance, comisiones) — pass minAmount too (Kipu plans with the minimum). false when it becomes a fixed amount (clears the min/max range)." },
          minAmount: { type: "number", description: "SAFE minimum per period for a variable income, in its own currency. This is the figure the plan/Saldo uses." },
          maxAmount: { type: "number", description: "Typical maximum per period for a variable income (optional)." },
          isOccasional: { type: "boolean", description: "true = OCCASIONAL/windfall income that lands unpredictably (freelance every few months, a bonus): EXCLUDED from the monthly plan/Saldo, factored only when it actually arrives. false = it becomes regular again." },
          action: { type: "string", enum: ["update", "pause", "resume", "end"], description: "pause = stop counting it (keeps it), resume = count it again, end = it no longer exists. Default update." },
          confirm: { type: "boolean", description: "Required true for action='end', ONLY after the user explicitly confirmed. Never set it on the first call." },
        },
        required: ["incomeName"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_income",
      description:
        "Register a NEW income source (salary, freelance, rent received) so Kipu counts it in the plan and cashflow. Does NOT log money received today (that is log_movement). Use update_income when the income already exists.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "number", description: "Amount per period." },
          currency: { type: "string", description: "ISO 4217 code ONLY if the user names one; omit to use their base currency." },
          frequency: { type: "string", enum: ["weekly", "biweekly", "monthly", "yearly"] },
          expectedDay: { type: "number", description: "Day of month (1-31) it is paid, for monthly incomes." },
          payAnchorDate: { type: "string", description: "YYYY-MM-DD of the last real payday, for weekly/biweekly incomes." },
          destinationAccount: { type: "string", description: "Name or id of the account where it is deposited (\"me lo pagan en Pichincha\"), if the user says it. Future paydays of this income default to that account." },
          occasional: { type: "boolean", description: "true for OCCASIONAL/windfall income that lands unpredictably (freelance every few months, a bonus): EXCLUDED from the monthly plan/Saldo, factored only when it actually arrives. Omit for a regular salary/income." },
          confirmedNew: { type: "boolean", description: "Set true ONLY after the user confirmed this is a SEPARATE income from a similar existing one." },
        },
        required: ["name", "amount", "frequency"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resolve_recurring_occurrence",
      description:
        "Resolve a CALENDAR flow occurrence Kipu auto-booked or asked about (see the 'FLUJOS DEL CALENDARIO SIN CONFIRMAR' list). Covers income, fixed expenses, DEBT/LOAN/CARD payments and AHORRO/INVERSIÓN reserves. Pass the occurrenceId. If the user reports a VARIABLE fixed bill before its calendar row exists, pass fixedExpenseId (and flowName): the executor creates the canonical cycle row from the plan before resolving it, so the nightly cron cannot duplicate it. If that report belongs to an older/newer named billing cycle, pass cycleDate (the cycle/due date, NOT the payment date); otherwise ask rather than assigning it to the current month. For a VARIABLE fixed bill, action='observe' means the user only told you how much the bill came to: it learns that native amount but MOVES NO MONEY and keeps the payment question open. Use confirm/correct only when the user explicitly says it WAS PAID; they register cash/card plus the observation atomically. If a paid bill is corrected to amount=0, use correct: the executor reverses the prior payment and retains the zero invoice atomically; do NOT use retract. If an observed bill is NOT PAID YET, action='unpaid' preserves the learned bill and snoozes only the payment reminder. action='retract' is ONLY for an explicit correction that the observed bill never existed/was entered by mistake. Never use skip for an observed bill; skip is for an unobserved occurrence that did not happen. If the user names the actual one-cycle source or payment date, pass paymentSourceAccountId/paymentSourceCardId and paymentDate; never silently use the plan's usual source instead. action='confirm' accepts an already observed amount; action='correct' requires amount. scope='once' preserves the declared plan; scope='from_now' is ONLY for an explicit permanent change. dismiss stops reminders without deleting a known bill. Never route a monthly bill amount to update_fixed_expense unless the user explicitly changes the permanent plan.",
      parameters: {
        type: "object",
        properties: {
          occurrenceId: { type: "string", description: "The occurrenceId from the 'FLUJOS RECURRENTES SIN CONFIRMAR' list." },
          fixedExpenseId: { type: "string", description: "For an early VARIABLE bill with no occurrence yet: the fixed-expense id from context. Never use it for a different flow kind." },
          flowName: { type: "string", description: "How the user names the flow (\"el sueldo\", \"la luz\") — used to disambiguate if occurrenceId is unknown." },
          action: { type: "string", enum: ["observe", "confirm", "correct", "unpaid", "retract", "skip", "snooze", "dismiss"] },
          amount: { type: "number", description: "The REAL native amount. Required for observe/correct and for an unobserved variable bill confirmation." },
          paymentSourceAccountId: { type: "string", description: "For a paid VARIABLE fixed bill, the owned cash-account id explicitly used this cycle. Do not pass together with paymentSourceCardId." },
          paymentSourceCardId: { type: "string", description: "For a paid VARIABLE fixed bill charged to a credit card, the credit-card debt id explicitly used this cycle. Do not pass together with paymentSourceAccountId." },
          paymentDate: { type: "string", description: "For a paid VARIABLE fixed bill, the actual non-future payment date YYYY-MM-DD when the user states it. Omit when unknown; observing a bill has no payment date." },
          cycleDate: { type: "string", description: "For an early/late VARIABLE bill with no occurrence yet: a real YYYY-MM-DD inside the billing cycle the user identified (normally its due date). This selects the cycle only; it never means cash moved." },
          scope: { type: "string", enum: ["once", "from_now"], description: "'once' = only this cycle; 'from_now' = the recurring plan changed permanently. Never infer from_now from one different bill." },
          snoozeUntil: { type: "string", description: "For 'snooze': ISO date/time to re-ask (e.g. tomorrow evening)." },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_change",
      description:
        "Program a FUTURE change that applies automatically on its date (\"en 3 meses mi sueldo sube a 1500\", \"cada 3 meses sube 3% el arriendo\", \"pausa Netflix desde julio\", \"desde el próximo mes bajo mi inversión a 500\", \"recuérdame revisar la tasa cada mes\"). Nothing changes today. For a change that applies NOW use update_income / update_fixed_expense / set_savings_plan / update_goal instead. cadence makes it repeat (e.g. quarterly 3% rent raises). targetType savings_plan = the monthly ahorro/inversión/esenciales commitments of \"Tu mes\" (requires targetField; set_amount 0 = dejar de apartar).",
      parameters: {
        type: "object",
        properties: {
          targetType: { type: "string", enum: ["income", "fixed_expense", "goal", "reminder", "savings_plan"] },
          targetName: { type: "string", description: "How the user refers to the target (\"mi sueldo\", \"el arriendo\", \"Netflix\", \"mi inversión\"). For reminder: what to remind." },
          changeKind: { type: "string", enum: ["set_amount", "adjust_percent", "adjust_fixed", "pause", "resume", "set_frequency", "reminder"] },
          targetField: { type: "string", enum: ["savings", "investment", "essential", "contribution"], description: "For savings_plan (required): which commitment changes — savings (ahorro mensual), investment (inversión mensual), essential (estimado de esenciales). For goal: pass \"contribution\" to change the APORTE mensual a la meta instead of its target amount." },
          amount: { type: "number", description: "set_amount: the new amount, in the TARGET'S OWN currency (never converted; savings_plan is in the user's base currency and accepts 0 = stop). adjust_percent: percent like 3 for +3% (negative lowers). adjust_fixed: signed delta added to the amount." },
          currency: { type: "string", description: "ISO 4217 code of the currency the USER stated the amount in, if they named one. If it differs from the target's currency the tool asks instead of converting." },
          newFrequency: { type: "string", enum: ["weekly", "biweekly", "monthly", "yearly"], description: "For set_frequency." },
          effectiveDate: { type: "string", description: "YYYY-MM-DD when it first applies. Today or future." },
          cadence: { type: "string", enum: ["once", "monthly", "quarterly", "semiannual", "yearly"], description: "once (default) or how often it repeats." },
          note: { type: "string", description: "Short natural note for the user, optional." },
          confirm: { type: "boolean", description: "Required true for adjust_percent above 50%, ONLY after the user re-confirmed the percentage." },
        },
        required: ["targetType", "targetName", "changeKind", "effectiveDate"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_scheduled_changes",
      description:
        "Read-only. Lists the user's programmed future changes (what changes, next date, cadence, status). Use for \"¿qué cambios programados tengo?\", \"¿qué me habías agendado?\".",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_scheduled_change",
      description:
        "Cancel a pending programmed change so it never applies (\"ya no subas el arriendo\", \"cancela ese cambio de sueldo\"). Resolve which one by name/label or date; if ambiguous it returns the options so you can ask.",
      parameters: {
        type: "object",
        properties: {
          reference: { type: "string", description: "Name/label fragment of the change or its date (YYYY-MM-DD)." },
        },
        required: ["reference"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_account",
      description:
        "Rename one of the user's accounts (\"la cuenta Banco ahora se llama Pichincha\"), or mark it as the DEFAULT for its currency with makeCurrencyDefault=true when the user declares a standing preference (\"con ARS siempre uso Supervielle\") — that stored flag is what lets capture auto-pick it among several same-currency accounts. Balance corrections go through reconcile_account_balance, NOT here. There is no account deletion: to close one, offer to reconcile it to 0 and rename it as closed.",
      parameters: {
        type: "object",
        properties: {
          accountName: { type: "string", description: "How the user refers to the account today." },
          newName: { type: "string", description: "The new name." },
          makeCurrencyDefault: { type: "boolean", description: "true when the user declared this account as their standing default for its currency." },
        },
        required: ["accountName"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "export_my_data",
      description:
        "Read-only. When the user asks for their data (\"dame mis datos\", \"exporta todo lo mío\", \"quiero llevarme mi información\"): returns a quick summary of what Kipu holds for them (counts of accounts, movements, goals, fixed expenses, incomes) and points to the full JSON download in Ajustes. Never generates a file or dumps raw data in chat.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "explain_my_data",
      description:
        "Read-only. Answers \"¿qué sabes de mí?\", \"¿qué datos tienes?\", \"¿qué información guardas?\" from the user's REAL structured state: their accounts (and balances), cards/debts, incomes, fixed expenses, goals, household and key preferences — described naturally, NOT as a raw dump. Use it to be transparent about what Kipu holds. Never invents data; only reports what exists.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "report_bug",
      description:
        "Persist a bug / problem / idea / confusion the user reports (\"esto está fallando\", \"tengo un problema\", \"sería buena idea que…\", \"no entendí por qué…\"). Saves it so the team reviews it, and you confirm warmly (\"gracias, ya lo anoté y lo revisamos\"). Use it whenever the user reports something wrong or suggests an improvement — do NOT pretend to fix product bugs you can't.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "What the user reported, in their words (paraphrase faithfully; keep it specific)." },
          kind: { type: "string", enum: ["bug", "idea", "confusion", "other"], description: "bug = algo falla; idea = sugerencia/mejora; confusion = no entendió algo; other." },
          context: { type: "string", description: "Optional short context (what they were doing / which screen/feature), if they gave it." },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename_card",
      description:
        "Rename one of the user's cards/debts (\"la Visa ahora se llama Visa Pichincha\"). Renaming only — limits/cutoff/due day/interest/balance go through update_card_obligations; closing goes through close_card. Resolve which card by name from the context; if ambiguous, ask which one.",
      parameters: {
        type: "object",
        properties: {
          cardName: { type: "string", description: "How the user refers to the card today." },
          newName: { type: "string", description: "The new name." },
        },
        required: ["cardName", "newName"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "close_account",
      description:
        "Soft-close (disable) one of the user's accounts so it stops counting (\"cierra/desactiva/elimina esa cuenta\"). NEVER a hard delete: the account and its history stay for audit; it is reconciled to 0 with a balance adjustment and marked closed. It can later be restored only through reopen_account, which reverses the close as one domain operation. DESTRUCTIVE — ALWAYS ask first (warn if the balance is not 0: that money would be adjusted out). Call once WITHOUT confirm to get the warning, then, only after the user says yes, call again with confirm=true.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string", description: "Id of the account to close (from the context)." },
          confirm: { type: "boolean", description: "Required true to actually close, ONLY after the user explicitly confirmed. Never set it on the first call." },
        },
        required: ["accountId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reopen_account",
      description:
        "Reopen a soft-closed account when the user explicitly asks to reactivate/reopen it. This is the domain inverse of close_account: if closing reconciled a balance to zero, the same atomic operation reverses that adjustment and restores the prior status. Never emulate this with a generic balance adjustment.",
      parameters: {
        type: "object",
        properties: {
          accountName: { type: "string", description: "Name of the closed account to reopen." },
        },
        required: ["accountName"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "close_card",
      description:
        "Soft-close (disable) one of the user's cards/debts so it stops counting (\"cierra/desactiva esa tarjeta\", \"ya pagué y cerré esa deuda\"). NEVER a hard delete: the card and its history stay for audit; it is marked closed. DESTRUCTIVE — ALWAYS ask first (warn if it still has outstanding debt ≠ 0: closing hides a debt that still exists — better to pay it off or reverse its balance first). Call once WITHOUT confirm to get the warning, then, only after the user says yes, call again with confirm=true.",
      parameters: {
        type: "object",
        properties: {
          debtAccountId: { type: "string", description: "Id of the card/debt to close (from the context)." },
          confirm: { type: "boolean", description: "Required true to actually close, ONLY after the user explicitly confirmed. Never set it on the first call." },
        },
        required: ["debtAccountId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "change_account_currency",
      description:
        "Change the CURRENCY of one of the user's accounts. TWO modes. Default (reinterpret omitted/false): only safe when the account has NO movements AND balance 0 (a just-created account with the wrong currency) — otherwise REFUSES, because reinterpreting a stored amount as a new currency at no rate would fabricate FX. Use reinterpret=true ONLY when the user says the NUMBER was ALWAYS in the new currency and was just MISLABELED (\"esos 20000 siempre fueron pesos, no dólares\"): the original amount is kept as-is, only its currency LABEL changes, and Kipu recomputes the base-currency value with a KNOWN rate (asks for the rate if it doesn't have one — never invents it). Still refuses if the account has real movements (those would desync).",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          newCurrency: { type: "string", description: "ISO 4217 code the account should be in (e.g. COP, UYU)." },
          reinterpret: { type: "boolean", description: "true = the stored number was ALWAYS in newCurrency and was mislabeled; keep the amount, relabel its currency, recompute base at a known rate. Omit for a normal empty-account currency fix." },
        },
        required: ["accountId", "newCurrency"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_scheduled_payment",
      description:
        "Edit a FUTURE scheduled payment/reminder the user already programmed (change its amount and/or its due date). Resolve which one by name; if ambiguous, list the upcoming ones and ask. Does NOT move money. To stop one entirely use cancel_scheduled_payment.",
      parameters: {
        type: "object",
        properties: {
          reference: { type: "string", description: "Name fragment of the scheduled payment (\"el pago del colegio\", \"la renta\")." },
          newAmount: { type: "number", description: "New amount, in the payment's own currency." },
          newDueDate: { type: "string", description: "New due date YYYY-MM-DD (today or future)." },
        },
        required: ["reference"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_scheduled_payment",
      description:
        "Cancel a FUTURE scheduled payment/reminder so it no longer shows up or materializes (\"ya no voy a pagar eso\", \"cancela ese recordatorio de pago\"). Soft: it flips to cancelled, no money moves, history stays. Resolve which one by name; if ambiguous, list the upcoming ones and ask. Confirm before cancelling.",
      parameters: {
        type: "object",
        properties: {
          reference: { type: "string", description: "Name fragment of the scheduled payment to cancel." },
          confirm: { type: "boolean", description: "Required true to cancel, ONLY after the user confirmed. Never set it on the first call." },
        },
        required: ["reference"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "change_base_currency",
      description:
        "Change the user's BASE/display currency (the currency every number is normalized to). HIGH-IMPACT and rarely correct after onboarding. Allowed ONLY when it is safe: the user has NO financial data yet in a different base (no accounts/cards/movements whose base amounts would be silently reinterpreted). If there IS existing data, this REFUSES and explains — Kipu never fabricates conversions of stored base amounts. Requires explicit confirmation even when safe.",
      parameters: {
        type: "object",
        properties: {
          newBaseCurrency: { type: "string", description: "ISO 4217 code for the new base currency." },
          confirm: { type: "boolean", description: "Required true to apply, ONLY after the user explicitly confirmed. Never set it on the first call." },
        },
        required: ["newBaseCurrency"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_asset",
      description:
        "Register a NEW asset/investment in the user's patrimonio: property, vehicle, business, a fixed term / policy, stocks or ETFs, crypto, a savings pot, or money lent out. Use for \"tengo un depto\", \"un plazo fijo de 5000\", \"acciones por 3000\". An asset counts toward NET WORTH only — it is NEVER spendable money and NEVER feeds the current Saldo. Uses the VALUE the user states; never invent a market price. For a NEW recurring/fixed EXPENSE use create_fixed_expense; for a new bank/cash ACCOUNT use create_account.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "How the user names it, e.g. \"Depto Belgrano\", \"Plazo fijo Galicia\", \"BTC\"." },
          assetClass: { type: "string", enum: ["cash", "investment", "fixed_term", "crypto", "property", "vehicle", "business", "receivable", "other"], description: "cash=efectivo/ahorro; investment=acciones/ETF/fondos; fixed_term=plazo fijo/póliza; crypto; property=inmueble; vehicle; business=negocio; receivable=préstamo a favor; other." },
          value: { type: "number", description: "Current value EXACTLY as the USER states it, in the currency they said. Must be ≥ 0. Never guessed and NEVER converted by you — if it's a foreign currency the tool converts with the user's known rate (or asks)." },
          currency: { type: "string", description: "ISO 4217 code ONLY if the user names one; omit to use their base currency. A foreign currency needs a known exchange rate (the tool asks for it if missing)." },
          liquid: { type: "boolean", description: "true only if it can be turned into cash quickly (a savings pot, liquid fund). Default false. Even 'liquid' assets do NOT feed the current Saldo." },
          includeInNetWorth: { type: "boolean", description: "Default true. false to track it without counting it in net worth." },
          expectedReturnPct: { type: "number", description: "Annual % return ONLY if the user gives it; omit otherwise (no growth projected). Never invent a yield." },
          notes: { type: "string", description: "Optional short note the coach should remember about it." },
        },
        required: ["name", "assetClass", "value"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_asset",
      description:
        "Update an EXISTING asset the user already registered: revalue it (\"el depto ahora vale 90k\", \"el plazo fijo quedó en 5200\"), rename it, mark it liquid/no-liquid, include/exclude it from net worth, set its expected return, or attach a note. Resolve which asset by name from the assets in context; if ambiguous, ask which one. Uses the value the user states — never a fabricated market price. Does NOT move money or touch the Saldo.",
      parameters: {
        type: "object",
        properties: {
          assetId: { type: "string", description: "Id of the asset (from context). Prefer this when known." },
          assetName: { type: "string", description: "How the user refers to the asset, when the id is not known." },
          newValue: { type: "number", description: "New current value the USER states, in the asset's currency. Must be ≥ 0." },
          newName: { type: "string", description: "New name, when renaming." },
          liquid: { type: "boolean", description: "Set liquid true/false. Even liquid assets never feed the Saldo." },
          includeInNetWorth: { type: "boolean", description: "Include (true) or exclude (false) from net worth." },
          expectedReturnPct: { type: "number", description: "Annual % return ONLY if the user states it." },
          notes: { type: "string", description: "Attach/replace a note; empty string clears it." },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_asset",
      description:
        "Remove an asset the user no longer has (\"vendí el auto\", \"ya no tengo ese plazo fijo\", \"saca el depto de mi patrimonio\"). SOFT remove: the asset stops counting toward net worth but its record is preserved (never a hard delete). DESTRUCTIVE for the patrimonio view — call once WITHOUT confirm to warn, then, only after the user says yes, call again with confirm=true. Resolve which asset by name; if ambiguous, ask. If the user SOLD it and the cash landed in an account, also log that inflow separately with log_movement (this tool does not move money).",
      parameters: {
        type: "object",
        properties: {
          assetId: { type: "string", description: "Id of the asset (from context)." },
          assetName: { type: "string", description: "How the user refers to the asset, when the id is not known." },
          confirm: { type: "boolean", description: "Required true to actually remove, ONLY after the user explicitly confirmed. Never set it on the first call." },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_entity_note",
      description:
        "Attach or update a free-text NOTE the coach remembers on one of the user's entities — an account, card/debt, fixed expense, goal, income, or asset (\"esta cuenta es de emergencias, no tocar\", \"la Visa sube el cupo en agosto\", \"el arriendo sube en agosto\", \"la boda es en Cartagena\"). Kipu reads these notes as memory. If the note mentions a FUTURE, dated change to an amount (e.g. \"el arriendo sube a 500 en agosto\", \"en marzo baja la cuota\"), ALSO pass scheduleReminderDate (YYYY-MM-DD) so Kipu proactively reminds the user on that date to apply it — that creates a reminder, it does NOT change the amount now (for a change that applies now use update_fixed_expense / update_income). Resolve the entity by name from context; if ambiguous, ask which one. Empty note clears it.",
      parameters: {
        type: "object",
        properties: {
          entityType: { type: "string", enum: ["account", "card", "debt", "fixed_expense", "goal", "income", "asset"], description: "What kind of entity the note is about. card and debt are the same (a card is a debt)." },
          nameOrId: { type: "string", description: "The entity's id (preferred) or how the user names it." },
          note: { type: "string", description: "The note text to save. Pass an empty string to clear an existing note." },
          scheduleReminderDate: { type: "string", description: "YYYY-MM-DD. Set ONLY when the note describes a future dated change; creates a reminder so Kipu asks the user then. Must be today or future." },
        },
        required: ["entityType", "nameOrId", "note"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "register_card_payment",
      description:
        "Record that the user PAID their credit card (\"pagué la Visa\", \"aboné 200 a la tarjeta\", \"pagué el resumen de Diners\"). This is a CARD PAYMENT accounting event, not an own-account transfer and not a new expense: planner effects use classification=payment with cash/decrease + debt_liability/decrease. It lowers the paying account AND lowers the card debt by the same amount and must NEVER be logged as spending (the original purchases were already the expense). Also stamps the card's last payment date so its billing cycle knows the statement is covered. Needs the card and which account it was paid from. Pass amount when the user states it; for \"pagué en full/el total\" pass paidInFull=true and OMIT amount — the executor derives the exact current statement remainder, never the model. If ONE payment came from several sources, first ask for the exact full split in one reply (source name + amount for every part); the executor derives that evidence from the raw user message and applies it atomically — never invent a sources array. For a purchase made WITH the card use log_movement (onCard); for money moved between own bank accounts use transfer_between_accounts.",
      parameters: {
        type: "object",
        properties: {
          cardName: { type: "string", description: "How the user refers to the card/debt being paid (\"la Visa\", \"Diners\"). Resolve to a credit_card/debt in context." },
          amount: { type: "number", description: "Amount paid, in the paying account's currency. Must be > 0." },
          paidInFull: { type: "boolean", description: "True only when the user explicitly says this payment covered the full/current statement. The executor derives the amount from the stored statement; never pair it with a guessed amount." },
          fromAccount: { type: "string", description: "Name or id of the account the payment came from. If the user didn't say and the card has a saved usual account, the tool asks you to CONFIRM that one (\"¿Desde X, como siempre?\") instead of an open question." },
          confirmDefaultSource: { type: "boolean", description: "Set true ONLY after the user confirmed paying from the card's saved usual account (when fromAccount was not stated). Never set it on the first call." },
          date: { type: "string", description: "YYYY-MM-DD the payment was made. Defaults to today if omitted." },
        },
        required: ["cardName"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "card_status",
      description:
        "READ-ONLY. Explain a credit card's billing cycle honestly: whether a statement is pending, already paid, or still accumulating; when it is due; and how much is estimated to land (\"tu Visa cierra el 6, ~783$ estimado a pagar el 22\"). Use for \"¿cuánto tengo que pagar de la tarjeta?\", \"¿cuándo vence la Visa?\", \"¿ya pagué el resumen?\". Only meaningful for credit cards (loans are fixed monthly). Marks estimated amounts as estimates; never invents a confirmed statement. Does NOT move money.",
      parameters: {
        type: "object",
        properties: {
          cardName: { type: "string", description: "How the user refers to the card. Omit to summarize ALL their credit cards." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_installment_plan",
      description:
        "Record a CARD purchase paid in monthly installments (cuotas): \"compré la tele en 12 cuotas\", \"lo pagué en 6 sin interés\". NEVER use log_movement for a cuotas purchase — that would drain the user's Saldo for the FULL amount today. This tool books the full debt on the card (the total is owed from day one), tags the purchase so the Saldo tank ignores it, and instead lowers the user's daily recharge by the monthly installment while the plan runs (that IS how the purchase is paid). The result tells you the recharge before → after; ALWAYS relay that to the user (\"tu recarga baja de X$/día a Y$/día por N meses\") plus any layer/cost warning included. Needs the total, the number of months and the card; ask for what's missing.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "Short human label in Spanish, e.g. \"Tele Samsung\"." },
          totalAmount: { type: "number", description: "TOTAL the user will end up paying across all installments, interest included if financed. In the card's currency unless `currency` says otherwise." },
          months: { type: "number", description: "Number of monthly installments (1–60)." },
          cardName: { type: "string", description: "How the user refers to the card (\"la Visa\"). Resolve to a credit_card in context; omit only if the user has exactly one card." },
          surcharge: { type: "number", description: "Interest/financing charge INCLUDED in totalAmount (0 or omit = cuotas sin interés). E.g. price 1000 in 12 cuotas totaling 1150 → totalAmount 1150, surcharge 150." },
          firstPaymentDate: { type: "string", description: "YYYY-MM-DD the FIRST installment gets charged (its statement due date), when the user knows it. Omit to derive from the card's cutoff/due days." },
          category: { type: "string", enum: [...PURCHASE_CATEGORY_ENUM], description: "Spending category of the purchase. Defaults to shopping." },
          currency: { type: "string", description: "ISO code ONLY when the user explicitly states the purchase currency and it differs from the card's. Omit otherwise." },
          confirmedNew: { type: "boolean", description: "Set true ONLY after the user explicitly confirms this is a different/new purchase when Kipu found an active plan with the same card, total and description." },
        },
        required: ["description", "totalAmount", "months"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "close_installment_plan",
      description:
        "Close an ACTIVE installment plan (cuotas) early. mode=paid_off means the user paid the remaining installments at once: it stops the monthly load, but the actual card payment still gets logged separately with register_card_payment. mode=cancelled means the purchase was returned/annulled: the tool atomically stops the plan AND reverses the original card purchase/debt; NEVER add a separate refund/undo afterward. Identify the plan by name; the active plans are listed in the briefing.",
      parameters: {
        type: "object",
        properties: {
          planName: { type: "string", description: "How the user refers to the plan (matches the plan's description, e.g. \"la tele\")." },
          mode: { type: "string", enum: ["paid_off", "cancelled"], description: "paid_off = early payoff; cancelled = purchase returned/annulled." },
        },
        required: ["planName", "mode"],
        additionalProperties: false,
      },
    },
  },
];

// The currency of a KNOWN owned account — never a USD fallback. Callers must
// have validated the account's presence before calling. Exported for the gate.
export function accountCurrency(account: Account): CurrencyCode {
  return account.currency as CurrencyCode;
}

// The currency a movement is actually denominated in: the source account's, or
// (for a card purchase with no cash account) the CARD's currency — never a
// blind USD fallback that would mis-state a non-USD card. Returns undefined when
// no trusted currency can be derived; the caller must then ask, not invent USD.
// Exported for the gate.
export function movementCurrency(
  source?: Account,
  debt?: DebtAccount,
  dest?: Account,
): CurrencyCode | undefined {
  const c = source?.currency ?? debt?.currency ?? dest?.currency;
  return c ? (c as CurrencyCode) : undefined;
}

export type FixedExpenseCurrencyPlan =
  | { ok: true; currency: CurrencyCode }
  | { ok: false; reason: "invalid_explicit" | "source_mismatch" | "unproven" };

export function planFixedExpenseCurrency(input: {
  explicitCurrency?: unknown;
  sourceCurrency?: string | null;
  baseCurrency?: string | null;
}): FixedExpenseCurrencyPlan {
  const explicit =
    typeof input.explicitCurrency === "string" &&
    /^[A-Za-z]{3}$/.test(input.explicitCurrency.trim())
      ? input.explicitCurrency.trim().toUpperCase()
      : null;
  if (input.explicitCurrency != null && !explicit) {
    return { ok: false, reason: "invalid_explicit" };
  }
  const source = String(input.sourceCurrency ?? "").trim().toUpperCase();
  if (explicit && source && explicit !== source) {
    return { ok: false, reason: "source_mismatch" };
  }
  const base = String(input.baseCurrency ?? "").trim().toUpperCase();
  const currency = explicit ?? (/^[A-Z]{3}$/.test(source) ? source : null) ??
    (/^[A-Z]{3}$/.test(base) ? base : null);
  return currency
    ? { ok: true, currency: currency as CurrencyCode }
    : { ok: false, reason: "unproven" };
}

// Round to cents to avoid float dust reaching the numeric(14,2) ledger.
function toCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

// Strictly validate a calendar date (rejects 2026-02-31 etc.) and return the
// movement's occurrence timestamp (noon UTC of that day, so timezone shifts
// can't move it across a day boundary). `localTodayISO` must be the user's
// proven local day: comparing against Date.now()/UTC used to admit "tomorrow"
// for part of the day and violated the product's timezone contract.
export function validOccurredAtISO(
  value: unknown,
  localTodayISO: string,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  // Round-trip check: JS normalizes overflow (Feb 31 → Mar 3), so a valid date
  // must reproduce its own components.
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return undefined;
  }
  // A recorded occurrence can be today or historical, never a future day.
  if (value.trim() > localTodayISO) return undefined;
  return dt.toISOString();
}

// Real extraction confidence, clamped; falls back to a neutral typed-text value
// when the caller has no model-reported score. Never used as auto-write
// AUTHORITY (that gate is deterministic) — only stored for audit.
function resolveConfidence(value: unknown): number {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return 0.9;
}

function category(value: unknown, fallback: FinancialCategory): FinancialCategory {
  return typeof value === "string" && VALID_CATEGORIES.has(value as FinancialCategory)
    ? (value as FinancialCategory)
    : fallback;
}

function money(value: number, currency: string): string {
  return formatMoney(value, currency as CurrencyCode);
}

function normalizedCurrencyEvidence(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function hypotheticalCurrency(
  args: Record<string, unknown>,
  ctx: AgentContext,
): CurrencyCode | null {
  const normalizedMessage = normalizedCurrencyEvidence(ctx.rawMessage);
  const fromMessage = detectExplicitCurrency(
    normalizedMessage,
    {
      accounts: ctx.accounts,
      debtAccounts: ctx.debtAccounts,
      baseCurrency: ctx.baseCurrency,
    },
  );
  const fromArgs =
    typeof args.currency === "string" &&
    /^[A-Za-z]{3}$/.test(args.currency.trim())
      ? (args.currency.trim().toUpperCase() as CurrencyCode)
      : null;
  if (/\bpesos?\b/.test(normalizedMessage) && !fromMessage) {
    // "Pesos" is not one currency. If this user has several peso-family
    // instruments, a model-provided ARS/COP guess is not evidence.
    return null;
  }
  // The user's own words are stronger evidence than a model-provided tool
  // argument. When there is no explicit currency, the typed argument may carry
  // the model's extraction; the final fallback is the user's base currency.
  return (fromMessage ?? fromArgs ?? ctx.baseCurrency) as CurrencyCode;
}

function hypotheticalAmountText(
  amountOriginal: number,
  originalCurrency: CurrencyCode,
  amountBase: number,
  baseCurrency: CurrencyCode,
): string {
  const original = money(amountOriginal, originalCurrency);
  return originalCurrency === baseCurrency
    ? original
    : `${original} (≈ ${money(amountBase, baseCurrency)})`;
}

function hypotheticalPlanFailure(
  plan: ReturnType<typeof planHypotheticalPurchase>,
): ToolResult | null {
  if (plan.ok) return null;
  if (plan.reason === "fx_required" && plan.originalCurrency) {
    return {
      status: "needs_info",
      summary: `Para compararlo con tu Saldo necesito la tasa de ${plan.originalCurrency} a ${plan.baseCurrency}. Dime qué cambio usamos y no adivino el valor.`,
    };
  }
  if (plan.reason === "invalid_currency") {
    return {
      status: "needs_info",
      summary: "¿En qué moneda está ese precio? Con eso lo comparo bien con tu Saldo.",
    };
  }
  return {
    status: "needs_info",
    summary: "¿De cuánto sería esa compra?",
  };
}

// THE CONFIDENCE CONTRACT. Any tool that ANSWERS A SPENDABLE NUMBER (evaluate_
// purchase, cashflow outlook, the Margen quoted after logging) must surface how
// trustworthy that number is, so Kipu never asks the user to trust a figure it
// internally knows is weak. Reads briefing.margenKipu.{confidence,essentialsKnown,
// dataAgeDays,marginGaps} defensively — a parallel engine agent lands these
// fields; if any is missing (transiently), we degrade to "no extra caveat" rather
// than break. Returns a Spanish instruction fragment for the agent to weave in.
function marginConfidenceNote(ctx: AgentContext): string {
  const mk = ctx.briefing?.margenKipu as
    | {
        confidence?: "solid" | "estimated" | "preliminary";
        essentialsKnown?: boolean;
        dataAgeDays?: number | null;
        marginGaps?: { code: string; label: string }[];
      }
    | undefined;
  const confidence = mk?.confidence;
  if (!confidence || confidence === "solid") return "";
  const gaps = Array.isArray(mk?.marginGaps) ? mk!.marginGaps! : [];
  const gapLabel = gaps[0]?.label ?? (mk?.essentialsKnown === false ? "aún no conozco bien tu gasto diario" : "me faltan datos para afinarlo");
  const stale = typeof mk?.dataAgeDays === "number" && mk.dataAgeDays >= 5 ? ` (y hace ${mk.dataAgeDays} días no registras nada)` : "";
  // Preliminary = never assert a confident spendable number.
  if (confidence === "preliminary") {
    return ` CONFIANZA BAJA (preliminar): NO afirmes ese número como seguro. Preséntalo como un estimado provisional, di en una frase corta por qué (${gapLabel})${stale}, y ofrece la acción para afinarlo (dime tu ingreso / tu gasto diario / la tasa). En Spanish cálido, sin tecnicismos.`;
  }
  // Estimated = usable but flag it and offer to improve.
  return ` CONFIANZA MEDIA (estimado): usa el número pero acláralo como estimado, nombra el hueco en una frase (${gapLabel})${stale}, y ofrece afinarlo. Sin alarmar.`;
}

// Human name of where a movement's money came from / went to, so the agent can
// present concrete options ("el de Pichincha" vs "el de efectivo") and the user
// can disambiguate naturally.
function sourceLabel(
  tx: StoredTransaction,
  accounts: Account[],
  debts: DebtAccount[],
): string {
  if (tx.sourceAccountId) {
    return accounts.find((a) => a.id === tx.sourceAccountId)?.name ?? "una cuenta";
  }
  if (tx.debtAccountId) {
    return debts.find((d) => d.id === tx.debtAccountId)?.name ?? "una tarjeta";
  }
  if (tx.destinationAccountId) {
    return accounts.find((a) => a.id === tx.destinationAccountId)?.name ?? "una cuenta";
  }
  return "efectivo/otro";
}

// Rebuild a same-type intent for a correction, applying amount / source /
// category / description patches. Returns null when the shape is not safely
// supported (the caller asks instead of guessing).
function buildAgentCorrectedIntent(
  original: StoredTransaction,
  patch: {
    newAmount?: number;
    account?: Account;
    debt?: DebtAccount;
    newCategory?: FinancialCategory;
    newDescription?: string;
    newBudgetTreatment?: "objective" | "saldo";
  },
  accounts: Account[],
): ExpenseIntent | IncomeIntent | DebtPaymentIntent | TransferIntent | GoalContributionIntent | null {
  const amount = patch.newAmount ?? original.originalAmount;
  const currency = original.originalCurrency as CurrencyCode;
  // Moving a movement onto an instrument in ANOTHER currency would apply the
  // original currency/rate against that instrument's native balance — corrupt.
  // Not safely supported: return null so the caller asks instead of guessing.
  const movedToCurrency = (patch.account?.currency ?? patch.debt?.currency ?? "").toUpperCase();
  if (movedToCurrency && movedToCurrency !== String(currency ?? "").toUpperCase()) {
    return null;
  }
  const baseFields = {
    originalAmount: amount,
    originalCurrency: currency,
    exchangeRateToBase: original.exchangeRateToBase,
    baseCurrency: original.baseCurrency as CurrencyCode,
    confidenceScore: 1,
    status: "ready" as const,
    description: patch.newDescription ?? original.description,
    // Stage H — an amount/account correction must never silently reset an
    // extraordinary movement back to the objective (or vice versa).
    budgetTreatment: (patch.newBudgetTreatment ?? original.budgetTreatment ?? null) as "objective" | "saldo" | null,
  };
  const cat = patch.newCategory ?? (original.category as FinancialCategory);
  switch (original.type) {
    case "expense": {
      let sourceAccountId = original.sourceAccountId ?? undefined;
      let debtAccountId = original.debtAccountId ?? undefined;
      if (patch.account) {
        sourceAccountId = patch.account.id;
        debtAccountId = undefined;
      } else if (patch.debt) {
        debtAccountId = patch.debt.id;
        sourceAccountId = undefined;
      }
      return { ...baseFields, type: "expense", category: cat, sourceAccountId, debtAccountId };
    }
    case "income": {
      const destinationAccountId = patch.account?.id ?? original.destinationAccountId;
      if (!destinationAccountId) return null;
      return { ...baseFields, type: "income", destinationAccountId, category: cat };
    }
    case "debt_payment": {
      const sourceAccountId = patch.account?.id ?? original.sourceAccountId;
      if (!sourceAccountId || !original.debtAccountId) return null;
      return { ...baseFields, type: "debt_payment", sourceAccountId, debtAccountId: original.debtAccountId, category: cat };
    }
    case "transfer": {
      const sourceAccountId = patch.account?.id ?? original.sourceAccountId;
      if (!sourceAccountId || !original.destinationAccountId) return null;
      return { ...baseFields, type: "transfer", sourceAccountId, destinationAccountId: original.destinationAccountId, category: cat };
    }
    case "goal_contribution": {
      const sourceAccountId = patch.account?.id ?? original.sourceAccountId;
      if (!sourceAccountId || !original.goalId) return null;
      const goalAccount = original.destinationAccountId ?? accounts.find((a) => a.isGoalAccount)?.id ?? "";
      return { ...baseFields, type: "goal_contribution", sourceAccountId, destinationAccountId: goalAccount, goalId: original.goalId, category: "savings" };
    }
    default:
      return null;
  }
}

// Build the validated provenance an evidence-derived movement carries into the
// canonical writer: trusted evidence id (from context), bank reference
// (stored for the matcher — cross-channel dedup is application-level, not a
// DB unique constraint), and strictly validated occurrence date.
export function movementProvenance(args: Record<string, unknown>, ctx: AgentContext) {
  const externalRef =
    typeof args.externalRef === "string" && args.externalRef.trim()
      ? args.externalRef.trim().slice(0, 120)
      : null;
  return {
    evidenceId: ctx.evidenceId ?? null,
    externalRef,
    occurredAtISO: validOccurredAtISO(args.occurredAtISO, todayISO(ctx)) ?? null,
    parserConfidenceScore: resolveConfidence(args.confidence),
  };
}

// Build the canonical ledger entry for one movement-tool row: validate against
// the user's real accounts/cards/goals (ownership comes from ctx, which is the
// user's own state) and attach deterministic provenance. Returns either a ready
// entry + a short factual summary, or a reason the row can't be written. Shared
// by the single and batch paths so they validate identically.
type BuiltMovement =
  | { ok: true; entry: LedgerEntryInput; summary: string }
  | { ok: false; reason: string; fatal?: boolean };

// Compute the next deterministic dedupe key for a movement in this turn, from
// the operation namespace + the movement's normalized financial content + a
// per-turn occurrence index, so a redelivered turn is idempotent while
// legitimate identical movements still get distinct keys.
function dedupeKeyFor(
  ctx: AgentContext,
  f: {
    type: string;
    amount: number;
    currency: string;
    sourceAccountId?: string | null;
    debtAccountId?: string | null;
    destinationAccountId?: string | null;
    goalId?: string | null;
    occurredDate?: string | null;
  },
): string | null {
  if (!ctx.operationId) return null;
  const occ = (ctx.dedupeOcc ??= new Map<string, number>());
  const fp = movementFingerprint({
    type: f.type,
    cents: Math.round(f.amount * 100),
    currency: f.currency,
    sourceAccountId: f.sourceAccountId,
    debtAccountId: f.debtAccountId,
    destinationAccountId: f.destinationAccountId,
    goalId: f.goalId,
    occurredDate: f.occurredDate,
  });
  return nextDedupeKey(ctx.operationId, fp, occ);
}

function attachDedupeKey(entry: LedgerEntryInput, ctx: AgentContext): void {
  const key = dedupeKeyFor(ctx, {
    type: entry.type,
    amount: entry.originalAmount,
    currency: entry.originalCurrency,
    sourceAccountId: entry.sourceAccountId,
    debtAccountId: entry.debtAccountId,
    destinationAccountId: entry.destinationAccountId,
    goalId: entry.goalId,
    occurredDate: entry.occurredAtISO ? entry.occurredAtISO.slice(0, 10) : null,
  });
  if (key) entry.dedupeKey = key;
}

// Re-auditoría 2 de J-1 (P1) — la EVIDENCIA de una elección la computa el
// EXECUTOR, jamás un booleano del LLM: "mentioned" = el nombre del instrumento
// (o un token distintivo suyo, sin genéricos) aparece en el MENSAJE del usuario;
// "learned" = la cuenta es el default estructurado de su moneda (068). Sin
// evidencia y con varias compatibles, el plan pregunta.
const INSTRUMENT_NAME_STOPWORDS = new Set([
  "banco", "cuenta", "caja", "ahorro", "ahorros", "tarjeta", "card", "credito", "crédito",
  "debito", "débito", "visa", "master", "mastercard", "amex", "cta", "mi", "la", "el", "de", "del",
]);

// Re-auditoría 3 (P1): por PALABRAS COMPLETAS, jamás por substring — `includes`
// hacía que "pagué el trámite del visado" probara "Visa", y "me fui a Galicia"
// probara la cuenta Galicia. Además los tokens de MARCA genérica (visa,
// mastercard…) no son evidencia por sí solos: distinguen mal entre dos tarjetas
// y aparecen en lenguaje corriente. La secuencia COMPLETA del nombre sí cuenta.
// Además de palabra entera, la mención exige CONTEXTO DE INSTRUMENTO: la palabra
// previa debe indicar medio de pago ("con Supervielle", "desde Galicia") o el
// nombre debe abrir el mensaje. Así "me fui a Galicia de viaje" (previa: "a") no
// es evidencia, y "lo pagué con Galicia" sí.
// "en" queda FUERA a propósito: es el conector de LUGAR ("comí en Galicia
// Restaurant") y colaba comercios homónimos como si fueran el instrumento.
const INSTRUMENT_CUE_TOKENS = new Set(["con", "desde", "por", "via", "cuenta", "tarjeta", "banco", "cta"]);

export function instrumentMentioned(rawMessage: string, name: string): boolean {
  const msgTokens = normName(rawMessage).split(/\s+/).filter(Boolean);
  const nameTokens = normName(name).split(/\s+/).filter(Boolean);
  if (!nameTokens.length || !msgTokens.length) return false;
  const cued = (at: number) => at === 0 || INSTRUMENT_CUE_TOKENS.has(msgTokens[at - 1]);
  // (a) el nombre completo aparece como secuencia de palabras, con contexto
  for (let i = 0; i + nameTokens.length <= msgTokens.length; i += 1) {
    if (nameTokens.every((t, k) => msgTokens[i + k] === t) && cued(i)) return true;
  }
  // (b) un token DISTINTIVO del nombre, como palabra entera y con contexto
  const distinct = new Set(nameTokens.filter((t) => t.length >= 4 && !INSTRUMENT_NAME_STOPWORDS.has(t)));
  return msgTokens.some((tok, i) => distinct.has(tok) && cued(i));
}

function chosenAccountEvidence(ctx: AgentContext, acc: { name: string; isCurrencyDefault?: boolean }): "mentioned" | "learned" | "none" {
  if (ctx.operationManifestAuthorized === true) return "mentioned";
  if (instrumentMentioned(ctx.rawMessage ?? "", acc.name)) return "mentioned";
  if (acc.isCurrencyDefault === true) return "learned";
  return "none";
}

export function buildMovementEntry(
  args: Record<string, unknown>,
  ctx: AgentContext,
): BuiltMovement {
  const type = String(args.type ?? "");
  const amount = toCents(Number(args.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "monto inválido" };
  }
  // Reject a provided-but-impossible date instead of silently dropping it.
  if (
    args.occurredAtISO !== undefined &&
    args.occurredAtISO !== null &&
    validOccurredAtISO(args.occurredAtISO, todayISO(ctx)) === undefined
  ) {
    return { ok: false, reason: "fecha inválida" };
  }
  const description = String(args.description ?? "").trim() || "Movimiento";
  let source = ctx.accounts.find((a) => a.id === args.sourceAccountId);
  const debt = ctx.debtAccounts.find((d) => d.id === args.debtAccountId);
  const dest = ctx.accounts.find((a) => a.id === args.destinationAccountId);
  const goal = ctx.goals.find((g) => g.id === args.goalId);
  const prov = movementProvenance(args, ctx);
  const base = {
    userId: ctx.userId,
    description,
    confidenceScore: prov.parserConfidenceScore,
    rawInput: ctx.rawMessage,
    inputChannel: channelToInputChannel(ctx.channel),
    evidenceId: prov.evidenceId,
    externalRef: prov.externalRef,
    occurredAtISO: prov.occurredAtISO,
  };
  // Canonical currency resolution: explicit (user/evidence) → instrument →
  // primary → ask. Base/FX derived only with a trusted rate (no invented USD,
  // no fabricated rate).
  const explicitCurrency = typeof args.currency === "string" ? args.currency : null;
  const resolveCur = (instruments: (string | null | undefined)[]) =>
    resolveAgentMovementCurrency(ctx, { explicit: explicitCurrency, instruments });
  const currencyError = (cr: { ok: false; reason: "unresolved" } | { ok: false; reason: "fx_unavailable"; original: CurrencyCode; base: CurrencyCode }): BuiltMovement =>
    cr.reason === "fx_unavailable"
      ? { ok: false, reason: ctx.fxRatesReadOk === false
          ? `no pude leer las tasas vigentes para valorar ${cr.original} en ${cr.base}; no registré nada y necesito reintentar la lectura`
          : `ese movimiento está en ${cr.original}, distinta a tu moneda base ${cr.base}; todavía no puedo convertirlo sin un tipo de cambio confiable — dime la tasa ${cr.original}→${cr.base} o lo vemos aparte` }
      : { ok: false, reason: "no pude determinar la moneda; ¿en qué moneda fue?" };
  const currencyFields = (r: CurrencyResolution) => ({
    originalCurrency: r.original,
    baseCurrency: r.base,
    exchangeRateToBase: r.exchangeRateToBase,
  });

  if (type === "expense") {
    // J-1 (re-auditado) — la MONEDA manda la cuenta, con ELECCIÓN ≠ OMISIÓN:
    // un instrumento ELEGIDO en otra moneda se PREGUNTA (sustituirlo en silencio
    // registraba el gasto en una tarjeta que el usuario no nombró); el auto-assign
    // existe solo con instrumento OMITIDO + moneda explícita + exactamente UNA
    // cuenta ORDINARIA (ni de meta ni no-líquida) en esa moneda. Las tarjetas
    // jamás se auto-asignan por moneda.
    // Re-auditoría 2 (P2): cuenta Y tarjeta a la vez es ambiguo SIEMPRE — el ledger
    // lo rechazaría tarde con un error críptico; mejor una aclaración inmediata.
    if (source && debt) {
      return { ok: false, reason: `llegaron una cuenta (${source.name}) Y una tarjeta (${debt.name}) para el mismo gasto — pregúntale si salió de la cuenta o fue con la tarjeta, y re-llama con UNO solo` };
    }
    let source2 = source;
    const debt2 = debt;
    let repickNote = "";
    if (!source2 && !debt2) {
      if (!explicitCurrency) return { ok: false, reason: "falta cuenta o tarjeta" };
      const pick = planCashAccountForCurrency({
        currency: explicitCurrency,
        chosen: null,
        candidates: ctx.accounts.map((a) => ({
          id: a.id, name: a.name, currency: (a.currency as string | null) ?? null,
          ordinary: !a.isGoalAccount && a.liquidity !== "non_liquid",
          isDefault: a.isCurrencyDefault === true,
        })),
      });
      if (pick.route === "assign") {
        source2 = ctx.accounts.find((a) => a.id === pick.accountId);
        repickNote = pick.basis === "default"
          ? ` Lo registré desde ${pick.accountName} — la cuenta que dejó fijada para ${explicitCurrency} (tiene más de una); díselo en una frase.`
          : ` Lo registré desde ${pick.accountName} — su única cuenta en ${explicitCurrency}; díselo en una frase.`;
      } else if (pick.route === "ask") {
        return { ok: false, reason: pick.reason === "none"
          ? `ese gasto está en ${explicitCurrency} y no tiene cuenta en esa moneda — pregúntale de dónde salió (¿tarjeta? ¿cuenta nueva? ¿el monto en otra moneda?)`
          : pick.reason === "only_protected"
            ? `la única cuenta en ${explicitCurrency} es protegida (${pick.candidates.map((c) => c.name).join(", ")}) — pregúntale si de verdad salió de ahí antes de registrar`
            : `tiene varias cuentas en ${explicitCurrency} (${pick.candidates.map((c) => c.name).join(", ")}) — pregúntale de cuál salió` };
      }
    } else if (explicitCurrency && source2 && !debt2) {
      const pick = planCashAccountForCurrency({
        currency: explicitCurrency,
        chosen: { id: source2.id, name: source2.name, currency: (source2.currency as string | null) ?? null },
        candidates: ctx.accounts.map((a) => ({ id: a.id, name: a.name, currency: (a.currency as string | null) ?? null })),
        chosenEvidence: chosenAccountEvidence(ctx, source2),
      });
      if (pick.route === "ask") {
        if (pick.reason === "unproven_choice") {
          return { ok: false, reason: `hay varias cuentas en ${explicitCurrency} (${pick.candidates.map((c) => c.name).join(", ")}) y el usuario no nombró ninguna — pregúntale de cuál salió antes de registrar (si te dice "siempre con X", guárdalo con update_account makeCurrencyDefault)` };
        }
        const opts = pick.candidates.length ? ` (¿fue con ${pick.candidates.map((c) => c.name).join(" o ")}?)` : "";
        return { ok: false, reason: `ese gasto está en ${explicitCurrency} pero ${source2.name} está en ${source2.currency} — NO lo registres en otra cuenta sin preguntar${opts}; también puede darte el monto en ${source2.currency}` };
      }
    } else if (explicitCurrency && debt2 && !source2) {
      const pick = planCashAccountForCurrency({
        currency: explicitCurrency,
        chosen: { id: debt2.id, name: debt2.name, currency: (debt2.currency as string | null) ?? null },
        candidates: ctx.debtAccounts
          .filter((d) => d.type === "credit_card")
          .map((d) => ({ id: d.id, name: d.name, currency: (d.currency as string | null) ?? null })),
        chosenEvidence: instrumentMentioned(ctx.rawMessage ?? "", debt2.name) ? "mentioned" : "none",
      });
      if (pick.route === "ask") {
        if (pick.reason === "unproven_choice") {
          return { ok: false, reason: `hay varias tarjetas en ${explicitCurrency} (${pick.candidates.map((c) => c.name).join(", ")}) y el usuario no nombró ninguna — pregúntale con cuál fue antes de registrar` };
        }
        const opts = pick.candidates.length ? ` (¿fue con ${pick.candidates.map((c) => c.name).join(" o ")}?)` : "";
        return { ok: false, reason: `ese gasto está en ${explicitCurrency} pero la ${debt2.name} está en ${debt2.currency} — NO lo cambies de tarjeta sin preguntar${opts}; también puede darte el monto en ${debt2.currency}` };
      }
    }
    // Card expense uses the CARD currency; cash expense the account currency.
    const cr = resolveCur([source2?.currency, debt2?.currency]);
    if (!cr.ok) return currencyError(cr);
    const fixedExpenseId =
      typeof args.fixedExpenseId === "string" && args.fixedExpenseId ? args.fixedExpenseId : null;
    const rawTreatment =
      args.budgetTreatment === "saldo" || args.budgetTreatment === "objective"
        ? (args.budgetTreatment as "objective" | "saldo")
        : null;
    // Stage H — 'saldo' (extraordinary) is only coherent when an active objective
    // exists for this category to bypass: without one, food/transport is reserved
    // whole and a per-txn Saldo drain would double-count. Gate it on the real
    // objective state so the confirmation can never claim a Saldo drain that the
    // engine won't apply.
    const catValue = category(args.category, "other");
    const hasObjective = ctx.briefing?.objectives?.states?.some((st) => st.category === catValue) ?? false;
    const budgetTreatment = rawTreatment === "saldo" && !hasObjective ? null : rawTreatment;
    const treatmentDropped = rawTreatment === "saldo" && !hasObjective;
    return {
      ok: true,
      summary: `Expense ${amount} recorded${debt2 ? ` on card ${debt2.name} (debt up, no cash out today)` : source2 ? ` from ${source2.name}` : ""}${fixedExpenseId ? " (linked to its recurring/fixed expense, not extra spending)" : ""}${budgetTreatment === "saldo" ? " (EXTRAORDINARY: sale directo del Saldo, no consume el objetivo del mes)" : ""}${treatmentDropped ? " (NOTA: no hay un objetivo activo de esa categoría, así que se registró normal — NO digas que salió del Saldo; si el usuario quiere separarlo, primero necesita un objetivo)" : ""}.${repickNote}`,
      entry: {
        ...base,
        type: "expense",
        effectType: "expense",
        category: category(args.category, "other"),
        originalAmount: amount,
        ...currencyFields(cr.resolution),
        sourceAccountId: source2?.id ?? null,
        debtAccountId: debt2?.id ?? null,
        recurringExpenseId: fixedExpenseId,
        budgetTreatment,
      },
    };
  }
  if (type === "income") {
    // J-1 (re-auditado) — elección ≠ omisión: destino elegido en otra moneda ⇒
    // preguntar; destino OMITIDO + única cuenta ordinaria en la moneda ⇒ asignar.
    let dest2 = dest;
    let incomeNote = "";
    if (!dest2) {
      if (!explicitCurrency) return { ok: false, reason: "falta cuenta destino" };
      const pick = planCashAccountForCurrency({
        currency: explicitCurrency,
        chosen: null,
        candidates: ctx.accounts.map((a) => ({
          id: a.id, name: a.name, currency: (a.currency as string | null) ?? null,
          ordinary: !a.isGoalAccount && a.liquidity !== "non_liquid",
          isDefault: a.isCurrencyDefault === true,
        })),
      });
      if (pick.route === "assign") {
        dest2 = ctx.accounts.find((a) => a.id === pick.accountId);
        incomeNote = pick.basis === "default"
          ? ` Lo registré en ${pick.accountName} — la cuenta que dejó fijada para ${explicitCurrency} (tiene más de una); díselo en una frase.`
          : ` Lo registré en ${pick.accountName} — su única cuenta en ${explicitCurrency}; díselo en una frase.`;
      } else if (pick.route === "ask") {
        return { ok: false, reason: pick.reason === "none"
          ? `ese ingreso está en ${explicitCurrency} y no tiene cuenta en esa moneda — pregúntale a dónde entró`
          : pick.reason === "only_protected"
            ? `la única cuenta en ${explicitCurrency} es protegida (${pick.candidates.map((c) => c.name).join(", ")}) — confírmale antes de registrar ahí`
            : `tiene varias cuentas en ${explicitCurrency} (${pick.candidates.map((c) => c.name).join(", ")}) — pregúntale a cuál entró` };
      }
    } else if (explicitCurrency) {
      const pick = planCashAccountForCurrency({
        currency: explicitCurrency,
        chosen: { id: dest2.id, name: dest2.name, currency: (dest2.currency as string | null) ?? null },
        candidates: ctx.accounts.map((a) => ({ id: a.id, name: a.name, currency: (a.currency as string | null) ?? null })),
        chosenEvidence: chosenAccountEvidence(ctx, dest2),
      });
      if (pick.route === "ask") {
        if (pick.reason === "unproven_choice") {
          return { ok: false, reason: `hay varias cuentas en ${explicitCurrency} (${pick.candidates.map((c) => c.name).join(", ")}) y el usuario no nombró ninguna — pregúntale a cuál entró antes de registrar` };
        }
        const opts = pick.candidates.length ? ` (¿entró a ${pick.candidates.map((c) => c.name).join(" o ")}?)` : "";
        return { ok: false, reason: `ese ingreso está en ${explicitCurrency} pero ${dest2.name} está en ${dest2.currency} — NO lo muevas de cuenta sin preguntar${opts}` };
      }
    }
    if (!dest2) return { ok: false, reason: "falta cuenta destino" };
    const cr = resolveCur([dest2.currency]);
    if (!cr.ok) return currencyError(cr);
    return {
      ok: true,
      summary: `Income ${amount} recorded to ${dest2.name}.${incomeNote}`,
      entry: {
        ...base,
        type: "income",
        effectType: "income",
        category: "income",
        originalAmount: amount,
        ...currencyFields(cr.resolution),
        destinationAccountId: dest2.id,
      },
    };
  }
  if (type === "debt_payment") {
    // J-1 (re-auditado) — la DEUDA la nombra siempre el usuario (jamás se infiere);
    // la CUENTA origen: elegida en otra moneda ⇒ preguntar (sin sustituir);
    // omitida + única cuenta ordinaria en la moneda ⇒ asignar.
    if (!debt) return { ok: false, reason: "falta la tarjeta/deuda que pagó" };
    if (!source && explicitCurrency) {
      const pick = planCashAccountForCurrency({
        currency: explicitCurrency,
        chosen: null,
        candidates: ctx.accounts.map((a) => ({
          id: a.id, name: a.name, currency: (a.currency as string | null) ?? null,
          ordinary: !a.isGoalAccount && a.liquidity !== "non_liquid",
          isDefault: a.isCurrencyDefault === true,
        })),
      });
      if (pick.route === "assign") {
        source = ctx.accounts.find((a) => a.id === pick.accountId);
      } else if (pick.route === "ask" && pick.reason !== "none") {
        return { ok: false, reason: pick.reason === "only_protected"
          ? `la única cuenta en ${explicitCurrency} es protegida (${pick.candidates.map((c) => c.name).join(", ")}) — confírmale antes de pagar desde ahí`
          : `tiene varias cuentas en ${explicitCurrency} (${pick.candidates.map((c) => c.name).join(", ")}) — pregúntale desde cuál pagó` };
      }
    }
    if (!source) return { ok: false, reason: "falta cuenta de origen" };
    if (explicitCurrency) {
      const pick = planCashAccountForCurrency({
        currency: explicitCurrency,
        chosen: { id: source.id, name: source.name, currency: (source.currency as string | null) ?? null },
        candidates: ctx.accounts.map((a) => ({ id: a.id, name: a.name, currency: (a.currency as string | null) ?? null })),
        chosenEvidence: chosenAccountEvidence(ctx, source),
      });
      if (pick.route === "ask") {
        if (pick.reason === "unproven_choice") {
          return { ok: false, reason: `hay varias cuentas en ${explicitCurrency} (${pick.candidates.map((c) => c.name).join(", ")}) y el usuario no nombró ninguna — pregúntale desde cuál pagó` };
        }
        const opts = pick.candidates.length ? ` (¿salió de ${pick.candidates.map((c) => c.name).join(" o ")}?)` : "";
        return { ok: false, reason: `ese pago está en ${explicitCurrency} pero ${source.name} está en ${source.currency} — NO lo muevas de cuenta sin preguntar${opts}` };
      }
    }
    // A cross-currency card payment needs a trusted rate; don't pretend the
    // account and card currencies are equal when they differ.
    if (source.currency !== debt.currency) {
      return { ok: false, reason: `el pago sale de ${source.name} (${source.currency}) hacia ${debt.name} (${debt.currency}) — son monedas distintas y necesito un tipo de cambio confiable; dímelo o lo vemos aparte` };
    }
    const cr = resolveCur([source.currency]);
    if (!cr.ok) return currencyError(cr);
    return {
      ok: true,
      summary: `Debt payment ${amount} from ${source.name} to ${debt.name} (account down, debt down, not a new expense).`,
      entry: {
        ...base,
        type: "debt_payment",
        effectType: "debt_payment",
        category: "debt",
        originalAmount: amount,
        ...currencyFields(cr.resolution),
        sourceAccountId: source.id,
        debtAccountId: debt.id,
      },
    };
  }
  if (type === "goal_contribution") {
    // J-1 (re-auditado) — la META la nombra el usuario; la cuenta origen: elegida
    // en otra moneda ⇒ preguntar; omitida + única ordinaria ⇒ asignar.
    if (!goal) return { ok: false, reason: "falta la meta" };
    if (!source && explicitCurrency) {
      const pick = planCashAccountForCurrency({
        currency: explicitCurrency,
        chosen: null,
        candidates: ctx.accounts.map((a) => ({
          id: a.id, name: a.name, currency: (a.currency as string | null) ?? null,
          ordinary: !a.isGoalAccount && a.liquidity !== "non_liquid",
          isDefault: a.isCurrencyDefault === true,
        })),
      });
      if (pick.route === "assign") {
        source = ctx.accounts.find((a) => a.id === pick.accountId);
      } else if (pick.route === "ask" && pick.reason !== "none") {
        return { ok: false, reason: pick.reason === "only_protected"
          ? `la única cuenta en ${explicitCurrency} es protegida (${pick.candidates.map((c) => c.name).join(", ")}) — confírmale antes de aportar desde ahí`
          : `tiene varias cuentas en ${explicitCurrency} (${pick.candidates.map((c) => c.name).join(", ")}) — pregúntale de cuál sale` };
      }
    }
    if (!source) return { ok: false, reason: "falta cuenta de origen" };
    if (explicitCurrency) {
      const pick = planCashAccountForCurrency({
        currency: explicitCurrency,
        chosen: { id: source.id, name: source.name, currency: (source.currency as string | null) ?? null },
        candidates: ctx.accounts.map((a) => ({ id: a.id, name: a.name, currency: (a.currency as string | null) ?? null })),
        chosenEvidence: chosenAccountEvidence(ctx, source),
      });
      if (pick.route === "ask") {
        if (pick.reason === "unproven_choice") {
          return { ok: false, reason: `hay varias cuentas en ${explicitCurrency} (${pick.candidates.map((c) => c.name).join(", ")}) y el usuario no nombró ninguna — pregúntale de cuál sale el aporte` };
        }
        const opts = pick.candidates.length ? ` (¿sale de ${pick.candidates.map((c) => c.name).join(" o ")}?)` : "";
        return { ok: false, reason: `ese aporte está en ${explicitCurrency} pero ${source.name} está en ${source.currency} — NO lo muevas de cuenta sin preguntar${opts}` };
      }
    }
    const goalAccountId = goal.goalAccountId ?? ctx.accounts.find((a) => a.isGoalAccount)?.id ?? null;
    const cr = resolveCur([source.currency]);
    if (!cr.ok) return currencyError(cr);
    // J-1 re-auditoría (P1): el ledger hace goals.current_amount += ORIGINAL —
    // un aporte de 5000 ARS a una meta en USD sumaría 5000 DÓLARES a la meta.
    // La moneda NATIVA de la meta es originalCurrency cuando el contexto la
    // re-expresó a base; currency ya es la nativa cuando no hubo conversión.
    const goalNativeCur = String(goal.originalCurrency ?? goal.currency ?? "").trim().toUpperCase();
    if (goalNativeCur && String(cr.resolution.original).toUpperCase() !== goalNativeCur) {
      return { ok: false, reason: `la meta "${goal.name}" está en ${goalNativeCur} y el aporte saldría en ${cr.resolution.original} — la meta acumula en SU moneda; pídele el monto en ${goalNativeCur} o que aporte desde una cuenta en ${goalNativeCur}` };
    }
    return {
      ok: true,
      summary: `Goal contribution ${amount} from ${source.name} to ${goal.name}.`,
      entry: {
        ...base,
        type: "goal_contribution",
        effectType: "goal_contribution",
        category: "savings",
        originalAmount: amount,
        ...currencyFields(cr.resolution),
        sourceAccountId: source.id,
        destinationAccountId: goalAccountId,
        goalId: goal.id,
      },
    };
  }
  return { ok: false, reason: `tipo inválido (${type || "vacío"})`, fatal: true };
}

// Record ONE movement through the atomic canonical writer (insert + balance
// delta in a single transaction, against fresh DB state). Provenance (evidence
// id + bank reference) is set AT INSERT TIME. Duplicate detection is handled by
// the application-level matcher before the agent is invoked.
// Conservative SEMANTIC duplicate safeguard for a TYPED/SPOKEN movement (not
// evidence). If a very recent EXACT match exists (same type/amount/currency/
// source AND date proximity), ask one short question instead of silently writing
// a possible re-entry of an already-recorded event. Fail-OPEN on a read error
// (the write is the user's explicit intent; never block it on a DB blip).
// Shared duplicate-check context: the recent movement keys (enriched with a merchant
// dedupe token + category so the NEAR check works) + the learned merchant overrides,
// loaded ONCE so a batch can check every row without re-hitting the DB per row.
export interface DuplicateContext {
  recentKeys: RecentMovementKey[];
  overrides: MerchantOverride[];
}

export type DuplicateContextRead =
  | { ok: true; complete: true; context: DuplicateContext }
  | { ok: true; complete: false }
  | { ok: false; complete: false };

function duplicateContextFromRecent(
  recent: CompleteRecentTransactionsRead & { ok: true; complete: true },
  overrides: MerchantOverride[],
): DuplicateContext {
  const recentKeys: RecentMovementKey[] = recent.recent.transactions
    .filter((t) => t.type !== "reversal" && t.type !== "adjustment" && !recent.recent.reversedOriginalIds.has(t.id))
    .map((t) => ({
      type: t.type,
      cents: Math.round(t.originalAmount * 100),
      currency: t.originalCurrency,
      sourceId: t.sourceAccountId ?? t.debtAccountId ?? null,
      occurredAtMs: Date.parse(t.occurredAt),
      createdAtMs: Date.parse(t.createdAt),
      merchantToken: t.type === "expense" ? merchantDedupeToken(t.description, overrides) : "",
      correctionToken: correctionIdentityToken(t.description),
      category: t.category ?? null,
      id: t.id,
      description: t.description ?? null,
      budgetTreatment: t.budgetTreatment ?? null,
      relatedTransactionId: t.relatedTransactionId ?? null,
      recurringExpenseId: t.recurringExpenseId ?? null,
      externalRef: t.externalRef ?? null,
    }));
  return { recentKeys, overrides };
}

export async function readDuplicateContextWith(
  readRecent: () => Promise<CompleteRecentTransactionsRead>,
  readOverrides: () => Promise<MerchantOverride[]>,
): Promise<DuplicateContextRead> {
  const recent = await readRecent();
  if (!recent.ok) return { ok: false, complete: false };
  if (!recent.complete) return { ok: true, complete: false };
  let overrides: MerchantOverride[] = [];
  try {
    overrides = await readOverrides();
  } catch {
    overrides = [];
  }
  return {
    ok: true,
    complete: true,
    context: duplicateContextFromRecent(recent, overrides),
  };
}

async function loadDuplicateContext(userId: string): Promise<DuplicateContextRead> {
  return readDuplicateContextWith(
    () => readRecentTransactionsForCorrection(userId),
    () => loadMerchantMemory(userId),
  );
}

const REFUND_MATCH_WINDOW_DAYS = 60;

async function loadRefundContext(userId: string): Promise<DuplicateContextRead> {
  return readDuplicateContextWith(
    () =>
      readRecentTransactionsForCorrection(userId, {
        windowHours: REFUND_MATCH_WINDOW_DAYS * 24,
      }),
    () => loadMerchantMemory(userId),
  );
}

/** L-1 — the exact decision consumed by the live executor. Tool arguments are
 * model proposals, not proof. The only authorities are a complete ledger read,
 * a validated original id, or an explicit user statement that no original was
 * ever recorded. */
export function planPersonRefundRegistration(input: {
  amount: number;
  currency: string;
  message: string;
  originalTransactionId?: string | null;
  originalWasNotRecorded?: boolean;
  read: DuplicateContextRead;
  nowMs: number;
}): RefundRegistrationDecision {
  const original =
    input.read.ok && input.read.complete
      ? refundOriginalTarget({
          amount: input.amount,
          currency: input.currency,
          message: input.message,
          recent: input.read.context.recentKeys,
          nowMs: input.nowMs,
          originalTransactionId: input.originalTransactionId,
          windowDays: REFUND_MATCH_WINDOW_DAYS,
        })
      : null;
  return refundRegistrationDecision({
    original,
    confirmedUnrecorded:
      input.originalWasNotRecorded === true &&
      refundOriginalWasNotRecorded(input.message),
    isValidCategory: (value) =>
      VALID_PURCHASE_CATEGORIES.has(value as FinancialCategory),
  });
}

// J-2 — una CORRECCIÓN no se registra, se corrige. El error real: «no era con
// Pichincha, era Supervielle» escribió un gasto nuevo y el mismo dinero salió dos
// veces. Determinista: reformulación correctiva del usuario (calculada por el
// ejecutor sobre su mensaje, como `instrumentMentioned`) + un movimiento reciente
// compatible. NO lo abre `confirmedNew`: ese flag responde otra pregunta —«fueron
// dos compras distintas»—, no «me estoy refiriendo a la que ya registraste».
function correctionRedirect(
  rawMessage: string,
  entry: LedgerEntryInput,
  dup: DuplicateContext,
): ToolResult | null {
  const candidate: RecentMovementKey = {
    type: entry.type,
    cents: Math.round(entry.originalAmount * 100),
    currency: entry.originalCurrency,
    sourceId: entry.sourceAccountId ?? entry.debtAccountId ?? null,
    occurredAtMs: entry.occurredAtISO ? Date.parse(entry.occurredAtISO) : Date.now(),
    createdAtMs: Date.now(),
    merchantToken: entry.type === "expense" ? merchantDedupeToken(entry.description, dup.overrides) : "",
    correctionToken: correctionIdentityToken(entry.description),
    category: entry.category ?? null,
  };
  const targets = movementCorrectionTargets(rawMessage, candidate, dup.recentKeys, {
    windowMs: 36 * 60 * 60_000,
  }).filter((t) => t.id);
  const first = targets[0];
  if (!first) return null;
  const label = (t: RecentMovementKey) =>
    `${t.id} — ${(t.description ?? "").trim() || "sin descripción"} (${money(t.cents / 100, t.currency)})`;
  if (targets.length === 1) {
    return {
      status: "redirect",
      summary: `Eso es una CORRECCIÓN de un movimiento que ya registré, no uno nuevo: ${label(first)}. Llama correct_movement con transactionId=${first.id} y solo el campo que cambió (newSourceAccountId / newDebtAccountId / newAmount / newOccurredAtISO / newCategory / newDescription). NO uses log_movement: registrarlo otra vez cobraría el mismo dinero dos veces.`,
      data: { transactionId: first.id, correctionBlocked: true },
    };
  }
  return {
    status: "needs_info",
    data: { correctionBlocked: true },
    summary: `Eso suena a una CORRECCIÓN, no a un movimiento nuevo, y hay ${targets.length} candidatos recientes: ${targets.slice(0, 3).map(label).join(" · ")}. Pregúntale cuál corrige (distínguelos por su descripción o su cuenta) y luego llama correct_movement con ese transactionId. NO uses log_movement.`,
  };
}

// Pure: given a prebuilt context, does this entry look like a re-entry of something
// already recorded? Two safeguards, both ASK (never suppress): an EXACT match on the
// same account/card, or a NEAR match (same merchant + amount + day) across ANY account.
function duplicateQuestion(entry: LedgerEntryInput, dup: DuplicateContext): string | null {
  const candidate: RecentMovementKey = {
    type: entry.type,
    cents: Math.round(entry.originalAmount * 100),
    currency: entry.originalCurrency,
    sourceId: entry.sourceAccountId ?? entry.debtAccountId ?? null,
    occurredAtMs: entry.occurredAtISO ? Date.parse(entry.occurredAtISO) : Date.now(),
    merchantToken: entry.type === "expense" ? merchantDedupeToken(entry.description, dup.overrides) : "",
    category: entry.category ?? null,
  };
  const windowMs = 36 * 60 * 60_000;
  if (recentExactDuplicate(candidate, dup.recentKeys, { windowMs })) {
    const where = entry.debtAccountId ? "esa tarjeta" : "esa cuenta";
    return `Ya tengo un movimiento igual hace poco (${money(entry.originalAmount, entry.originalCurrency)} en ${where}). ¿Es el mismo que ya registré o fue otro igual? Si fue otro, lo registro.`;
  }
  if (recentNearDuplicate(candidate, dup.recentKeys, { windowMs })) {
    const desc = (entry.description ?? "").trim();
    const label = desc ? `"${desc}" (${money(entry.originalAmount, entry.originalCurrency)})` : money(entry.originalAmount, entry.originalCurrency);
    return `Ya registré un gasto casi idéntico hace poco: ${label}. ¿Es el mismo que ya anoté o fueron dos compras distintas? Si fueron dos, lo registro.`;
  }
  return null;
}

export async function guardMovementWritesWith(
  input: {
    rawMessage: string;
    entries: LedgerEntryInput[];
    evidenceId?: string | null;
    confirmedNew?: boolean;
    batch?: boolean;
  },
  readContext: () => Promise<DuplicateContextRead>,
): Promise<ToolResult | null> {
  const correcting = correctivePhrasing(input.rawMessage);
  if (!correcting && input.evidenceId) return null;

  const read = await readContext();
  if (!read.ok || !read.complete) {
    if (!correcting) return null;
    return {
      status: "needs_info",
      // La marca viaja al loop del agente: un turno con la corrección bloqueada
      // NO puede caer al pipeline legacy, que reprocesaría el mismo mensaje.
      data: { correctionBlocked: true },
      summary: input.batch
        ? "Suena a una corrección y no pude probar que leí todos tus movimientos recientes. NO registré NADA del lote; reinténtalo en un rato."
        : "Suena a una corrección y no pude probar que leí todos tus movimientos recientes. NO registré nada nuevo; reinténtalo en un rato.",
    };
  }

  if (correcting) {
    for (const entry of input.entries) {
      const redirect = correctionRedirect(input.rawMessage, entry, read.context);
      if (redirect) {
        return input.batch
          ? { ...redirect, summary: `No registré NADA del lote. ${redirect.summary}` }
          : redirect;
      }
    }
    return {
      status: "needs_info",
      data: { correctionBlocked: true },
      summary: input.batch
        ? "No registré NADA del lote: entendí que estabas corrigiendo algo, pero no pude identificar con seguridad cuál movimiento reciente era. Dime cuál era o pídeme listar los recientes."
        : "No registré nada nuevo: entendí que estabas corrigiendo algo, pero no pude identificar con seguridad cuál movimiento reciente era. Dime cuál era o pídeme listar los recientes.",
    };
  }

  if (input.evidenceId || input.confirmedNew) return null;
  const flagged = input.entries
    .map((entry) => ({ entry, question: duplicateQuestion(entry, read.context) }))
    .filter((item): item is { entry: LedgerEntryInput; question: string } => item.question !== null);
  if (flagged.length === 0) return null;
  if (!input.batch) {
    return {
      status: "needs_info",
      data: { duplicateConfirmationRequired: true },
      summary: flagged[0].question,
    };
  }
  return {
    status: "needs_info",
    data: { duplicateConfirmationRequired: true },
    summary: `No registré el lote todavía: ${flagged.length} ${flagged.length === 1 ? "fila parece" : "filas parecen"} repetir algo que ya tengo (${flagged.map(({ entry }) => `${(entry.description ?? "movimiento").trim()} (${money(entry.originalAmount, entry.originalCurrency)})`).join("; ")}). ¿Son movimientos nuevos y distintos? Si me confirmas que sí, los guardo.`,
  };
}

async function issueDuplicateConfirmation(
  toolName: string,
  args: Record<string, unknown>,
  ctx: AgentContext,
  question: string,
): Promise<ToolResult> {
  const desiredArgs = { ...args, confirmedNew: true };
  const guarded = await guardServerConfirmedActionWith(
    toolName,
    desiredArgs,
    ctx,
    { proposalSummary: actionProposalSummary(toolName, desiredArgs, ctx) },
  );
  return (
    guarded.result ?? {
      status: "error",
      summary:
        `${question} No pude guardar esa confirmación de forma durable, así que no registré nada.`,
    }
  );
}

// S31 (item 1.7) — "Se deposita en": when the user logs an INCOME without
// naming the account, default to the destination account the matching income
// source declares (captured at onboarding / create_income) instead of asking.
// Only on an UNAMBIGUOUS mapping: the text names exactly one income, or there
// is exactly one destination-bearing income and the text reads like a payday.
// Anything less keeps the existing ask — we never guess a money destination.
const GENERIC_PAYDAY_RE = /(sueldo|salario|n[oó]mina|quincena|me pagaron|me pag[oó]|dep[oó]sit|cobr[eé]|freelance)/;
async function defaultIncomeDestinationId(
  ctx: AgentContext,
  text: string,
): Promise<{ ok: true; destinationId: string | null } | { ok: false }> {
  const read = await readIncomeSources(ctx.userId);
  if (!read.ok || !read.complete) return { ok: false };
  const withDest = read.sources.filter(
    (i) =>
      i.status === "active" &&
      i.destinationAccountId &&
      ctx.accounts.some((a) => a.id === i.destinationAccountId && !a.isGoalAccount),
  );
  if (withDest.length === 0) return { ok: true, destinationId: null };
  const t = normName(text);
  const byName = withDest.filter((i) => {
    const n = normName(i.name);
    return n.length >= 3 && (t.includes(n) || n.includes(t));
  });
  if (byName.length === 1) return { ok: true, destinationId: byName[0].destinationAccountId };
  if (byName.length > 1) return { ok: true, destinationId: null };
  if (withDest.length === 1 && GENERIC_PAYDAY_RE.test(t)) {
    return { ok: true, destinationId: withDest[0].destinationAccountId };
  }
  return { ok: true, destinationId: null };
}

export function validateFixedExpenseMovementLink(
  args: Record<string, unknown>,
  ctx: Pick<
    AgentContext,
    "rawMessage" | "entityAuthorityMessages" | "fixedExpenses" | "accounts"
  >,
  evidenceText = ctx.rawMessage,
  serverAuthorized = false,
): { ok: true } | { ok: false; reason: string } {
  const linkedId =
    typeof args.fixedExpenseId === "string" && args.fixedExpenseId.trim()
      ? args.fixedExpenseId.trim()
      : null;
  const fixedExpenses = ctx.fixedExpenses ?? [];
  const nativeExpenses = fixedExpenses.map((expense) => ({
    ...expense,
    amount:
      expense.originalAmount ??
      expense.declaredAmount ??
      expense.amount,
    currency: expense.originalCurrency ?? expense.currency,
  }));
  if (!linkedId) {
    if (String(args.type ?? "") !== "expense") return { ok: true };
    // fixedExpenseId is chosen by the model, so its omission cannot be
    // authority to bypass the variable-bill lifecycle. Keep the user's words
    // as the naming evidence and append only the already-proposed amount so a
    // terse "pagué la luz" is still recognized without trusting a
    // model-invented description.
    const detected = matchFixedExpense(
      `${evidenceText} ${String(args.amount ?? "")}`,
      nativeExpenses,
      ctx.accounts,
    );
    const detectedVariable =
      detected.matchedExpense?.isVariable === true
        ? detected.matchedExpense
        : detected.candidateExpenses?.find(
            (expense) => expense.isVariable === true,
          );
    if (detectedVariable) {
      return {
        ok: false,
        reason:
          `"${detectedVariable.name}" es una factura variable y no puede entrar como gasto común aunque falte fixedExpenseId. ` +
          "Usa resolve_recurring_occurrence para distinguir recibo de pago y probar la fuente. No escribí nada.",
      };
    }
    return { ok: true };
  }
  if (String(args.type ?? "") !== "expense") {
    return {
      ok: false,
      reason:
        "un vínculo a gasto fijo solo es válido en una salida; quita fixedExpenseId y revisa el tipo",
    };
  }
  const target = fixedExpenses.find(
    (expense) => expense.id === linkedId && expense.isActive,
  );
  if (!target) {
    return {
      ok: false,
      reason:
        "el gasto fijo vinculado no existe, no está activo o no pertenece al contexto probado",
    };
  }
  if (target.isVariable) {
    return {
      ok: false,
      reason:
        `"${target.name}" es una factura variable: log_movement no puede probar si solo llegó el recibo ni desde dónde se pagó. ` +
        "Usa resolve_recurring_occurrence (observe sin caja; confirm/correct solo con pago y fuente explícitos). No escribí nada.",
    };
  }
  // A later bare “sí” contains no bill name/amount. It is authority only when
  // the server atomically claimed the exact stored proposal; that proposal
  // renders fixedExpenseId as the human plan name (see actionProposalSummary).
  // Re-running lexical evidence against “sí” would turn a guard into a
  // permanent lock-out after a legitimate multi-amount confirmation.
  if (serverAuthorized) return { ok: true };
  // Entity authority belongs to the exact durable operation, not only its
  // latest delivery. A continuation such as “desde Supervielle” completes the
  // source of the “pagué el arriendo” root turn; asking it to repeat Arriendo
  // adds no authority. The current turn still has precedence: explicitly
  // naming a different fixed expense is a correction, never permission to use
  // the stale target selected earlier in the operation.
  const peers = nativeExpenses.map((expense) => ({ name: expense.name }));
  const currentNamesTarget = namedEntityWasStated(
    ctx.rawMessage,
    target.name,
    peers,
  );
  const currentNamesOther = nativeExpenses.some(
    (expense) =>
      expense.id !== target.id &&
      namedEntityWasStated(ctx.rawMessage, expense.name, peers),
  );
  if (currentNamesOther && !currentNamesTarget) {
    return {
      ok: false,
      reason:
        `el mensaje actual nombra otro gasto fijo, no "${target.name}". ` +
        "No vinculé el movimiento; vuelve a planificar con la entidad corregida.",
    };
  }
  const operationEvidence = [
    ...(ctx.entityAuthorityMessages ?? []),
    evidenceText,
    String(args.amount ?? ""),
  ]
    .filter(Boolean)
    .join("\n");
  const matched = matchFixedExpense(
    operationEvidence,
    nativeExpenses,
    ctx.accounts,
  );
  if (
    matched.status !== "confident_match" ||
    matched.matchedExpense?.id !== target.id
  ) {
    return {
      ok: false,
      reason:
        matched.clarificationQuestion ??
        `no pude probar que este movimiento sea "${target.name}". No lo vinculé ni aprendí como factura; nombra el gasto fijo o regístralo como gasto aparte`,
    };
  }
  return { ok: true };
}

async function executeLogMovement(
  args: Record<string, unknown>,
  ctx: AgentContext,
  serverAuthorized = false,
): Promise<ToolResult> {
  const calendarGuard = guardUnavailableCalendarReplyWrite(ctx, {
    confirmedUnrelated: args.confirmedNew === true,
  });
  if (calendarGuard) return calendarGuard;
  // Item 1.7 — fill the income destination from the income source's saved
  // "Se deposita en" account when the user didn't name one (unambiguous only).
  if (String(args.type ?? "") === "income" && !args.destinationAccountId) {
    const def = await defaultIncomeDestinationId(ctx, `${String(args.description ?? "")} ${ctx.rawMessage}`);
    if (!def.ok) {
      return {
        status: "error",
        summary:
          "No pude leer de forma completa las fuentes de ingreso y no voy a adivinar dónde se depositó. No registré nada; reintenta.",
      };
    }
    if (def.destinationId) args = { ...args, destinationAccountId: def.destinationId };
  }
  const fixedLink = validateFixedExpenseMovementLink(
    args,
    ctx,
    ctx.rawMessage,
    serverAuthorized,
  );
  if (!fixedLink.ok) {
    return { status: "needs_info", summary: fixedLink.reason };
  }
  // Build WITHOUT assigning the dedupe occurrence yet, so the safeguard's
  // needs_info path doesn't consume an occurrence index (which would offset the
  // key if the user then confirms and we re-call).
  const built = buildMovementEntry(args, ctx);
  if (!built.ok) {
    return { status: built.fatal ? "refused" : "needs_info", summary: built.reason };
  }
  // J-2: la corrección se protege incluso si hay una evidencia pendiente; el
  // duplicate ask común sigue siendo solo para texto/voz. La lectura tipada y
  // completa falla cerrada únicamente cuando el mensaje realmente corrige.
  const movementGuard = ctx.operationManifestAuthorized === true
    ? null
    : await guardMovementWritesWith(
        {
          rawMessage: ctx.rawMessage ?? "",
          entries: [built.entry],
          evidenceId: ctx.evidenceId,
          confirmedNew: args.confirmedNew === true,
        },
        () => loadDuplicateContext(ctx.userId),
      );
  if (movementGuard) {
    if (
      movementGuard.data &&
      typeof movementGuard.data === "object" &&
      (movementGuard.data as { duplicateConfirmationRequired?: unknown })
        .duplicateConfirmationRequired === true
    ) {
      return issueDuplicateConfirmation(
        "log_movement",
        args,
        ctx,
        movementGuard.summary,
      );
    }
    return movementGuard;
  }
  attachDedupeKey(built.entry, ctx);
  try {
    // Pasada 5 (punto 2) — un debt_payment a una TARJETA con estado de cuenta
    // vigente NO puede escribir por el ledger genérico: dejaba full_payment_due
    // intacto detrás de un éxito. Mismo plan compartido que register_card_payment
    // y el cron; blocked_fx no ocurre por aquí (buildMovementEntry ya exige moneda
    // de la tarjeta), pero si ocurriera, se pide el dato en vez de escribir a medias.
    const card = built.entry.effectType === "debt_payment" && built.entry.debtAccountId
      ? ctx.debtAccounts.find((d) => d.id === built.entry.debtAccountId) ?? null
      : null;
    const plan = card
      ? planCardPaymentStatement({
          originalAmount: built.entry.originalAmount,
          originalCurrency: built.entry.originalCurrency,
          sourceCurrency: built.entry.sourceAccountId
            ? (ctx.accounts.find((a) => a.id === built.entry.sourceAccountId)?.currency as string | undefined) ?? null
            : null,
          baseAmount: built.entry.baseAmount ?? built.entry.originalAmount * (built.entry.exchangeRateToBase ?? 1),
          baseCurrency: built.entry.baseCurrency ?? built.entry.originalCurrency,
          cardType: card.type,
          cardCurrency: (card.currency as string | null) ?? null,
          fullPaymentDue: cardNativeStatementExpected(card, ctx.baseCurrency),
        })
      : ({ route: "plain" } as const);
    if (plan.route === "blocked_fx") {
      return { status: "needs_info", summary: `La cuenta origen y esa deuda no comparten moneda nativa. Vuelve a registrar el pago individualmente desde una cuenta en ${plan.cardCurrency}; no escribí nada porque el ledger aún no puede aplicar dos deltas nativos distintos con seguridad.` };
    }
    if (plan.route === "atomic" && card) {
      const applied = await applyCardPaymentEntry(
        {
          ...built.entry,
          dedupeKey:
            built.entry.dedupeKey ??
            `agent:cardpay:${createHash("sha256")
              .update([ctx.userId, ctx.rawMessage.trim(), Math.round(built.entry.originalAmount * 100), built.entry.originalCurrency.toUpperCase(), card.id, new Date().toISOString().slice(0, 10)].join("|"))
              .digest("hex")
              .slice(0, 32)}`,
        },
        { debtAccountId: card.id, expectedDue: plan.expectedDue, paidInCardCurrency: plan.paidInCardCurrency },
      );
      if (!applied.ok) {
        return {
          status: applied.reason === "unsafe" ? "needs_info" : "error",
          summary: applied.reason === "conflict"
            ? "El pago del mes de esa tarjeta cambió mientras registraba, así que NO registré nada para no dejarlo a medias. Dile que lo reintente."
            : applied.reason === "unsafe"
              ? "Ese pago no pasó las validaciones de tarjeta, moneda o identidad; NO registré nada. Relee la tarjeta y la cuenta y pide que lo confirme."
            : "No pude registrar el pago con certeza; NO quedó nada a medias. Dile que lo reintente en un rato.",
        };
      }
      if (applied.replayed) {
        return {
          status: "done",
          effect: "noop",
          data: { transactionId: applied.transactionId },
          summary: `Ese pago YA estaba registrado (fue un reintento del mismo mensaje); no bajé el pago del mes dos veces.`,
        };
      }
      return {
        status: "done",
        data: { transactionId: applied.transactionId },
        summary: applied.statementCovered
          ? `${built.summary} El pago del mes quedó cubierto (remanente 0).`
          : `${built.summary} Bajó también el pago del mes; todavía quedan ${money(applied.remainingDue, card.currency)} pendientes.`,
      };
    }
    const supabase = createSupabaseAdminClient();
    const transactionId = await applyLedgerEntry(supabase, built.entry);
    return { status: "done", data: { transactionId }, summary: built.summary };
  } catch (error) {
    if (isOwnershipViolation(error)) {
      return { status: "error", summary: "No pude validar que esa cuenta/tarjeta sea tuya; no registré nada." };
    }
    return { status: "error", summary: error instanceof Error ? error.message : "log_movement failed" };
  }
}

const MAX_BATCH_MOVEMENTS = 15;

function batchRowLabel(r: Record<string, unknown>): string {
  return `${String(r.description ?? r.type ?? "movimiento")} ${toCents(Number(r.amount))}`;
}

// Several movements in one pass. Safety contract: reject >15 explicitly (never
// truncate), validate EVERY row before writing anything, then write the whole
// batch as ONE atomic transaction — either every row commits (balances to the
// same account accumulate correctly) or none does. A partly-failed batch can
// never read as full success, and an interrupted batch leaves nothing to
// duplicate on retry.
export async function executeLogMovementsBatch(
  args: Record<string, unknown>,
  ctx: AgentContext,
  serverAuthorized = false,
): Promise<ToolResult> {
  const calendarGuard = guardUnavailableCalendarReplyWrite(ctx, {
    confirmedUnrelated: args.confirmedNew === true,
  });
  if (calendarGuard) return calendarGuard;
  const raw = Array.isArray(args.movements) ? args.movements : [];
  if (raw.length === 0) {
    return { status: "needs_info", summary: "No llegaron movimientos en el lote." };
  }
  if (raw.length > MAX_BATCH_MOVEMENTS) {
    return {
      status: "refused",
      summary: `Llegaron ${raw.length} movimientos; el máximo seguro por lote es ${MAX_BATCH_MOVEMENTS}. No registré nada — pídeme registrarlos en grupos de ${MAX_BATCH_MOVEMENTS} o menos.`,
    };
  }
  const rows = raw.map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : null));

  // 1. Validate + build ALL rows first. If any is malformed, write NOTHING.
  //    Build WITHOUT attaching dedupe keys here: attaching consumes per-turn
  //    occurrence indices, and a REJECTED batch must not advance them (else a
  //    later retry/replay of the same rows gets offset keys → double-import).
  const entries: LedgerEntryInput[] = [];
  const rowReceipts: string[] = [];
  const invalid: string[] = [];
  rows.forEach((r, i) => {
    if (!r) {
      invalid.push(`#${i + 1}: fila vacía`);
      return;
    }
    const fixedLink = validateFixedExpenseMovementLink(
      r,
      ctx,
      ctx.rawMessage,
      serverAuthorized,
    );
    if (!fixedLink.ok) {
      invalid.push(
        `#${i + 1} (${batchRowLabel(r)}): ${fixedLink.reason}`,
      );
      return;
    }
    const built = buildMovementEntry(r, ctx);
    if (!built.ok) invalid.push(`#${i + 1} (${batchRowLabel(r)}): ${built.reason}`);
    else {
      entries.push(built.entry);
      rowReceipts.push(built.summary);
    }
  });
  if (invalid.length > 0) {
    return {
      status: "needs_info",
      summary: `No registré NADA del lote (${invalid.length}/${rows.length} filas necesitan corrección): ${invalid.join("; ")}. Corrígelas o complétalas y reintenta el lote.`,
    };
  }

  // Un pago de deuda puede requerir una ruta especializada: tarjeta con estado
  // vigente (ledger+remanente atómicos) o instrumentos en monedas distintas (el
  // writer genérico no representa dos deltas nativos). El batch rehúsa TODO para
  // preservar su all-or-nothing y pide registrar esas filas individualmente.
  const cardStatementRows = entries
    .filter((e) => {
      if (e.effectType !== "debt_payment" || !e.debtAccountId) return false;
      const card = ctx.debtAccounts.find((d) => d.id === e.debtAccountId);
      if (!card) return false;
      return planCardPaymentStatement({
        originalAmount: e.originalAmount,
        originalCurrency: e.originalCurrency,
        sourceCurrency: e.sourceAccountId
          ? (ctx.accounts.find((a) => a.id === e.sourceAccountId)?.currency as string | undefined) ?? null
          : null,
        baseAmount: e.baseAmount ?? e.originalAmount * (e.exchangeRateToBase ?? 1),
        baseCurrency: e.baseCurrency ?? e.originalCurrency,
        cardType: card.type,
        cardCurrency: (card.currency as string | null) ?? null,
        fullPaymentDue: cardNativeStatementExpected(card, ctx.baseCurrency),
      }).route !== "plain";
    })
    .map((e) => `${(e.description ?? "pago").trim()} (${money(e.originalAmount, e.originalCurrency)})`);
  if (cardStatementRows.length > 0) {
    return {
      status: "needs_info",
      summary: `No registré NADA del lote: ${cardStatementRows.join("; ")} ${cardStatementRows.length === 1 ? "requiere" : "requieren"} la ruta segura individual (estado de tarjeta atómico o moneda nativa compatible). Registra ${cardStatementRows.length === 1 ? "ese pago" : "esos pagos"} aparte y reintenta el lote con el resto.`,
    };
  }

  // The native loop's authorized manifest already binds the exact correction
  // group. Reusing the root phrase after its undo leg has landed would
  // reinterpret the batch as a fresh correction and strand the operation
  // half-applied. Keep the legacy/on path byte-for-byte on its prior guard.
  const batchGuard =
    ctx.operationManifestAuthorized === true && ctx.loopDispatcherAuthorized === true
    ? null
    : await guardMovementWritesWith(
        {
          rawMessage: ctx.rawMessage ?? "",
          entries,
          evidenceId: ctx.evidenceId,
          confirmedNew: args.confirmedNew === true,
          batch: true,
        },
        () => loadDuplicateContext(ctx.userId),
      );
  if (batchGuard) {
    if (
      batchGuard.data &&
      typeof batchGuard.data === "object" &&
      (batchGuard.data as { duplicateConfirmationRequired?: unknown })
        .duplicateConfirmationRequired === true
    ) {
      return issueDuplicateConfirmation(
        "log_movements_batch",
        args,
        ctx,
        batchGuard.summary,
      );
    }
    return batchGuard;
  }

  // 2. All valid → assign dedupe keys NOW (only for rows that WILL be written),
  //    then ONE atomic transaction (all-or-nothing).
  for (const entry of entries) attachDedupeKey(entry, ctx);
  try {
    const ids = await applyLedgerEntriesAtomic(entries);
    // El recibo del lote es la autoridad de lo que aterrizó. Sin monto y
    // entidad POR FILA, una respuesta veraz («registré compra A por 10$ desde
    // Produbanco») no puede cruzar money_not_grounded y la publicación se
    // muere de hambre con el dinero ya escrito — el writer individual sí los
    // declara; ésta es la misma paridad.
    return {
      status: "done",
      summary:
        `Lote de ${entries.length}: ${ids.length} registrados (en una sola operación, todo o nada, sin duplicar). ` +
        rowReceipts.map((line, index) => `#${index + 1}: ${line}`).join(" "),
      data: {
        written: ids.length,
        total: entries.length,
        partial: false,
        transactionIds: ids,
        movements: entries.map((entry, index) => ({
          transactionId: ids[index] ?? null,
          type: entry.effectType,
          amount: entry.originalAmount,
          currency: entry.originalCurrency,
          description: entry.description ?? null,
        })),
      },
    };
  } catch (error) {
    if (isOwnershipViolation(error)) {
      return {
        status: "error",
        summary: "No registré NADA del lote: una de las cuentas/tarjetas no se pudo validar como tuya.",
      };
    }
    return {
      status: "error",
      summary: `No registré NADA del lote por un error al guardar (${error instanceof Error ? error.message : "desconocido"}). No quedó nada a medias; es seguro reintentar.`,
    };
  }
}

// Card obligations from statements/alerts: minimum, TOTAL due this period
// (full_payment_due — the field Margen actually uses), statement balance,
// due/cutoff days. Distinct fields, never conflated. Provided-but-invalid
// values are rejected and reported (never silently dropped behind a success).
// Omitted fields are preserved. Base balance is only set when a trusted 1:1
// conversion exists (card currency === base); otherwise the original is updated
// and the base is left untouched with an explicit note.
export interface CardObligationsDeps {
  setStatement: typeof setCardStatementDue;
  overrideDue: typeof overrideDebtDue;
  /** El UPDATE con CAS sobre debt_accounts. `rows` = filas efectivamente tocadas. */
  applyPatch: (input: {
    userId: string;
    debt: DebtAccount;
    patch: Record<string, number | string>;
    expectedNativeDue: number | null;
    fromStatement: boolean;
  }) => Promise<{ ok: true; rows: number } | { ok: false; message: string }>;
  /** Solo para pruebas: omitido en producción, donde corre el writer idempotente real. */
  recordAudit?: (input: CardStatementAuditInput) => Promise<boolean>;
}

export interface CardStatementAuditInput {
  userId: string;
  debtAccountId: string;
  operationKey: string;
  evidenceId: string | null;
  statementDate: string;
  periodEnd: string | null;
  fullPaymentDue: number | null;
  minimumPayment: number | null;
  statementBalance: number | null;
  dueDay: number | null;
  cutoffDay: number | null;
  interestRate: number | null;
  interestRateKind: string | null;
  applied: boolean;
  isCurrent: boolean;
  reason: string;
}

type CardStatementAuditRpc = (
  name: "kipu_record_debt_statement_cycle_idempotent",
  payload: { p: Record<string, unknown> },
) => PromiseLike<{
  data: { outcome?: unknown; cycle_id?: unknown } | null;
  error: { message?: string } | null;
}>;

export async function recordCardStatementCycleWith(
  rpc: CardStatementAuditRpc,
  input: CardStatementAuditInput,
): Promise<boolean> {
  try {
    const { data, error } = await rpc(
      "kipu_record_debt_statement_cycle_idempotent",
      {
        p: {
          user_id: input.userId,
          debt_account_id: input.debtAccountId,
          operation_key: input.operationKey,
          evidence_id: input.evidenceId,
          statement_date: input.statementDate,
          period_end: input.periodEnd,
          full_payment_due: input.fullPaymentDue,
          minimum_payment: input.minimumPayment,
          statement_balance: input.statementBalance,
          due_day: input.dueDay,
          cutoff_day: input.cutoffDay,
          interest_rate: input.interestRate,
          interest_rate_kind: input.interestRateKind,
          applied: input.applied,
          is_current: input.isCurrent,
          reason: input.reason,
        },
      },
    );
    return (
      !error &&
      typeof data?.cycle_id === "string" &&
      (data?.outcome === "created" || data?.outcome === "replayed")
    );
  } catch {
    return false;
  }
}

export async function executeUpdateCardObligations(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  return executeUpdateCardObligationsWith(args, ctx, {
    setStatement: setCardStatementDue,
    overrideDue: overrideDebtDue,
    applyPatch: async ({ userId, debt, patch, expectedNativeDue, fromStatement }) => {
      try {
        const supabase = createSupabaseAdminClient();
        let update = supabase
          .from("debt_accounts")
          .update(patch)
          .eq("id", debt.id)
          .eq("user_id", userId)
          // CAS monetario: una compra/pago entre el contexto y este write obliga a
          // releer; nunca pisamos el saldo nuevo con la foto vieja del turno.
          .eq("current_balance_original", debt.currentBalanceOriginal);
        update = expectedNativeDue == null
          ? update.is("full_payment_due", null)
          : update.eq("full_payment_due", expectedNativeDue);
        if (fromStatement) {
          update = debt.statementDate == null
            ? update.is("statement_date", null)
            : update.eq("statement_date", debt.statementDate);
        }
        const { data, error } = await update.select("id");
        if (error) return { ok: false, message: error.message };
        return { ok: true, rows: data?.length ?? 0 };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "update failed" };
      }
    },
  });
}

export async function executeUpdateCardObligationsWith(
  args: Record<string, unknown>,
  ctx: AgentContext,
  deps: CardObligationsDeps,
): Promise<ToolResult> {
  const debt = ctx.debtAccounts.find((d) => d.id === args.debtAccountId);
  if (!debt) {
    return { status: "needs_info", summary: "No reconozco esa tarjeta/deuda; mira sus ids en el contexto." };
  }
  const patch: Record<string, number | string> = {};
  const applied: string[] = [];
  const invalid: string[] = [];
  const provided = (v: unknown) => v !== undefined && v !== null;
  const money = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? toCents(n) : undefined;
  };
  const day = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 31 ? n : undefined;
  };
  const isoDate = (v: unknown): string | undefined =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) ? v : undefined;

  // Stage 14 — DATE-AWARE obligation guard. When this update comes from a
  // statement, only let it overwrite the live obligations (minimum / full / due
  // / cutoff / balance) if the statement is at least as NEW as the one that set
  // them. An older or undated statement keeps current obligations untouched.
  const statementDate = isoDate(args.statementDate);
  const calendarOccurrenceId =
    typeof args.calendarOccurrenceId === "string" && args.calendarOccurrenceId.trim()
      ? args.calendarOccurrenceId.trim()
      : null;
  const fromStatement = provided(args.statementDate);
  const decision = fromStatement
    ? decideApplyObligations(statementDate ?? null, debt.statementDate ?? null)
    : { apply: true as const, reason: "chat" as const };
  const applyObligations = decision.apply;
  const withheld: string[] = [];
  let dueValue: number | undefined;
  let dueApplied = false;
  let resolvedCalendarOccurrenceId: string | null = null;
  // J-3 — la ambigüedad del aviso NO revierte el corte: el dato del usuario se
  // guarda y la pregunta se hace en el MISMO turno, en vez de perderse el dato y
  // dejarle un «reintentá» que volvería a fallar igual.
  let ambiguousCalendarAsk = false;
  // J-4 — la fecha que trae un estado es de ESE ciclo, no la regla mensual.
  const statedDue = validCalendarDateISO(args.statementDueDate);
  if (provided(args.statementDueDate) && !statedDue) {
    return {
      status: "needs_info",
      summary: `No cambié nada de ${debt.name}: la fecha de vencimiento no es una fecha calendario válida (usa YYYY-MM-DD).`,
    };
  }
  const duePlan = statedDue
    ? planStatementDueDate({ statedDateISO: statedDue, recurringDueDay: debt.dueDay ?? null })
    : null;
  if (duePlan?.kind === "ask") {
    return {
      status: "needs_info",
      summary: `No cambié nada de ${debt.name}. Dice que vence el ${duePlan.statementDueDate}, pero la tengo con vencimiento los ${duePlan.recurringDueDay} de cada mes (${duePlan.diffDays} días de diferencia). Pregúntale si es SOLO este mes o si su tarjeta cambió de fecha para siempre, y vuelve a llamarme: si es solo este mes, pasa statementDueDate; si cambió la regla, pasa dueDay.`,
    };
  }
  let cycleDueNote: string | null = null;

  const setObligation = (
    label: string,
    value: number | undefined,
    invalidLabel: string,
    assign: (v: number) => void,
  ) => {
    if (value === undefined) {
      invalid.push(invalidLabel);
      return;
    }
    if (!applyObligations) {
      withheld.push(label);
      return;
    }
    assign(value);
    applied.push(`${label} ${value}`);
  };

  let baseUntouched = false;
  if (provided(args.minimumPayment)) setObligation("mínimo", money(args.minimumPayment), "pago mínimo", (v) => (patch.minimum_payment = v));
  if (provided(args.totalDueThisMonth)) setObligation("pago del mes", money(args.totalDueThisMonth), "pago del mes", (v) => (dueValue = v));
  if (provided(args.statementBalance)) {
    const v = money(args.statementBalance);
    if (v === undefined) invalid.push("saldo");
    else if (!applyObligations) withheld.push("saldo");
    else if (fromStatement) {
      // El saldo de un estado es una FOTO AL CORTE, no el saldo corriente. Entre
      // corte y lectura pudo haber pagos/compras; escribirlo en debt_accounts
      // resucitaba deuda ya pagada. Queda en debt_statement_cycles (abajo).
      withheld.push("saldo corriente (el saldo del corte quedó en el historial)");
    }
    else {
      patch.current_balance_original = v;
      if ((debt.currency as string) === ctx.baseCurrency) patch.current_balance_base = v;
      else baseUntouched = true; // no trusted FX here → don't fabricate a base value
      applied.push(`saldo ${v} ${debt.currency}`);
    }
  }
  if (provided(args.dueDay)) setObligation("paga el", day(args.dueDay), "día de pago (entero 1–31)", (v) => (patch.due_day = v));
  if (duePlan) {
    patch.statement_due_date = duePlan.statementDueDate;
    applied.push(`vence el ${duePlan.statementDueDate}`);
    if (duePlan.kind === "this_cycle") {
      // Se anota el ciclo y se DICE; la regla mensual no se toca.
      cycleDueNote = `Anoté que ESTE estado vence el ${duePlan.statementDueDate}; su ${debt.name} normalmente vence los ${duePlan.recurringDueDay} de cada mes, así que no cambié esa regla. Díselo por si el cambio era permanente.`;
    } else if (duePlan.kind === "adopt_rule" && !provided(args.dueDay)) {
      patch.due_day = duePlan.newDueDay;
      cycleDueNote = `No tenía día de pago para ${debt.name}: aprendí que vence los ${duePlan.newDueDay}.`;
    }
  }
  if (provided(args.cutoffDay)) setObligation("corte el", day(args.cutoffDay), "día de corte (entero 1–31)", (v) => (patch.cutoff_day = v));

  // Interest rate is a card TERM (not cycle-specific); accept it from chat or a
  // current statement, but not from an older statement we're declining.
  // A rate is a PERCENT, not money: keep 4 decimals (column is numeric(8,4)),
  // not 2 — toCents would silently truncate 15.456% to 15.46%.
  const rate4 = (n: number) => Math.round(n * 10000) / 10000;
  if (provided(args.interestRate)) {
    const r = Number(args.interestRate);
    if (!Number.isFinite(r) || r < 0 || r > 400) invalid.push("tasa de interés");
    else if (fromStatement && !applyObligations) withheld.push("tasa");
    else {
      patch.interest_rate = rate4(r);
      const kind = args.interestRateKind;
      if (kind === "annual_effective" || kind === "monthly" || kind === "annual_nominal") patch.interest_rate_kind = kind;
      applied.push(`tasa ${rate4(r)}%`);
    }
  }

  // When we DO apply a statement's obligations, stamp its emission date so the
  // next statement can be compared against it.
  if (fromStatement && applyObligations && statementDate) {
    patch.statement_date = statementDate;
    const periodEnd = isoDate(args.statementPeriodEnd);
    if (periodEnd) patch.statement_period_end = periodEnd;
    if (ctx.evidenceId) patch.last_statement_evidence_id = ctx.evidenceId;
  }

  // 065 — `full_payment_due` nunca vuelve a pasar por el UPDATE directo. Un
  // statement fechado usa la máquina idempotente del corte (y lleva en la MISMA
  // RPC los demás campos del estado); una aclaración sin statement usa el CAS
  // declarativo. Si cualquiera falla, no seguimos con un éxito parcial silencioso.
  if (dueValue !== undefined) {
    if (fromStatement && statementDate) {
      const statementFields: Record<string, number | string> = {};
      for (const key of [
        "minimum_payment",
        "current_balance_original",
        "current_balance_base",
        "due_day",
        "cutoff_day",
        "interest_rate",
        "interest_rate_kind",
        "statement_period_end",
        "last_statement_evidence_id",
      ]) {
        const value = patch[key];
        if (value !== undefined) statementFields[key] = value;
      }
      const set = await deps.setStatement({
        userId: ctx.userId,
        debtAccountId: debt.id,
        amount: dueValue,
        statementDateISO: statementDate,
        statementFields,
        occurrenceId: calendarOccurrenceId,
      });
      if (!set.ok) {
        return { status: "error", summary: `No pude aplicar el estado de ${debt.name} de forma atómica; no confirmé el cambio. Reinténtalo.` };
      }
      if (set.outcome === "safe_newer_exists") {
        return { status: "done", effect: "noop", summary: `Ya había un estado más nuevo de ${debt.name}; no pisé su pago, saldo ni fechas con este documento anterior.` };
      }
      dueApplied = true;
      resolvedCalendarOccurrenceId = set.occurrenceId;
      if (set.occurrenceResolution === "ambiguous") ambiguousCalendarAsk = true;
      for (const key of Object.keys(statementFields)) delete patch[key];
      delete patch.statement_date;
    } else {
      const set = await deps.overrideDue({
        userId: ctx.userId,
        debtAccountId: debt.id,
        expectedDue: debt.fullPaymentDueOriginal ?? debt.fullPaymentDue ?? null,
        newDue: dueValue,
        occurrenceId: calendarOccurrenceId,
      });
      if (!set.ok) {
        return {
          status: "error",
          summary: set.reason === "conflict"
            ? `El pago pendiente de ${debt.name} cambió mientras lo editaba; no lo pisé. Vuelve a intentarlo con el dato actualizado.`
            : `No pude probar que el pago pendiente de ${debt.name} se guardara; no confirmé el cambio.`,
        };
      }
      dueApplied = true;
      resolvedCalendarOccurrenceId = set.occurrenceId;
      if (set.occurrenceResolution === "ambiguous") ambiguousCalendarAsk = true;
    }
  }

  // Audit AFTER the authoritative write. Antes se insertaba `applied:true` y
  // recién después se intentaba actualizar la deuda: un fallo dejaba una historia
  // que aseguraba que se aplicó algo que nunca aterrizó.
  const statementAuditInput = (): CardStatementAuditInput | null => {
    if (!fromStatement) return null;
    if (!statementDate) return null;
    const auditCore = {
      debtAccountId: debt.id,
      statementDate,
      periodEnd: isoDate(args.statementPeriodEnd) ?? null,
      fullPaymentDue: provided(args.totalDueThisMonth)
        ? money(args.totalDueThisMonth) ?? null
        : null,
      minimumPayment: provided(args.minimumPayment)
        ? money(args.minimumPayment) ?? null
        : null,
      statementBalance: provided(args.statementBalance)
        ? money(args.statementBalance) ?? null
        : null,
      dueDay: provided(args.dueDay) ? day(args.dueDay) ?? null : null,
      cutoffDay: provided(args.cutoffDay) ? day(args.cutoffDay) ?? null : null,
      interestRate:
        provided(args.interestRate) && Number.isFinite(Number(args.interestRate))
          ? rate4(Number(args.interestRate))
          : null,
      interestRateKind:
        typeof args.interestRateKind === "string"
          ? args.interestRateKind
          : null,
      applied: applyObligations,
      isCurrent: applyObligations,
      reason: decision.reason,
    };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(auditCore))
      .digest("hex")
      .slice(0, 32);
    const namespace =
      ctx.operationId?.trim() ||
      ctx.evidenceId?.trim() ||
      `content:${fingerprint}`;
    return {
      userId: ctx.userId,
      operationKey: `agent:statement:${namespace}:${debt.id}:${statementDate}`,
      evidenceId: ctx.evidenceId ?? null,
      ...auditCore,
    };
  };
  const recordStatementAuditReal = async (
    input: CardStatementAuditInput,
  ): Promise<boolean> => {
    const supabase = createSupabaseAdminClient();
    return recordCardStatementCycleWith(
      (name, payload) => supabase.rpc(name, payload),
      input,
    );
  };
  const recordStatementAudit = deps.recordAudit ?? recordStatementAuditReal;
  const writeStatementAudit = async (): Promise<boolean> => {
    const input = statementAuditInput();
    return input == null ? !fromStatement : recordStatementAudit(input);
  };
  // J-3 — el aviso del calendario se cuenta en TODAS las ramas post-write, no
  // solo cuando `patch` quedó vacío. Con «el corte fue 50.60 y vence el 3»,
  // `dueDay` sigue en `patch` y el executor toma la rama final: ahí la aclaración
  // se perdía, el corte se guardaba y los dos avisos quedaban colgados — o sea
  // que «pregunta cuál en el mismo turno» era falso justo en el caso real. Un
  // solo string para que ninguna rama futura pueda divergir en silencio.
  const calendarNote = resolvedCalendarOccurrenceId
    ? "El aviso de corte quedó resuelto en la misma operación."
    : ambiguousCalendarAsk
      ? "OJO: hay MÁS DE UN aviso de corte abierto para esa tarjeta, así que NO cerré ninguno. El dato quedó guardado; PREGÚNTALE a cuál corte correspondía (distínguelos por su fecha en FLUJOS DEL CALENDARIO) y vuelve a llamar update_card_obligations con ese calendarOccurrenceId."
      : null;
  // Misma disciplina que J-3: una nota post-write vive en UN solo lugar y la
  // consumen TODAS las ramas, para que ninguna futura la pierda en silencio.
  const postWriteNotes = [calendarNote, cycleDueNote].filter(Boolean).join(" ");

  // Declined an older/undated statement and nothing else to apply → not an
  // error: we kept the current obligations on purpose.
  if (Object.keys(patch).length === 0 && fromStatement && !applyObligations) {
    if (!(await writeStatementAudit())) {
      return {
        status: "error",
        summary:
          `No cambié el estado vigente de ${debt.name}, pero tampoco pude guardar el registro histórico del documento anterior. No lo doy por archivado; reintenta.`,
      };
    }
    return {
      status: "done",
      summary: `Ese estado de "${debt.name}" es más antiguo (o sin fecha clara) que el que ya tengo, así que NO toqué su pago/fecha actuales para no desactualizarlos. Sus movimientos sí se pueden registrar. Cuéntaselo natural y sin tecnicismos.`,
    };
  }
  if (Object.keys(patch).length === 0) {
    if (dueApplied) {
      if (!(await writeStatementAudit())) {
        ctx.dirty = true;
        return {
          status: "error",
          effect: "wrote",
          summary:
            `El pago/corte de ${debt.name} SÍ quedó actualizado, pero falló su registro histórico. No repitas el cambio a ciegas; relee la tarjeta antes de reintentar el historial.`,
        };
      }
      ctx.dirty = true;
      const refreshed = await refreshAgentContextIfDirty(ctx);
      return {
        status: "done",
        summary: withRefreshCaveat(
          refreshed,
          `${debt.name} actualizada: ${applied.join(", ")}. El remanente y la cobertura del estado quedaron consistentes; no afirmes que está totalmente pagado salvo remanente cero.${postWriteNotes ? " " + postWriteNotes : ""}`,
          postWriteNotes,
        ),
      };
    }
    return {
      status: "needs_info",
      summary: invalid.length
        ? `No apliqué nada en ${debt.name}: ${invalid.join(", ")} con valor inválido.`
        : "No llegó ningún dato de la tarjeta para actualizar.",
    };
  }
  try {
    const expectedNativeDue = dueValue ?? debt.fullPaymentDueOriginal ?? debt.fullPaymentDue ?? null;
    const applyRes = await deps.applyPatch({
      userId: ctx.userId,
      debt,
      patch,
      expectedNativeDue,
      fromStatement,
    });
    if (!applyRes.ok) return { status: "error", summary: applyRes.message };
    if (applyRes.rows !== 1) {
      return { status: "error", summary: `La deuda cambió mientras actualizaba ${debt.name}; no pisé el dato nuevo. Vuelve a intentarlo.` };
    }
    if (!(await writeStatementAudit())) {
      ctx.dirty = true;
      return {
        status: "error",
        effect: "wrote",
        summary:
          `${debt.name} SÍ quedó actualizada, pero falló el registro histórico del estado. No repitas la actualización a ciegas; relee antes de reintentar.`,
      };
    }
    ctx.dirty = true;
    const refreshed = await refreshAgentContextIfDirty(ctx);
    const notes = [
      calendarNote,
      cycleDueNote,
      invalid.length ? `Ignoré por inválidos: ${invalid.join(", ")}.` : null,
      withheld.length
        ? `Mantuve sin cambios (${withheld.join(", ")}) porque ese estado es más antiguo que el actual; sus movimientos sí se registran.`
        : null,
      baseUntouched
        ? `La tarjeta está en ${debt.currency} (≠ tu moneda base ${ctx.baseCurrency}): actualicé el saldo en su moneda; el equivalente en base se ajusta con el tipo de cambio real, no inventado.`
        : null,
    ].filter(Boolean);
    return {
      status: "done",
      summary: withRefreshCaveat(
        refreshed,
        `${debt.name} actualizada: ${applied.join(", ")}. Tu Saldo usa el pago del mes (no solo el mínimo).${notes.length ? " " + notes.join(" ") : ""}`,
        postWriteNotes,
      ),
    };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "update failed" };
  }
}

// ── Stage 14 — read-only debt/card analysis tools ───────────────────────────
// These NEVER write. They turn the deterministic debt-health truth into compact
// factual summaries (estimate-tagged) for the agent to phrase like a human coach.

function monthlyFreeCashEstimate(ctx: AgentContext): number {
  // Internal sustainable weekly rate → rough monthly free-cash estimate.
  // This is planning capacity, not the current Saldo tank.
  return Math.max(0, ctx.briefing.weeklyMargin * 4.33);
}

function cardLabel(c: CardHealth, base: string): string {
  const bits = [
    `saldo ${formatMoney(c.balance, base as CurrencyCode)}`,
    c.fullPaymentDue != null ? `pago del mes ${formatMoney(c.fullPaymentDue, base as CurrencyCode)}` : null,
    c.minimumPayment != null ? `mínimo ${formatMoney(c.minimumPayment, base as CurrencyCode)}` : null,
    c.dueInDays != null ? `vence en ${c.dueInDays}d` : null,
    c.interestRatePct != null ? `~${c.interestRatePct}%/año` : "sin tasa registrada",
  ].filter(Boolean);
  return `"${c.name}" (${bits.join(", ")}) — estado: ${c.state}`;
}

async function executeAnalyzeDebtHealth(_args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const dh = ctx.briefing.debtHealth;
  if (!dh.hasAnyDebt) {
    return { status: "done", summary: "El usuario no tiene deuda/tarjetas con saldo registradas. Confírmaselo con calma y celebra esa tranquilidad; no inventes deudas." };
  }
  const base = ctx.baseCurrency;
  const lines = dh.cards.filter((c) => c.balance > 0 || c.states.some((s) => s !== "healthy")).map((c) => cardLabel(c, base));
  const action = dh.topAction ? `Acción sugerida ahora: ${dh.topAction.text}.` : "Nada urgente ahora.";
  return {
    status: "done",
    summary: `Salud de deuda (cifras reales del motor; intereses son ESTIMADOS). Total deuda ${formatMoney(dh.totalDebt, base)}, mínimos ${formatMoney(dh.totalMinimums, base)}, pago del mes ${formatMoney(dh.totalFull, base)}, presión ${dh.pressureLevel}. Tarjetas: ${lines.join(" | ")}. ${action} Explícalo humano, sin tabla, y si un estado dice needs_payment_confirmation/overdue PREGUNTA si ya pagó (no lo afirmes).`,
  };
}

async function executePlanDebtPayoff(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const dh = ctx.briefing.debtHealth;
  if (!dh.hasAnyDebt) {
    return { status: "done", summary: "No hay deudas con saldo para armar un plan. Díselo tranquilo y no inventes deudas." };
  }
  const strategyArg = args.strategy;
  const strategy: PayoffStrategy =
    strategyArg === "avalanche" || strategyArg === "snowball" || strategyArg === "urgency_first" ? strategyArg : "hybrid";
  const extra = Number(args.extraMonthly);
  const inputs = payoffInputsFromHealth(dh, ctx.debtAccounts);
  const plan = planPayoff(inputs, {
    strategy,
    extraMonthlyBudget: Number.isFinite(extra) && extra > 0 ? extra : 0,
    monthlyMarginForDebt: monthlyFreeCashEstimate(ctx),
  });
  const base = ctx.baseCurrency;
  const focus = plan.focusDebtId ? plan.allocations.find((a) => a.id === plan.focusDebtId) : null;
  const focusText = focus
    ? `Primero el abono extra a "${focus.name}" (${focus.reason})${plan.focusPayoff?.feasible ? `: a ese ritmo saldría en ~${plan.focusPayoff.months} meses (interés estimado ${formatMoney(plan.focusPayoff.totalInterest, base)})` : ""}.`
    : "Sin un foco claro para el extra (faltan tasas o saldos).";
  return {
    status: "done",
    summary: `Plan de pago (${plan.strategy}, ESTIMADO). Paga SIEMPRE los mínimos primero (total ${formatMoney(plan.minimumsTotal, base)}). Plata libre estimada del mes para abonos extra: ${formatMoney(plan.extraBudget, base)}. ${focusText} ${plan.notes.join(" ")} Explícalo simple, sin presión, y deja claro que los tiempos/intereses son estimados.`,
  };
}

async function executeCompareDebtVsInvestment(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const dh = ctx.briefing.debtHealth;
  const target = args.debtAccountId
    ? ctx.debtAccounts.find((d) => d.id === args.debtAccountId)
    : dh.highestInterestCardId
      ? ctx.debtAccounts.find((d) => d.id === dh.highestInterestCardId)
      : ctx.debtAccounts.find((d) => d.currentBalanceBase > 0);
  if (!target) {
    return { status: "done", summary: "No hay una deuda con saldo para comparar contra invertir. Díselo tranquilo." };
  }
  const expected = Number(args.expectedReturnPct);
  const cash = Number(args.cashAvailable);
  const result = compareDebtVsInvestment({
    debtAnnualRatePct: target.interestRate ?? null,
    expectedAnnualReturnPct: Number.isFinite(expected) ? expected : null,
    cashAvailable: Number.isFinite(cash) && cash > 0 ? cash : ctx.briefing.liquid.liquidTotal,
    currentLiquidReserve: ctx.briefing.liquid.liquidTotal,
  });
  const verdictText: Record<string, string> = {
    pay_debt: "normalmente conviene pagar la deuda (ahorro casi seguro)",
    invest_or_keep_cash: "podría tener sentido invertir o conservar liquidez",
    split: "conviene dividir: cuidar reserva y a la vez bajar deuda",
    insufficient_data: "falta dato para decidir bien",
  };
  return {
    status: "done",
    summary: `Deuda vs inversión para "${target.name}" (orientación de finanzas personales, NO recomendación de inversión específica; ESTIMADO): ${verdictText[result.verdict]}. ${result.reasons.join(" ")} Recalca: el ahorro de pagar deuda es casi seguro; el retorno de invertir es incierto. Nunca sugieras dejar de pagar un mínimo para invertir.`,
  };
}

async function executeEstimateCardInterest(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const debt = ctx.debtAccounts.find((d) => d.id === args.debtAccountId) ?? ctx.debtAccounts.find((d) => d.currentBalanceBase > 0);
  if (!debt) return { status: "needs_info", summary: "¿De qué tarjeta/deuda calculo el interés? No veo una con saldo." };
  const base = ctx.baseCurrency;
  const rateKind = (debt.interestRateKind ?? "annual_nominal") as RateKind;
  if (debt.interestRate == null || debt.interestRate <= 0) {
    return { status: "needs_info", summary: `No tengo la tasa de "${debt.name}", y sin ella cualquier interés sería inventado. Pregúntale la tasa (anual) para estimarlo honesto.` };
  }
  const partial = Number(args.partialAmount);
  const cmp = comparePayments({
    balance: debt.currentBalanceBase,
    rate: debt.interestRate,
    fullPaymentDue: debt.fullPaymentDue,
    minimumPayment: debt.minimumPayment,
    partial: Number.isFinite(partial) && partial > 0 ? partial : null,
    kind: rateKind,
  });
  const waitDays = Number(args.delayDays);
  const delay = Number.isFinite(waitDays) && waitDays > 0 ? costOfDelay(debt.currentBalanceBase, debt.interestRate, waitDays, rateKind) : null;
  const parts: string[] = [
    `Pagar el TOTAL (${formatMoney(cmp.full.amount, base)}) evita el interés del próximo ciclo.`,
  ];
  if (cmp.minimum) {
    parts.push(
      `Pagar solo el MÍNIMO (${formatMoney(cmp.minimum.amount, base)}) deja ${formatMoney(cmp.minimum.remaining, base)} corriendo interés (~${formatMoney(cmp.minimum.monthlyInterestNext, base)} el primer mes)` +
        (cmp.minimum.payoff?.feasible ? `; a ese ritmo tardarías ~${cmp.minimum.payoff.months} meses y pagarías ~${formatMoney(cmp.minimum.payoff.totalInterest, base)} de interés` : "; a ese ritmo casi no baja el saldo") +
        ".",
    );
  }
  if (cmp.partial) {
    parts.push(`Un abono de ${formatMoney(cmp.partial.amount, base)} deja ${formatMoney(cmp.partial.remaining, base)} con interés (~${formatMoney(cmp.partial.monthlyInterestNext, base)}/mes).`);
  }
  if (delay != null) parts.push(`Esperar ${waitDays} día(s) costaría ~${formatMoney(delay, base)} de interés.`);
  return {
    status: "done",
    summary: `Interés de "${debt.name}" (tasa ~${debt.interestRate}%/año, TODO ESTIMADO): ${parts.join(" ")} Explícalo claro y humano, deja claro que son estimados y no cifras exactas del banco.`,
  };
}

// ── Stage 15 — read-only cashflow planning tools ────────────────────────────
// These NEVER write. They turn the deterministic forward-looking cashflow truth
// (the strengthened, timing-aware Margen engine) into compact facts the agent
// phrases simply: today's & this week's safe spend, runway, what to watch.

async function executeCashflowOutlook(_args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const cf = ctx.briefing.cashflow;
  const base = ctx.baseCurrency;
  const m = (v: number) => formatMoney(v, base);
  const income =
    cf.nextIncome && cf.nextIncome.confidence !== "low"
      ? `Próximo ingreso ~${m(cf.nextIncome.amount)} el ${cf.nextIncome.dateISO}.`
      : cf.nextIncome
        ? "Hay un ingreso registrado pero NO sé la fecha exacta — pídela (\"¿qué día sueles cobrar?\"); NO inventes la fecha."
        : "No hay un ingreso registrado, proyecto a fin de mes (dilo así, no inventes fecha).";
  const runway = cf.runwayOk
    ? "Llegas a tu próximo ingreso sin quedarte corto."
    : `Cuidado: la proyección baja a ${m(cf.lowestProjectedBalance)} el ${cf.lowestDateISO} (no alcanza tranquilo).`;
  const risk = cf.riskWindows.length ? ` Lo único a cuidar: ${cf.riskWindows.map((r) => `${r.label} (${r.dateISO})`).join(" y ")}.` : "";
  const conf =
    cf.confidence === "high" ? "" : cf.confidence === "medium" ? " (confianza media)" : ` (baja confianza${cf.missing[0] ? `: ${cf.missing[0]}` : ""})`;
  const confNote = marginConfidenceNote(ctx);
  const sk = ctx.briefing?.margenKipu?.saldo;
  const saldoLine = sk
    ? `Saldo Kipu (el MISMO número del dashboard): AHORA tiene ${m(sk.saldo)} para gustos; se recarga ~${m(sk.fillDaily)} al día hasta ${m(sk.cap)}. Su Reserva protegida es ${m(sk.reserva)} (aparte, no gastable en silencio).`
    : "";
  const projectionLine = `Proyección del calendario (NO es Saldo): gasto seguro hoy ${m(cf.safeToday)}; durante esta semana ${m(cf.safeThisWeek)}.`;
  return {
    status: "done",
    summary: `${saldoLine} ${projectionLine} ${runway} ${income}${risk}${conf} Responde SIMPLE: Saldo actual + SOLO la proyección que pidió + MÁXIMO una cosa a cuidar; nunca llames Saldo a la proyección.${confNote}`.trim(),
  };
}

async function executeSimulateScenario(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const base = ctx.baseCurrency;
  const m = (v: number) => formatMoney(v, base);
  const kinds = ["spend_today", "income_earlier", "income_later", "add_monthly_expense", "change_goal_contribution", "protect_reserve"];
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  let kind = typeof args.kind === "string" && kinds.includes(args.kind) ? (args.kind as ScenarioSpec["kind"]) : undefined;
  if (!kind && num(args.amount) !== undefined) kind = "spend_today"; // "¿puedo gastar 80 hoy?" default
  if (!kind) return { status: "needs_info", summary: "¿Qué quieres simular? (un gasto hoy, que te paguen antes/después, un gasto fijo nuevo, cambiar tu aporte, o proteger una reserva)." };
  const spec: ScenarioSpec = {
    kind,
    amount: num(args.amount),
    days: num(args.days),
    monthlyAmount: num(args.monthlyAmount),
    weeklyDelta: num(args.weeklyDelta),
    reserveAmount: num(args.reserveAmount),
    label: typeof args.label === "string" ? args.label : undefined,
  };
  const r = simulateScenario(ctx.briefing.cashflowScenarioBase, spec);
  const verdict =
    r.verdict === "recommended" ? "se puede sin problema" : r.verdict === "possible_but_tight" ? "se puede, pero queda justo" : "mejor no ahora";
  const runway = r.after.runwayOk ? "sigues llegando a tu ingreso" : "romperías tu Reserva antes del ingreso";
  const unc = r.uncertainties.length ? ` Ojo: ${r.uncertainties[0]}.` : "";
  return {
    status: "done",
    summary: `Escenario "${r.scenario}" (ESTIMADO): ${verdict}. Tu gasto seguro de HOY pasa de ${m(r.base.safeToday)} a ${m(r.after.safeToday)}; esta semana quedaría ${m(r.after.safeThisWeek)}; ${runway}. Fin de mes proyectado: ${m(r.after.projectedEndOfMonth)} (cambio ${m(r.deltaEndOfMonth)}).${unc} Dilo simple, directo y sin culpa; una recomendación clara.`,
  };
}

async function executePlanCashflow(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const cf = ctx.briefing.cashflow;
  const cal = ctx.briefing.cashflowScenarioBase.calendar;
  const base = ctx.baseCurrency;
  const m = (v: number) => formatMoney(v, base);
  const horizon = args.horizon === "until_income" ? "hasta tu próximo ingreso" : "de esta semana";
  const pays = cal.events
    .filter((e) => e.signedAmount < 0 && (e.requirement === "required" || e.reserves))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4)
    .map((e) => `${e.label} ${m(e.amount)} (${e.date})`);
  const tone =
    args.tone === "pessimistic"
      ? "Tono CONSERVADOR (asume el peor caso, ingreso que se atrasa)."
      : args.tone === "optimistic"
        ? "Tono optimista pero realista, sin prometer de más."
        : "";
  const runway = cf.runwayOk ? "Llegas bien al ingreso." : `Cuida no bajar de tu Reserva cerca del ${cf.lowestDateISO}.`;
  const conf = cf.confidence === "low" && cf.missing[0] ? ` Antes de afinar: ${cf.missing[0]}.` : "";
  return {
    status: "done",
    summary: `Plan ${horizon} (estimado, números del motor): Saldo Kipu AHORA ${m(ctx.briefing.margenKipu.saldo.saldo)}, con recarga de ~${m(ctx.briefing.margenKipu.saldo.fillDaily)} al día. Proyección del calendario: gasto seguro hoy ${m(cf.safeToday)} y durante esta semana ${m(cf.safeThisWeek)}; NO llames Saldo a esas proyecciones. Pagos que vienen: ${pays.join("; ") || "ninguno grande"}. ${runway}${conf} Arma un plan CORTO de 3–5 pasos, concreto, directo y sin culpa; céntralo en qué gastar/cuidar, no en teoría. ${tone}`,
  };
}

// ── Stage 16 — behavioral spending OS read tools. All read ctx.briefing.
// spendingIntel (computed once per turn from the same live truth) and return a
// SIMPLE structured fact for the agent to phrase: genius inside, simple outside.
function cadenceEs(c: string): string {
  return c === "weekly" ? "semana" : c === "biweekly" ? "quincena" : c === "annual" ? "año" : "mes";
}

async function executeWhereDidMoneyGo(ctx: AgentContext): Promise<ToolResult> {
  const si = ctx.briefing.spendingIntel;
  const m = (v: number) => money(v, ctx.baseCurrency);
  if (si.baselines.confidence === "low" && si.spendTxnCount < 8) {
    return { status: "done", summary: "Aún tengo pocos movimientos para decir con certeza en qué se va la plata; con unos días más te lo muestro claro. No inventes categorías ni montos." };
  }
  const top = si.baselines.topByImpact.slice(0, 3).map((c) => `${c.parentCategory} ~${m(c.monthlyAvg)}/mes`).join(", ");
  const subs = si.subscriptions.estimatedMonthlyTotal > 0 ? ` Suscripciones detectadas ~${m(si.subscriptions.estimatedMonthlyTotal)}/mes.` : "";
  const conf = si.baselines.confidence === "high" ? "" : " (es una lectura de los últimos días; se irá afinando — dilo así, sin tecnicismos)";
  return {
    status: "done",
    summary: `En qué se va (gasto controlable, aprox/mes): ${top || "sin un patrón claro todavía"}.${subs}${conf}. Transferencias, pagos de tarjeta, reembolsos e ingresos NO son gasto. Dilo simple: las 2–3 cosas que importan, sin listar todo, sin mostrar etiquetas internas.`,
  };
}

async function executeWhyMarginChanged(ctx: AgentContext): Promise<ToolResult> {
  const ma = ctx.briefing.spendingIntel.margin;
  if (!ma.drivers.length) {
    return { status: "done", summary: `No veo un cambio grande respecto a tu normal esta semana. ${ma.basis} Dilo tranquilo, sin inventar una causa.` };
  }
  const drivers = ma.drivers.slice(0, 3).map((d) => d.note).join(" ");
  return {
    status: "done",
    summary: `Qué cambió en tu ritmo de gasto: ${drivers} ${ma.basis} Nombra el driver principal de forma simple. NO afirmes que esto reconstruye exactamente por qué cambió el Saldo y NO recites cinco números.`,
  };
}

async function executeSpendingAnomalies(ctx: AgentContext): Promise<ToolResult> {
  const a = ctx.briefing.spendingIntel.anomalies;
  if (!a.anomalies.length) {
    return { status: "done", summary: "Nada raro en tus gastos recientes; todo dentro de lo normal. Dilo calmado, sin alarmar." };
  }
  const top = a.anomalies.slice(0, 3).map((x) => x.note).join(" ");
  return {
    status: "done",
    summary: `Cosas a revisar (graduadas, con calma): ${top} Si algo cae dentro de lo normal, no lo hagas sonar a problema; menciona solo lo que de verdad valga la pena, en tono tranquilo.`,
  };
}

async function executeMySubscriptions(ctx: AgentContext): Promise<ToolResult> {
  const s = ctx.briefing.spendingIntel.subscriptions;
  const m = (v: number) => formatMoney(v, ctx.baseCurrency);
  if (!s.subscriptions.length) {
    return { status: "done", summary: "No detecté suscripciones o cargos recurrentes claros todavía. No inventes ninguno; si el usuario menciona uno, puedes anotarlo." };
  }
  const list = s.subscriptions
    .slice(0, 6)
    .map((x) => `${x.merchantFamily} ~${m(x.amount)}/${cadenceEs(x.cadence)}${x.nextChargeISO ? `, próximo ~${x.nextChargeISO}` : ""}${x.alreadyModeled ? " (ya es gasto fijo)" : x.suggestConvert ? " (no está como fijo)" : ""}`)
    .join("; ");
  const convertible = s.subscriptions.filter((x) => x.suggestConvert);
  const ask = convertible.length ? ` Si encaja, PREGUNTA si conviertes ${convertible[0].merchantFamily} en gasto fijo (usa create_fixed_expense solo tras confirmar; no lo crees solo).` : "";
  return {
    status: "done",
    summary: `Suscripciones/recurrentes detectadas: ${list}. Total estimado ~${m(s.estimatedMonthlyTotal)}/mes.${ask}`,
  };
}

async function executeBudgetSuggestion(ctx: AgentContext): Promise<ToolResult> {
  const b = ctx.briefing.spendingIntel.budget;
  const m = (v: number) => formatMoney(v, ctx.baseCurrency);
  if (!b.overCategories.length) {
    return { status: "done", summary: "Vas dentro de tu normal esta semana, nada que apretar. Confírmalo tranquilo, sin sermón ni listas." };
  }
  const tops = b.overCategories
    .slice(0, 2)
    .map((s) => `${s.parentCategory} ~${Math.round(s.pctVsNormal * 100)}% arriba de su normal (proyecta ${m(s.projectedThisWeek)} vs ${m(s.normalWeekly)})`)
    .join("; ");
  const adj = b.oneAdjustment ? ` Un ajuste de ~${m(b.oneAdjustment.saving)} en ${b.oneAdjustment.categories.join(" + ")} reencauza la semana.` : "";
  return {
    status: "done",
    summary: `Presupuesto dinámico (sin sermón): ${tops}.${adj} Frámalo como control, NUNCA como fracaso ni como que "falló su presupuesto".`,
  };
}

async function executeRecommendCut(ctx: AgentContext): Promise<ToolResult> {
  const one = ctx.briefing.spendingIntel.insights.theOneThing;
  if (!one || (!one.actionable && one.kind !== "subscription_unmodeled")) {
    return { status: "done", summary: "Ahora mismo no hay un recorte que te mueva la aguja; vas bien. NUNCA sugieras saltarte un pago mínimo de tarjeta o deuda." };
  }
  const act = one.suggestedAction ? ` Acción concreta: ${one.suggestedAction}` : "";
  return {
    status: "done",
    summary: `Lo más útil para liberar plata: ${one.title}${act}${one.detail ? ` (${one.detail})` : ""}. Una sola sugerencia concreta y sin culpa; JAMÁS recomiendes saltarte un pago mínimo de tarjeta/deuda.`,
  };
}

// Persist a generalizable spending correction to structured merchant memory so it
// applies to FUTURE matching transactions. Degrades gracefully (migration 024):
// if the store isn't there yet, it's honest about not persisting permanently.
async function executeLearnSpendingCorrection(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const text = String(args.merchantText ?? "").trim();
  if (!text) return { status: "needs_info", summary: "¿Sobre qué cobro o comercio es la regla?" };
  const pattern = merchantKey(text);
  if (!pattern || pattern.length < 2) {
    return { status: "needs_info", summary: "No pude identificar bien el comercio; dímelo con el nombre que aparece en el cobro." };
  }
  const cat = typeof args.category === "string" && VALID_CATEGORIES.has(args.category as FinancialCategory) ? (args.category as FinancialCategory) : undefined;
  const family = typeof args.merchantFamily === "string" && args.merchantFamily.trim() ? args.merchantFamily.trim().slice(0, 60) : undefined;
  const isRecurring = typeof args.isRecurring === "boolean" ? args.isRecurring : undefined;
  if (!cat && !family && isRecurring === undefined) {
    return { status: "needs_info", summary: "¿Qué le enseño de ese comercio? Su categoría correcta, su nombre, o que es un cobro recurrente." };
  }
  const note = typeof args.note === "string" && args.note.trim() ? args.note.trim().slice(0, 200) : undefined;
  const ok = await saveMerchantCorrection(
    ctx.userId,
    {
      matchPattern: pattern,
      category: cat,
      family,
      isRecurring,
      note,
      source: "user_correction",
    },
    agentActionDedupe(ctx, "learn_spending_correction", [
      pattern,
      cat ?? null,
      family ?? null,
      isRecurring ?? null,
      note ?? null,
    ]),
  );
  const what = cat ? `como ${cat}` : family ? `como ${family}` : isRecurring ? "como recurrente" : "según me indicaste";
  if (!ok) {
    return {
      status: "error",
      summary: `No pude guardar de forma permanente la corrección de "${family ?? text}". No la doy por aprendida; reintenta.`,
    };
  }
  return {
    status: "done",
    summary: `Aprendido: de ahora en adelante trataré "${family ?? text}" ${what}${isRecurring ? " (recurrente)" : ""}. Confírmalo natural y breve, sin tecnicismos.`,
  };
}

// ── Stage 17 — Goals, Mini-Goals & Wealth Builder tools. Read tools use
// ctx.briefing.goalsIntel (the single per-turn truth: portfolio, allocation,
// joy budget, net worth). Write tools go through the typed goals-wealth store and
// mark ctx.dirty so a same-turn read refreshes. Genius inside, simple outside.
const VALID_ARCHETYPES = new Set<GoalArchetype>(["savings", "travel", "purchase", "emergency", "debt_payoff", "investment", "wealth", "family", "lifestyle", "custom"]);
const VALID_ASSET_CLASSES = new Set<AssetClass>(["cash", "investment", "fixed_term", "crypto", "property", "vehicle", "business", "receivable", "other"]);
export function validISODate(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const text = v.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? text
    : undefined;
}

async function executeEvaluatePurchaseAsGoal(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const rawPrice = Number(args.amount);
  const label = typeof args.label === "string" && args.label.trim() ? args.label.trim() : "eso";
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    return { status: "needs_info", summary: `¿Cuánto cuesta ${label} más o menos? Con el precio te digo si te conviene hoy o como mini-meta.` };
  }
  if (typeof args.onCard !== "boolean") {
    return {
      status: "needs_info",
      summary:
        `¿Pagarías ${label} con tarjeta o con plata de una cuenta? ` +
        "La tarjeta aumenta deuda aunque no baje el efectivo hoy; no asumí una forma de pago.",
    };
  }
  const purchasePlan = planHypotheticalPurchase({
    amountOriginal: rawPrice,
    originalCurrency: hypotheticalCurrency(args, ctx),
    baseCurrency: ctx.baseCurrency,
    category: "shopping",
    fxRates: ctx.fxRates ?? [],
  });
  const planFailure = hypotheticalPlanFailure(purchasePlan);
  if (planFailure || !purchasePlan.ok) return planFailure!;
  const price = purchasePlan.amountBase;
  const priceText = hypotheticalAmountText(
    purchasePlan.amountOriginal,
    purchasePlan.originalCurrency,
    purchasePlan.amountBase,
    purchasePlan.baseCurrency,
  );
  const gi = ctx.briefing.goalsIntel;
  const cf = ctx.briefing.cashflow;
  const sk = ctx.briefing.margenKipu?.saldo;
  if (
    !sk ||
    !Number.isFinite(sk.saldo) ||
    !Number.isFinite(sk.fillDaily)
  ) {
    return saldoUnavailableResult(ctx) ?? {
      status: "refused",
      summary: "No puedo comprobar tu Saldo ahora mismo. Reintenta en un rato.",
    };
  }
  const onCard = args.onCard === true;
  const m = (v: number) => money(v, ctx.baseCurrency);
  const saldoDecision = evaluateAdvisoryDecision({
    amount: price,
    paymentMethodType: onCard ? "card" : "account",
    itemKind: "durable",
    currentSaldo: sk.saldo,
    dailyRefill: sk.fillDaily,
    debtPressureLevel: ctx.snapshot.debtPressureLevel,
    totalDebt: ctx.snapshot.totalDebt,
    availableCash: ctx.snapshot.availableCash,
    suppressContributionPush: ctx.snapshot.suppressContributionPush,
    baseCurrency: ctx.baseCurrency,
  });
  const crossesSaldo = saldoDecision.reasonCodes.includes("crosses_saldo_layer");
  const saldoTruth = crossesSaldo
    ? `Supera su Saldo actual de ${m(sk.saldo)} y cruzaría a una capa protegida: AVÍSALO, pero no lo presentes como un bloqueo.`
    : `En Saldo, pasaría de ${m(sk.saldo)} a ${m(saldoDecision.saldoAfter ?? sk.saldo)}.`;
  const ev = evaluatePurchase({
    price,
    safeToday: cf.safeToday,
    safeThisWeek: cf.safeThisWeek,
    discretionaryAfterPlanWeekly: gi.weeklyJoyBudget,
    nowMs: Date.now(),
    onCard,
    // F4 — the card STATEMENT (flow) is already reserved on its due date by the
    // cycle-aware cashflow, so cf.safeToday/safeThisWeek already reflect it. Passing
    // cardsDueSoon.balance (the accumulated STOCK) here again would BOTH conflate
    // stock↔flow and double-count the payment → false "tienes un pago de tarjeta cerca".
    cardDueSoonAmount: 0,
    runwayOk: cf.runwayOk,
  });
  const mg = ev.miniGoal && ev.miniGoal.feasibleFromDiscretionary
    ? ` Alternativa mini-meta: ~${m(ev.miniGoal.weeklyContribution)}/sem por ${ev.miniGoal.weeks} sem (lista ~${ev.miniGoal.targetDateISO}), sin tocar pagos ni metas.`
    : "";
  const paymentTruth = onCard
    ? ` Con tarjeta no baja el efectivo hoy, pero sube la deuda por ${m(price)}.`
    : "";
  if (
    saldoDecision.recommendation === "no" ||
    saldoDecision.recommendation === "wait"
  ) {
    return {
      status: "done",
      summary: `Hoy no recomendaría comprar ${label} (${priceText}) por la presión financiera: ${saldoDecision.shortReason} ${saldoTruth}${paymentTruth}${mg} Si el Saldo cruza de capa, aclara que el aviso no bloquea; la recomendación de esperar viene de la deuda/cashflow. Tono directo, sin culpa.`,
    };
  }
  if (ev.recommendation === "buy_today") {
    return { status: "done", summary: `La proyección de cashflow permite comprar ${label} hoy (${priceText}). ${saldoTruth}${paymentTruth}${mg} Ofrécele ambas opciones; si cruza de capa, la compra sigue siendo decisión del usuario. Tono relajado, sin culpa.` };
  }
  if (ev.recommendation === "mini_goal" && ev.miniGoal) {
    return { status: "done", summary: `Comprar ${label} hoy presiona el cashflow (${ev.pressureReason ?? "reduce la holgura proyectada"}). ${saldoTruth}${paymentTruth} NO digas solo "no": propón mini-meta — aparta ~${m(ev.miniGoal.weeklyContribution)}/sem y en ${ev.miniGoal.weeks} semana(s) (≈ ${ev.miniGoal.targetDateISO}) lo compras sin tocar tu tarjeta, tu meta principal ni tu fondo. Celébralo como un plan, no como una negativa.` };
  }
  return { status: "done", summary: `Ahora mismo ${label} (${priceText}) presiona tus pagos${ev.pressureReason ? ` (${ev.pressureReason})` : ""}. ${saldoTruth}${paymentTruth} No hay plata libre para una mini-meta cómoda: sugiere esperar o ajustar otra prioridad, pero no confundas la recomendación con un bloqueo de capa. Con tacto, sin culpa.` };
}

async function executeCreateGoal(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const targetAmount = Number(args.targetAmount);
  if (!name) return { status: "needs_info", summary: "¿Cómo quieres llamar a esta meta?" };
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) return { status: "needs_info", summary: `¿De cuánto es la meta "${name}"?` };
  const cadence = ["weekly", "biweekly", "monthly"].includes(args.cadence as string) ? (args.cadence as GoalCadence) : undefined;
  const contributionAmount = Number(args.contributionAmount);
  if (
    args.contributionAmount !== undefined &&
    (!Number.isFinite(contributionAmount) || contributionAmount <= 0)
  ) {
    return {
      status: "needs_info",
      summary:
        "El aporte comprometido debe ser mayor a cero; no creé la meta descartando ese dato.",
    };
  }
  if ((cadence && args.contributionAmount === undefined) || (!cadence && args.contributionAmount !== undefined)) {
    return {
      status: "needs_info",
      summary:
        "Para reservar un aporte necesito juntos el monto y su frecuencia; no creé una meta con medio compromiso.",
    };
  }
  const targetDate = validISODate(args.targetDate);
  if (args.targetDate != null && !targetDate) {
    return {
      status: "needs_info",
      summary: "La fecha de la meta no existe o no está en formato YYYY-MM-DD; no creé la meta.",
    };
  }
  const statedCurrency =
    typeof args.currency === "string" && /^[A-Za-z]{3}$/.test(args.currency.trim())
      ? args.currency.trim().toUpperCase()
      : null;
  if (args.currency != null && !statedCurrency) {
    return {
      status: "needs_info",
      summary: "La moneda de la meta debe ser un código ISO de 3 letras; no creé la meta.",
    };
  }
  const goalCurrency = statedCurrency ?? ctx.baseCurrency;
  const a: CreateGoalArgs = {
    userId: ctx.userId,
    name,
    targetAmount,
    targetDate: targetDate ?? null,
    archetype: VALID_ARCHETYPES.has(args.archetype as GoalArchetype) ? (args.archetype as GoalArchetype) : undefined,
    isPrimary: args.isPrimary === true,
    cadence,
    contributionAmount: cadence && Number.isFinite(contributionAmount) && contributionAmount > 0 ? contributionAmount : null,
    currency: goalCurrency,
    operationKey: agentActionDedupe(ctx, "create-goal", [
      name,
      targetAmount,
      targetDate ?? null,
      goalCurrency,
      cadence ?? null,
      contributionAmount,
    ]),
  };
  const res = await createGoalRow(a);
  if (!res.ok) return { status: "error", summary: `No pude guardar la meta "${name}". No prometas que quedó registrada; ofrécele reintentar.` };
  ctx.dirty = true;
  const committed = a.cadence && a.contributionAmount ? ` Con ~${formatMoney(a.contributionAmount, goalCurrency as CurrencyCode)}/${a.cadence === "weekly" ? "sem" : a.cadence === "biweekly" ? "quincena" : "mes"} reservados.` : "";
  return res.replayed
    ? {
        status: "done",
        effect: "noop",
        summary: `Esa meta "${name}" ya estaba creada por este mismo pedido; no la dupliqué.`,
        data: { goalId: res.id },
      }
    : {
        status: "done",
        summary: `Creé la meta "${name}" (${formatMoney(targetAmount, goalCurrency as CurrencyCode)}${a.targetDate ? `, para ${a.targetDate}` : ", sin fecha fija"}).${committed} Confírmalo natural y, si no hay fecha/aporte, ofrece definirlos para armar el plan.`,
        data: { goalId: res.id },
      };
}

async function executeCreateMiniGoal(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const price = Number(args.price);
  if (!name) return { status: "needs_info", summary: "¿Para qué es la mini-meta?" };
  if (!Number.isFinite(price) || price <= 0) return { status: "needs_info", summary: `¿Cuánto cuesta ${name}?` };
  if (
    args.weeklyContribution !== undefined &&
    (!Number.isFinite(Number(args.weeklyContribution)) ||
      Number(args.weeklyContribution) <= 0)
  ) {
    return {
      status: "needs_info",
      summary:
        "El aporte semanal declarado debe ser mayor a cero. Si quieres que Kipu lo calcule, omite el campo; no convertí un valor inválido en una decisión automática.",
    };
  }
  let weekly = Number(args.weeklyContribution);
  if (!Number.isFinite(weekly) || weekly <= 0) {
    // Auto-sizing is an affordability decision. An explicitly chosen weekly
    // contribution can still be saved during a Saldo outage, but Kipu must not
    // invent one from an unavailable/placeholder joy budget.
    const unavailable = await requirePublishableSaldo("evaluate_purchase_as_goal", ctx);
    if (unavailable) return unavailable;
    const plan = planMiniGoal({
      price,
      discretionaryWeekly: ctx.briefing.goalsIntel.weeklyJoyBudget,
      nowMs: Date.now(),
    });
    weekly = plan.weeklyContribution;
  }
  if (weekly <= 0) return { status: "done", effect: "noop", summary: `Ahora mismo no hay plata libre para apartar sin tocar tus pagos o metas. Mejor esperar a que se libere algo; dilo con tacto, no como un "no" seco.` };
  const weeks = Math.max(1, Math.ceil(price / weekly));
  const localToday = todayISO(ctx);
  const target = new Date(`${localToday}T12:00:00.000Z`);
  target.setUTCDate(target.getUTCDate() + weeks * 7);
  const targetISO = target.toISOString().slice(0, 10);
  const statedCurrency =
    typeof args.currency === "string" && /^[A-Za-z]{3}$/.test(args.currency.trim())
      ? args.currency.trim().toUpperCase()
      : null;
  if (args.currency != null && !statedCurrency) {
    return {
      status: "needs_info",
      summary:
        "La moneda de la mini-meta debe ser un código ISO de 3 letras; no creé nada.",
    };
  }
  const goalCurrency = statedCurrency ?? ctx.baseCurrency;
  const res = await createGoalRow({
    userId: ctx.userId,
    name,
    targetAmount: price,
    targetDate: targetISO,
    goalType: "mini",
    archetype: "purchase",
    cadence: "weekly",
    contributionAmount: weekly,
    parentGoalId: typeof args.parentGoalId === "string" ? args.parentGoalId : null,
    currency: goalCurrency,
    operationKey: agentActionDedupe(ctx, "create-mini-goal", [
      name,
      price,
      weekly,
      targetISO,
      goalCurrency,
      typeof args.parentGoalId === "string" ? args.parentGoalId : null,
    ]),
  });
  if (!res.ok) return { status: "error", summary: `No pude guardar la mini-meta de "${name}". No prometas que quedó registrada; ofrécele reintentar.` };
  ctx.dirty = true;
  return res.replayed
    ? {
        status: "done",
        effect: "noop",
        summary: `Esa mini-meta "${name}" ya estaba creada por este mismo pedido; no la dupliqué.`,
        data: { goalId: res.id },
      }
    : {
        status: "done",
        summary: `Mini-meta creada: "${name}" — aparta ~${formatMoney(weekly, goalCurrency as CurrencyCode)}/sem y en ${weeks} semana(s) (≈ ${targetISO}) lo compras sin tocar tu tarjeta ni tu meta principal. Celébralo: es comprarte el gusto SIN deuda. Le recordaré el avance.`,
        data: { goalId: res.id },
      };
}

async function executePrioritizeGoals(ctx: AgentContext): Promise<ToolResult> {
  const gi = ctx.briefing.goalsIntel;
  if (gi.portfolio.activeCount === 0) {
    return { status: "done", summary: "Todavía no hay metas activas para priorizar. Si el usuario quiere, ofrécele crear una meta principal y, si surge un gusto, una mini-meta." };
  }
  const order = gi.portfolio.goals.slice(0, 5).map((g, i) => `${i + 1}) ${g.goal.name}${g.isPrimary ? " (principal)" : g.goalType === "mini" ? " (mini)" : ""} — ${g.plan.statusLabel}`).join("; ");
  const conflicts = gi.portfolio.conflicts.length ? ` A cuidar: ${gi.portfolio.conflicts.slice(0, 2).map((c) => c.note).join(" ")}` : "";
  return {
    status: "done",
    summary: `Orden de prioridad: ${order}. Reparto de tu plata libre: ${gi.allocation.rationale}${conflicts} Responde SIMPLE: en qué 1–2 enfocarse y qué pausar/extender si compiten; nunca sugieras saltarte un mínimo de deuda. Tono de control y calma.`,
  };
}

async function executeUpdateGoal(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const goalId = typeof args.goalId === "string" ? args.goalId : "";
  if (!goalId) return { status: "needs_info", summary: "¿Cuál meta? Si hay varias parecidas, pregúntale al usuario cuál antes de cambiarla." };
  // The portfolio lists ACTIVE goals only; a paused goal being reactivated won't
  // appear there, so resolve a display name softly and proceed by id (the store
  // update is scoped to user_id + id, and returns false if nothing matched).
  const target = ctx.briefing.goalsIntel.portfolio.goals.find((g) => g.goal.id === goalId);
  const storedGoal = ctx.goals.find((goal) => goal.id === goalId);
  const goalName = target?.goal.name ?? storedGoal?.name ?? "tu meta";
  // Cancelling a goal is a soft delete (drops from the plan): explicit user
  // confirmation first, matching the delete/cancel pattern used elsewhere.
  if (args.status === "cancelled" && args.confirm !== true) {
    return { status: "needs_info", summary: `Cancelar la meta "${goalName}" la saca de tu plan desde ya (su dinero reservado queda libre; su historial se conserva). Confirma con el usuario y vuelve a llamar con status="cancelled" y confirm=true.` };
  }
  const patch: Record<string, unknown> = {};
  if (args.status === "paused" || args.status === "active" || args.status === "cancelled") patch.status = args.status;
  const date = validISODate(args.targetDate);
  if (args.targetDate !== undefined && !date) {
    return {
      status: "needs_info",
      summary:
        "La fecha nueva de la meta no existe o no está en formato YYYY-MM-DD; no guardé el resto del patch.",
    };
  }
  if (date) patch.target_date = date;
  const contribution = Number(args.contributionAmount);
  if (
    args.contributionAmount !== undefined &&
    (!Number.isFinite(contribution) || contribution < 0)
  ) {
    return {
      status: "needs_info",
      summary:
        "El aporte de la meta debe ser cero o un monto positivo; no guardé los demás cambios junto a un aporte inválido.",
    };
  }
  if (Number.isFinite(contribution) && contribution >= 0) patch.contribution_amount = contribution;
  if (["weekly", "biweekly", "monthly"].includes(args.cadence as string)) patch.cadence = args.cadence;
  if (args.makePrimary === true) { patch.is_primary = true; patch.goal_type = "primary"; }
  if (args.flexibleDeadline === true) patch.flexible_deadline = true;
  const targetAmount = Number(args.targetAmount);
  const hasTargetAmount = Number.isFinite(targetAmount) && targetAmount > 0;
  const requestedCurrency =
    typeof args.currency === "string" && /^[A-Za-z]{3}$/.test(args.currency.trim())
      ? args.currency.trim().toUpperCase()
      : null;
  const hasDefinitionChange = hasTargetAmount || requestedCurrency !== null;
  if (args.targetAmount !== undefined && !hasTargetAmount) {
    return { status: "needs_info", summary: "¿Cuál es el nuevo monto objetivo positivo de la meta?" };
  }
  if (args.currency !== undefined && !requestedCurrency) {
    return { status: "needs_info", summary: "La moneda nueva de la meta debe ser un código ISO de 3 letras." };
  }
  if (
    requestedCurrency &&
    storedGoal &&
    requestedCurrency !== storedGoal.currency &&
    !hasTargetAmount
  ) {
    return {
      status: "needs_info",
      summary:
        "Para cambiar la moneda sin reinterpretar el objetivo viejo, dime también el nuevo monto objetivo en esa moneda. Si la meta ya tiene aportes, su moneda no se puede relabelar.",
    };
  }
  if (hasDefinitionChange && Object.keys(patch).length > 0) {
    return {
      status: "needs_info",
      summary:
        "Puedo cambiar el monto/moneda de la meta o su estado/fecha/aporte, pero no ambas definiciones en una operación parcial. Confirma primero el nuevo objetivo y después ajustamos el plan.",
    };
  }
  if (hasDefinitionChange) {
    const ok = await updateGoalDefinition({
      userId: ctx.userId,
      goalId,
      targetAmount: hasTargetAmount ? targetAmount : undefined,
      currency: requestedCurrency ?? undefined,
    });
    if (!ok) {
      return {
        status: "needs_info",
        summary:
          "No pude cambiar la definición de esa meta. Si ya tiene aportes o historial, su moneda es inmutable; crea una meta nueva o corrige solo el monto en la moneda actual.",
      };
    }
    ctx.dirty = true;
    return {
      status: "done",
      summary: `Actualicé "${goalName}"${hasTargetAmount ? ` a un objetivo de ${formatMoney(targetAmount, (requestedCurrency ?? storedGoal?.currency ?? ctx.baseCurrency) as CurrencyCode)}` : ""}${requestedCurrency ? ` en ${requestedCurrency}` : ""}.`,
    };
  }
  if (Object.keys(patch).length === 0) return { status: "needs_info", summary: "¿Qué quieres cambiar de la meta: pausarla, cancelarla, su aporte, su fecha, o hacerla principal?" };
  const ok = await updateGoalRow(ctx.userId, goalId, patch);
  if (!ok) return { status: "needs_info", summary: `No encuentro esa meta para actualizar; muéstrale sus metas y que elija cuál.` };
  ctx.dirty = true;
  const what =
    patch.status === "paused" ? "la pausé (su dinero reservado queda libre para el resto)"
    : patch.status === "cancelled" ? "la cancelé (sale de tu plan; su dinero reservado queda libre y su historial se conserva)"
    : patch.status === "active" ? "la reactivé"
    : patch.is_primary ? "ahora es tu meta principal"
    : "la actualicé";
  return { status: "done", summary: `Listo, "${goalName}": ${what}. Confírmalo natural y, si liberó o reservó plata, dilo simple.` };
}

async function executeRegisterInvestment(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const value = Number(args.value);
  const assetClass = VALID_ASSET_CLASSES.has(args.assetClass as AssetClass) ? (args.assetClass as AssetClass) : null;
  if (!name) return { status: "needs_info", summary: "¿Cómo se llama esa inversión o activo?" };
  if (!assetClass) return { status: "needs_info", summary: "¿Qué tipo de activo es? (póliza/plazo fijo, acciones/ETF, cripto, propiedad, vehículo, negocio, préstamo a favor…)" };
  if (!Number.isFinite(value) || value < 0) return { status: "needs_info", summary: `¿Cuál es el valor actual de ${name}? (lo que tú sabes; no invento precios)` };
  const parsedCurrency = statedAssetCurrency(args.currency);
  if (args.currency != null && !parsedCurrency) {
    return {
      status: "needs_info",
      summary:
        "La moneda del activo debe ser un código ISO de 3 letras; no lo guardé en tu moneda base por defecto.",
    };
  }
  const statedCurrency = parsedCurrency ?? ctx.baseCurrency;
  const conversion = assetValueToBase(value, statedCurrency, ctx);
  if (!conversion) {
    return {
      status: "needs_info",
      summary: `El valor de ${name} está en ${statedCurrency} y tu base es ${ctx.baseCurrency}. Necesito una tasa confiable antes de guardarlo; no lo registro 1:1.`,
    };
  }
  const expectedReturnPct = Number(args.expectedReturnPct);
  const res = await registerInvestmentRow({
    userId: ctx.userId,
    name,
    assetClass,
    valueBase: conversion.valueBase,
    valueOriginal: conversion.valueOriginal,
    currency: statedCurrency,
    liquid: args.liquid === true,
    expectedReturnPct: Number.isFinite(expectedReturnPct) && expectedReturnPct > 0 ? expectedReturnPct : null,
    returnKind: ["annual_nominal", "annual_effective", "monthly"].includes(args.returnKind as string) ? (args.returnKind as "annual_nominal" | "annual_effective" | "monthly") : undefined,
    operationKey: agentActionDedupe(ctx, "register-investment", [
      name,
      assetClass,
      value,
      statedCurrency,
      conversion.valueBase,
    ]),
  });
  if (!res.ok) return { status: "error", summary: `No pude guardar ${name}; no afirmes que quedó registrado y ofrécele reintentar.` };
  ctx.dirty = true;
  const rate = Number.isFinite(expectedReturnPct) && expectedReturnPct > 0 ? ` al ${expectedReturnPct}% (proyectaré su crecimiento, estimado)` : " (sin rendimiento informado: cuenta para tu patrimonio pero no proyecto crecimiento)";
  return res.replayed
    ? {
        status: "done",
        effect: "noop",
        summary: `${name} ya estaba registrado por este mismo pedido; no lo dupliqué.`,
        data: { assetId: res.id },
      }
    : {
        status: "done",
        summary: `Registré ${name} por ${formatMoney(value, statedCurrency as CurrencyCode)}${conversion.echo}${rate}. Ya entra en tu patrimonio. NUNCA inventes precios ni rendimientos; jamás recomiendes un activo específico.`,
        data: { assetId: res.id },
      };
}

// ── Stage 30 — ASSETS CRUD via chat. Assets live in investment_accounts and
// count toward NET WORTH only — never spendable-this-week money, never the
// Margen. Values are what the user states; we never fabricate a market price.
// remove_asset is a SOFT remove (stops counting toward net worth; row kept).

// Resolve an asset the user names from the per-turn assets list (loose, accent-
// insensitive). Returns the single match, or null when zero / ambiguous.
function resolveAsset(assets: Asset[], nameOrId: string): { asset: Asset | null; many: boolean } {
  const byId = assets.find((a) => a.id === nameOrId);
  if (byId) return { asset: byId, many: false };
  const target = normName(nameOrId);
  if (!target) return { asset: null, many: false };
  const matches = assets.filter((a) => {
    const n = normName(a.name);
    return n.includes(target) || target.includes(n);
  });
  if (matches.length === 1) return { asset: matches[0], many: false };
  return { asset: null, many: matches.length > 1 };
}

/** A sole saved entity is a safe default only when the user/model OMITTED the
 * reference. If a reference is present, it must match that row. The old
 * "preselect sole, then try to match" pattern silently charged/edited the sole
 * entity even when the user explicitly named a different one. */
export function resolveExplicitOrSingle<T>(
  rows: T[],
  reference: string | null | undefined,
  label: (row: T) => string,
): T | null {
  const raw = reference?.trim() ?? "";
  if (!raw) return rows.length === 1 ? rows[0] : null;
  const byId = rows.find(
    (row) =>
      typeof row === "object" &&
      row != null &&
      "id" in row &&
      (row as { id?: unknown }).id === raw,
  );
  if (byId) return byId;
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .trim();
  const target = normalize(raw);
  const matches = rows.filter((row) => {
    const candidate = normalize(label(row));
    return (
      candidate === target ||
      candidate.includes(target) ||
      target.includes(candidate)
    );
  });
  return matches.length === 1 ? matches[0] : null;
}

// S31 (item 5.10) — value_base is ALWAYS the user's BASE currency. A value the
// user states in another currency converts with a KNOWN rate (ctx.fxRates) or
// we ASK — a raw foreign value stored as base (90M COP read as 90M USD) lies
// about the whole patrimonio. Returns the base value + a human echo, or null
// when no trusted rate exists (the caller asks; NEVER 1:1).
function assetValueToBase(
  value: number,
  statedCurrency: string | null,
  ctx: AgentContext,
): { valueBase: number; valueOriginal: number | null; echo: string } | null {
  if (!statedCurrency || statedCurrency === ctx.baseCurrency) {
    return { valueBase: value, valueOriginal: null, echo: "" };
  }
  const res = convertFx(value, statedCurrency, ctx.baseCurrency, ctx.fxRates ?? []);
  if (!res.ok) return null;
  return {
    valueBase: res.baseAmount,
    valueOriginal: value,
    echo: ` (${money(value, statedCurrency)} ≈ ${money(res.baseAmount, ctx.baseCurrency)} con tu tipo de cambio)`,
  };
}

function statedAssetCurrency(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : null;
}

async function executeAddAsset(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const value = Number(args.value);
  const assetClass = VALID_ASSET_CLASSES.has(args.assetClass as AssetClass) ? (args.assetClass as AssetClass) : null;
  if (!name) return { status: "needs_info", summary: "¿Cómo se llama ese activo?" };
  if (!assetClass) return { status: "needs_info", summary: "¿Qué tipo de activo es? (efectivo/ahorro, inversión/acciones, plazo fijo/póliza, cripto, inmueble, vehículo, negocio, préstamo a favor…)" };
  if (!Number.isFinite(value) || value < 0) return { status: "needs_info", summary: `¿Cuál es el valor actual de ${name}? (lo que tú sabes; no invento precios)` };
  const statedCurrency = statedAssetCurrency(args.currency);
  if (args.currency != null && !statedCurrency) {
    return {
      status: "needs_info",
      summary:
        "La moneda del activo debe ser un código ISO de 3 letras; no lo guardé en tu moneda base por defecto.",
    };
  }
  const conv = assetValueToBase(value, statedCurrency, ctx);
  if (!conv) {
    return { status: "needs_info", summary: `El valor de ${name} viene en ${statedCurrency} y tu moneda base es ${ctx.baseCurrency}: no tengo un tipo de cambio confiable de ese par y NUNCA lo invento (guardarlo 1:1 mentiría tu patrimonio). Pregunta a cuánto está ${statedCurrency}/${ctx.baseCurrency}, guárdalo con set_exchange_rate y reintenta con el mismo valor.` };
  }
  const expectedReturnPct = Number(args.expectedReturnPct);
  const res = await insertAssetRow({
    userId: ctx.userId,
    name,
    assetClass,
    valueBase: conv.valueBase,
    valueOriginal: conv.valueOriginal,
    currency: statedCurrency ?? ctx.baseCurrency,
    liquid: args.liquid === true,
    includeInNetWorth: args.includeInNetWorth === false ? false : true,
    expectedReturnPct: Number.isFinite(expectedReturnPct) && expectedReturnPct > 0 ? expectedReturnPct : null,
    notes: typeof args.notes === "string" && args.notes.trim() ? args.notes.trim() : null,
    operationKey: agentActionDedupe(ctx, "add-asset", [
      name,
      assetClass,
      value,
      statedCurrency ?? ctx.baseCurrency,
      conv.valueBase,
    ]),
  });
  if (!res.ok) return { status: "error", summary: `No pude guardar ${name}; no afirmes que quedó registrado y ofrécele reintentar.` };
  ctx.dirty = true;
  const refreshed = await refreshAgentContextIfDirty(ctx);
  const rate = Number.isFinite(expectedReturnPct) && expectedReturnPct > 0 ? ` al ${expectedReturnPct}% (crecimiento estimado)` : "";
  const excluded = args.includeInNetWorth === false ? " (lo registro pero NO lo cuento en tu patrimonio, como pediste)" : "";
  return res.replayed
    ? {
        status: "done",
        effect: "noop",
        summary: `${name} ya estaba registrado por este mismo pedido; no lo dupliqué.`,
        data: { assetId: res.id },
      }
    : {
        status: "done",
        summary: withRefreshCaveat(refreshed, `Registré ${name} por ${formatMoney(conv.valueBase, ctx.baseCurrency)}${conv.echo}${rate}${excluded}. Cuenta en tu patrimonio, NO es dinero disponible ni toca tu Saldo. Confírmalo natural; nunca inventes su precio de mercado.`),
        data: { assetId: res.id },
      };
}

async function executeUpdateAsset(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const assets = ctx.assets ?? [];
  const ref = typeof args.assetId === "string" && args.assetId ? args.assetId : typeof args.assetName === "string" ? args.assetName : "";
  if (!ref) return { status: "needs_info", summary: "¿Cuál activo actualizo? Muéstrale los suyos y que elija." };
  // Refutación P7: el guard va ANTES de resolver — con lista truncada, un match
  // "único" puede tener un gemelo que no vimos, y escribirle sería adivinar.
  if (ctx.assetsAvailable === false) {
    return { status: "needs_info", summary: "Ahora mismo no pude leer sus activos completos, así que no actualizo ninguno con certeza. NO afirmes que no tiene; dile que lo reintente en un rato." };
  }
  const { asset, many } = resolveAsset(assets, ref);
  if (!asset) {
    const list = assets.map((a) => `"${a.name}"`).join(", ");
    // La ausencia aquí es PROBADA: el guard de arriba ya rechazó toda lectura no
    // publicable, así que una lista vacía es "de verdad no tiene".
    return { status: "needs_info", summary: many ? `Hay varios activos que suenan a eso: ${list}. Pregúntale cuál.` : list ? `No reconozco ese activo. Tiene: ${list}. Pregúntale cuál.` : "No tiene activos registrados. ¿Quieres que agregue uno con add_asset?" };
  }
  if (
    args.newValue !== undefined &&
    (!Number.isFinite(Number(args.newValue)) || Number(args.newValue) < 0)
  ) {
    return {
      status: "needs_info",
      summary:
        `El nuevo valor de "${asset.name}" debe ser cero o positivo; no guardé ningún otro cambio del mismo patch.`,
    };
  }
  if (
    args.expectedReturnPct !== undefined &&
    (!Number.isFinite(Number(args.expectedReturnPct)) ||
      Number(args.expectedReturnPct) < 0)
  ) {
    return {
      status: "needs_info",
      summary:
        `El rendimiento de "${asset.name}" debe ser cero o positivo; no guardé ningún otro cambio del mismo patch.`,
    };
  }
  if (
    args.newName !== undefined &&
    (typeof args.newName !== "string" || !args.newName.trim())
  ) {
    return {
      status: "needs_info",
      summary:
        "El nombre nuevo del activo no puede estar vacío; no guardé el resto del patch.",
    };
  }
  const newValue = Number.isFinite(Number(args.newValue)) && Number(args.newValue) >= 0 ? Number(args.newValue) : undefined;
  const newName = typeof args.newName === "string" && args.newName.trim() ? args.newName.trim() : undefined;
  const liquid = typeof args.liquid === "boolean" ? args.liquid : undefined;
  const includeInNetWorth = typeof args.includeInNetWorth === "boolean" ? args.includeInNetWorth : undefined;
  const expectedReturnPct = Number.isFinite(Number(args.expectedReturnPct)) && Number(args.expectedReturnPct) >= 0 ? Number(args.expectedReturnPct) : undefined;
  const notes = typeof args.notes === "string" ? args.notes : undefined;
  if (newValue === undefined && newName === undefined && liquid === undefined && includeInNetWorth === undefined && expectedReturnPct === undefined && notes === undefined) {
    return { status: "needs_info", summary: `¿Qué cambio de "${asset.name}"? (su valor, nombre, si es líquido, si cuenta en el patrimonio, su rendimiento, o una nota)` };
  }
  // S31 (item 5.10) — a revalue stated in the asset's own currency converts to
  // BASE with a known rate before storing (value_base is always base). No rate
  // → ask; never 1:1.
  const nativeCurrency = statedAssetCurrency(asset.currency) ?? ctx.baseCurrency;
  let valueBaseToStore: number | undefined;
  let valueOriginal: number | null = null;
  let valueEcho = "";
  if (newValue !== undefined) {
    const conv = assetValueToBase(newValue, nativeCurrency, ctx);
    if (!conv) {
      return { status: "needs_info", summary: `"${asset.name}" está en ${nativeCurrency} y tu moneda base es ${ctx.baseCurrency}: no tengo un tipo de cambio confiable de ese par y NUNCA lo invento. Pregunta a cuánto está ${nativeCurrency}/${ctx.baseCurrency}, guárdalo con set_exchange_rate y reintenta con el mismo valor.` };
    }
    valueBaseToStore = conv.valueBase;
    valueOriginal = conv.valueOriginal;
    valueEcho = conv.echo;
  }
  const ok = await updateAssetRow({
    userId: ctx.userId,
    id: asset.id,
    name: newName,
    valueBase: valueBaseToStore,
    valueOriginal,
    liquid,
    includeInNetWorth,
    expectedReturnPct,
    notes,
  });
  if (!ok) return { status: "error", summary: "No pude actualizar el activo ahora; ofrécele reintentar." };
  ctx.dirty = true;
  const refreshed = await refreshAgentContextIfDirty(ctx);
  const changes: string[] = [];
  if (newName !== undefined) changes.push(`ahora se llama "${newName}"`);
  if (newValue !== undefined) changes.push(`vale ${money(newValue, nativeCurrency)}${valueEcho}`);
  if (liquid !== undefined) changes.push(liquid ? "marcado como líquido" : "marcado como no líquido");
  if (includeInNetWorth !== undefined) changes.push(includeInNetWorth ? "vuelve a contar en tu patrimonio" : "ya no cuenta en tu patrimonio");
  if (expectedReturnPct !== undefined) changes.push(expectedReturnPct > 0 ? `rendimiento ${expectedReturnPct}% (estimado)` : "sin rendimiento");
  if (notes !== undefined) changes.push(notes.trim() ? "guardé tu nota" : "quité la nota");
  return {
    status: "done",
    summary: withRefreshCaveat(
      refreshed,
      `Actualicé "${asset.name}": ${changes.join(", ")}. Sigue contando solo en tu patrimonio, nunca en tu Saldo. Confírmalo natural; no inventes su precio.`,
    ),
  };
}

async function executeRemoveAsset(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const assets = ctx.assets ?? [];
  const ref = typeof args.assetId === "string" && args.assetId ? args.assetId : typeof args.assetName === "string" ? args.assetName : "";
  if (!ref) return { status: "needs_info", summary: "¿Cuál activo quito? Muéstrale los suyos y que elija." };
  // Refutación P7: guard ANTES de resolver (ver update_asset).
  if (ctx.assetsAvailable === false) {
    return { status: "needs_info", summary: "Ahora mismo no pude leer sus activos completos, así que no quito ninguno con certeza. NO afirmes que no tiene; dile que lo reintente en un rato." };
  }
  const { asset, many } = resolveAsset(assets, ref);
  if (!asset) {
    const list = assets.map((a) => `"${a.name}"`).join(", ");
    // Ausencia PROBADA (el guard de arriba filtró toda lectura no publicable).
    return { status: "needs_info", summary: many ? `Hay varios activos que suenan a eso: ${list}. Pregúntale cuál.` : list ? `No reconozco ese activo. Tiene: ${list}. Pregúntale cuál.` : "No tiene activos registrados que quitar." };
  }
  if (args.confirm !== true) {
    // value_base is ALWAYS base currency (S31 item 5.10): label it as such.
    return { status: "needs_info", summary: `Quitar "${asset.name}" (${money(asset.valueBase, ctx.baseCurrency)}) lo saca de tu patrimonio; el registro se conserva (no se borra nada). Si lo VENDISTE y la plata entró a una cuenta, eso se registra aparte con log_movement. Pregúntale si está seguro y, si dice que sí, vuelve a llamar remove_asset con confirm=true.` };
  }
  const ok = await removeAssetRow({ userId: ctx.userId, id: asset.id });
  if (!ok) return { status: "error", summary: "No pude quitar el activo ahora; ofrécele reintentar." };
  ctx.assets = assets.filter((a) => a.id !== asset.id);
  ctx.dirty = true;
  const refreshed = await refreshAgentContextIfDirty(ctx);
  return { status: "done", summary: withRefreshCaveat(refreshed, `Listo: "${asset.name}" ya no cuenta en tu patrimonio (su registro se conserva). No moví dinero. Si la venta entró a una cuenta, regístrala aparte. Confírmalo simple y sin drama.`) };
}

// S31 (item 2.5) — stopgap mirror: until EVERY consumer reads per-entity notes,
// an entity note ALSO lands as a compact user_context_notes row ("Nota sobre
// {entidad}: …"), which every surface already reads — so "lo tendré presente"
// is true everywhere today. Replace-not-append: any previous mirror for the
// same entity is deactivated first (append-only pattern, never deleted), and an
// empty note just clears the mirror. Best-effort: a mirror failure never fails
// the entity-note write.
async function mirrorEntityNoteToContext(userId: string, label: string, note: string): Promise<boolean> {
  try {
    const prefix = `Nota sobre ${label}:`;
    const supabase = createSupabaseAdminClient();
    // CAP+1: a truncated scan cannot prove which prior mirror must be retired.
    const { data, error } = await supabase
      .from("user_context_notes")
      .select("id, content")
      .eq("user_id", userId)
      .eq("is_active", true)
      .eq("source", "system")
      .limit(201);
    if (error || !data || data.length > 200) return false;
    const stale = (data as { id: string; content: string | null }[])
      .filter((r) => String(r.content ?? "").startsWith(prefix))
      .map((r) => r.id);
    if (stale.length > 0) {
      const { error: staleError } = await supabase
        .from("user_context_notes")
        .update({ is_active: false })
        .in("id", stale);
      if (staleError) return false;
    }
    const clean = note.replace(/\s+/g, " ").trim();
    if (clean) {
      const { error: insertError } = await supabase.from("user_context_notes").insert({
        user_id: userId,
        note_type: "general",
        content: `${prefix} ${clean}`.slice(0, 480),
        source: "system",
        is_active: true,
      });
      if (insertError) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Attach/update a memory NOTE on any entity, and — when the note describes a
// future dated change — ALSO create a reminder (reusing the scheduled-change
// engine) so Kipu proactively asks then. The note write and the reminder are
// independent: a note always saves; the reminder is best-effort on top.
async function executeSetEntityNote(
  args: Record<string, unknown>,
  ctx: AgentContext,
  serverAuthorized = false,
): Promise<ToolResult> {
  const entityType = typeof args.entityType === "string" ? args.entityType : "";
  const ref = typeof args.nameOrId === "string" ? args.nameOrId.trim() : "";
  const note = typeof args.note === "string" ? args.note : "";
  if (!ref) return { status: "needs_info", summary: "¿Sobre qué (cuál cuenta, tarjeta, gasto, meta, ingreso o activo) es la nota?" };
  const reminderRequested = args.scheduleReminderDate !== undefined;
  const reminderDate = validISODate(args.scheduleReminderDate);
  if (
    reminderRequested &&
    (!reminderDate || reminderDate < todayISO(ctx))
  ) {
    return {
      status: "needs_info",
      summary:
        "La fecha del recordatorio debe existir y ser hoy o futura (YYYY-MM-DD). No guardé la nota ni un recordatorio parcial.",
    };
  }

  // Resolve the entity + its display label, per type. fixed_expense routes
  // through the fixed-expense store so its own safety stays centralized.
  let ok = false;
  let label = ref;
  let scheduleTargetType: ScheduledTargetType | null = null;
  let scheduleTargetId: string | null = null;
  let scheduleTargetCurrency: string | null = null;

  if (entityType === "account") {
    const byId = ctx.accounts.find((a) => a.id === ref);
    const resolution = resolveExistingInstrumentName(ref, ctx.accounts);
    const hit = byId ?? resolution.exact;
    if (!hit && resolution.possible.length > 0) {
      return {
        status: "needs_info",
        summary: `¿Cuál cuenta? Coinciden: ${resolution.possible.map((a) => `"${a.name}"`).join(", ")}.`,
      };
    }
    if (!hit) return { status: "needs_info", summary: ctx.accounts.length ? `¿Cuál cuenta? Tiene: ${ctx.accounts.map((a) => `"${a.name}"`).join(", ")}.` : "No tiene cuentas registradas." };
    label = hit.name;
    ok = await setEntityNote({ userId: ctx.userId, entity: "account", id: hit.id, note });
  } else if (entityType === "card" || entityType === "debt") {
    const byId = ctx.debtAccounts.find((d) => d.id === ref);
    const resolution = resolveExistingInstrumentName(ref, ctx.debtAccounts);
    const hit = byId ?? resolution.exact;
    if (!hit && resolution.possible.length > 0) {
      return {
        status: "needs_info",
        summary: `¿Cuál tarjeta/deuda? Coinciden: ${resolution.possible.map((d) => `"${d.name}"`).join(", ")}.`,
      };
    }
    if (!hit) return { status: "needs_info", summary: ctx.debtAccounts.length ? `¿Cuál tarjeta/deuda? Tiene: ${ctx.debtAccounts.map((d) => `"${d.name}"`).join(", ")}.` : "No tiene tarjetas ni deudas registradas." };
    label = hit.name;
    ok = await setEntityNote({ userId: ctx.userId, entity: "debt", id: hit.id, note });
  } else if (entityType === "goal") {
    const byId = ctx.goals.find((g) => g.id === ref);
    const resolution = resolveExistingInstrumentName(ref, ctx.goals);
    const hit = byId ?? resolution.exact;
    if (!hit && resolution.possible.length > 0) {
      return {
        status: "needs_info",
        summary: `¿Cuál meta? Coinciden: ${resolution.possible.map((g) => `"${g.name}"`).join(", ")}.`,
      };
    }
    if (!hit) return { status: "needs_info", summary: ctx.goals.length ? `¿Cuál meta? Tiene: ${ctx.goals.map((g) => `"${g.name}"`).join(", ")}.` : "No tiene metas registradas." };
    label = hit.name;
    scheduleTargetType = "goal";
    scheduleTargetId = hit.id;
    scheduleTargetCurrency = hit.currency;
    ok = await setEntityNote({ userId: ctx.userId, entity: "goal", id: hit.id, note });
  } else if (entityType === "asset") {
    // Re-auditoría 2 (punto 7): sin lectura de activos probada, "no tiene activos"
    // es una afirmación inventada — mismo brazo que update_asset/remove_asset.
    if (ctx.assetsAvailable === false) {
      return { status: "needs_info", summary: "Ahora mismo no pude leer sus activos. NO afirmes que no existe ni que no tiene; dile que lo reintente en un rato." };
    }
    const { asset, many } = resolveAsset(ctx.assets ?? [], ref);
    if (!asset) return { status: "needs_info", summary: many ? "Hay varios activos que suenan a eso; pregúntale cuál." : ((ctx.assets ?? []).length ? `¿Cuál activo? Tiene: ${(ctx.assets ?? []).map((a) => `"${a.name}"`).join(", ")}.` : "No tiene activos registrados.") };
    label = asset.name;
    ok = await setEntityNote({ userId: ctx.userId, entity: "asset", id: asset.id, note });
  } else if (entityType === "income") {
    // Publicable antes de afirmar ausencia (doctrina P7/P9): con la lectura caída
    // o topada, "No tiene ingresos" era una afirmación inventada.
    const incomesRead = await readIncomeSources(ctx.userId);
    if (!moneyReadPublishable(incomesRead)) {
      return { status: "needs_info", summary: "Ahora mismo no pude leer sus ingresos. NO afirmes que no tiene; dile que lo reintente en un rato." };
    }
    const incomes = incomesRead.sources.filter((i) => i.status !== "cancelled");
    const income = resolveIncomeByName(incomes, ref);
    if (!income) return { status: "needs_info", summary: incomes.length ? `¿Cuál ingreso? Tiene: ${incomes.map((i) => `"${i.name}"`).join(", ")}.` : "No tiene ingresos registrados." };
    const incomeEntityGate = await guardResolvedEntityChoice({
      toolName: "set_entity_note",
      args,
      ctx,
      label: "el ingreso",
      chosen: income,
      peers: incomes,
      serverAuthorized,
    });
    if (incomeEntityGate) return incomeEntityGate;
    label = income.name;
    scheduleTargetType = "income_source";
    scheduleTargetId = income.id;
    scheduleTargetCurrency = income.currency;
    ok = await setEntityNote({ userId: ctx.userId, entity: "income", id: income.id, note });
  } else if (entityType === "fixed_expense") {
    const matchRead = await readSimilarFixedExpenses({ userId: ctx.userId, name: ref });
    // Publicable, no solo ok: un scan topado no probó ver todos los fijos, y este
    // brazo elige UNO y le programa recordatorios encima (re-auditoría 2, punto 5).
    if (!moneyReadPublishable(matchRead)) return { status: "needs_info", summary: "Ahora mismo no pude leer sus gastos fijos. NO afirmes que no existe; dile que lo reintente en un rato." };
    const matches = matchRead.matches;
    const fx = matches.length === 1 ? matches[0] : null;
    if (!fx) return { status: "needs_info", summary: matches.length > 1 ? `Hay varios gastos fijos parecidos: ${matches.map((m) => `"${m.name}"`).join(", ")}. Pregúntale cuál.` : `No encuentro un gasto fijo que suene a "${ref}".` };
    const fixedCatalogRead = await readFixedExpenseCatalog(ctx.userId);
    if (!moneyReadPublishable(fixedCatalogRead)) {
      return {
        status: "needs_info",
        summary:
          "Ahora mismo no pude comprobar el catálogo completo de gastos fijos. No guardé la nota; dile que lo reintente.",
      };
    }
    const fixedEntityGate = await guardResolvedEntityChoice({
      toolName: "set_entity_note",
      args,
      ctx,
      label: "el gasto fijo",
      chosen: fx,
      peers: fixedCatalogRead.expenses,
      serverAuthorized,
    });
    if (fixedEntityGate) return fixedEntityGate;
    label = fx.name;
    scheduleTargetType = "fixed_expense";
    scheduleTargetId = fx.id;
    scheduleTargetCurrency = fx.currency;
    ok = await updateFixedExpenseFields({ userId: ctx.userId, id: fx.id, notes: note });
  } else {
    return { status: "needs_info", summary: "¿La nota es de una cuenta, tarjeta/deuda, gasto fijo, meta, ingreso o activo?" };
  }

  if (!ok) return { status: "error", summary: "No pude guardar la nota ahora; ofrécele reintentar." };
  ctx.dirty = true;
  const mirrored = await mirrorEntityNoteToContext(ctx.userId, label, note);

  // Optional: a dated future change → a reminder so Kipu asks on that day. This
  // reuses the scheduled-change engine as a 'reminder' (never mutates an amount).
  let reminderNote = "";
  if (reminderDate) {
    const res = await createScheduledChange(ctx.userId, {
      targetType: scheduleTargetType ?? "reminder",
      targetId: scheduleTargetId,
      targetLabel: label,
      changeKind: "reminder",
      amount: null,
      currency: scheduleTargetCurrency,
      newFrequency: null,
      effectiveDate: reminderDate,
      cadence: "once",
      note: note.trim() ? note.trim().slice(0, 300) : `Revisar ${label}`,
      operationKey: agentActionDedupe(ctx, "entity-note-reminder", [
        scheduleTargetType ?? "reminder",
        scheduleTargetId,
        label,
        reminderDate,
        note,
      ]),
    });
    if (!res.ok) {
      return {
        status: "error",
        effect: "wrote",
        summary: `La nota de "${label}" sí quedó guardada, pero el recordatorio del ${reminderDate} no. No afirmes que quedó programado; ofrece reintentarlo.`,
      };
    }
    reminderNote = ` Además te lo recuerdo el ${reminderDate} para aplicarlo (no cambié nada hoy).`;
  }

  const cleared = note.trim() === "";
  if (!mirrored) {
    return {
      status: "error",
      effect: "wrote",
      summary: `${cleared ? `La nota de "${label}" se quitó en su ficha.` : `La nota de "${label}" quedó en su ficha.`}${reminderNote} No pude actualizar la memoria transversal; no prometas que todas las superficies la recordarán hasta reintentar.`,
    };
  }
  return { status: "done", summary: `${cleared ? `Quité la nota de "${label}".` : `Anoté sobre "${label}": lo tendré presente.`}${reminderNote} Confírmalo natural y breve.` };
}

export type CardPaymentSourcesPlan =
  | { route: "single" }
  | {
      route: "multi";
      legs: MultiSourceCardPaymentLeg[];
      labels: string[];
      currency: string;
    }
  | { route: "ask"; reason: string };

type PaymentInstrument = {
  id: string;
  name: string;
  currency: string;
  kind: "account" | "loan";
};

function uniquePaymentInstrument(
  ref: string,
  instruments: PaymentInstrument[],
): PaymentInstrument | null {
  const exact = instruments.find((item) => item.id === ref);
  if (exact) return exact;
  const target = normName(ref);
  if (!target) return null;
  const matches = instruments.filter((item) => {
    const name = normName(item.name);
    const distinct = name
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !["banco", "cuenta", "tarjeta", "prestamo", "credito", "deuda"].includes(token));
    return name === target ||
      name.includes(target) ||
      target.includes(name) ||
      distinct.some((token) => target.split(/\s+/).includes(token));
  });
  return matches.length === 1 ? matches[0] : null;
}

/** Deterministic bridge between natural split evidence and the atomic writer.
 * It never trusts a model-supplied kind: ids/names are resolved against the
 * live account/debt inventory and loan-vs-account comes from that row. */
export function planCardPaymentSources(input: {
  rawMessage: string;
  totalAmount: number;
  accounts: { id: string; name: string; currency: string }[];
  debtAccounts: { id: string; name: string; currency: string; type: string }[];
}): CardPaymentSourcesPlan {
  const instruments: PaymentInstrument[] = [
    ...input.accounts.map((row) => ({ ...row, kind: "account" as const })),
    ...input.debtAccounts
      .filter((row) => row.type !== "credit_card")
      .map((row) => ({ id: row.id, name: row.name, currency: row.currency, kind: "loan" as const })),
  ];
  // Source amounts are evidence, not model arguments. The first J-8 draft
  // accepted a structured `sources[]` invented by the LLM as long as it summed
  // to the total — the same class as trusting its invented 552.77. Resolve the
  // complete split only from the raw user message and live instrument names.
  const inferred = inferMultiSourceAllocations(
    input.rawMessage,
    instruments.map((item) => item.name),
    input.totalAmount,
  );
  if (!inferred || inferred.length < 2) {
    const textual = planMultiSourcePayment({
      rawMessage: input.rawMessage,
      instrumentNames: instruments.map((item) => item.name),
      totalAmount: input.totalAmount,
    });
    return textual.ok ? { route: "single" } : { route: "ask", reason: textual.reason };
  }
  const roundedTotal = Math.round(input.totalAmount * 100) / 100;
  const sum = Math.round(inferred.reduce((acc, item) => acc + item.amount, 0) * 100) / 100;
  if (Math.abs(sum - roundedTotal) > 0.01) {
    return {
      route: "ask",
      reason: `Las partes suman ${sum}, pero el pago total es ${roundedTotal}. NO registré nada; pregúntale el reparto exacto.`,
    };
  }
  const resolved = inferred.map((item) => ({
    item,
    instrument: uniquePaymentInstrument(item.name, instruments),
  }));
  if (resolved.some((row) => !row.instrument)) {
    return {
      route: "ask",
      reason: "No pude identificar de forma única todos los orígenes del reparto. NO registré nada; pregunta cuál cuenta o préstamo corresponde a cada parte.",
    };
  }
  const rows = resolved as { item: { name: string; amount: number }; instrument: PaymentInstrument }[];
  if (new Set(rows.map((row) => row.instrument.id)).size !== rows.length) {
    return { route: "ask", reason: "El mismo origen aparece dos veces en el reparto. Agrupa su monto y vuelve a intentarlo; no registré nada." };
  }
  const currencies = new Set(rows.map((row) => row.instrument.currency.toUpperCase()));
  if (currencies.size !== 1) {
    return {
      route: "ask",
      reason: "Los orígenes del pago están en monedas distintas. No puedo sumar dos montos nativos como si fueran iguales; no registré nada.",
    };
  }
  const clearing = rows.find((row) => row.instrument.kind === "account")?.instrument ?? null;
  if (!clearing) {
    return {
      route: "ask",
      reason: "Todo el pago figura como dinero prestado, pero necesito saber por qué cuenta pasó para dejar caja y deuda consistentes. No registré nada.",
    };
  }
  return {
    route: "multi",
    currency: [...currencies][0],
    labels: rows.map((row) => `${row.instrument.name}: ${row.item.amount}`),
    legs: rows.map((row) => ({
      kind: row.instrument.kind,
      instrumentId: row.instrument.id,
      clearingAccountId: row.instrument.kind === "loan" ? clearing.id : null,
      amount: Math.round(row.item.amount * 100) / 100,
    })),
  };
}

/** The expectation used to validate "pagué el total" must be expressed in the
 * card's NATIVE currency. `fullPaymentDue` is base-valued in the agent context,
 * while `fullPaymentDueOriginal`/`statementTotalDue` are native. A covered
 * statement is a proved zero — it must not fall through to the old total. */
export { cardNativeStatementExpected };

/** "Paid in full" is an engine fact, not permission for the model to copy an
 * arbitrary number from the surrounding account context. */
export function resolvedCardPaymentAmount(input: {
  paidInFull: boolean;
  proposedAmount: unknown;
  statementExpected: number | null;
}): number | null {
  const candidate = input.paidInFull
    ? input.statementExpected
    : Number(input.proposedAmount);
  return candidate != null &&
    Number.isFinite(candidate) &&
    (candidate > 0 || (input.paidInFull && candidate === 0))
    ? Math.round(candidate * 100) / 100
    : null;
}

export type PreparedAtomicAgentAction =
  | {
      ok: true;
      resolvedType:
        | "ledger_entry"
        | "card_payment"
        | "repayment"
        | "debt_proceeds"
        | "operation_reversal";
      payload: Record<string, unknown>;
      summary: string;
    }
  | { ok: false; summary: string };

export type AgentAtomicGroupMode = "always" | "conditional" | "none";

/** Capability metadata shared by the planner and the adapter. This describes
 * whether an existing typed writer has a database-native representation inside
 * `kipu_apply_operation`; it never classifies user language. */
export function agentToolAtomicGroupMode(name: string): AgentAtomicGroupMode {
  if (name === "undo_agent_operation" || name === "register_card_payment") {
    return "always";
  }
  if (name === "record_person_payment") return "conditional";
  if (name === "log_movement") return "conditional";
  return "none";
}

/** Argument-level half of the same contract. Keep this pure and consume it in
 * plan validation so an impossible group is rejected before it becomes durable
 * work that can only loop on "missing information".
 *
 * `groupCapabilities` is the complete membership of the atomic group the action
 * belongs to. It matters because `log_movement` is preparable ONLY as the
 * replacement half of a whole-operation correction: `prepareAtomicAgentAction`
 * refuses every other grouped movement. Answering an unconditional `true` here
 * made this predicate disagree with the adapter it claims to describe, so a
 * funding group such as [income, card payment] looked admissible to the layer
 * documented as the place where impossible groups die. */
export function canPrepareAtomicAgentAction(
  capability: string,
  args: Record<string, unknown>,
  groupCapabilities: readonly string[] = [],
): boolean {
  if (agentToolAtomicGroupMode(capability) === "always") return true;
  if (capability === "log_movement") {
    return groupCapabilities.includes("undo_agent_operation");
  }
  return capability === "record_person_payment" &&
    args.direction === "in" &&
    ["capital_return_unrecorded", "borrowed", "loan_repayment"].includes(
      String(args.inflowKind ?? ""),
    );
}

/** Resolve the small, versioned operation algebra accepted by migration 100.
 * This is deliberately not a generic "call a tool from JSON" bridge. Only
 * economically complete payloads with existing domain writers are emitted;
 * every other grouped action is refused before the database transaction. */
export async function prepareAtomicAgentAction(input: {
  action: {
    id: string;
    capability: string;
    arguments: Record<string, unknown>;
  };
  ctx: AgentContext;
}): Promise<PreparedAtomicAgentAction> {
  const { action, ctx } = input;
  const args = action.arguments;
  const amount = Number(args.amount);
  const resolveNamed = <T extends { id: string; name: string }>(
    rows: T[],
    ref: unknown,
  ): T | null => {
    const text = typeof ref === "string" ? ref.trim() : "";
    if (!text) return null;
    const exact = rows.find((row) => row.id === text);
    if (exact) return exact;
    const target = normName(text);
    const matches = rows.filter((row) => {
      const name = normName(row.name);
      return name.includes(target) || target.includes(name);
    });
    return matches.length === 1 ? matches[0] : null;
  };
  const operationId = ctx.durableOperationId;
  if (!operationId) {
    return { ok: false, summary: "La operación agrupada no tiene identidad durable." };
  }
  const dedupe = `agent-operation:${operationId}:${action.id}`;
  if (action.capability === "undo_agent_operation") {
    const target =
      typeof args.targetOperationId === "string"
        ? args.targetOperationId.trim()
        : "";
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        target,
      ) ||
      target === operationId
    ) {
      return {
        ok: false,
        summary: "Falta identificar una operación completada distinta para deshacer.",
      };
    }
    return {
      ok: true,
      resolvedType: "operation_reversal",
      payload: {
        user_id: ctx.userId,
        target_operation_id: target,
        raw_input: ctx.rawMessage,
        input_channel: ctx.channel === "web" ? "web" : "chat",
        occurred_at: new Date().toISOString(),
      },
      summary: `deshacer la operación durable ${target}`,
    };
  }
  if (action.capability === "log_movement") {
    if (!ctx.atomicCorrectionTargetOperationId) {
      return {
        ok: false,
        summary:
          "log_movement sólo puede agruparse como reemplazo de una operación durable que se revierte en el mismo grupo.",
      };
    }
    const calendarGuard = guardUnavailableCalendarReplyWrite(ctx, {
      confirmedUnrelated: args.confirmedNew === true,
    });
    if (calendarGuard) {
      return { ok: false, summary: calendarGuard.summary };
    }
    let resolvedArgs = args;
    if (String(args.type ?? "") === "income" && !args.destinationAccountId) {
      const destination = await defaultIncomeDestinationId(
        ctx,
        `${String(args.description ?? "")} ${ctx.rawMessage}`,
      );
      if (!destination.ok) {
        return {
          ok: false,
          summary:
            "No pude leer completas las fuentes de ingreso; no preparé el reemplazo.",
        };
      }
      if (destination.destinationId) {
        resolvedArgs = {
          ...args,
          destinationAccountId: destination.destinationId,
        };
      }
    }
    const fixedLink = validateFixedExpenseMovementLink(
      resolvedArgs,
      ctx,
      ctx.rawMessage,
      false,
    );
    if (!fixedLink.ok) return { ok: false, summary: fixedLink.reason };
    const built = buildMovementEntry(resolvedArgs, ctx);
    if (!built.ok) return { ok: false, summary: built.reason };
    // The group already contains the append-only reversal of the operation the
    // user is correcting. The ordinary J-2 corrective guard would redirect
    // this exact replacement back to correct_movement and create a lock-out.
    // Duplicate protection is instead the operation+step dedupe below, and the
    // SQL preflight proves the reversal is an earlier member of this group.
    built.entry.dedupeKey = dedupe;
    const card =
      built.entry.effectType === "debt_payment" && built.entry.debtAccountId
        ? ctx.debtAccounts.find(
            (debt) => debt.id === built.entry.debtAccountId,
          ) ?? null
        : null;
    const statement = card
      ? planCardPaymentStatement({
          originalAmount: built.entry.originalAmount,
          originalCurrency: built.entry.originalCurrency,
          sourceCurrency: built.entry.sourceAccountId
            ? ctx.accounts.find(
                (account) => account.id === built.entry.sourceAccountId,
              )?.currency ?? null
            : null,
          baseAmount:
            built.entry.baseAmount ??
            built.entry.originalAmount *
              (built.entry.exchangeRateToBase ?? 1),
          baseCurrency:
            built.entry.baseCurrency ?? built.entry.originalCurrency,
          cardType: card.type,
          cardCurrency: card.currency,
          fullPaymentDue: cardNativeStatementExpected(card, ctx.baseCurrency),
        })
      : ({ route: "plain" } as const);
    if (statement.route === "blocked_fx") {
      return {
        ok: false,
        summary:
          "El reemplazo de pago no es expresable en una moneda nativa común.",
      };
    }
    return {
      ok: true,
      resolvedType:
        statement.route === "atomic" ? "card_payment" : "ledger_entry",
      payload:
        statement.route === "atomic" && card
          ? {
              entry: buildLedgerEntryPayload(built.entry),
              statement: {
                debt_account_id: card.id,
                expected_due: statement.expectedDue,
                paid_in_card_currency: statement.paidInCardCurrency,
              },
            }
          : { entry: buildLedgerEntryPayload(built.entry) },
      summary: built.summary,
    };
  }
  const occurrenceValue =
    action.capability === "record_person_payment"
      ? args.occurredAtISO
      : args.date;
  const provedOccurredAt = validOccurredAtISO(occurrenceValue, todayISO(ctx));
  if (occurrenceValue != null && !provedOccurredAt) {
    return {
      ok: false,
      summary:
        action.capability === "record_person_payment"
          ? "La fecha del movimiento entre personas no es una fecha pasada o presente válida (YYYY-MM-DD)."
          : "La fecha del pago de tarjeta no es una fecha pasada o presente válida (YYYY-MM-DD).",
    };
  }
  const occurredAt =
    provedOccurredAt ?? `${todayISO(ctx)}T12:00:00.000Z`;

  if (action.capability === "record_person_payment") {
    // A person-to-person inflow is always user-stated and therefore needs an
    // explicit positive amount. Do not put this check above the capability
    // branches: register_card_payment with paidInFull=true deliberately omits
    // args.amount and derives the exact current statement from engine state.
    // The old shared guard made that canonical grouped payment impossible.
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        ok: false,
        summary: "Falta un monto positivo y exacto para uno de los pasos.",
      };
    }
    if (args.direction !== "in") {
      return {
        ok: false,
        summary:
          "Ese movimiento entre personas todavía no tiene una forma atómica agrupada segura.",
      };
    }
    // Grouped money steps cross a second trust boundary in PostgreSQL. Require
    // the exact context id here (the schema already asks for an id) so the DB
    // can compare persisted arguments to the resolved payload without trying
    // to reproduce fuzzy name matching or trusting the adapter's choice.
    const account = ctx.accounts.find((row) => row.id === args.accountId) ?? null;
    if (!account) {
      return { ok: false, summary: "Falta identificar la cuenta exacta que recibió el dinero." };
    }
    const currencyPlan = resolveAgentMovementCurrency(ctx, {
      instruments: [account.currency],
    });
    if (!currencyPlan.ok) {
      return {
        ok: false,
        summary: ctx.fxRatesReadOk === false
          ? "No pude leer las tasas vigentes; no agrupé ni moví la entrada de dinero. Reintenta la lectura."
          : "Falta una tasa vigente para valorar la entrada de dinero.",
      };
    }
    const currency = currencyPlan.resolution.original;
    const person = typeof args.person === "string" ? args.person.trim() : "";
    if (args.inflowKind === "capital_return_unrecorded") {
      const entry: LedgerEntryInput = {
        userId: ctx.userId,
        type: "adjustment",
        effectType: "adjustment",
        description: `Capital devuelto${person ? ` de ${person}` : ""} (préstamo original no registrado)`,
        category: "other",
        originalAmount: amount,
        originalCurrency: currency,
        exchangeRateToBase: currencyPlan.resolution.exchangeRateToBase,
        baseAmount: amount * currencyPlan.resolution.exchangeRateToBase,
        baseCurrency: currencyPlan.resolution.base,
        destinationAccountId: account.id,
        confidenceScore: 0.95,
        rawInput: ctx.rawMessage,
        inputChannel: ctx.channel === "web" ? "web" : "chat",
        occurredAtISO: occurredAt,
        externalRef: `capital_return_unrecorded:${operationId}:${action.id}`,
        dedupeKey: dedupe,
      };
      return {
        ok: true,
        resolvedType: "ledger_entry",
        payload: { entry: buildLedgerEntryPayload(entry) },
        summary: `${amount} ${currency} de capital devuelto a ${account.name}`,
      };
    }
    if (args.inflowKind === "borrowed") {
      if (!isConcreteLenderName(person)) {
        return { ok: false, summary: "Falta el prestamista concreto de los fondos recibidos." };
      }
      const debt =
        ctx.debtAccounts.find((row) => row.id === args.debtAccountId) ?? null;
      if (!debt || debt.type === "credit_card") {
        return {
          ok: false,
          summary: "Falta identificar una deuda no-tarjeta existente para esos fondos.",
        };
      }
      if (String(debt.currency).toUpperCase() !== currency) {
        return {
          ok: false,
          summary: "La cuenta y la deuda de los fondos prestados no comparten moneda nativa.",
        };
      }
      return {
        ok: true,
        resolvedType: "debt_proceeds",
        payload: {
          user_id: ctx.userId,
          account_id: account.id,
          debt_account_id: debt.id,
          amount,
          original_currency: currency,
          base_currency: currencyPlan.resolution.base,
          exchange_rate_to_base: currencyPlan.resolution.exchangeRateToBase,
          dedupe_key: dedupe,
          description: `Fondos prestados de ${person}`,
          raw_input: ctx.rawMessage,
          input_channel: ctx.channel === "web" ? "web" : "chat",
          occurred_at: occurredAt,
        },
        summary: `${amount} ${currency} recibidos de ${person} con su deuda correspondiente`,
      };
    }
    if (args.inflowKind === "loan_repayment") {
      const receivablesRead = await readOpenReceivables(ctx.userId);
      if (!moneyReadPublishable(receivablesRead)) {
        return {
          ok: false,
          summary:
            "No pude leer completos los préstamos por cobrar; no agrupé la devolución ni moví dinero.",
        };
      }
      const registration = repaymentRegistrationDecision({
        receivables: receivablesRead.receivables,
        counterparty: person || null,
        amount,
        currency,
      });
      if (registration.outcome === "ambiguous") {
        return {
          ok: false,
          summary:
            `Hay ${registration.candidates} préstamos por cobrar compatibles. Falta identificar quién devolvió el dinero; no agrupé ninguna pata.`,
        };
      }
      if (registration.outcome === "no_match") {
        return {
          ok: false,
          summary:
            "No encontré un préstamo abierto compatible en esa moneda. No degradé la devolución a ingreso ni moví el grupo.",
        };
      }
      if (registration.outcome === "unmatched_amount") {
        return {
          ok: false,
          summary:
            `La devolución supera en ${registration.remainder.toFixed(2)} lo que Kipu puede descontar con certeza. No la degradé a ingreso ni moví el grupo.`,
        };
      }
      const plannedReceivableIds = Array.isArray(args.receivableIds)
        ? [...new Set(args.receivableIds.filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0,
          ))].sort()
        : [];
      const resolvedReceivableIds = [...new Set(
        registration.allocations.map((row) => row.receivableId),
      )].sort();
      if (
        plannedReceivableIds.length !== resolvedReceivableIds.length ||
        plannedReceivableIds.some(
          (id, index) => id !== resolvedReceivableIds[index],
        )
      ) {
        return {
          ok: false,
          summary:
            "Los préstamos que el plan identificó ya no coinciden con la devolución resuelta. Relee los receivables y vuelve a planificar; no moví dinero.",
        };
      }
      const entry: LedgerEntryInput = {
        userId: ctx.userId,
        type: "income",
        effectType: "income",
        description: `Devolución de préstamo${person ? ` de ${person}` : ""}`,
        category: "income",
        originalAmount: amount,
        originalCurrency: currency,
        exchangeRateToBase: currencyPlan.resolution.exchangeRateToBase,
        baseAmount: amount * currencyPlan.resolution.exchangeRateToBase,
        baseCurrency: currencyPlan.resolution.base,
        destinationAccountId: account.id,
        confidenceScore: 0.95,
        rawInput: ctx.rawMessage,
        inputChannel: ctx.channel === "web" ? "web" : "chat",
        occurredAtISO: occurredAt,
        externalRef: `receivable_repayment:${operationId}:${action.id}`,
        dedupeKey: dedupe,
      };
      return {
        ok: true,
        resolvedType: "repayment",
        payload: {
          entry: buildLedgerEntryPayload(entry),
          allocations: registration.allocations.map((row) => ({
            receivable_id: row.receivableId,
            amount: row.amount,
            expected_outstanding: row.expectedOutstanding,
          })),
        },
        summary: `${amount} ${currency} devueltos por ${person || "la contraparte"}, acreditados y descontados del receivable juntos`,
      };
    }
    return {
      ok: false,
      summary:
        "La entrada entre personas necesita su writer de reembolso o receivable antes de agruparse; no la degradé a ingreso.",
    };
  }

  if (action.capability === "register_card_payment") {
    const card = resolveNamed(
      ctx.debtAccounts.filter((debt) => debt.type === "credit_card"),
      args.cardName,
    );
    const account = resolveNamed(ctx.accounts, args.fromAccount);
    if (!card || !account) {
      return {
        ok: false,
        summary: !card
          ? "Falta identificar la tarjeta exacta de uno de los pagos."
          : `Falta identificar desde qué cuenta se pagó ${card.name}.`,
      };
    }
    const resolvedAmount = resolvedCardPaymentAmount({
      paidInFull: args.paidInFull === true,
      proposedAmount: args.amount,
      statementExpected: cardNativeStatementExpected(card, ctx.baseCurrency),
    });
    if (!(resolvedAmount != null && resolvedAmount > 0)) {
      return {
        ok: false,
        summary: `Falta un monto probado para el pago de ${card.name}.`,
      };
    }
    if (String(card.currency).toUpperCase() !== String(account.currency).toUpperCase()) {
      return {
        ok: false,
        summary: `La tarjeta ${card.name} y la cuenta ${account.name} no comparten moneda nativa.`,
      };
    }
    const currencyPlan = resolveAgentMovementCurrency(ctx, {
      instruments: [account.currency],
    });
    if (!currencyPlan.ok) {
      return {
        ok: false,
        summary: ctx.fxRatesReadOk === false
          ? `No pude leer las tasas vigentes para el pago de ${card.name}; no agrupé ni moví ninguna pata.`
          : `Falta una tasa vigente para el pago de ${card.name}.`,
      };
    }
    const entry: LedgerEntryInput = {
      userId: ctx.userId,
      type: "debt_payment",
      effectType: "debt_payment",
      description: `Pago ${card.name}`,
      category: "debt",
      originalAmount: resolvedAmount,
      originalCurrency: currencyPlan.resolution.original,
      exchangeRateToBase: currencyPlan.resolution.exchangeRateToBase,
      baseAmount: resolvedAmount * currencyPlan.resolution.exchangeRateToBase,
      baseCurrency: currencyPlan.resolution.base,
      sourceAccountId: account.id,
      debtAccountId: card.id,
      confidenceScore: 0.95,
      rawInput: ctx.rawMessage,
      inputChannel: ctx.channel === "web" ? "web" : "chat",
      occurredAtISO: occurredAt,
      dedupeKey: dedupe,
    };
    const statement = planCardPaymentStatement({
      originalAmount: resolvedAmount,
      originalCurrency: entry.originalCurrency,
      sourceCurrency: account.currency,
      baseAmount: entry.baseAmount ?? 0,
      baseCurrency: entry.baseCurrency ?? entry.originalCurrency,
      cardType: card.type,
      cardCurrency: card.currency,
      fullPaymentDue: cardNativeStatementExpected(card, ctx.baseCurrency),
    });
    if (statement.route === "blocked_fx") {
      return { ok: false, summary: `El pago de ${card.name} no es expresable en una moneda nativa común.` };
    }
    return {
      ok: true,
      resolvedType: statement.route === "atomic" ? "card_payment" : "ledger_entry",
      payload:
        statement.route === "atomic"
          ? {
              entry: buildLedgerEntryPayload(entry),
              statement: {
                debt_account_id: card.id,
                expected_due: statement.expectedDue,
                paid_in_card_currency: statement.paidInCardCurrency,
              },
            }
          : { entry: buildLedgerEntryPayload(entry) },
      summary: `${resolvedAmount} ${entry.originalCurrency} a ${card.name} desde ${account.name}`,
    };
  }

  return {
    ok: false,
    summary: `La capacidad ${action.capability} no tiene un paso atómico versionado.`,
  };
}

export type CardPaymentCapturePlan =
  | { route: "ask_amount"; reason: string; requiresMultiSource: boolean }
  | { route: "ask_sources"; reason: string; requiresMultiSource: true }
  | {
      route: "ready";
      expected: number | null;
      requiresMultiSource: boolean;
      sources: CardPaymentSourcesPlan;
    };

/** One ordered preflight for the two guards that failed in the founder turn.
 * Amount truth is evaluated first: asking for a split that adds up to an
 * already-contradicted total just makes the invented figure more durable. */
export function planCardPaymentCapture(input: {
  rawMessage: string;
  amount: number;
  card: {
    name: string;
    currency: string;
    statementCovered?: boolean | null;
    fullPaymentDueOriginal?: number | null;
    fullPaymentDue?: number | null;
    statementTotalDue?: number | null;
  };
  baseCurrency: string;
  accounts: { id: string; name: string; currency: string }[];
  debtAccounts: { id: string; name: string; currency: string; type: string }[];
}): CardPaymentCapturePlan {
  const expected = cardNativeStatementExpected(input.card, input.baseCurrency);
  // Detect the second-source FACT independently of the proposed amount. In the
  // founder turn that amount was precisely the wrong value (552.77), so using it
  // to infer allocations before asking about 743.93 would manufacture a split.
  const multiSourceEvidence = planMultiSourcePayment({
    rawMessage: input.rawMessage,
    instrumentNames: [
      ...input.accounts.map((account) => account.name),
      ...input.debtAccounts
        .filter((debt) => debt.type !== "credit_card")
        .map((debt) => debt.name),
    ],
    totalAmount: null,
  });
  const requiresMultiSource = !multiSourceEvidence.ok;
  const amountPlan = planStatedAmount({
    statedAmount: input.amount,
    engineExpected: expected,
    rawMessage: input.rawMessage,
    subject: `la ${input.card.name}`,
    expectedLabel: "el pago del mes",
  });
  if (!amountPlan.ok) {
    return {
      route: "ask_amount",
      reason:
        amountPlan.reason +
        (requiresMultiSource
          ? " Además, ya quedó probado que salió de más de una fuente: después de confirmar el total voy a necesitar el reparto; no voy a cargarlo entero a una sola cuenta."
          : ""),
      requiresMultiSource,
    };
  }
  const sources = planCardPaymentSources({
    rawMessage: input.rawMessage,
    totalAmount: input.amount,
    accounts: input.accounts,
    debtAccounts: input.debtAccounts,
  });
  if (sources.route === "ask") {
    return { route: "ask_sources", reason: sources.reason, requiresMultiSource: true };
  }
  return { route: "ready", expected, requiresMultiSource, sources };
}

// Register a credit-card PAYMENT. This is a TRANSFER (account down + debt down),
// NEVER a new expense — the purchases were already the spend. Reuses the safe
// ledger writer via a debt_payment intent. La RPC estampa fecha + cobertura en la
// MISMA transacción; un parcial deja statement_covered=false. Sin escritor de dos
// deltas nativos, cuenta y tarjeta deben compartir moneda.
async function executeRegisterCardPayment(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const calendarGuard = guardUnavailableCalendarReplyWrite(ctx);
  if (calendarGuard) return calendarGuard;
  const cardRef = typeof args.cardName === "string" ? args.cardName.trim() : "";
  if (!cardRef) return { status: "needs_info", summary: "¿Cuál tarjeta pagaste?" };
  const target = normName(cardRef);
  const creditCards = ctx.debtAccounts.filter((d) => d.type === "credit_card");
  const card = creditCards.find((d) => d.id === cardRef) ?? (() => {
    const matches = creditCards.filter((d) => { const n = normName(d.name); return n.includes(target) || target.includes(n); });
    return matches.length === 1 ? matches[0] : null;
  })();
  if (!card) {
    const list = creditCards.map((d) => `"${d.name}"`).join(", ");
    return { status: "needs_info", summary: list ? `¿Cuál tarjeta pagaste? Tiene: ${list}. Pregúntale cuál.` : "No tiene tarjetas de crédito registradas para pagar." };
  }
  const paidInFull = args.paidInFull === true;
  const expectedFull = cardNativeStatementExpected(card, ctx.baseCurrency);
  const amount = resolvedCardPaymentAmount({
    paidInFull,
    proposedAmount: args.amount,
    statementExpected: expectedFull,
  });
  if (paidInFull && amount === 0) {
    return {
      status: "done",
      effect: "noop",
      summary: `El estado vigente de ${card.name} ya figura cubierto. No registré otro pago ni volví a mover dinero.`,
      data: { noop: true, statementAlreadyCovered: true },
    };
  }
  if (amount == null) {
    return {
      status: "needs_info",
      summary: paidInFull
        ? `Dijo que pagó completa la ${card.name}, pero no tengo un remanente de estado positivo y confirmado del que derivar el monto. Pregunta cuánto pagó exactamente; no registré nada.`
        : `¿De cuánto fue el pago a la ${card.name}? No registré nada todavía.`,
    };
  }

  const captureChannel: ChatChannel = ctx.channel === "telegram" ? "telegram" : "web";
  const draftRead = await readOpenCardPaymentCaptureDraft({
    userId: ctx.userId,
    channel: captureChannel,
    chatId: ctx.chatId,
    debtAccountId: card.id,
  });
  if (!draftRead.ok) {
    return {
      status: "error",
      summary:
        "No pude comprobar si este pago tenía una aclaración de fuentes pendiente. No registré nada: reinténtalo para que no cargue todo a una sola cuenta por error.",
    };
  }
  const captureDraft: CardPaymentCaptureDraft | null = draftRead.draft;
  const rawTurn = ctx.rawMessage ?? "";
  // A challenge such as “pero el pago fue 743.93” can mean two different
  // things. With an OPEN capture draft, it is answering a question before any
  // ledger write and must continue that draft. Without one, it is a correction
  // of an already-written payment and must go through J-2's redirect barrier.
  if (
    ctx.operationManifestAuthorized !== true &&
    !captureDraft &&
    correctivePhrasing(rawTurn)
  ) {
    const corrective = await guardCorrectiveToolCall(
      "register_card_payment",
      args,
      ctx,
    );
    if (corrective) return corrective;
  }
  const retractingCaptureDraft =
    captureDraft?.multiSourceRequired === true && retractsMultiSource(rawTurn);
  const captureEvidence =
    captureDraft?.multiSourceRequired === true && !retractingCaptureDraft
      ? `${captureDraft.initialRawMessage}\nACLARACIÓN ACTUAL: ${rawTurn}`
      : rawTurn;
  const capturePlan: CardPaymentCapturePlan =
    ctx.operationManifestAuthorized === true && !captureDraft
      ? {
          route: "ready",
          expected: expectedFull,
          requiresMultiSource: false,
          sources: { route: "single" },
        }
      : planCardPaymentCapture({
          rawMessage: captureEvidence,
          amount,
          card,
          baseCurrency: ctx.baseCurrency,
          accounts: ctx.accounts,
          debtAccounts: ctx.debtAccounts,
        });
  if (capturePlan.route !== "ready") {
    if (retractingCaptureDraft) {
      return {
        status: "needs_info",
        summary:
          `${capturePlan.reason} Como estás reemplazando el reparto anterior por UNA sola fuente, dime en la misma respuesta el total y la cuenta exacta; no cancelé la aclaración ni registré nada todavía.`,
      };
    }
    if (capturePlan.requiresMultiSource && !captureDraft) {
      const opened = await openCardPaymentCaptureDraft({
        userId: ctx.userId,
        channel: captureChannel,
        chatId: ctx.chatId,
        debtAccountId: card.id,
        originalCurrency: String(card.currency).toUpperCase(),
        expectedDue: cardNativeStatementExpected(card, ctx.baseCurrency),
        initialRawMessage: rawTurn,
        multiSourceRequired: true,
      });
      if (!opened.ok) {
        return {
          status: "error",
          summary:
            "Detecté que el pago salió de más de una fuente, pero no pude guardar esa aclaración de forma segura. No registré nada; vuelve a intentarlo con el total y el reparto.",
        };
      }
    }
    return { status: "needs_info", summary: capturePlan.reason };
  }
  const nativeExpected = capturePlan.expected;
  const sourcesPlan = capturePlan.sources;

  const paidDate = validOccurredAtISO(args.date, todayISO(ctx));

  if (sourcesPlan.route === "multi") {
    if (sourcesPlan.currency !== String(card.currency).toUpperCase()) {
      return {
        status: "needs_info",
        summary: `La ${card.name} está en ${card.currency}, pero los orígenes del reparto están en ${sourcesPlan.currency}. No registré nada: el pago debe expresarse en la moneda nativa de la tarjeta.`,
      };
    }
    if (!(nativeExpected != null && nativeExpected > 0)) {
      return {
        status: "needs_info",
        summary:
          card.statementCovered === true
            ? `El estado vigente de ${card.name} ya figura cubierto. No registré otro pago repartido; confirma si es un abono nuevo al saldo acumulado o si está corrigiendo el pago anterior.`
            : `No tengo un remanente de estado probado para ${card.name}; no registré el reparto porque no podría actualizar el ciclo de la tarjeta de forma atómica.`,
      };
    }
    if (amount > nativeExpected + 0.005) {
      return {
        status: "needs_info",
        summary:
          `El reparto suma ${money(amount, sourcesPlan.currency)}, pero el remanente probado del estado es ${money(nativeExpected, sourcesPlan.currency)}. ` +
          "No registré nada: el writer repartido no puede dejar saldo a favor sin volver el resultado dependiente del orden de las patas. Confirma si el total o el remanente cambió.",
      };
    }
    const cr = resolveAgentMovementCurrency(ctx, {
      instruments: sourcesPlan.legs.map(() => sourcesPlan.currency),
    });
    if (!cr.ok) {
      return {
        status: "needs_info",
        summary: ctx.fxRatesReadOk === false
          ? `No pude leer las tasas vigentes para valorar ${sourcesPlan.currency} en ${ctx.baseCurrency}. No registré el reparto; reintenta en un momento.`
          : `Necesito una tasa confiable ${sourcesPlan.currency}→${ctx.baseCurrency} antes de registrar este reparto; no escribí nada.`,
      };
    }
    // A redelivery without an explicit date must reuse both the dedupe and the
    // payload fingerprint. `new Date().toISOString()` in the RPC payload made
    // the same logical turn fail with KIPU_DEDUPE_MISMATCH a few milliseconds
    // later. Noon UTC is a stable representation of the user-day; the DB still
    // derives the financial payment_date in the user's timezone.
    const stableOccurredAt = paidDate ?? `${todayISO(ctx)}T12:00:00.000Z`;
    const identity = createHash("sha256")
      .update([
        ctx.userId,
        ctx.operationId ?? "",
        ctx.rawMessage.trim(),
        card.id,
        Math.round(amount * 100),
        sourcesPlan.legs.map((leg) => `${leg.kind}:${leg.instrumentId}:${Math.round(leg.amount * 100)}`).join(","),
        stableOccurredAt.slice(0, 10),
      ].join("|"))
      .digest("hex")
      .slice(0, 40);
    const applied = await applyMultiSourceCardPayment({
      userId: ctx.userId,
      dedupeKey: `agent:cardpaymulti:${identity}`,
      debtAccountId: card.id,
      expectedDue: nativeExpected,
      totalAmount: amount,
      originalCurrency: sourcesPlan.currency,
      exchangeRateToBase: cr.resolution.exchangeRateToBase,
      baseCurrency: cr.resolution.base,
      occurredAtISO: stableOccurredAt,
      rawInput: ctx.rawMessage,
      inputChannel: ctx.channel === "web" ? "web" : "chat",
      captureDraftId: captureDraft?.id ?? null,
      sources: sourcesPlan.legs,
    });
    if (!applied.ok) {
      return {
        status: applied.reason === "unsafe" ? "needs_info" : "error",
        summary:
          applied.reason === "conflict"
            ? "El estado o uno de los orígenes cambió mientras registraba; no quedó nada a medias. Relee y reintenta."
            : applied.reason === "unsafe"
              ? "El reparto no pasó las validaciones de moneda/propiedad/deuda; no registré nada. Revisa las fuentes y sus montos."
              : "No pude probar que el pago repartido aterrizó completo; la operación se revirtió y no quedó a medias.",
      };
    }
    ctx.dirty = true;
    const refreshed = await refreshAgentContextIfDirty(ctx);
    return {
      status: "done",
      effect: applied.replayed ? "noop" : "wrote",
      data: {
        groupId: applied.groupId,
        transactionIds: applied.transactionIds,
        replayed: applied.replayed,
      },
      summary: withRefreshCaveat(
        refreshed,
        `${applied.replayed ? "Ese pago repartido ya estaba registrado; no lo dupliqué" : `Registré el pago de ${money(amount, sourcesPlan.currency)} a "${card.name}" en una sola operación (${sourcesPlan.labels.join(" · ")})`}. Las cuentas, el préstamo, la tarjeta y el remanente del estado quedaron consistentes juntos.`,
      ),
    };
  }

  // Which account it came from. We never GUESS the source of a money movement,
  // but S31 (item 1.6): when the card has a saved "Pagas desde" account
  // (default_payment_account_id, captured at onboarding), we CONFIRM that one
  // ("¿Desde Pichincha, como siempre?") instead of asking an open question.
  const fromRef = typeof args.fromAccount === "string" ? args.fromAccount.trim() : "";
  let source: Account | null = null;
  if (fromRef) {
    const fromTarget = normName(fromRef);
    source = ctx.accounts.find((a) => a.id === fromRef) ?? (() => {
      const matches = ctx.accounts.filter((a) => { const n = normName(a.name); return n.includes(fromTarget) || fromTarget.includes(n); });
      return matches.length === 1 ? matches[0] : null;
    })();
    if (!source) {
      const list = ctx.accounts.map((a) => `"${a.name}"`).join(", ");
      return { status: "needs_info", summary: list ? `¿Desde cuál cuenta? Tiene: ${list}. Pregúntale cuál.` : "No tiene cuentas registradas como origen del pago." };
    }
  } else {
    const saved = card.defaultPaymentAccountId
      ? ctx.accounts.find((a) => a.id === card.defaultPaymentAccountId) ?? null
      : null;
    if (saved && args.confirmDefaultSource === true) {
      source = saved;
    } else if (saved) {
      const proposedArgs = {
        ...args,
        fromAccount: saved.id,
        confirmDefaultSource: true,
      };
      const guarded = await guardServerConfirmedActionWith(
        "register_card_payment",
        proposedArgs,
        ctx,
        {
          proposalSummary: actionProposalSummary(
            "register_card_payment",
            proposedArgs,
            ctx,
          ),
        },
      );
      return (
        guarded.result ?? {
          status: "error",
          summary: `No pude guardar la confirmación de que el pago salió de "${saved.name}", así que no registré nada.`,
        }
      );
    } else {
      const list = ctx.accounts.map((a) => `"${a.name}"`).join(", ");
      return { status: "needs_info", summary: `¿Desde qué cuenta pagaste la ${card.name}?${list ? ` Tiene: ${list}.` : ""} Pregúntale (no registro el pago sin saber de dónde salió).` };
    }
  }

  // FX safety: el writer de debt_payment resta el monto NATIVO tanto de la cuenta
  // como de la deuda. Hasta tener un escritor multimoneda con ambos deltas nativos,
  // solo es seguro pagar desde una cuenta en la misma moneda de la tarjeta.
  // J-8 (D1) — el MOTOR manda sobre el monto. En la beta del 21/07 el usuario dijo
  // «pagué el total» de una tarjeta con corte 743.93 y se escribió 552.77: el saldo
  // de la cuenta que había nombrado en la misma frase. El prompt YA prohibía inventar
  // montos; pasó igual. Por eso el contraste es determinista y vive acá.
  const cr = resolveAgentMovementCurrency(ctx, {
    instruments: [source.currency],
  });
  if (!cr.ok) {
    return { status: "needs_info", summary: cr.reason === "fx_unavailable" ? `El pago sale de "${source.name}" en ${source.currency}, distinta a tu moneda base ${ctx.baseCurrency}; necesito un tipo de cambio confiable para reflejarlo. Dímelo o lo vemos aparte.` : "¿En qué moneda pagaste?" };
  }
  if ((card.currency as string) !== source.currency) {
    return { status: "needs_info", summary: `La ${card.name} está en ${card.currency} y la cuenta "${source.name}" en ${source.currency}. Por ahora registra este pago desde una cuenta en ${card.currency}; no escribí nada porque el ledger todavía no puede aplicar con seguridad dos montos nativos distintos.` };
  }

  let appliedChatPayment: Awaited<
    ReturnType<typeof applyAgentChatTransactionIntent>
  >;
  try {
    const intent: DebtPaymentIntent = {
      type: "debt_payment",
      description: `Pago ${card.name}`,
      category: "debt",
      originalAmount: amount,
      originalCurrency: cr.resolution.original,
      baseCurrency: cr.resolution.base,
      exchangeRateToBase: cr.resolution.exchangeRateToBase,
      confidenceScore: 0.9,
      status: "ready",
      sourceAccountId: source.id,
      debtAccountId: card.id,
    };
    appliedChatPayment = await applyAgentChatTransactionIntent({
      userId: ctx.userId,
      message: ctx.rawMessage,
      intent,
      accounts: ctx.accounts,
      debtAccounts: ctx.debtAccounts,
      goals: ctx.goals,
      parserSource: "ai",
      parserConfidenceScore: 0.9,
      channel: ctx.channel,
      chatId: ctx.chatId,
      occurredAtISO: paidDate ?? null,
      dedupeKey: dedupeKeyFor(ctx, {
        type: "debt_payment",
        amount,
        currency: cr.resolution.original,
        sourceAccountId: source.id,
        debtAccountId: card.id,
      }),
      cardPaymentCaptureDraftId: retractingCaptureDraft ? captureDraft?.id ?? null : null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "card payment failed";
    // Pasada 5 (punto 3): la barrera del applier rehúsa un pago NO expresable en la
    // moneda de la tarjeta con statement vigente — eso es una pregunta, no un error.
    if (/KIPU_NEEDS_INFO/.test(msg)) {
      return { status: "needs_info", summary: msg.replace(/^KIPU_NEEDS_INFO:\s*/, "") };
    }
    return { status: "error", summary: msg };
  }

  ctx.dirty = true;
  const refreshed = await refreshAgentContextIfDirty(ctx);
  return {
    status: "done",
    data: {
      transactionIds:
        appliedChatPayment.financialWriteReceipt?.transactionIds ?? [],
    },
    summary: withRefreshCaveat(refreshed, `Registré el pago de ${money(amount, source.currency)} a "${card.name}" desde "${source.name}": bajó tu cuenta, bajó la deuda y el pago pendiente del estado se actualizó en la misma operación. NO es un gasto nuevo (las compras ya se contaron). Confírmalo simple; no afirmes que quedó totalmente pagada salvo que el remanente sea cero.`),
  };
}

// READ-ONLY card billing-cycle explainer. Reuses the pure card-cycle module so
// the phrasing matches the engine exactly. Only credit_card debts have a cycle.
async function executeCardStatus(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  // Same-turn freshness: a cuotas purchase or payment written earlier this turn
  // must be visible here, or chat quotes a pre-write statement.
  // Bloque I — antes refrescaba a mano: sin `ctx.refresh` no marcaba nada (seguía
  // `dirty` y citaba el resumen pre-escritura) y si el refresh lanzaba, la excepción
  // se escapaba. El helper cubre ambos y deja el veredicto tipado en saldoAvailable.
  await refreshAgentContextIfDirty(ctx);
  const cards = ctx.debtAccounts.filter((d) => d.type === "credit_card");
  if (cards.length === 0) {
    return { status: "done", summary: "No tiene tarjetas de crédito registradas (solo las tarjetas tienen ciclo de corte/pago). Si tiene préstamos, esos son cuota fija mensual. No inventes una tarjeta." };
  }
  const cardRef = typeof args.cardName === "string" ? args.cardName.trim() : "";
  let selected = cards;
  if (cardRef) {
    const target = normName(cardRef);
    const matches = cards.filter((d) => { const n = normName(d.name); return n.includes(target) || target.includes(n); });
    if (matches.length === 0) {
      return { status: "needs_info", summary: `No reconozco esa tarjeta. Tiene: ${cards.map((d) => `"${d.name}"`).join(", ")}. Pregúntale cuál.` };
    }
    selected = matches;
  }
  const today = new Date();
  // Bloque I — el estimado del resumen es `corriente − diferido`, y el diferido sale de
  // los planes de cuotas del briefing. Cuando el briefing es el placeholder neutro (o
  // quedó viejo tras un refresh fallido) esa lista llega VACÍA, y `?? []` la volvía
  // indistinguible de "no tiene cuotas": el diferido cae a 0 y el estimado vuelve
  // callado al comportamiento pre-Bloque-G, contando en el resumen de este mes cuotas
  // que se facturan en ciclos futuros. Lo que se pierde es el MONTO, no el ciclo: las
  // fechas salen de debtAccounts, así que se siguen dando.
  const cyclesReliable = ctx.saldoAvailable !== false;
  const describe = (phase: CardCyclePhase, name: string, currency: string): string => {
    const amt = money(phase.reserveAmount, currency);
    if (phase.status === "paid") return `"${name}": sin nada pendiente ahora (el último resumen ya está cubierto).`;
    if (phase.status === "accumulating") return phase.dueDateISO ? `"${name}": el resumen actual aún acumula; no hay pago pendiente hasta el próximo corte.` : `"${name}": sin días de corte/pago registrados, no puedo ubicar su ciclo — pídelos si quieres que lo calcule.`;
    if (phase.status === "confirm") return `"${name}": hay ~${amt} estimado a pagar el ${phase.dueDateISO}${phase.daysUntilDue != null ? ` (en ${phase.daysUntilDue}d)` : ""}, pero no lo tengo confirmado — conviene que el usuario confirme el monto real del resumen (es estimado).`;
    return `"${name}": ~${amt}${phase.estimated ? " (estimado)" : ""} a pagar el ${phase.dueDateISO}${phase.daysUntilDue != null ? ` (en ${phase.daysUntilDue}d)` : ""}.`;
  };
  // Stage G — the running-balance estimate must exclude installment money that
  // bills in FUTURE cycles, or chat would quote an inflated statement.
  const nextDueByCard = new Map<string, string | null>(cards.map((c) => [c.id, cardCyclePhaseFor(c, today).dueDateISO ?? null]));
  if (!cyclesReliable) {
    const dates = selected.map((c) => {
      const due = nextDueByCard.get(c.id);
      return due ? `"${c.name}": próximo pago el ${due}.` : `"${c.name}": sin días de corte/pago registrados.`;
    });
    return { status: "done", summary: `No pude reconstruir su estado con certeza ahora, así que NO tengo un estimado de resumen confiable: NO cites, estimes ni insinúes ningún monto a pagar (podría estar contando cuotas que se facturan más adelante). Las FECHAS sí son buenas, dáselas y nada más; dile en una frase que el monto se lo dices cuando lo reintente:\n${dates.join("\n")}` };
  }
  const deferredPerCard = deferredByCard(ctx.briefing.installmentPlans, today, nextDueByCard);
  const lines = selected.map((c) => describe(cardCyclePhaseFor(c, today, undefined, deferredPerCard.get(c.id)), c.name, c.currency as string));
  return { status: "done", summary: `Estado de tarjeta(s) — díselo simple y humano, sin tecnicismos; marca claro lo estimado y nunca afirmes un monto de resumen que no está confirmado:\n${lines.join("\n")}` };
}

// ── Stage G — Cuotas (LatAm installments). Option A, founder-locked: the FULL
// debt is born on the card today (one expense for the total, tagged
// external_ref 'installment:<plan_id>' so the Saldo tank NEVER drains it); the
// cost hits the RITMO instead — the monthly installment lowers the daily
// recharge while the plan runs. The tool computes recharge before → after so
// the agent can give the founder-approved aviso.
const dayClamped = (year: number, monthIndex: number, day: number): Date => {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(day, last));
};

// Next calendar occurrence of `day` STRICTLY AFTER `from` (days 29–31 clamp to
// each month's real last day — the engine-wide convention).
const nextDomAfter = (from: Date, day: number): Date => {
  const sameMonth = dayClamped(from.getFullYear(), from.getMonth(), day);
  if (sameMonth.getTime() > from.getTime()) return sameMonth;
  return dayClamped(from.getFullYear(), from.getMonth() + 1, day);
};

const planISO = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface InstallmentExecutorDeps {
  readPlans: typeof readActiveInstallmentPlans;
  applyPurchase: typeof applyInstallmentPlanPurchase;
  closePlan: typeof closeInstallmentPlanAtomically;
  now: () => Date;
}

const liveInstallmentExecutorDeps: InstallmentExecutorDeps = {
  readPlans: readActiveInstallmentPlans,
  applyPurchase: applyInstallmentPlanPurchase,
  closePlan: closeInstallmentPlanAtomically,
  now: () => new Date(),
};

async function executeCreateInstallmentPlan(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  return executeCreateInstallmentPlanWith(args, ctx, liveInstallmentExecutorDeps);
}

export async function executeCreateInstallmentPlanWith(
  args: Record<string, unknown>,
  ctx: AgentContext,
  deps: InstallmentExecutorDeps,
): Promise<ToolResult> {
  // The aviso (recarga antes → después) must read post-write state when earlier
  // tools already wrote this turn — never a stale start-of-turn briefing.
  await refreshAgentContextIfDirty(ctx);
  const description = String(args.description ?? "").trim();
  if (!description) return { status: "needs_info", summary: "¿Qué compró? Necesito una descripción corta." };
  const total = toCents(Number(args.totalAmount));
  if (!Number.isFinite(total) || total <= 0) return { status: "needs_info", summary: "¿Cuál es el TOTAL que va a terminar pagando (con interés incluido si lo hay)?" };
  const months = Number(args.months);
  if (!Number.isInteger(months) || months < 1 || months > 60) {
    return { status: "needs_info", summary: "¿En cuántas cuotas mensuales? (entre 1 y 60)." };
  }
  const surcharge = args.surcharge === undefined || args.surcharge === null ? 0 : toCents(Number(args.surcharge));
  if (!Number.isFinite(surcharge) || surcharge < 0 || surcharge >= total) {
    return { status: "needs_info", summary: "El interés del financiamiento no cuadra: debe ser 0 o menor que el total. ¿Cuánto es el recargo incluido en el total?" };
  }

  // The card. Cuotas are a credit-card thing — loans/family debts don't apply.
  const cards = ctx.debtAccounts.filter((d) => d.type === "credit_card");
  if (cards.length === 0) {
    return { status: "refused", summary: "No tiene tarjetas de crédito registradas y las cuotas van sobre una tarjeta. Ofrécele crearla primero (create_card) y luego registrar la compra en cuotas." };
  }
  const cardRef = typeof args.cardName === "string" ? args.cardName.trim() : "";
  const card = resolveExplicitOrSingle(cards, cardRef, (row) => row.name);
  if (!card) return { status: "needs_info", summary: `¿Con qué tarjeta compró? Tiene: ${cards.map((d) => `"${d.name}"`).join(", ")}.` };

  const existingPlansRead = await deps.readPlans(ctx.userId);
  if (!moneyReadPublishable(existingPlansRead)) {
    return {
      status: "needs_info",
      summary: "No pude leer todos tus planes de cuotas activos, así que no crearé otro a ciegas. Reinténtalo en un rato.",
    };
  }
  const samePlans = existingPlansRead.plans.filter(
    (p) =>
      p.debtAccountId === card.id &&
      Math.abs(p.totalOriginal - total) <= 0.005 &&
      normName(p.description) === normName(description),
  );
  if (samePlans.length > 0 && args.confirmedNew !== true) {
    return issueDuplicateConfirmation(
      "create_installment_plan",
      args,
      ctx,
      `Ya hay un plan activo de "${samePlans[0].description}" por ${money(total, card.currency)} en "${card.name}".`,
    );
  }

  // Currency: explicit > card. Cross-base needs a trusted rate (never invent 1:1).
  const explicitCurrency = typeof args.currency === "string" ? args.currency : null;
  const cr = resolveAgentMovementCurrency(ctx, {
    explicit: explicitCurrency,
    instruments: [card.currency],
  });
  if (!cr.ok) {
    return cr.reason === "fx_unavailable"
      ? { status: "needs_info", summary: `esa compra está en ${cr.original}, distinta a tu moneda base ${cr.base}; necesito un tipo de cambio confiable — dime el equivalente en ${cr.base} o configura el cambio primero` }
      : { status: "needs_info", summary: "no pude determinar la moneda; ¿en qué moneda fue la compra?" };
  }
  // The plan lives on the CARD: a total in another currency would corrupt the
  // card's native balance and make estimate−deferred cross FX bases. Ask for the
  // figure as it will appear on the statement instead of converting on a guess.
  if (cr.resolution.original !== String(card.currency).toUpperCase()) {
    return {
      status: "needs_info",
      summary: `la compra vino en ${cr.resolution.original} pero "${card.name}" está en ${card.currency} — pídele el TOTAL como va a salir en el resumen de la tarjeta (en ${card.currency}) y regístralo con ese monto.`,
    };
  }
  const rate = cr.resolution.exchangeRateToBase ?? 1;
  const totalBase = toCents(total * rate);
  const surchargeBase = toCents(surcharge * rate);

  // When does installment #1 get charged? User-stated date wins; else derive
  // from the card's cycle (purchase enters the statement closing at the NEXT
  // cutoff; that statement is due on the following due day). No cycle → ask.
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  let firstDue: string | null = null;
  let anniversaryDay: number | null = null;
  const todayISO = planISO(deps.now());
  if (typeof args.firstPaymentDate === "string" && args.firstPaymentDate) {
    if (!isoRe.test(args.firstPaymentDate) || !Number.isFinite(Date.parse(args.firstPaymentDate))) {
      return { status: "needs_info", summary: "La fecha de la primera cuota no es válida (usa AAAA-MM-DD)." };
    }
    if (args.firstPaymentDate < todayISO) {
      // A plan that already started can't book its FULL total as new debt today
      // (the billed cuotas ya salieron). Register only what's pending.
      return {
        status: "needs_info",
        summary: `esa primera cuota (${String(args.firstPaymentDate)}) ya pasó — el plan ya venía corriendo y no puedo cargar el total completo como deuda nueva de hoy. Pídele cuántas cuotas le FALTAN y el monto pendiente, y vuelve a llamar con months = las cuotas que faltan, totalAmount = lo pendiente y firstPaymentDate = la fecha de la PRÓXIMA cuota.`,
      };
    }
    firstDue = args.firstPaymentDate;
    anniversaryDay = card.dueDay ?? Number(args.firstPaymentDate.slice(8, 10));
  } else if (card.cutoffDay && card.dueDay) {
    const today = deps.now();
    const cutoff = nextDomAfter(today, card.cutoffDay);
    firstDue = planISO(nextDomAfter(cutoff, card.dueDay));
    anniversaryDay = card.dueDay;
  } else {
    return { status: "needs_info", summary: `No tengo el ciclo de "${card.name}" (día de corte y de pago), así que no sé cuándo cae la primera cuota. Pregúntale cuándo le cobran la primera cuota, o los días de corte/pago de la tarjeta.` };
  }

  // Plan + full card debt are one financial fact. The old two-step path inserted
  // the plan, attempted the ledger and compensated by cancelling on failure; a
  // lost response or failed compensation left an orphan plan or a duplicate.
  const prov = movementProvenance(args, ctx);
  const entry: LedgerEntryInput = {
    userId: ctx.userId,
    description,
    confidenceScore: prov.parserConfidenceScore,
    rawInput: ctx.rawMessage,
    inputChannel: channelToInputChannel(ctx.channel),
    evidenceId: prov.evidenceId,
    // The RPC owns the plan id and stamps installment:<id> atomically.
    externalRef: null,
    occurredAtISO: prov.occurredAtISO,
    type: "expense",
    effectType: "expense",
    category: category(args.category, "shopping"),
    originalAmount: total,
    originalCurrency: cr.resolution.original,
    baseCurrency: cr.resolution.base,
    exchangeRateToBase: cr.resolution.exchangeRateToBase,
    sourceAccountId: null,
    debtAccountId: card.id,
    recurringExpenseId: null,
  };
  attachDedupeKey(entry, ctx);
  const installmentDedupe =
    entry.dedupeKey ??
    `agent:installment:${createHash("sha256")
      .update([ctx.userId, ctx.rawMessage.trim(), card.id, Math.round(total * 100), months, firstDue].join("|"))
      .digest("hex")
      .slice(0, 32)}`;
  const atomic = await deps.applyPurchase({
    userId: ctx.userId,
    dedupeKey: installmentDedupe,
    plan: {
      debtAccountId: card.id,
      description,
      totalOriginal: total,
      originalCurrency: cr.resolution.original,
      totalBase,
      baseCurrency: cr.resolution.base,
      monthsTotal: months,
      firstStatementDue: firstDue,
      surchargeBase,
      anniversaryDay,
      category: category(args.category, "shopping"),
    },
    entry,
  });
  if (!atomic.ok) {
    return {
      status: atomic.reason === "unsafe" ? "needs_info" : "error",
      summary: atomic.reason === "unsafe"
        ? "El plan y la compra no pasaron juntos las validaciones de tarjeta, moneda o monto; no se guardó ninguna mitad."
        : "No pude probar que el plan y la compra aterrizaran juntos; la transacción se revirtió completa y es seguro reintentar.",
    };
  }
  ctx.dirty = true;
  const plan = {
    id: atomic.planId,
    installmentBase: toCents(totalBase / months),
  };

  const cur = cr.resolution.base;
  const costNote = surchargeBase > 0
    ? ` El financiamiento le cuesta ${money(surchargeBase, cur)} extra (eso es costo de deuda, dícelo claro y sin juicio).`
    : " Cuotas sin interés: no paga extra por financiar.";
  // The write itself is valid without a publishable Saldo. If the pre-write
  // refresh failed, keep the registration but omit EVERY recarga/Saldo number;
  // using the cached briefing here would describe the state before another
  // movement from this same turn.
  const sk = ctx.briefing?.margenKipu?.saldo;
  const mtf = ctx.briefing?.margenKipu?.capacity?.monthlyTrulyFree;
  if (
    ctx.saldoAvailable === false ||
    !sk ||
    !Number.isFinite(mtf)
  ) {
    return {
      status: "done",
      effect: atomic.replayed ? "noop" : "wrote",
      summary: installmentCreateDegradedSummary({
        description, totalBase, cur, months, installmentBase: plan.installmentBase,
        cardName: card.name, firstDue, costNote,
      }),
      data: {
        planId: plan.id,
        transactionId: atomic.transactionId,
        installmentBase: plan.installmentBase,
        months,
        firstDue,
        saldoAvailable: false,
      },
    };
  }

  // Founder-approved aviso: recharge before → after + total-vs-Saldo + cost.
  const fillBefore = sk.fillDaily;
  const fillAfter = Math.round(Math.max(0, (Math.max(0, mtf) - plan.installmentBase) / 30) * 100) / 100;
  const saldoNote = totalBase > sk.saldo
    ? ` OJO: el total (${money(totalBase, cur)}) es más grande que su Saldo actual (${money(sk.saldo, cur)}) — de un solo golpe habría cruzado capas; en cuotas se reparte en el ritmo.`
    : "";
  const rechargeLine = fillBefore <= 0.005
    ? `su recarga diaria ya estaba en 0 (mes sobre-comprometido), así que no baja más — pero el plan suma ${money(plan.installmentBase, cur)}/mes de presión al mes: dilo claro y sin juicio`
    : `su recarga diaria baja de ${money(fillBefore, cur)}/día a ${money(fillAfter, cur)}/día por ${months} meses — SIEMPRE dale ese antes → después`;
  return {
    status: "done",
    effect: atomic.replayed ? "noop" : "wrote",
    summary: atomic.replayed
      ? `Ese plan de cuotas y su compra ya estaban registrados; no dupliqué ni la deuda ni la recarga.`
      : `Plan de cuotas creado: "${description}" ${money(totalBase, cur)} en ${months} cuotas de ${money(plan.installmentBase, cur)}/mes con "${card.name}" (primera cuota ~${firstDue}). La deuda total ya está en la tarjeta y su Saldo Kipu NO baja hoy: ${rechargeLine}.${saldoNote}${costNote}`,
    data: {
      planId: plan.id,
      transactionId: atomic.transactionId,
      installmentBase: plan.installmentBase,
      months,
      firstDue,
      rechargeBefore: fillBefore,
      rechargeAfter: fillAfter,
    },
  };
}

async function executeCloseInstallmentPlan(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  return executeCloseInstallmentPlanWith(args, ctx, liveInstallmentExecutorDeps);
}

export async function executeCloseInstallmentPlanWith(
  args: Record<string, unknown>,
  ctx: AgentContext,
  deps: InstallmentExecutorDeps,
): Promise<ToolResult> {
  await refreshAgentContextIfDirty(ctx);
  const mode = args.mode === "paid_off" || args.mode === "cancelled" ? args.mode : null;
  if (!mode) return { status: "needs_info", summary: "¿La liquidó pagando lo que faltaba (paid_off) o devolvió/anuló la compra (cancelled)?" };
  const plansRead = await deps.readPlans(ctx.userId);
  // "No pude leer sus planes" NO es "no tiene planes" — y una lista TOPADA o sin
  // valuar tampoco lo es (re-auditoría 2, punto 9): matchear/negar el plan a cerrar
  // sobre media lista elige o niega con cara de hecho. Publicable o nada.
  if (!moneyReadPublishable(plansRead)) {
    return { status: "needs_info", summary: "Ahora mismo no pude leer sus planes de cuotas, así que no puedo cerrar ninguno con certeza. NO afirmes que no tiene planes; dile que lo reintente en un rato." };
  }
  const plans = plansRead.plans;
  if (plans.length === 0) return { status: "done", summary: "No tiene planes de cuotas activos. No inventes uno." };
  const ref = normName(String(args.planName ?? ""));
  const matches = ref ? plans.filter((p) => { const n = normName(p.description); return n.includes(ref) || ref.includes(n); }) : plans;
  if (matches.length === 0) {
    return { status: "needs_info", summary: `No encuentro ese plan. Activos: ${plans.map((p) => `"${p.description}" (${p.monthsTotal} cuotas)`).join(", ")}. Pregúntale cuál.` };
  }
  if (matches.length > 1) {
    return { status: "needs_info", summary: `Varios planes coinciden: ${matches.map((p) => `"${p.description}"`).join(", ")}. Pregúntale cuál.` };
  }
  const plan = matches[0];
  const pr = installmentProgress(plan, deps.now());
  const closed = await deps.closePlan({
    userId: ctx.userId,
    planId: plan.id,
    mode,
    message: ctx.rawMessage,
    channel: ctx.channel,
    occurredAtISO: movementProvenance(args, ctx).occurredAtISO,
  });
  if (!closed.ok) {
    if (closed.reason === "needs_review") {
      return {
        status: "needs_info",
        summary: "Ese plan no tiene una compra enlazada de forma segura o figura ya liquidado. No cerré el plan ni moví la deuda: revisa primero la compra/pago original para evitar un crédito falso.",
      };
    }
    return {
      status: closed.reason === "unsafe" ? "needs_info" : "error",
      summary: closed.reason === "unsafe"
        ? "El estado del plan no permite ese cierre; no moví ni la deuda ni el plan."
        : "No pude probar el cierre completo; la operación se revirtió y es seguro reintentar.",
    };
  }
  ctx.dirty = true;
  const cur = plan.baseCurrency;
  const tail = mode === "paid_off"
    ? ` Este cierre NO mueve plata: cuando pague ese monto a la tarjeta, regístralo con register_card_payment (quedaban ~${money(pr.pendingBase, cur)} pendientes).`
    : ` La compra original y la deuda que creó quedaron revertidas en la MISMA operación; no la deshagas otra vez ni registres un reembolso separado.`;
  const mtfNow = ctx.briefing?.margenKipu?.capacity?.monthlyTrulyFree;
  if (ctx.saldoAvailable === false || !Number.isFinite(mtfNow)) {
    return {
      status: "done",
      effect: closed.alreadyClosed ? "noop" : "wrote",
      summary: installmentCloseDegradedSummary({
        description: plan.description, mode, remaining: pr.remaining, tail,
      }),
      data: { planId: plan.id, mode, remaining: pr.remaining, saldoAvailable: false },
    };
  }
  // The REAL recovery respects the engine clamp (fill = max(0, trulyFree)/30):
  // an over-committed month recovers less than cuota/30 — never invent it.
  const recover = Math.round(((Math.max(0, mtfNow + plan.installmentBase) - Math.max(0, mtfNow)) / 30) * 100) / 100;
  const recoverLine = recover > 0.005
    ? `Su recarga diaria recupera ~${money(recover, cur)}/día desde ya — dáselo como buena noticia.`
    : `Su recarga sigue en 0 por ahora (el mes está sobre-comprometido), pero su carga mensual baja ${money(plan.installmentBase, cur)} — dilo claro y sin juicio.`;
  return {
    status: "done",
    effect: closed.alreadyClosed ? "noop" : "wrote",
    summary: `Plan "${plan.description}" cerrado (${mode === "paid_off" ? "liquidado antes de tiempo" : "cancelado"}) con ${pr.remaining} cuotas sin facturar. ${recoverLine}${tail}`,
    data: { planId: plan.id, mode, remaining: pr.remaining },
  };
}

async function executeNetWorth(ctx: AgentContext): Promise<ToolResult> {
  const gi = ctx.briefing.goalsIntel;
  const m = (v: number) => formatMoney(v, ctx.baseCurrency);
  // Re-auditoría 2 (refutación P7): el veredicto va ANTES del null-check. Con la
  // lectura de patrimonio o de activos no probada, el brazo peligroso era el
  // NO-null: un netWorth armado solo con cuentas publicaba un total cerrado sin
  // los activos perdidos ("neto ~$2.000" a quien tiene $30.000 invertidos).
  if (gi.wealthAvailable === false || ctx.assetsAvailable === false) {
    return { status: "done", summary: "Ahora mismo no pude leer su patrimonio (activos/inversiones), así que NO puedo darte un total. NO afirmes que no tiene nada registrado ni cites un neto parcial; dile que lo intente de nuevo en un rato." };
  }
  if (!gi.netWorth) {
    return { status: "done", summary: "Aún no tengo activos ni inversiones registradas para calcular tu patrimonio. Si quieres, ofrécele registrar lo que tiene (cuentas, pólizas, inversiones, propiedades). No inventes valores." };
  }
  const nw = gi.netWorth;
  const wealth = nw.wealthTarget ? ` Meta de patrimonio ${m(nw.wealthTarget)}: ${nw.wealthProgressPct}%${nw.requiredMonthlyForTarget != null ? `, requiere ~${m(nw.requiredMonthlyForTarget)}/mes` : ""}.` : "";
  const inv = gi.investment ? ` Inversiones: ${gi.investment.count}, valor ~${m(gi.investment.totalValue)}${gi.investment.hasReturns ? `, proyección 12m ~${m(gi.investment.projected12mValue)}` : ""}.` : "";
  return {
    status: "done",
    summary: `Patrimonio (ESTIMADO): neto ~${m(nw.totalNetWorth)} (líquido ~${m(nw.liquidNetWorth)}; activos ~${m(nw.totalAssets)}, deuda ~${m(nw.totalDebt)}).${inv}${wealth} Dilo simple y deja claro que es estimado; nunca afirmes valores de mercado en tiempo real ni un bróker conectado si no lo está.`,
  };
}

async function executeSetWealthTarget(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { status: "needs_info", summary: "¿A qué número de patrimonio quieres llegar?" };
  const ok = await setGoalPrefs(ctx.userId, { wealthTarget: amount });
  if (!ok) return { status: "error", summary: "No pude guardar tu meta de patrimonio ahora; ofrécele reintentar." };
  ctx.dirty = true;
  return { status: "done", summary: `Anoté tu meta de patrimonio: ${formatMoney(amount, ctx.baseCurrency)}. Cuando me preguntes te muestro el avance y el aporte mensual estimado para llegar (es estimado, depende del rendimiento que me des).` };
}

async function executeSetAmbitionMode(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const mode = ["light_touch", "steady", "power_builder"].includes(args.mode as string) ? (args.mode as AmbitionMode) : null;
  if (!mode) return { status: "needs_info", summary: "¿Prefieres ir suave (disfrutar más, metas tranquilas), equilibrado, o atacar fuerte tus metas?" };
  const ok = await setGoalPrefs(ctx.userId, { ambitionMode: mode });
  if (!ok) return { status: "error", summary: "No pude guardar tu preferencia ahora; ofrécele reintentar." };
  ctx.dirty = true;
  const label = mode === "light_touch" ? "suave (priorizo que disfrutes, metas tranquilas)" : mode === "power_builder" ? "fuerte (empujo metas y deuda más duro, gustos más ajustados)" : "equilibrado";
  return { status: "done", summary: `Listo, ajusto tu ritmo a ${label}. Esto cambia cómo reparto tu plata libre, nunca tus pagos mínimos ni la seguridad. Confírmalo natural.` };
}

// ── Stage 18 — Personalization tools. Reads use ctx.briefing.personalization
// (the per-turn profile/decisions); writes go through the typed personalization
// store and mark ctx.dirty. They change TONE/FRAMING/surfaces/nudge prefs only —
// never the money math, the minimums, or the default brevity.
async function executeSetFinancialPhilosophy(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const philosophy = ["experiences", "balanced", "builder", "wealth"].includes(args.philosophy as string) ? (args.philosophy as FinancialPhilosophy) : null;
  if (!philosophy) return { status: "needs_info", summary: "¿Prefieres disfrutar más tu dinero hoy, construir patrimonio, o un equilibrio? No lo etiquetes; solo entiende su filosofía." };
  const ok = await setPersonalizationPref(ctx.userId, { financialPhilosophy: philosophy });
  if (!ok) return { status: "error", summary: "Entendí la preferencia, pero no pude guardarla y no la doy por aplicada. Reintenta." };
  await logPreferenceEvent(ctx.userId, "philosophy", philosophy);
  ctx.dirty = true;
  const how = philosophy === "experiences" ? "priorizo que disfrutes tu dinero sin endeudarte; no te voy a presionar a ahorrar" : philosophy === "wealth" ? "te voy a ayudar a construir patrimonio y seré menos permisivo con lo discrecional" : philosophy === "builder" ? "priorizo el avance de tus metas con equilibrio" : "mantengo el equilibrio entre disfrutar y construir";
  return { status: "done", summary: `Listo: de ahora en adelante ${how}. Nunca cambia tus pagos ni tu seguridad financiera. Confírmalo natural y breve.` };
}

async function executeGetPersonalizationProfile(ctx: AgentContext): Promise<ToolResult> {
  if (!ctx.briefing.personalization.available) {
    return {
      status: "error",
      summary:
        "No pude leer completo el perfil de personalización. No afirmes que está vacío ni cites preferencias parciales; ofrece reintentar.",
    };
  }
  const p = ctx.briefing.personalization.profile;
  const philo = p.financialPhilosophy === "unknown" ? "sin declarar" : p.financialPhilosophy;
  return {
    status: "done",
    summary: `Config actual (dilo SIMPLE y humano, sin etiquetas internas; confianza ${p.confidence}): filosofía ${philo}, orientación ${p.financialOrientation}, tono ${p.tone}, detalle ${p.detailLevel}, modo ${p.userMode}, riesgo ${p.riskPosture}, recordatorios ${p.nudgeSensitivity}. Puede cambiar cualquiera cuando quiera.`,
  };
}

async function executeSetCommunicationPreference(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const tone = ["calm", "direct", "motivating", "analytical", "gentle", "playful", "coach"].includes(args.tone as string) ? (args.tone as string) : undefined;
  const detail = ["short", "balanced", "detailed"].includes(args.detail as string) ? (args.detail as string) : undefined;
  if (!tone && !detail) return { status: "needs_info", summary: "¿Cómo prefieres que te hable (más directo, suave, motivador) o cuánto detalle (corto, balanceado, detallado)?" };
  const ok = await setCommunicationPref(ctx.userId, { tone, detailLevel: detail });
  if (!ok) return { status: "error", summary: "No pude guardar tu preferencia de estilo y no la doy por aplicada. Reintenta." };
  if (tone) await logPreferenceEvent(ctx.userId, "tone", tone);
  if (detail) await logPreferenceEvent(ctx.userId, "detail", detail);
  ctx.dirty = true;
  return { status: "done", summary: `Listo, ajusto mi estilo${tone ? ` (tono ${tone})` : ""}${detail ? ` (detalle ${detail})` : ""}. El detalle aplica cuando profundizas; las confirmaciones rutinarias siguen cortas. Confírmalo breve.` };
}

async function executeSetRiskPreference(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const risk = ["conservative", "moderate", "aggressive"].includes(args.risk as string) ? (args.risk as "conservative" | "moderate" | "aggressive") : null;
  if (!risk) return { status: "needs_info", summary: "¿Prefieres ir conservador (más reserva), moderado, o tolerar más riesgo?" };
  const ok = await setGoalPrefs(ctx.userId, { riskTolerance: risk });
  if (!ok) return { status: "error", summary: "No pude guardar tu postura de riesgo y no la doy por aplicada. Reintenta." };
  await logPreferenceEvent(ctx.userId, "risk", risk);
  ctx.dirty = true;
  return { status: "done", summary: `Listo, ajusto el encuadre a un perfil ${risk === "conservative" ? "conservador (más reserva y prudencia)" : risk === "aggressive" ? "más tolerante al riesgo (planes algo más ambiciosos, siempre estimados)" : "moderado"}. No cambio la verdad financiera ni recomiendo activos específicos.` };
}

async function executeSetOnboardingMode(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const mode = args.mode === "simple" || args.mode === "power" ? (args.mode as "simple" | "power") : null;
  if (!mode) return { status: "needs_info", summary: "¿Lo quieres simple (lo mínimo, rápido) o power (más detalle y control)?" };
  const ok = await setPersonalizationPref(ctx.userId, { onboardingMode: mode });
  if (!ok) return { status: "error", summary: "No pude guardar ese modo y no lo doy por aplicado. Reintenta." };
  await logPreferenceEvent(ctx.userId, "onboarding", mode);
  ctx.dirty = true;
  return { status: "done", summary: `Listo, modo ${mode === "simple" ? "simple (lo mínimo y con más automatización)" : "power (más detalle y control disponible)"}. Aun en power, las respuestas por defecto siguen cortas.` };
}

async function executeSetNudgeSensitivity(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const s = ["low", "normal", "high"].includes(args.sensitivity as string) ? (args.sensitivity as "low" | "normal" | "high") : null;
  if (!s) return { status: "needs_info", summary: "¿Quieres más recordatorios, los normales, o solo los importantes?" };
  const ok = await setPersonalizationPref(ctx.userId, { nudgeSensitivity: s });
  if (!ok) return { status: "error", summary: "No pude guardar esa preferencia de recordatorios y no la doy por aplicada. Reintenta." };
  await logPreferenceEvent(ctx.userId, "nudge_sensitivity", s);
  ctx.dirty = true;
  return { status: "done", summary: `Listo: ${s === "high" ? "solo te aviso lo realmente importante" : s === "low" ? "no te filtro recordatorios, te dejo los que puedan ayudarte" : "recordatorios normales"}. Siempre respeto tus horas de silencio y el tope diario; nunca te aviso de más.` };
}

async function executeUpdateLifeContext(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const kind = typeof args.kind === "string" ? args.kind.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40) : "";
  const label = userAuthoredMemoryText(ctx.rawMessage);
  if (!kind || !label) return { status: "needs_info", summary: "¿Qué de tu situación quieres que tenga en cuenta? Dímelo con tus palabras; no guardaré una etiqueta inventada por el modelo." };
  const ok = await upsertLifeContext(ctx.userId, kind, label);
  if (!ok) return { status: "error", summary: `No pude guardar "${label}" y no lo doy por recordado. Reintenta.` };
  await logPreferenceEvent(ctx.userId, "life_context", kind);
  ctx.dirty = true;
  return { status: "done", summary: `Anotado: ${label}. Lo tendré en cuenta solo cuando sea relevante para tus recomendaciones, sin sobre-interpretarlo. Confírmalo breve.` };
}

async function executeForgetLifeContext(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const kind = typeof args.kind === "string" ? args.kind.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40) : "";
  if (!kind) return { status: "needs_info", summary: "¿Qué contexto quieres que olvide? (dime cuál, p.ej. que eras estudiante o que viajabas)" };
  const ok = await removeLifeContext(ctx.userId, kind);
  if (!ok) return { status: "error", summary: "No pude borrar ese contexto de forma permanente y no doy el olvido por hecho. Reintenta." };
  await logPreferenceEvent(ctx.userId, "life_context_removed", kind);
  ctx.dirty = true;
  return { status: "done", summary: "Listo, ya no lo tendré en cuenta. Tus datos y metas siguen igual. Confírmalo breve." };
}

async function executeExplainPersonalization(ctx: AgentContext): Promise<ToolResult> {
  const pi = ctx.briefing.personalization;
  if (!pi.available) {
    return {
      status: "error",
      summary:
        "No pude leer completa la personalización. No expliques defaults ni ausencia como si fueran preferencias del usuario; ofrece reintentar.",
    };
  }
  const p = pi.profile;
  const d = pi.decisions;
  const explicitTraits = Object.entries(p.provenance).filter(([, v]) => v === "explicit").map(([k]) => k);
  const densityWhy = p.provenance.dashboardDensity === "explicit" ? "tú la elegiste" : "la inferí de tu uso/filosofía y es ajustable";
  const dash = `Sobre el dashboard: densidad ${d.dashboardDensity} (${densityWhy}); destaco ${d.promotedSurfaces.join(", ") || "lo esencial"}${d.collapsedSurfaces.length ? ` y dejo en segundo plano ${d.collapsedSurfaces.join(", ")}` : ""}; NINGÚN dato financiero real se oculta y puede pedir verlo cuando quiera.`;
  return {
    status: "done",
    summary: `Explica honesto y SIN sonar invasivo (confianza ${p.confidence}): adapto el tono (${p.tone}) y el encuadre a lo que el usuario me ha dicho o a cómo usa la app; ${explicitTraits.length ? `lo explícito que él fijó: ${explicitTraits.join(", ")}` : "casi todo viene de valores por defecto, aún sé poco de él"}. ${dash} Mantengo respuestas simples por defecto, las cifras no cambian por personalización, y puede ajustar o resetear esto cuando quiera. Nada de etiquetas internas ni adivinar cosas personales.`,
  };
}

async function executePersonalizationFeedback(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const aspect = ["nudge", "strictness", "detail", "dashboard", "tone"].includes(args.aspect as string) ? (args.aspect as string) : null;
  const sentiment = ["too_much", "too_little", "good", "annoying", "useful"].includes(args.sentiment as string) ? (args.sentiment as string) : null;
  if (!aspect || !sentiment) return { status: "needs_info", summary: "¿Sobre qué es el feedback (recordatorio, exigencia, detalle, dashboard, tono) y qué sentiste?" };
  // Apply the obvious preference change when the feedback is unambiguous.
  // STRICTNESS routes to the ambition_mode lever (the joy-vs-goals allocation
  // posture), NEVER to the explicitly-declared financial philosophy — one weak
  // complaint must not rewrite the user's core life identity, flip their dashboard
  // orientation, or change framing. effectiveAmbition = explicit ambition ??
  // philosophy-derived, so an explicit ambition correctly takes precedence.
  let applied = "";
  let preferenceWrite: boolean | null = null;
  if (aspect === "nudge" && (sentiment === "annoying" || sentiment === "too_much")) { preferenceWrite = await setPersonalizationPref(ctx.userId, { nudgeSensitivity: "high" }); applied = " Te aviso solo lo importante."; }
  else if (aspect === "nudge" && (sentiment === "useful" || sentiment === "good")) { preferenceWrite = await setPersonalizationPref(ctx.userId, { nudgeSensitivity: "normal" }); applied = " Mantengo este tipo de avisos."; }
  else if (aspect === "detail" && sentiment === "too_much") { preferenceWrite = await setCommunicationPref(ctx.userId, { detailLevel: "short" }); applied = " Acorto el detalle por defecto."; }
  else if (aspect === "detail" && sentiment === "too_little") { preferenceWrite = await setCommunicationPref(ctx.userId, { detailLevel: "detailed" }); applied = " Doy más detalle cuando profundices."; }
  else if (aspect === "strictness" && sentiment === "too_much") { preferenceWrite = await setGoalPrefs(ctx.userId, { ambitionMode: "light_touch" }); applied = " Aflojo el ritmo, priorizo que disfrutes sin presión."; }
  else if (aspect === "strictness" && sentiment === "too_little") { preferenceWrite = await setGoalPrefs(ctx.userId, { ambitionMode: "power_builder" }); applied = " Te empujo un poco más con tus metas."; }
  else if (aspect === "dashboard" && sentiment === "too_much") { preferenceWrite = await setPersonalizationPref(ctx.userId, { dashboardDensity: "minimal" }); applied = " Dejo el dashboard más limpio, solo lo esencial."; }
  else if (aspect === "dashboard" && sentiment === "too_little") { preferenceWrite = await setPersonalizationPref(ctx.userId, { dashboardDensity: "rich" }); applied = " Te muestro más detalle en el dashboard."; }
  if (preferenceWrite === false) {
    return {
      status: "error",
      summary:
        "Entendí el feedback, pero no pude guardar el ajuste y no lo doy por aplicado. Reintenta.",
    };
  }
  const eventSaved = await logPreferenceEvent(ctx.userId, `${aspect}_feedback`, sentiment, "chat");
  if (!eventSaved && preferenceWrite == null) {
    return {
      status: "error",
      summary:
        "Entendí el feedback, pero no pude guardarlo y no voy a prometer que lo recordaré. Reintenta.",
    };
  }
  ctx.dirty = true;
  return { status: "done", summary: `Gracias, lo tomo en cuenta y lo ajusto.${applied} Agradécelo breve y sin culpa; el feedback explícito manda sobre lo que yo infiera. Nunca cambio tu verdad financiera ni tus mínimos por esto.` };
}

async function executeResetPersonalization(ctx: AgentContext): Promise<ToolResult> {
  const ok = await resetPersonalization(ctx.userId);
  if (!ok) return { status: "error", summary: "No pude resetear ahora; ofrécele reintentar." };
  // An audit event is a claim about what happened. Never record "reset" when
  // the primary reset failed; otherwise later explanations can cite a change
  // that never landed.
  await logPreferenceEvent(ctx.userId, "reset", null);
  ctx.dirty = true;
  // Honest scope: reset clears user_personalization (filosofía + preferencias de
  // uso) y el contexto de vida declarado. NO toca tono/detalle (coach_preferences)
  // ni riesgo/ambición (user_financial_preferences) ni datos/metas — esos se ajustan
  // con sus propias herramientas. La copia debe decir solo lo que de verdad se borró.
  return { status: "done", summary: `Listo, reinicié a neutral tu filosofía, tus preferencias de uso (recordatorios, densidad del dashboard, modo) y olvidé el contexto que me contaste. Tu tono, nivel de detalle, postura de riesgo, datos y metas siguen como están — esos los cambias con sus propios ajustes cuando quieras. Confírmalo breve.` };
}

// ── Stage 19 — household executors. Permission + membership are enforced in the
//    store; here we resolve the user's household + member names → ids and keep the
//    agent's surface natural (names, not internal ids). Never expose ids/JSON.
export async function resolveHousehold(ctx: AgentContext, hint?: string): Promise<{ household: LoadedHousehold | null; many: boolean }> {
  if (ctx.householdsAvailable !== true || !ctx.households) {
    throw new Error("KIPU_HOUSEHOLD_READ_REQUIRED");
  }
  const households = ctx.households;
  if (households.length === 0) return { household: null, many: false };
  const household = resolveExplicitOrSingle(
    households,
    hint,
    (row) => row.name,
  );
  if (household) return { household, many: false };
  return {
    household: null,
    many: households.length > 1,
  };
}
function resolveMemberId(h: LoadedHousehold, name: string): string | null {
  const n = name.trim().toLowerCase();
  if (n === "me" || n === "yo" || n === "mí" || n === "mi") return h.selfMemberId;
  const active = h.members.filter((x) => x.status !== "removed");
  const exact = active.filter((x) => normName(x.displayName) === normName(name));
  if (exact.length === 1) return exact[0].memberId;
  const partial = active.filter((x) => {
    const display = normName(x.displayName);
    const target = normName(name);
    return display.includes(target) || target.includes(display);
  });
  return partial.length === 1 ? partial[0].memberId : null;
}

export function agentActionDedupe(
  ctx: AgentContext,
  action: string,
  parts: unknown[],
): string {
  const operation = ctx.operationId?.trim();
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        ctx.userId,
        ctx.channel ?? "web",
        ctx.chatId ?? "",
        action,
        ...parts,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
  if (operation) {
    // One delivery may legitimately contain two different household writes of
    // the same kind (or even two identical expenses). `operation:action` made
    // the second collide with the first and fail as a dedupe mismatch. Reuse
    // the same per-turn deterministic occurrence map as ledger movements:
    // redelivery reconstructs the same keys in the same order, while distinct
    // writes in one turn remain distinct.
    const occurrences = (ctx.dedupeOcc ??= new Map<string, number>());
    const occurrenceKey = `action:${action}:${fingerprint}`;
    const index = occurrences.get(occurrenceKey) ?? 0;
    occurrences.set(occurrenceKey, index + 1);
    return `${operation}:action:${action}:${fingerprint}:${index}`;
  }
  return `agent:${action}:${createHash("sha256")
    .update(
      JSON.stringify([
        ctx.userId,
        ctx.channel ?? "web",
        ctx.chatId ?? "",
        ctx.rawMessage.trim(),
        fingerprint,
      ]),
    )
    .digest("hex")
    .slice(0, 40)}`;
}

export function householdActionDedupe(
  ctx: AgentContext,
  action: string,
  parts: unknown[],
): string {
  return agentActionDedupe(ctx, `household:${action}`, parts);
}

async function executeCreateHousehold(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const type = ["couple", "family", "roommates", "trip", "custom"].includes(args.type as string) ? (args.type as HouseholdType) : null;
  if (!name || !type) return { status: "needs_info", summary: "¿Cómo se llama el grupo y de qué tipo es (pareja, familia, roomies, viaje)?" };
  const explicitBase =
    typeof args.baseCurrency === "string" &&
    /^[A-Za-z]{3}$/.test(args.baseCurrency.trim())
      ? args.baseCurrency.trim().toUpperCase()
      : null;
  if (args.baseCurrency !== undefined && !explicitBase) {
    return {
      status: "needs_info",
      summary:
        "La moneda base del grupo debe ser un código ISO de 3 letras; no creé el hogar con una moneda descartada.",
    };
  }
  const dedupeKey =
    ctx.operationId?.trim() ||
    `agent:household:${createHash("sha256")
      .update([ctx.userId, ctx.rawMessage.trim(), name, type, explicitBase ?? ctx.baseCurrency].join("|"))
      .digest("hex")
      .slice(0, 32)}`;
  const r = await createHousehold(ctx.userId, {
    name,
    type,
    baseCurrency: explicitBase ?? ctx.baseCurrency,
    dedupeKey,
  });
  if (!r.ok) return { status: "error", summary: "No pude crear el grupo ahora; no afirmes que existe y ofrécele reintentar." };
  ctx.dirty = true;
  const replayed = (r.data as { replayed?: boolean } | undefined)?.replayed === true;
  return {
    status: "done",
    effect: replayed ? "noop" : "wrote",
    summary: replayed
      ? `El grupo "${name}" ya estaba creado por esta misma operación; no lo dupliqué.`
      : `Listo, creé el grupo "${name}". Eres el dueño. Agrega a las personas (si no usan Kipu, con add_household_participant; si usan Kipu, invítalas). Luego registra gastos compartidos. Confírmalo simple y cálido.`,
  };
}

async function executeAddHouseholdParticipant(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const displayName = typeof args.displayName === "string" ? args.displayName.trim() : "";
  if (!displayName) return { status: "needs_info", summary: "¿A quién agrego al grupo?" };
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿A cuál de tus grupos lo agrego?" };
  if (!household) return { status: "needs_info", summary: "Primero crea un grupo/hogar para poder agregar personas." };
  const r = await addNonUserParticipant(
    ctx.userId,
    household.id,
    displayName,
    householdActionDedupe(ctx, "household-participant", [
      household.id,
      displayName,
    ]),
  );
  if (!r.ok) return { status: r.reason === "sin_permiso" ? "refused" : "error", summary: r.reason === "sin_permiso" ? "Solo quien administra el grupo puede agregar personas." : "No pude agregarlo ahora." };
  ctx.dirty = true;
  const replayed = (r.data as { replayed?: boolean } | undefined)?.replayed === true;
  return {
    status: "done",
    effect: replayed ? "noop" : "wrote",
    summary: replayed
      ? `${displayName} ya había sido agregado por esta misma operación; no lo dupliqué.`
      : `Listo, agregué a ${displayName} al grupo "${household.name}" (sin usuario de Kipu; puede entrar en las divisiones). Confírmalo breve.`,
  };
}

async function executeInviteHouseholdMember(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const label = typeof args.label === "string" ? args.label.trim() : "";
  if (!label) return { status: "needs_info", summary: "¿A quién quieres invitar?" };
  const role = args.role == null ? "member" : String(args.role);
  if (!["member", "viewer", "contributor"].includes(role)) {
    return {
      status: "needs_info",
      summary:
        "Ese rol no es asignable por invitación. Puedes invitar como miembro, lector o colaborador; no creé la invitación.",
    };
  }
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿A cuál grupo lo invito?" };
  if (!household) return { status: "needs_info", summary: "Primero crea un grupo para invitar a alguien." };
  const r = await inviteMember(ctx.userId, household.id, {
    label,
    role,
    dedupeKey: householdActionDedupe(ctx, "household-invite", [
      household.id,
      label,
      role,
    ]),
  });
  if (!r.ok) return { status: r.reason === "solo_owner_admin_invita" ? "refused" : "error", summary: r.reason === "solo_owner_admin_invita" ? "Solo quien administra el grupo puede invitar." : "No pude crear la invitación ahora." };
  ctx.dirty = true;
  const replayed = (r.data as { replayed?: boolean } | undefined)?.replayed === true;
  return {
    status: "done",
    effect: replayed ? "noop" : "wrote",
    summary: replayed
      ? `La invitación para ${label} ya existía por esta misma operación; no generé otra.`
      : `Listo, dejé la invitación para ${label} en "${household.name}". No entra hasta que acepte; nunca agrego a nadie automáticamente. Confírmalo breve.`,
  };
}

async function executeRespondHouseholdInvite(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const inviteId = typeof args.inviteId === "string" ? args.inviteId : "";
  if (!inviteId) return { status: "needs_info", summary: "¿Cuál invitación?" };
  if (typeof args.accept !== "boolean") {
    return {
      status: "needs_info",
      summary: "¿Quieres aceptar o rechazar esa invitación? No cambié su estado.",
    };
  }
  const accept = args.accept;
  const r = await respondInvite(ctx.userId, inviteId, accept, typeof args.displayName === "string" ? args.displayName : undefined);
  if (!r.ok) return { status: "refused", summary: "No pude procesar la invitación (puede que ya no esté vigente o no sea para ti)." };
  ctx.dirty = true;
  return { status: "done", summary: accept ? "Listo, ya estás en el grupo. Confírmalo cálido y simple." : "Hecho, rechacé la invitación. Confírmalo breve y sin drama." };
}

/** Fixed/custom shares are stated in the movement's native currency, while the
 * household settlement engine stores base amounts. Percent/weight fields are
 * dimensionless and must not be converted. */
export function sharedParticipantsToBase(
  participants: SplitParticipant[],
  originalTotal: number,
  baseTotal: number,
): SplitParticipant[] {
  if (
    !Number.isFinite(originalTotal) ||
    originalTotal <= 0 ||
    !Number.isFinite(baseTotal) ||
    baseTotal <= 0
  ) {
    return participants;
  }
  const factor = baseTotal / originalTotal;
  return participants.map((row) => ({
    ...row,
    fixed:
      row.fixed == null ? undefined : Math.round(row.fixed * factor * 100) / 100,
    custom:
      row.custom == null
        ? undefined
        : Math.round(row.custom * factor * 100) / 100,
  }));
}

async function executeAddSharedExpense(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const description = typeof args.description === "string" ? args.description.trim() : "";
  const total = typeof args.total === "number" ? args.total : NaN;
  const method = ["equal", "percentage", "fixed", "income_weighted", "custom", "payer_absorbs"].includes(args.method as string) ? (args.method as SplitMethod) : null;
  const rawParts = Array.isArray(args.participants) ? (args.participants as Record<string, unknown>[]) : [];
  if (!description || !Number.isFinite(total) || total <= 0 || !method || rawParts.length === 0) return { status: "needs_info", summary: "Para registrar el gasto compartido dime: qué fue, cuánto, cómo se divide y entre quiénes." };
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿En cuál grupo va este gasto compartido?" };
  if (!household) return { status: "needs_info", summary: "Primero crea un grupo/hogar para registrar gastos compartidos." };
  const payerName = typeof args.payer === "string" && args.payer.trim() ? args.payer : "";
  if (!payerName) {
    return {
      status: "needs_info",
      summary: "¿Quién pagó este gasto compartido? No asumí que fuiste tú.",
    };
  }
  const payerMemberId = resolveMemberId(household, payerName);
  if (!payerMemberId) return { status: "needs_info", summary: `No reconozco a "${payerName}" en el grupo "${household.name}". ¿Quién pagó?` };
  const participants: SplitParticipant[] = [];
  const unknown: string[] = [];
  for (const p of rawParts) {
    const nm = typeof p.name === "string" ? p.name : "";
    const mid = resolveMemberId(household, nm);
    if (!mid) { unknown.push(nm); continue; }
    participants.push({ memberId: mid, percent: typeof p.percent === "number" ? p.percent : undefined, fixed: typeof p.amount === "number" ? p.amount : undefined, custom: typeof p.amount === "number" ? p.amount : undefined, weight: typeof p.weight === "number" ? p.weight : undefined });
  }
  if (unknown.length) return { status: "needs_info", summary: `No reconozco a ${unknown.join(", ")} en "${household.name}". Agrégalos al grupo primero o corrige el nombre.` };
  // Honest FX for the SHARED ledger too: a 60000-ARS shared súper must not be
  // stored as 60000 base when the household's base is USD. Convert with the
  // user's known rates; no known rate → ask, never fabricate.
  const stated =
    typeof args.currency === "string" &&
    /^[A-Za-z]{3}$/.test(args.currency.trim())
      ? args.currency.trim().toUpperCase()
      : null;
  if (!stated) {
    return {
      status: "needs_info",
      summary:
        "¿En qué moneda fue el gasto compartido? No reinterpreté el monto en la moneda del grupo.",
    };
  }
  let totalBase = total;
  if (stated !== household.baseCurrency) {
    const { convert } = await import("@/lib/fx/fx-rates");
    const res = convert(total, stated, household.baseCurrency, ctx.fxRates ?? []);
    if (!res.ok) return { status: "needs_info", summary: `El gasto está en ${stated} y el grupo lleva sus cuentas en ${household.baseCurrency}; dime a cuánto está el cambio (o guárdalo con set_exchange_rate) y lo registro bien.` };
    totalBase = res.baseAmount;
  }
  const baseParticipants = sharedParticipantsToBase(
    participants,
    total,
    totalBase,
  );
  const r = await addSharedExpense(ctx.userId, household.id, {
    description,
    totalBase,
    originalAmount: total,
    originalCurrency: stated,
    baseCurrency: household.baseCurrency,
    category: typeof args.category === "string" ? args.category : undefined,
    method,
    participants: baseParticipants,
    payerMemberId,
    dedupeKey: householdActionDedupe(ctx, "shared-expense", [
      household.id,
      description,
      total,
      stated,
      method,
      payerMemberId,
      baseParticipants,
    ]),
  });
  if (!r.ok) return { status: r.reason === "sin_permiso" ? "refused" : "needs_info", summary: r.reason === "sin_permiso" ? "No tienes permiso para registrar gastos en ese grupo." : (r.reason ?? "No pude registrar el gasto compartido.") };
  ctx.dirty = true;
  const sharedData = r.data as
    | {
        shares?: { memberId: string; shareBase: number }[];
        replayed?: boolean;
      }
    | undefined;
  const replayed = sharedData?.replayed === true;
  const shares = sharedData?.shares ?? [];
  const nameOf = (id: string) => household.members.find((m) => m.memberId === id)?.displayName ?? "alguien";
  const breakdown = shares.filter((s) => s.shareBase > 0).map((s) => `${nameOf(s.memberId)} ${s.shareBase} ${household.baseCurrency}`).join(", ");
  return {
    status: "done",
    effect: replayed ? "noop" : "wrote",
    summary: replayed
      ? `Ese gasto compartido ya estaba registrado por esta misma solicitud; no lo dupliqué.`
      : `Registré el gasto compartido "${description}" (${total} ${stated}) en "${household.name}". Reparto en la moneda del grupo: ${breakdown}. RECUERDA: si el usuario realmente pagó de su bolsillo, su gasto personal va aparte con log_movement (su Saldo refleja lo que pagó hoy); esto es solo la verdad compartida (quién le debe a quién), contada una sola vez. Un reembolso después NO es ingreso. Dilo simple y neutral, sin reclamos.`,
  };
}

async function executeHouseholdSummary(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  // `requireCompleteHouseholdContext` just refreshed this inventory from one
  // complete snapshot. Reusing `briefing.household` here could resurrect the
  // start-of-turn degraded/old snapshot and assert either "no group" or stale
  // balances immediately after proving newer data.
  const hi = buildHouseholdIntelligence({
    households: ctx.households ?? [],
    nowMs: Date.now(),
  });
  if (!hi.hasHousehold) return { status: "done", summary: "El usuario no tiene grupos/hogar todavía. Ofrécele crear uno si tiene sentido, sin presionar." };
  const hint = typeof args.householdName === "string" ? args.householdName : "";
  const namedView = hint
    ? resolveExplicitOrSingle(hi.households, hint, (row) => row.name)
    : null;
  if (hint && !namedView) {
    return {
      status: "needs_info",
      summary:
        `No encuentro ese grupo. Tiene: ${hi.households.map((row) => `"${row.name}"`).join(", ")}. Pregúntale cuál.`,
    };
  }
  const target = namedView ? [namedView] : hi.households;
  const lines = target.map((v) => {
    // Privacy-aware: render ONLY the transfers this member may see (minimal = their
    // own position). Never narrate the full balance graph among others in minimal.
    const path = v.visibleTransfers.length ? v.visibleTransfers.map((t) => `${t.fromName} → ${t.toName}: ${t.amountBase}`).join("; ") : "todo cuadrado";
    const bills = v.upcomingSharedBills.length ? ` Gastos compartidos que vienen: ${v.upcomingSharedBills.map((b) => `${b.description} ${b.amountBase} (en ${b.dueInDays}d)`).join("; ")}.` : "";
    return `"${v.name}" (privacidad ${v.privacyMode}): ${v.nextAction} Para cerrar del modo más simple: ${path}. Gasto compartido del mes: ${v.sharedSpendThisMonthBase}.${bills} ${v.pendingReimbursements ? `Reembolsos pendientes: ${v.pendingReimbursements}.` : ""}`;
  });
  return { status: "done", summary: `Resumen de hogar (dilo SIMPLE y NEUTRAL, sin culpar a nadie, sin exponer finanzas personales de nadie): ${lines.join(" | ")}` };
}

async function executeMarkReimbursementPaid(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const from = typeof args.from === "string" ? args.from : "";
  const to = typeof args.to === "string" ? args.to : "";
  const amount = typeof args.amount === "number" ? args.amount : NaN;
  if (!from || !to || !Number.isFinite(amount) || amount <= 0) return { status: "needs_info", summary: "¿Quién le pagó a quién y cuánto?" };
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿En cuál grupo registro el reembolso?" };
  if (!household) return { status: "needs_info", summary: "No encuentro el grupo para registrar el reembolso." };
  const statedCurrency =
    typeof args.currency === "string" &&
    /^[A-Za-z]{3}$/.test(args.currency.trim())
      ? args.currency.trim().toUpperCase()
      : null;
  if (!statedCurrency) {
    return {
      status: "needs_info",
      summary:
        "¿En qué moneda fue el reembolso? No interpreté el monto como la moneda base del grupo.",
    };
  }
  const converted =
    statedCurrency === household.baseCurrency
      ? { ok: true as const, baseAmount: amount }
      : convertFx(
          amount,
          statedCurrency,
          household.baseCurrency,
          ctx.fxRates ?? [],
        );
  if (!converted.ok) {
    return {
      status: "needs_info",
      summary:
        `El reembolso fue en ${statedCurrency} y el grupo lleva cuentas en ${household.baseCurrency}. ` +
        "Necesito una tasa confiable antes de liquidar el saldo; no lo registré 1:1.",
    };
  }
  const fromId = resolveMemberId(household, from); const toId = resolveMemberId(household, to);
  if (!fromId || !toId) return { status: "needs_info", summary: "No reconozco a una de las personas en el grupo." };
  const status = args.status === "pending" ? "pending" : "paid";
  const r = await markReimbursementPaid(ctx.userId, household.id, {
    fromMemberId: fromId,
    toMemberId: toId,
    amountBase: converted.baseAmount,
    baseCurrency: household.baseCurrency,
    status,
    dedupeKey: householdActionDedupe(ctx, "household-reimbursement", [
      household.id,
      fromId,
      toId,
      converted.baseAmount,
      household.baseCurrency,
      status,
    ]),
  });
  if (!r.ok) return { status: r.reason === "sin_permiso" ? "refused" : "error", summary: r.reason === "sin_permiso" ? "No tienes permiso para registrar reembolsos en ese grupo." : "No pude registrar el reembolso ahora." };
  ctx.dirty = true;
  const replayed =
    (r.data as { replayed?: boolean } | undefined)?.replayed === true;
  return {
    status: "done",
    effect: replayed ? "noop" : "wrote",
    summary: replayed
      ? `Ese reembolso ya estaba registrado por esta misma solicitud; no lo apliqué dos veces.`
      : `Registré el reembolso de ${money(amount, statedCurrency)}${statedCurrency === household.baseCurrency ? "" : ` (≈ ${money(converted.baseAmount, household.baseCurrency)})`} (${household.members.find((m) => m.memberId === fromId)?.displayName} → ${household.members.find((m) => m.memberId === toId)?.displayName}) en "${household.name}". Ajusté el saldo compartido. NO lo cuento como ingreso ni como gasto nuevo. Confírmalo simple y neutral.`,
  };
}

export function sharedGoalAmountsToBase(
  target: number,
  myWeekly: number | undefined,
  statedCurrency: string,
  householdBaseCurrency: string,
  rates: FxRate[],
):
  | { ok: true; targetBase: number; weeklyBase: number | undefined }
  | { ok: false } {
  if (
    !Number.isFinite(target) ||
    target <= 0 ||
    (myWeekly !== undefined && (!Number.isFinite(myWeekly) || myWeekly <= 0))
  ) {
    return { ok: false };
  }
  if (statedCurrency === householdBaseCurrency) {
    return { ok: true, targetBase: target, weeklyBase: myWeekly };
  }
  const targetConversion = convertFx(
    target,
    statedCurrency,
    householdBaseCurrency,
    rates,
  );
  if (!targetConversion.ok) return { ok: false };
  if (myWeekly === undefined) {
    return {
      ok: true,
      targetBase: targetConversion.baseAmount,
      weeklyBase: undefined,
    };
  }
  const weeklyConversion = convertFx(
    myWeekly,
    statedCurrency,
    householdBaseCurrency,
    rates,
  );
  return weeklyConversion.ok
    ? {
        ok: true,
        targetBase: targetConversion.baseAmount,
        weeklyBase: weeklyConversion.baseAmount,
      }
    : { ok: false };
}

async function executeCreateSharedGoal(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const target = typeof args.target === "number" ? args.target : NaN;
  if (!name || !Number.isFinite(target) || target <= 0) return { status: "needs_info", summary: "¿Cómo se llama la meta compartida y de cuánto es?" };
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿En cuál grupo va la meta compartida?" };
  if (!household) return { status: "needs_info", summary: "Primero crea un grupo/hogar para una meta compartida." };
  const currency =
    typeof args.currency === "string" &&
    /^[A-Za-z]{3}$/.test(args.currency.trim())
      ? args.currency.trim().toUpperCase()
      : null;
  if (!currency) {
    return {
      status: "needs_info",
      summary:
        "¿En qué moneda está la meta compartida? No interpreté el objetivo como la moneda del grupo por defecto.",
    };
  }
  const myWeekly =
    typeof args.myWeekly === "number" && Number.isFinite(args.myWeekly)
      ? args.myWeekly
      : undefined;
  if (args.myWeekly !== undefined && (myWeekly === undefined || myWeekly <= 0)) {
    return {
      status: "needs_info",
      summary:
        "Tu aporte semanal debe ser mayor a cero; no creé la meta descartando medio compromiso.",
    };
  }
  const converted = sharedGoalAmountsToBase(
    target,
    myWeekly,
    currency,
    household.baseCurrency,
    ctx.fxRates ?? [],
  );
  if (!converted.ok) {
    return {
      status: "needs_info",
      summary:
        `La meta está en ${currency} y el grupo planifica en ${household.baseCurrency}. ` +
        "Necesito una tasa confiable para convertir tanto el objetivo como tu aporte; no mezclé monedas ni creé una meta con progreso falso.",
    };
  }
  const dedupeKey =
    ctx.operationId?.trim() ||
    `agent:shared-goal:${createHash("sha256")
      .update(
        [
          ctx.userId,
          household.id,
          ctx.rawMessage.trim(),
          name,
          Math.round(target * 100),
          currency,
          myWeekly == null ? "" : Math.round(myWeekly * 100),
        ].join("|"),
      )
      .digest("hex")
      .slice(0, 32)}`;
  const r = await createSharedGoal(ctx.userId, household.id, {
    name,
    targetBase: converted.targetBase,
    baseCurrency: household.baseCurrency,
    myWeeklyBase: converted.weeklyBase,
    dedupeKey,
  });
  if (!r.ok) return { status: r.reason === "sin_permiso" ? "refused" : "error", summary: r.reason === "sin_permiso" ? "No tienes permiso para crear metas en ese grupo." : "No pude crear la meta compartida ahora." };
  ctx.dirty = true;
  const replayed = (r.data as { replayed?: boolean } | undefined)?.replayed === true;
  return {
    status: "done",
    effect: replayed ? "noop" : "wrote",
    summary: replayed
      ? `La meta compartida "${name}" ya estaba creada con esta misma operación; no la dupliqué.`
      : `Listo, creé la meta compartida "${name}" (${money(target, currency)}${currency === household.baseCurrency ? "" : ` ≈ ${money(converted.targetBase, household.baseCurrency)}`}) en "${household.name}"${myWeekly == null ? "" : `, con tu aporte de ${money(myWeekly, currency)}/sem${currency === household.baseCurrency ? "" : ` (≈ ${money(converted.weeklyBase ?? 0, household.baseCurrency)}/sem)`}`}. Cada quien aporta solo lo que se comprometa; tu plan personal solo se afecta por TU aporte. Confírmalo simple.`,
  };
}

async function executeLeaveHousehold(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿De cuál grupo quieres salir?" };
  if (!household) return { status: "done", effect: "noop", summary: "No estás en ningún grupo ahora mismo." };
  const r = await leaveHousehold(
    ctx.userId,
    household.id,
    householdActionDedupe(ctx, "leave", [household.id]),
  );
  if (!r.ok) {
    return r.reason === "owner_debe_transferir"
      ? {
          status: "refused",
          summary:
            "Eres quien administra este grupo. Salirte ahora lo dejaría sin dueño; no hice el cambio. Primero hay que transferir la administración a otra persona.",
        }
      : {
          status: "error",
          summary: "No pude sacarte del grupo ahora; no afirmes que saliste.",
        };
  }
  ctx.dirty = true;
  const replayed =
    (r.data as { replayed?: boolean } | undefined)?.replayed === true;
  return {
    status: "done",
    effect: replayed ? "noop" : "wrote",
    summary: replayed
      ? `Ya habías salido de "${household.name}" con esta misma solicitud; no repetí el cambio.`
      : `Listo, saliste de "${household.name}". El historial queda para cerrar cuentas si hace falta. Confírmalo breve y neutral.`,
  };
}

async function executeTransferHouseholdOwnership(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const successorName =
    typeof args.successorName === "string" ? args.successorName.trim() : "";
  if (!successorName) {
    return {
      status: "needs_info",
      summary: "¿A qué miembro exacto quieres transferirle la administración del grupo?",
    };
  }
  const { household, many } = await resolveHousehold(
    ctx,
    typeof args.householdName === "string" ? args.householdName : undefined,
  );
  if (many) {
    return {
      status: "needs_info",
      summary: "¿De cuál grupo quieres transferir la administración?",
    };
  }
  if (!household) {
    return {
      status: "done",
      effect: "noop",
      summary: "No encuentro un grupo activo del que puedas transferir la administración.",
    };
  }
  const successorId = resolveMemberId(household, successorName);
  if (!successorId) {
    const candidates = household.members
      .filter(
        (member) =>
          member.status === "active" &&
          member.memberId !== household.selfMemberId &&
          member.userId,
      )
      .map((member) => member.displayName)
      .join(", ");
    return {
      status: "needs_info",
      summary: candidates
        ? `No pude identificar un sucesor único. Miembros de Kipu elegibles: ${candidates}. ¿A quién exactamente?`
        : "No hay otro miembro activo con usuario de Kipu que pueda recibir la administración. No cambié nada.",
    };
  }
  const successor = household.members.find(
    (member) => member.memberId === successorId,
  );
  if (
    !successor ||
    successor.memberId === household.selfMemberId ||
    successor.status !== "active"
  ) {
    return {
      status: "needs_info",
      summary: "El sucesor debe ser otra persona activa del grupo. No cambié nada.",
    };
  }
  if (!successor.userId) {
    return {
      status: "needs_info",
      summary: `${successor.displayName} todavía es un participante sin usuario de Kipu. Debe unirse al grupo con su cuenta antes de poder administrarlo.`,
    };
  }
  if (args.confirm !== true) {
    return {
      status: "needs_info",
      summary: `Vas a transferir la administración de "${household.name}" a ${successor.displayName}. Esa persona podrá administrar miembros y configuración, y tú quedarás como admin. Pregunta si confirma ese sucesor exacto y, si dice que sí, vuelve a llamar transfer_household_ownership con successorName="${successor.displayName}" y confirm=true.`,
    };
  }
  const result = await transferHouseholdOwnership(
    ctx.userId,
    household.id,
    successor.memberId,
    householdActionDedupe(ctx, "transfer-ownership", [
      household.id,
      successor.memberId,
    ]),
  );
  if (!result.ok) {
    if (result.reason === "solo_owner") {
      return {
        status: "refused",
        summary: "Solo quien es dueño actual del grupo puede transferir su administración. No cambié nada.",
      };
    }
    if (result.reason === "sucesor_sin_usuario") {
      return {
        status: "needs_info",
        summary: "Esa persona debe unirse con su usuario de Kipu antes de poder recibir la administración. No cambié nada.",
      };
    }
    if (result.reason === "sucesor_invalido") {
      return {
        status: "needs_info",
        summary: "El sucesor tiene que ser otra persona activa del grupo. No cambié nada.",
      };
    }
    return {
      status: "error",
      summary: "No pude transferir la administración y no afirmé que cambiara. Ofrécele reintentar.",
    };
  }
  ctx.dirty = true;
  const replayed =
    (result.data as { replayed?: boolean } | undefined)?.replayed === true;
  return {
    status: "done",
    effect: replayed ? "noop" : "wrote",
    summary: replayed
      ? `${successor.displayName} ya había recibido la administración de "${household.name}" por esta misma solicitud; no repetí el cambio.`
      : `Listo, ${successor.displayName} ahora administra "${household.name}" y tú quedaste como admin. Si querías salir, ya puedes hacerlo con leave_household. Confírmalo claro y breve.`,
  };
}

async function executeSetHouseholdVisibility(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const privacy = ["minimal", "standard", "full"].includes(args.privacy as string) ? (args.privacy as "minimal" | "standard" | "full") : null;
  if (!privacy) return { status: "needs_info", summary: "¿Cuánto quieres compartir por defecto: mínimo, estándar o todo?" };
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿En cuál grupo?" };
  if (!household) return { status: "needs_info", summary: "No encuentro el grupo." };
  const r = await setHouseholdPrivacy(
    ctx.userId,
    household.id,
    privacy,
    householdActionDedupe(ctx, "visibility", [household.id, privacy]),
  );
  if (!r.ok) return { status: r.reason === "solo_owner_admin" ? "refused" : "error", summary: r.reason === "solo_owner_admin" ? "Solo quien administra el grupo cambia esto." : "No pude cambiar la visibilidad ahora." };
  ctx.dirty = true;
  const replayed =
    (r.data as { replayed?: boolean } | undefined)?.replayed === true;
  return {
    status: "done",
    effect: replayed ? "noop" : "wrote",
    summary: replayed
      ? `La visibilidad de "${household.name}" ya estaba aplicada por esta misma solicitud; no repetí el cambio.`
      : `Listo, dejé la visibilidad del grupo en "${privacy}". Tus finanzas personales nunca se exponen, pase lo que pase. Confírmalo breve.`,
  };
}

// ── Stage 20 PASS 2 — household completion executors ─────────────────────────
// Public base URL for shareable links (invite). Configurable; safe production default.
function appBaseUrl(): string {
  const fromEnv =
    process.env.KIPU_APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.TELEGRAM_WEBHOOK_BASE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  // Default = the real consumer domain, never the internal Vercel project URL —
  // a beta tester's partner should receive a soykipu.com link.
  return (fromEnv || "https://www.soykipu.com").replace(/\/+$/, "");
}

async function executeHouseholdInviteLink(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const role = args.role == null ? "member" : String(args.role);
  if (!["member", "viewer", "contributor"].includes(role)) {
    return {
      status: "needs_info",
      summary:
        "Ese rol no es asignable por enlace. Puedes invitar como miembro, lector o colaborador; no generé el enlace.",
    };
  }
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿Para cuál grupo genero el enlace?" };
  if (!household) return { status: "needs_info", summary: "Primero crea un grupo para invitar a alguien." };
  const label =
    typeof args.label === "string" ? args.label.trim() : undefined;
  const r = await createInviteLink(ctx.userId, household.id, {
    label,
    role,
    dedupeKey: householdActionDedupe(ctx, "household-invite-link", [
      household.id,
      label ?? "",
      role,
    ]),
  });
  if (!r.ok) return { status: r.reason === "solo_owner_admin_invita" ? "refused" : "error", summary: r.reason === "solo_owner_admin_invita" ? "Solo quien administra el grupo puede invitar." : "No pude generar el enlace ahora." };
  const token = (r.data as { token?: string } | undefined)?.token ?? "";
  const link = `${appBaseUrl()}/app/join/${token}`;
  return { status: "done", summary: `Listo. Comparte este enlace para que se unan a "${household.name}" (vence en 14 días): ${link} — o el código: ${token}. No entran hasta que lo abran y acepten; nunca agrego a nadie solo. Dáselo al usuario tal cual, claro y breve.` };
}

async function executeAcceptHouseholdInvite(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const raw = typeof args.code === "string" ? args.code.trim() : "";
  // Accept a full link or just the code.
  const code = raw.includes("/join/") ? raw.split("/join/").pop()!.trim() : raw;
  if (!code) return { status: "needs_info", summary: "Pásame el código o el enlace de la invitación." };
  const r = await acceptInviteByToken(ctx.userId, code, typeof args.displayName === "string" ? args.displayName : undefined);
  if (!r.ok) {
    const why = r.reason === "invitacion_expirada" ? "Esa invitación ya venció; pídele a quien te invitó que genere una nueva." : r.reason === "invitacion_no_es_tuya" ? "Esa invitación es para otra persona." : "No pude validar esa invitación (puede que ya no esté vigente).";
    return {
      status:
        r.reason === "invitacion_expirada" ||
        r.reason === "invitacion_no_es_tuya"
          ? "refused"
          : "error",
      summary: why,
    };
  }
  ctx.dirty = true;
  return { status: "done", summary: "Listo, ya estás en el grupo. Confírmalo cálido y simple, y ofrécele ver lo compartido." };
}

async function executeAddRecurringSharedExpense(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const description = typeof args.description === "string" ? args.description.trim() : "";
  const amount = typeof args.amount === "number" ? args.amount : NaN;
  if (!description || !Number.isFinite(amount) || amount <= 0) return { status: "needs_info", summary: "¿Qué gasto compartido recurrente y de cuánto (por ejemplo, renta 800 al mes)?" };
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿En cuál grupo va este gasto recurrente?" };
  if (!household) return { status: "needs_info", summary: "Primero crea un grupo/hogar para gastos compartidos recurrentes." };
  const payerName = typeof args.payer === "string" && args.payer.trim() ? args.payer : "";
  if (!payerName) {
    return {
      status: "needs_info",
      summary: "¿Quién paga este gasto recurrente? No asumí que eres tú.",
    };
  }
  const payerMemberId = resolveMemberId(household, payerName);
  if (!payerMemberId) return { status: "needs_info", summary: `No reconozco a "${payerName}" en "${household.name}". ¿Quién paga?` };
  const method = ["equal", "percentage", "fixed", "income_weighted", "custom", "payer_absorbs"].includes(args.method as string) ? (args.method as SplitMethod) : null;
  const cadence = ["weekly", "biweekly", "monthly", "annual"].includes(args.cadence as string) ? (args.cadence as "weekly" | "biweekly" | "monthly" | "annual") : null;
  if (!method || !cadence) {
    return {
      status: "needs_info",
      summary:
        "¿Cómo se divide y con qué cadencia se repite? No asumí reparto igual ni mensual.",
    };
  }
  const rawAnchor = args.anchorDay;
  const anchorDay = typeof rawAnchor === "number" && Number.isInteger(rawAnchor) ? rawAnchor : null;
  const anchorValid =
    anchorDay == null ||
    (cadence === "weekly" || cadence === "biweekly"
      ? anchorDay >= 0 && anchorDay <= 6
      : anchorDay >= 1 && anchorDay <= 28);
  if (!anchorValid) {
    return {
      status: "needs_info",
      summary:
        cadence === "weekly" || cadence === "biweekly"
          ? "El día semanal debe estar entre 0 (domingo) y 6 (sábado); no guardé el plan."
          : "El día mensual/anual debe estar entre 1 y 28; no guardé el plan.",
    };
  }
  const stated =
    typeof args.currency === "string" &&
    /^[A-Za-z]{3}$/.test(args.currency.trim())
      ? args.currency.trim().toUpperCase()
      : null;
  if (!stated) {
    return {
      status: "needs_info",
      summary:
        "¿En qué moneda está ese gasto recurrente? No reinterpreté el monto en la moneda del grupo.",
    };
  }
  let amountBase = amount;
  if (stated !== household.baseCurrency) {
    const { convert } = await import("@/lib/fx/fx-rates");
    const conversion = convert(
      amount,
      stated,
      household.baseCurrency,
      ctx.fxRates ?? [],
    );
    if (!conversion.ok) {
      return {
        status: "needs_info",
        summary:
          `El gasto recurrente está en ${stated} y el grupo usa ${household.baseCurrency}. ` +
          "Necesito una tasa confiable antes de guardar el plan; no lo registré 1:1.",
      };
    }
    amountBase = conversion.baseAmount;
  }
  const r = await createRecurringSharedExpense(ctx.userId, household.id, {
    description, amountBase, baseCurrency: household.baseCurrency, payerMemberId, splitMethod: method, cadence,
    anchorDay,
    dedupeKey: householdActionDedupe(ctx, "household-recurring-create", [
      household.id,
      description,
      amountBase,
      household.baseCurrency,
      payerMemberId,
      method,
      cadence,
      anchorDay,
    ]),
  });
  if (!r.ok) return { status: r.reason === "sin_permiso" || r.reason === "no_disponible" ? "refused" : "error", summary: r.reason === "sin_permiso" ? "No tienes permiso para esto en ese grupo." : r.reason === "no_disponible" ? "Esa función aún no está disponible en producción." : "No pude crear el gasto recurrente ahora." };
  ctx.dirty = true;
  return { status: "done", summary: `Listo, agendé "${description}" (${amount} ${stated}${stated !== household.baseCurrency ? ` ≈ ${amountBase} ${household.baseCurrency}` : ""}, ${cadence === "monthly" ? "mensual" : cadence}) como gasto compartido recurrente en "${household.name}". Es un recordatorio: el dinero real lo registramos cada ciclo (no se cuenta doble). Confírmalo breve.` };
}

async function executeLogRecurringSharedExpense(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const hint = typeof args.description === "string" ? args.description.trim().toLowerCase() : "";
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿En cuál grupo?" };
  if (!household) return { status: "needs_info", summary: "No encuentro el grupo." };
  const recurringRead = await readRecurringSharedExpenses(ctx.userId, household.id);
  if (!recurringRead.ok || !recurringRead.complete) {
    return {
      status: "error",
      summary:
        "No pude probar que leí completos los gastos compartidos recurrentes. No registré ningún ciclo.",
    };
  }
  const recurring = recurringRead.rows;
  const match = resolveExplicitOrSingle(
    recurring,
    hint,
    (row) => row.description,
  );
  if (!match) return { status: "needs_info", summary: recurring.length === 0 ? "No hay gastos recurrentes guardados en ese grupo." : `¿Cuál registro? Tienes: ${recurring.map((x) => x.description).join(", ")}.` };
  const r = await logRecurringSharedExpense(
    ctx.userId,
    household.id,
    match.id,
    householdActionDedupe(ctx, "household-recurring-log", [
      household.id,
      match.id,
    ]),
  );
  if (!r.ok) return { status: r.reason === "sin_permiso" ? "refused" : "error", summary: r.reason === "sin_permiso" ? "No tienes permiso para esto en ese grupo." : "No pude registrar este ciclo ahora." };
  ctx.dirty = true;
  return { status: "done", summary: `Registré "${match.description}" (${match.amountBase}) de este ciclo en "${household.name}", repartido en el grupo. Contado una sola vez. Si lo pagaste de tu bolsillo, tu gasto personal va aparte con log_movement. Confírmalo simple y neutral.` };
}

async function executeSettleHousehold(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿Cuál grupo cerramos?" };
  if (!household) return { status: "needs_info", summary: "No encuentro el grupo." };
  const r = await settleHousehold(
    ctx.userId,
    household.id,
    args.archive === true,
    householdActionDedupe(ctx, "settle", [
      household.id,
      args.archive === true,
    ]),
  );
  if (!r.ok) {
    if (r.reason === "solo_owner_admin") return { status: "refused", summary: "Solo quien administra el grupo puede cerrar las cuentas." };
    // 40001 de la RPC: alguien registró un gasto o pago MIENTRAS cerrábamos — nada
    // se escribió (la transacción entera revirtió); reintentar recalcula.
    if (r.reason === "cambio_en_el_medio") return { status: "needs_info", summary: "Justo mientras cerraba las cuentas alguien registró un gasto o un pago nuevo en el grupo, así que NO escribí nada para no cobrar de más. Dile que lo reintente y lo recalculo con lo último." };
    return { status: "error", summary: "No pude cerrar las cuentas ahora; no quedó nada a medias. Ofrécele reintentar." };
  }
  const n = settledCountFromRpcData(r.data);
  if (n == null) {
    return {
      status: "error",
      summary:
        "El cierre no devolvió una confirmación válida. No afirmes que quedó cuadrado; ofrece releer y reintentar.",
    };
  }
  ctx.dirty = true;
  const replayed =
    (r.data as { replayed?: boolean } | undefined)?.replayed === true;
  return {
    status: "done",
    effect:
      replayed || (n === 0 && args.archive !== true) ? "noop" : "wrote",
    summary: replayed
      ? `Ese cierre de "${household.name}" ya estaba aplicado por esta misma solicitud; no repetí reembolsos.`
      : n === 0
        ? `Las cuentas de "${household.name}" ya estaban cuadradas; nada que cerrar.`
        : `Listo, registré ${n} reembolso(s) y quedaron a mano en "${household.name}"${args.archive === true ? " (lo archivé)" : ""}. Un reembolso NO es ingreso. Confírmalo neutral y cálido.`,
  };
}

async function executeHouseholdVisibilityExplainer(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const hi = buildHouseholdIntelligence({
    households: ctx.households ?? [],
    nowMs: Date.now(),
  });
  if (!hi.hasHousehold) return { status: "done", summary: "El usuario no tiene grupos todavía. Explica en general que, si crea uno, los demás solo verían lo compartido (gastos compartidos, saldos por cuadrar, metas compartidas) y NUNCA sus cuentas, su Saldo ni sus deudas personales." };
  const hint = typeof args.householdName === "string" ? args.householdName : "";
  const view = resolveExplicitOrSingle(
    hi.households,
    hint,
    (row) => row.name,
  );
  if (!view) {
    return {
      status: "needs_info",
      summary:
        `No encuentro ese grupo. Tiene: ${hi.households.map((row) => `"${row.name}"`).join(", ")}. Pregúntale cuál.`,
    };
  }
  return { status: "done", summary: `Explícaselo claro y tranquilizador: ${householdVisibilityExplainer(view)}` };
}

// ── Stage 24 — household CONTROL executors (edit/cancel/remove/share/unshare +
//    data export). Permission stays in the store; here we resolve names → ids,
//    enforce the confirm-before-destructive convention, and translate the
//    store's refusal codes into honest, human Spanish (never technical codes).
function matchSharedExpenses(h: LoadedHousehold, hint: string): { candidates: LoadedSharedExpense[]; exact: boolean } {
  const list = [...h.expenses].sort((a, b) => b.occurredAtMs - a.occurredAtMs).slice(0, 20);
  const n = hint.trim().toLowerCase();
  if (!n) return { candidates: list, exact: false };
  const exact = list.filter((e) => e.description.trim().toLowerCase() === n);
  if (exact.length) return { candidates: exact, exact: true };
  return { candidates: list.filter((e) => e.description.toLowerCase().includes(n)), exact: false };
}

function sharedExpenseLabel(e: LoadedSharedExpense): string {
  const day = e.occurredAtMs > 0 ? new Date(e.occurredAtMs).toISOString().slice(0, 10) : "";
  return `id=${e.id} "${e.description}" ${e.totalBase}${day ? ` (${day})` : ""}${e.status === "settled" ? " [ya saldado]" : ""}`;
}

// Resolve ONE shared expense from a hint/exact id, or return the needs_info that
// lets the agent disambiguate by id (same list-then-act-by-id convention as
// list_recent_movements → undo_movement).
function resolveSharedExpense(household: LoadedHousehold, args: Record<string, unknown>): { target: LoadedSharedExpense; exact: boolean } | ToolResult {
  const id = typeof args.expenseId === "string" ? args.expenseId.trim() : "";
  if (id) {
    const byId = household.expenses.find((e) => e.id === id);
    if (!byId) return { status: "needs_info", summary: "No encuentro ese gasto compartido; vuelve a resolverlo por su descripción." };
    return { target: byId, exact: true };
  }
  const hint = typeof args.expense === "string" ? args.expense : "";
  const m = matchSharedExpenses(household, hint);
  if (m.candidates.length === 0) {
    const recent = matchSharedExpenses(household, "").candidates.slice(0, 5).map(sharedExpenseLabel).join("; ");
    return { status: "needs_info", summary: recent ? `No encuentro un gasto compartido que suene a eso en "${household.name}". Recientes: ${recent}. Pregunta cuál es y re-llama con expenseId.` : `No hay gastos compartidos registrados en "${household.name}".` };
  }
  if (m.candidates.length > 1) {
    return { status: "needs_info", summary: `Hay varias coincidencias en "${household.name}". Muéstrale las opciones al usuario (descripción, monto y fecha, sin ids) y re-llama con el expenseId del que elija: ${m.candidates.slice(0, 5).map(sharedExpenseLabel).join("; ")}` };
  }
  return { target: m.candidates[0], exact: m.exact };
}

async function executeEditSharedExpense(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const newAmount = typeof args.newAmount === "number" ? args.newAmount : undefined;
  const newDescription = typeof args.newDescription === "string" && args.newDescription.trim() ? args.newDescription.trim() : undefined;
  if (newAmount === undefined && !newDescription) return { status: "needs_info", summary: "¿Qué le cambio al gasto compartido: el monto o la descripción?" };
  if (newAmount !== undefined && !(newAmount > 0)) return { status: "needs_info", summary: "El monto corregido tiene que ser mayor a cero. ¿Cuál es?" };
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿En cuál grupo está ese gasto compartido?" };
  if (!household) return { status: "done", effect: "noop", summary: "El usuario no tiene grupos/hogar todavía, así que no hay gastos compartidos que editar. Dilo simple." };
  const resolved = resolveSharedExpense(household, args);
  if (!("target" in resolved)) return resolved;
  const { target, exact } = resolved;
  // Fuzzy match + money change ALWAYS asks once — confirm alone doesn't count;
  // the re-call must come back with the exact expenseId (structural guard, not
  // model discipline).
  if (newAmount !== undefined && !exact) {
    return { status: "needs_info", summary: `Encontré ${sharedExpenseLabel(target)} en "${household.name}". Antes de mover dinero compartido, pregúntale si es ESE gasto y, si dice que sí, vuelve a llamar edit_shared_expense con expenseId=${target.id} y confirm=true.` };
  }
  const r = await updateSharedExpense(
    ctx.userId,
    household.id,
    target.id,
    { totalBase: newAmount, description: newDescription },
    householdActionDedupe(ctx, "edit-shared-expense", [
      household.id,
      target.id,
      newAmount ?? null,
      newDescription ?? null,
    ]),
  );
  if (!r.ok) {
    if (r.reason === "sin_permiso") return { status: "refused", summary: "No tienes permiso para editar gastos en ese grupo." };
    const why =
      r.reason === "ya_saldado"
        ? `Ese gasto ("${target.description}") ya quedó saldado entre todos, así que no lo edito — moverlo descuadraría lo que ya pagaron. Si el monto real fue otro, ofrécele registrar un AJUSTE: un gasto compartido nuevo por la diferencia (add_shared_expense). Explícalo honesto y sin drama.`
        : r.reason === "split_personalizado"
          ? `Ese gasto tiene una división personalizada, así que no puedo repartir el nuevo monto por mi cuenta. Pregúntale cuánto le toca a cada quien; con eso se cancela y se registra de nuevo bien (cancel_shared_expense + add_shared_expense).`
          : r.reason === "ya_hay_pagos"
            ? `Alguien del grupo ya pagó su parte de ese gasto, así que no muevo los montos solos (se perdería lo que ya puso). Explícaselo tranquilo: primero cuadren ese pago, o registra un ajuste aparte por la diferencia.`
            : r.reason === "gasto_no_existe"
              ? "Ese gasto compartido ya no existe (quizá se canceló). Nada cambió."
              : r.reason === "monto_invalido"
                ? "El monto tiene que ser mayor a cero. ¿Cuál es el correcto?"
                : "No pude editar el gasto compartido ahora; ofrécele reintentar.";
    // Policy refusals are 'refused', infra failures 'error' — never 'done', so
    // the agent loop doesn't count a non-write as a successful write.
    const status =
      r.reason === "monto_invalido"
        ? ("needs_info" as const)
        : r.reason === "ya_saldado" || r.reason === "split_personalizado" || r.reason === "ya_hay_pagos" || r.reason === "gasto_no_existe"
          ? ("refused" as const)
          : ("error" as const);
    return { status, summary: why };
  }
  ctx.dirty = true;
  const replayed =
    (r.data as { replayed?: boolean } | undefined)?.replayed === true;
  const changed = [newAmount !== undefined ? `el monto a ${newAmount}` : null, newDescription ? `la descripción a "${newDescription}"` : null].filter(Boolean).join(" y ");
  return {
    status: "done",
    effect: replayed ? "noop" : "wrote",
    summary: replayed
      ? `Esa edición de "${target.description}" ya estaba aplicada por esta misma solicitud; no volví a modificar el gasto compartido.`
      : `Listo, corregí ${changed} del gasto compartido "${target.description}" en "${household.name}".${newAmount !== undefined ? " Recalculé las partes iguales de cada quien." : ""} OJO: esto NO toca el movimiento personal del usuario — si el gasto de su bolsillo también estaba mal, corrígelo aparte con correct_movement. Confírmalo simple y neutral.`,
  };
}

async function executeCancelSharedExpense(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿En cuál grupo está ese gasto compartido?" };
  if (!household) return { status: "done", effect: "noop", summary: "El usuario no tiene grupos/hogar todavía, así que no hay gastos compartidos que cancelar. Dilo simple." };
  const resolved = resolveSharedExpense(household, args);
  if (!("target" in resolved)) return resolved;
  const { target } = resolved;
  // Structural confirm: only honored together with the exact expenseId from a
  // prior round — a first-call confirm=true on a fuzzy hint never executes.
  const hasExactId = typeof args.expenseId === "string" && args.expenseId.trim().length > 0;
  if (args.confirm !== true || !hasExactId) {
    return { status: "needs_info", summary: `Encontré ${sharedExpenseLabel(target)} en "${household.name}". Es una operación destructiva: pregúntale si lo cancelo (deja de contar en quién debe a quién; queda en el historial del grupo) y, si dice que sí, vuelve a llamar cancel_shared_expense con expenseId=${target.id} y confirm=true.` };
  }
  const r = await cancelSharedExpense(
    ctx.userId,
    household.id,
    target.id,
    householdActionDedupe(ctx, "cancel-shared-expense", [
      household.id,
      target.id,
    ]),
  );
  if (!r.ok) return { status: r.reason === "sin_permiso" ? "refused" : "error", summary: r.reason === "sin_permiso" ? "No tienes permiso para cancelar gastos en ese grupo." : "No pude cancelar el gasto compartido ahora; ofrécele reintentar." };
  ctx.dirty = true;
  const replayed =
    (r.data as { replayed?: boolean } | undefined)?.replayed === true;
  return {
    status: "done",
    effect: replayed ? "noop" : "wrote",
    summary: replayed
      ? `Ese gasto compartido ya estaba cancelado por esta misma solicitud; no repetí el cambio.`
      : `Listo, cancelé el gasto compartido "${target.description}" (${target.totalBase}) en "${household.name}": ya no cuenta en los saldos del grupo y queda en el historial como cancelado. Si el usuario también lo tenía como gasto personal, ESE movimiento sigue igual (se corrige aparte si hace falta). Confírmalo breve y neutral.`,
  };
}

async function executeRemoveHouseholdMember(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) return { status: "needs_info", summary: "¿A quién saco del grupo?" };
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿De cuál grupo lo saco?" };
  if (!household) return { status: "done", effect: "noop", summary: "El usuario no tiene grupos/hogar; no hay de dónde sacar a nadie." };
  const memberId = resolveMemberId(household, name);
  if (!memberId) {
    const actives = household.members.filter((m) => m.status === "active" && m.memberId !== household.selfMemberId).map((m) => m.displayName).join(", ");
    return { status: "needs_info", summary: `No reconozco a "${name}" en "${household.name}".${actives ? ` Miembros: ${actives}.` : ""} ¿A quién se refiere?` };
  }
  if (memberId === household.selfMemberId) return { status: "needs_info", summary: "Se refiere a sí mismo: para salir del grupo lo correcto es leave_household, no sacarse. Pregúntale si quiere salirse él del grupo." };
  const member = household.members.find((m) => m.memberId === memberId);
  const displayName = member?.displayName ?? name;
  if (args.confirm !== true) {
    // Surface the member's pending balance BEFORE removal: expelling someone
    // who still owes (or is owed) silently breaks the group's settle-up math.
    let balanceWarning = "";
    try {
      const settlement = computeSettlement({
        // Todos los miembros: el saldo de uno removido/inactivo también cuenta
        // (re-auditoría 3, punto 4 — la obligación sobrevive a la membresía).
        members: household.members.map((m) => ({ memberId: m.memberId, displayName: m.displayName })),
        expenses: household.expenses.filter((e) => e.status !== "cancelled").map((e) => ({ payerMemberId: e.payerMemberId, totalBase: e.totalBase, splits: e.splits.map((s) => ({ memberId: s.memberId, shareBase: s.shareBase })) })),
        settlements: household.settlements,
      });
      const net = settlement.balances.find((b) => b.memberId === memberId)?.netBase ?? 0;
      if (Math.abs(net) >= 0.01) {
        balanceWarning =
          net < 0
            ? `IMPORTANTE — dile esto tal cual ANTES de preguntar: ${displayName} todavía debe ${money(Math.abs(net), household.baseCurrency as CurrencyCode)} al grupo. Sacarlo NO borra esa deuda (sigue contando en el cuadre), pero lo sano es cuadrarla o marcarla pagada antes. `
            : `IMPORTANTE — dile esto tal cual ANTES de preguntar: el grupo todavía le debe ${money(net, household.baseCurrency as CurrencyCode)} a ${displayName}. Sacarlo NO borra ese saldo (sigue contando en el cuadre), pero lo sano es cuadrarlo antes. `;
      }
    } catch {
      return {
        status: "error",
        summary:
          "No pude comprobar el saldo pendiente de esa persona. No la saqué ni pedí confirmar a ciegas; reintenta.",
      };
    }
    return { status: "needs_info", summary: `${balanceWarning}Vas a sacar a ${displayName} de "${household.name}". Sus gastos compartidos ya registrados se CONSERVAN en el historial del grupo (por si cierran cuentas); solo deja de ser miembro activo. Es una decisión delicada: pregúntale si está seguro y, si dice que sí, vuelve a llamar remove_household_member con confirm=true.` };
  }
  const r = await removeMember(
    ctx.userId,
    household.id,
    memberId,
    householdActionDedupe(ctx, "remove-member", [
      household.id,
      memberId,
    ]),
  );
  if (!r.ok) {
    if (r.reason === "solo_owner_admin") return { status: "refused", summary: "Solo el dueño o un admin del grupo puede sacar a alguien, y el usuario no tiene ese permiso aquí. Díselo honesto y sin drama." };
    if (r.reason === "no_puedes_sacar_al_dueno") return { status: "refused", summary: "Esa persona es quien creó el grupo (dueño) y no se puede sacar. Si el grupo ya no va, que el dueño lo cierre o cada quien se sale con leave_household." };
    if (r.reason === "solo_owner_saca_admin") return { status: "refused", summary: "Esa persona es admin del grupo: solo el dueño puede sacar a un admin. Díselo honesto." };
    if (r.reason === "usa_leave") return { status: "needs_info", summary: "Es él mismo: para salirse del grupo usa leave_household. Pregúntale si eso quiere." };
    return { status: "error", summary: "No pude sacarlo del grupo ahora; ofrécele reintentar." };
  }
  ctx.dirty = true;
  const replayed =
    (r.data as { replayed?: boolean } | undefined)?.replayed === true;
  return {
    status: "done",
    effect: replayed ? "noop" : "wrote",
    summary: replayed
      ? `${displayName} ya había sido removido de "${household.name}" por esta misma solicitud; no repetí el cambio.`
      : `Listo, ${displayName} ya no es miembro activo de "${household.name}". Lo que compartió queda en el historial del grupo por si necesitan cerrar cuentas. Confírmalo breve y neutral, sin drama.`,
  };
}

async function executeRemoveRecurringShared(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const hint = typeof args.description === "string" ? args.description.trim().toLowerCase() : "";
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿En cuál grupo está ese gasto recurrente?" };
  if (!household) return { status: "done", effect: "noop", summary: "El usuario no tiene grupos/hogar; no hay gastos compartidos recurrentes que quitar." };
  const recurringRead = await readRecurringSharedExpenses(ctx.userId, household.id);
  if (!recurringRead.ok || !recurringRead.complete) {
    return {
      status: "error",
      summary:
        "No pude probar que leí completos los gastos compartidos recurrentes. No quité ninguno.",
    };
  }
  const recurring = recurringRead.rows;
  const matches = hint ? recurring.filter((x) => x.description.toLowerCase().includes(hint)) : recurring;
  const match = matches.length === 1 ? matches[0] : null;
  if (!match) {
    if (recurring.length === 0) return { status: "done", effect: "noop", summary: `No hay gastos compartidos recurrentes guardados en "${household.name}".` };
    return { status: "needs_info", summary: `¿Cuál quito? En "${household.name}" hay: ${recurring.map((x) => `${x.description} (${x.amountBase}, ${x.cadence === "monthly" ? "mensual" : x.cadence})`).join(", ")}.` };
  }
  if (args.confirm !== true) {
    return { status: "needs_info", summary: `Voy a dejar de agendar "${match.description}" (${match.amountBase}, ${match.cadence === "monthly" ? "mensual" : match.cadence}) como gasto compartido recurrente en "${household.name}"; los ciclos ya registrados se conservan. Pregúntale si está seguro y, si dice que sí, vuelve a llamar remove_recurring_shared_expense con confirm=true.` };
  }
  const r = await removeRecurringSharedExpense(
    ctx.userId,
    household.id,
    match.id,
    householdActionDedupe(ctx, "remove-recurring-shared", [
      household.id,
      match.id,
    ]),
  );
  if (!r.ok) return { status: r.reason === "sin_permiso" ? "refused" : "error", summary: r.reason === "sin_permiso" ? "No tienes permiso para esto en ese grupo." : "No pude quitarlo ahora; ofrécele reintentar." };
  ctx.dirty = true;
  const replayed =
    (r.data as { replayed?: boolean } | undefined)?.replayed === true;
  return {
    status: "done",
    effect: replayed ? "noop" : "wrote",
    summary: replayed
      ? `Ese recurrente ya estaba desactivado por esta misma solicitud; no repetí el cambio.`
      : `Listo, "${match.description}" ya no se agenda como gasto compartido recurrente en "${household.name}". Lo ya registrado no cambia; si algún mes lo vuelven a compartir, se registra ese ciclo aparte. Confírmalo breve.`,
  };
}

async function executeShareMovement(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿En cuál grupo comparto ese gasto?" };
  if (!household) return { status: "needs_info", summary: "El usuario no tiene hogar/grupo todavía y para compartir un gasto necesita uno. Ofrécele crearlo natural ('¿Quieres que arme tu hogar primero?') y, si acepta, usa create_household y luego vuelve a share_movement." };
  const actives = household.members.filter((m) => m.status === "active");
  if (actives.length < 2) return { status: "needs_info", summary: `En "${household.name}" solo está el usuario por ahora: agrega a la otra persona primero (add_household_participant si no usa Kipu, o household_invite_link) y luego comparto el gasto.` };
  const recent = await readCompleteRecentForTool(ctx.userId, {
    windowHours: 30 * 24,
  });
  if (!recent) {
    return {
      status: "error",
      summary:
        "No pude probar que leí completos tus movimientos recientes. No compartí ninguno ni afirmé que no hubiera gastos.",
    };
  }
  const txs = recent.transactions.filter((t) => t.type === "expense" && !recent.reversedOriginalIds.has(t.id));
  const txLabel = (t: StoredTransaction) => `id=${t.id} ${t.description} ${money(t.originalAmount, t.originalCurrency)} (${sourceLabel(t, ctx.accounts, ctx.debtAccounts)}, ${t.occurredAt.slice(0, 10)})`;
  const txId = typeof args.transactionId === "string" ? args.transactionId.trim() : "";
  const hint = typeof args.hint === "string" ? args.hint.trim().toLowerCase() : "";
  let tx: StoredTransaction | null = null;
  if (txId) {
    tx = txs.find((t) => t.id === txId) ?? null;
    if (!tx) return { status: "needs_info", summary: "No encuentro ese movimiento entre los recientes; llama list_recent_movements y usa el id correcto." };
  } else {
    if (!hint) return { status: "needs_info", summary: txs.length ? `¿Cuál gasto era compartido? Recientes: ${txs.slice(0, 5).map(txLabel).join("; ")}. Pregunta cuál y re-llama con transactionId.` : "No hay gastos personales recientes para compartir." };
    const matches = txs.filter((t) => t.description.toLowerCase().includes(hint));
    if (matches.length === 0) return { status: "needs_info", summary: `No encuentro un gasto reciente (últimos ~30 días) que suene a eso. Recientes: ${txs.slice(0, 5).map(txLabel).join("; ") || "ninguno"}. Pregunta cuál es y re-llama con transactionId.` };
    if (matches.length > 1) return { status: "needs_info", summary: `Varias coincidencias. Muéstrale las opciones (descripción, monto, fuente y fecha, sin ids) y re-llama con el transactionId del que elija: ${matches.slice(0, 5).map(txLabel).join("; ")}` };
    tx = matches[0];
  }
  try {
    // Dup guard across ALL the user's groups — the same personal movement shared
    // twice (aunque sea en otro hogar) double-counts who-owes-whom.
    const supabase = createSupabaseAdminClient();
    const allHouseholds = ctx.households ?? [];
    const myHouseholdIds = allHouseholds.map((h) => h.id);
    const { data, error } = await supabase
      .from("shared_expenses")
      .select("id, household_id")
      .in("household_id", myHouseholdIds.length ? myHouseholdIds : [household.id])
      .eq("origin_transaction_id", tx.id)
      .neq("status", "cancelled")
      .limit(1);
    if (error) {
      return {
        status: "error",
        summary:
          "No pude comprobar si ese movimiento ya estaba compartido. No lo dupliqué; reintenta.",
      };
    }
    if (data && data.length > 0) {
      const otherId = String((data[0] as Record<string, unknown>).household_id);
      const other = allHouseholds.find((h) => h.id === otherId);
      const where = other && other.id !== household.id ? ` en "${other.name}" (otro grupo)` : ` en "${household.name}"`;
      return { status: "refused", summary: `Ese movimiento (${tx.description} ${money(tx.originalAmount, tx.originalCurrency)}) YA está compartido${where}; no lo duplico. Si quiere moverlo de grupo, primero unshare_movement allá. Díselo simple.` };
    }
  } catch {
    return {
      status: "error",
      summary:
        "No pude comprobar si ese movimiento ya estaba compartido. No lo dupliqué; reintenta.",
    };
  }
  // Honest FX: the shared ledger stores the household's base. Reuse the ledger's
  // own conversion when it matches; otherwise a known user rate; never invent one.
  let totalBase = tx.originalAmount;
  if (tx.originalCurrency !== household.baseCurrency) {
    if (tx.baseCurrency === household.baseCurrency) totalBase = tx.baseAmount;
    else {
      const res = convertFx(tx.originalAmount, tx.originalCurrency, household.baseCurrency, ctx.fxRates ?? []);
      if (!res.ok) return { status: "needs_info", summary: `Ese gasto está en ${tx.originalCurrency} y el grupo lleva sus cuentas en ${household.baseCurrency}; dime a cuánto está el cambio (o guárdalo con set_exchange_rate) y lo comparto bien.` };
      totalBase = res.baseAmount;
    }
  }
  const occurredMs = new Date(tx.occurredAt).getTime();
  const r = await addSharedExpense(ctx.userId, household.id, {
    description: tx.description, totalBase, originalAmount: tx.originalAmount, originalCurrency: tx.originalCurrency,
    baseCurrency: household.baseCurrency, category: tx.category || undefined, method: "equal",
    participants: actives.map((m) => ({ memberId: m.memberId })), payerMemberId: household.selfMemberId,
    originTransactionId: tx.id, occurredAtMs: Number.isFinite(occurredMs) ? occurredMs : undefined,
    dedupeKey: householdActionDedupe(ctx, "share-movement", [
      household.id,
      tx.id,
    ]),
  });
  if (!r.ok) return { status: r.reason === "sin_permiso" ? "refused" : "error", summary: r.reason === "sin_permiso" ? "No tienes permiso para registrar gastos en ese grupo." : "No pude compartir ese gasto ahora; ofrécele reintentar." };
  ctx.dirty = true;
  const sharedData = r.data as
    | {
        shares?: { memberId: string; shareBase: number }[];
        replayed?: boolean;
      }
    | undefined;
  const replayed = sharedData?.replayed === true;
  const shares = sharedData?.shares ?? [];
  const nameOf = (id: string) => household.members.find((m) => m.memberId === id)?.displayName ?? "alguien";
  const breakdown = shares.filter((s) => s.shareBase > 0).map((s) => `${nameOf(s.memberId)} ${s.shareBase}`).join(", ");
  return {
    status: "done",
    effect: replayed ? "noop" : "wrote",
    summary: replayed
      ? `Ese movimiento ya estaba compartido por esta misma solicitud; no dupliqué el gasto del grupo.`
      : `Listo: marqué "${tx.description}" (${money(tx.originalAmount, tx.originalCurrency)}) como compartido en "${household.name}", en partes iguales: ${breakdown}. El movimiento personal del usuario queda IGUAL (su Saldo ya lo reflejaba); esto solo registra la verdad compartida — los demás le deben su parte, contada una sola vez, y el reembolso que reciba después NO es ingreso. Dilo simple y neutral.`,
  };
}

async function executeUnshareMovement(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const { household, many } = await resolveHousehold(ctx, typeof args.householdName === "string" ? args.householdName : undefined);
  if (many) return { status: "needs_info", summary: "¿En cuál grupo estaba compartido ese gasto?" };
  if (!household) return { status: "done", effect: "noop", summary: "El usuario no tiene grupos/hogar; no hay nada compartido que deshacer." };
  // origin_transaction_id is not part of the loaded household snapshot; read the
  // linked rows directly (read-only, scoped to a household the user belongs to).
  let linked: { id: string; description: string; totalBase: number; originTransactionId: string }[] = [];
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.from("shared_expenses").select("id, description, total_base, origin_transaction_id").eq("household_id", household.id).neq("status", "cancelled").not("origin_transaction_id", "is", null).order("occurred_at", { ascending: false }).limit(31);
    if (error || !data) {
      return {
        status: "error",
        summary:
          "No pude leer los gastos vinculados de forma completa. No deshice nada; reintenta.",
      };
    }
    if (data.length > 30) {
      return {
        status: "error",
        summary:
          "Hay más gastos vinculados de los que puedo resolver con certeza en una sola lectura. No deshice nada; usa el movimiento exacto.",
      };
    }
    linked = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id), description: String(row.description ?? ""), totalBase: Number(row.total_base ?? 0), originTransactionId: String(row.origin_transaction_id),
    }));
  } catch {
    return {
      status: "error",
      summary:
        "No pude leer los gastos vinculados. No afirmé que no hubiera ninguno ni deshice nada.",
    };
  }
  if (linked.length === 0) return { status: "done", effect: "noop", summary: `En "${household.name}" no hay gastos compartidos que vengan de un movimiento personal. Si quiere quitar un gasto compartido normal, usa cancel_shared_expense.` };
  const txId = typeof args.transactionId === "string" ? args.transactionId.trim() : "";
  const hint = typeof args.hint === "string" ? args.hint.trim().toLowerCase() : "";
  let matches = linked;
  if (txId) matches = linked.filter((l) => l.originTransactionId === txId);
  else if (hint) matches = linked.filter((l) => l.description.toLowerCase().includes(hint));
  const linkedLabel = (l: { description: string; totalBase: number; originTransactionId: string }) => `"${l.description}" ${l.totalBase} (transactionId=${l.originTransactionId})`;
  if (matches.length === 0) return { status: "needs_info", summary: `No encuentro cuál. Compartidos desde un movimiento personal en "${household.name}": ${linked.slice(0, 5).map(linkedLabel).join("; ")}. Pregunta cuál es y re-llama con transactionId.` };
  if (matches.length > 1) return { status: "needs_info", summary: `Varias coincidencias. Muéstrale las opciones (descripción y monto, sin ids) y re-llama con el transactionId del que elija: ${matches.slice(0, 5).map(linkedLabel).join("; ")}` };
  const target = matches[0];
  // Structural confirm: only honored together with the exact transactionId
  // from a prior round — a first-call confirm=true on a hint never executes.
  const hasTxId = typeof args.transactionId === "string" && args.transactionId.trim().length > 0;
  if (args.confirm !== true || !hasTxId) {
    return { status: "needs_info", summary: `Encontré "${target.description}" (${target.totalBase}) compartido en "${household.name}". Pregúntale si lo dejo como gasto SOLO suyo (se cancela la parte compartida; su movimiento personal no cambia) y, si dice que sí, vuelve a llamar unshare_movement con transactionId=${target.originTransactionId} y confirm=true.` };
  }
  const r = await cancelSharedExpense(
    ctx.userId,
    household.id,
    target.id,
    householdActionDedupe(ctx, "unshare-movement", [
      household.id,
      target.id,
      target.originTransactionId,
    ]),
  );
  if (!r.ok) return { status: r.reason === "sin_permiso" ? "refused" : "error", summary: r.reason === "sin_permiso" ? "No tienes permiso para esto en ese grupo." : "No pude deshacerlo ahora; ofrécele reintentar." };
  ctx.dirty = true;
  const replayed =
    (r.data as { replayed?: boolean } | undefined)?.replayed === true;
  return {
    status: "done",
    effect: replayed ? "noop" : "wrote",
    summary: replayed
      ? `Ese movimiento ya había dejado de estar compartido por esta misma solicitud; no repetí el cambio.`
      : `Listo, "${target.description}" dejó de ser compartido en "${household.name}": ya no cuenta en quién debe a quién (queda en el historial como cancelado). El movimiento personal del usuario quedó intacto — su Saldo no cambia. Confírmalo simple y neutral.`,
  };
}

// Read-only data-export summary: cheap counts + the real download in Ajustes.
// Never generates a file in chat.
async function executeExportMyData(ctx: AgentContext): Promise<ToolResult> {
  const accounts = ctx.accounts.filter((a) => !a.isGoalAccount).length;
  const cards = ctx.debtAccounts.length;
  const goals = ctx.goals.length;
  let movements: number;
  let fixed: number;
  let incomes: number;
  try {
    const supabase = createSupabaseAdminClient();
    const [tx, fe, inc] = await Promise.all([
      supabase.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId),
      supabase.from("fixed_expenses").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId).eq("is_active", true),
      supabase.from("income_sources").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId),
    ]);
    if (
      tx.error ||
      fe.error ||
      inc.error ||
      tx.count == null ||
      fe.count == null ||
      inc.count == null
    ) {
      return {
        status: "error",
        summary:
          "No pude verificar los conteos de tu exportación y no voy a presentar una lectura parcial como si estuviera completa. Reintenta.",
      };
    }
    movements = tx.count;
    fixed = fe.count;
    incomes = inc.count;
  } catch {
    return {
      status: "error",
      summary:
        "No pude verificar los conteos de tu exportación y no voy a presentar una lectura parcial como si estuviera completa. Reintenta.",
    };
  }
  return {
    status: "done",
    summary:
      `Datos financieros verificados en Kipu: ${accounts} cuenta(s), ${cards} tarjeta(s)/deuda(s), ${movements} movimiento(s), ${goals} meta(s), ${fixed} gasto(s) fijo(s) activo(s), ${incomes} fuente(s) de ingreso. ` +
      `La descarga del NÚCLEO FINANCIERO (perfil, cuentas, ingresos, gastos fijos, deudas, metas, presupuestos, movimientos y pagos programados) está en Ajustes → "Descargar mis datos financieros (JSON)": /app/settings/export. ` +
      "No la llames exportación total: no incluye mensajes del chat ni registros técnicos internos. NO generes archivos ni pegues datos crudos en el chat.",
  };
}

// ── Stage 20 — personality / life-philosophy test executors. The result drives
//    REAL personalization (philosophy/risk/detail/nudge) via the existing setters,
//    applied as EXPLICIT prefs; a later explicit change by the user still wins.
async function executeGetPersonalityTest(): Promise<ToolResult> {
  const qs = getPersonalityQuestions();
  const lines = qs.map((q) => `${q.id}: ${q.prompt} — opciones: ${q.options.map((o) => `[${o.id}] ${o.label}`).join(" | ")}`).join("\n");
  return {
    status: "done",
    summary: `Test de Kipu (preséntalo divertido y ligero, "para conocerte mejor y adaptarme a ti", NO como diagnóstico; puede saltarlo cuando quiera). Hazle las preguntas de a una o dos, natural, y junta sus respuestas como {questionId, optionId}; al final llama submit_personality_test. Preguntas:\n${lines}`,
  };
}

async function executeSubmitPersonalityTest(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const raw = Array.isArray(args.answers) ? (args.answers as Record<string, unknown>[]) : [];
  const answers: TestAnswer[] = raw.filter((a) => typeof a.questionId === "string" && typeof a.optionId === "string").map((a) => ({ questionId: a.questionId as string, optionId: a.optionId as string }));
  if (answers.length === 0) return { status: "needs_info", summary: "Aún no tengo respuestas del test; hazle las preguntas de get_personality_test primero." };
  const result = scorePersonalityTest(answers);
  const prefs = mapTestToPersonalization(result);
  // These setters are individually idempotent but span several preference
  // tables. Do not narrate "applied" if one silently failed: a partial result is
  // observable and safe to retry, never a green success.
  const writes: boolean[] = [];
  if (prefs.financialPhilosophy) writes.push(await setPersonalizationPref(ctx.userId, { financialPhilosophy: prefs.financialPhilosophy }));
  if (prefs.nudgeSensitivity) writes.push(await setPersonalizationPref(ctx.userId, { nudgeSensitivity: prefs.nudgeSensitivity }));
  if (prefs.onboardingMode) writes.push(await setPersonalizationPref(ctx.userId, { onboardingMode: prefs.onboardingMode }));
  if (prefs.riskTolerance) writes.push(await setGoalPrefs(ctx.userId, { riskTolerance: prefs.riskTolerance }));
  if (prefs.tone || prefs.detailLevel) writes.push(await setCommunicationPref(ctx.userId, { tone: prefs.tone, detailLevel: prefs.detailLevel }));
  writes.push(await savePersonalityResult(ctx.userId, result));
  ctx.dirty = true;
  if (writes.some((ok) => !ok)) {
    return {
      status: "error",
      effect: writes.some(Boolean) ? "wrote" : undefined,
      summary:
        "Una parte de la personalización del test pudo quedar guardada, pero no pude probar que aterrizara completa. No la doy por terminada; es seguro reintentar el envío de las mismas respuestas.",
    };
  }
  await logPreferenceEvent(ctx.userId, "personality_test", result.archetype);
  const how = prefs.financialPhilosophy === "experiences" ? "voy a cuidar que disfrutes tu dinero sin presionarte a ahorrar" : prefs.financialPhilosophy === "wealth" ? "te voy a ayudar a construir patrimonio y seré menos permisivo con lo discrecional" : prefs.financialPhilosophy === "builder" ? "priorizo el avance de tus metas con equilibrio" : "mantengo el equilibrio entre disfrutar y construir";
  return {
    status: "done",
    summary: `Resultado: ${result.archetypeLabel} (confianza ${result.confidence}). Dilo CÁLIDO y humano, sin números ni etiquetas internas: cuéntale su arquetipo en una frase y que a partir de esto ${how}. Nunca cambia la verdad de su dinero ni sus mínimos, y puede ajustar o resetear cualquier cosa cuando quiera (el test es opcional). Confírmalo simple.`,
  };
}

async function executePersonalityTestResult(ctx: AgentContext): Promise<ToolResult> {
  const read = await readPersonalityResult(ctx.userId);
  if (!read.ok) {
    return {
      status: "error",
      summary:
        "No pude leer el resultado del test ahora. No afirmes que el usuario no lo hizo ni inventes un resultado; ofrece reintentar.",
    };
  }
  if (!read.found) return { status: "done", summary: "El usuario aún no ha hecho el test. Si tiene sentido, ofréceselo simple y sin presión (es opcional y divertido); no insistas." };
  const r = read.result;
  return { status: "done", summary: `Su arquetipo guardado: ${r.archetypeLabel} (confianza ${r.confidence}). Dilo humano y cálido, sin etiquetas internas ni números; recuérdale que puede rehacerlo o cambiar sus preferencias cuando quiera.` };
}

async function executeResetPersonalityTest(ctx: AgentContext): Promise<ToolResult> {
  const ok = await deletePersonalityResult(ctx.userId);
  if (!ok) return { status: "error", summary: "No pude borrar el test ahora; ofrécele reintentar." };
  await logPreferenceEvent(ctx.userId, "personality_test_reset", null);
  ctx.dirty = true;
  return { status: "done", summary: "Listo, olvidé el resultado del test. Tus preferencias actuales siguen como están (si quieres también las reinicio con reset_personalization_preference). Confírmalo breve." };
}

// ── Stage 20 — FX executors. Kipu uses ONLY a rate the user confirmed; it never
//    fabricates one (if missing, it asks).
export interface SetExchangeRateDeps {
  upsertFxRate: typeof upsertFxRate;
  setFxAutoRefresh: typeof setFxAutoRefresh;
}

export async function executeSetExchangeRateWith(
  args: Record<string, unknown>,
  ctx: AgentContext,
  deps: SetExchangeRateDeps,
): Promise<ToolResult> {
  const from = typeof args.from === "string" ? args.from.trim().toUpperCase() : "";
  const to = typeof args.to === "string" ? args.to.trim().toUpperCase() : "";
  const rate = typeof args.rate === "number" ? args.rate : NaN;
  if (from.length !== 3 || to.length !== 3 || !Number.isFinite(rate) || rate <= 0) return { status: "needs_info", summary: "Dame la tasa clara: de qué moneda a qué moneda y cuánto (ej. 1 USD = 4000 COP)." };
  const wantsAuto = args.autoRefresh === true;
  const isArs = (from === "USD" && to === "ARS") || (from === "ARS" && to === "USD");
  if (wantsAuto && !isArs) {
    return {
      status: "needs_info",
      summary:
        `Puedo guardar 1 ${from} = ${rate} ${to} como tasa fija, pero hoy no tengo una fuente automática confiable para ese par. ` +
        "No guardé nada todavía: pregunta si la deja fija.",
    };
  }
  const ok = await deps.upsertFxRate(ctx.userId, from, to, rate, "manual");
  if (!ok) return { status: "error", summary: "No pude guardar la tasa. Puedes usarla para esta explicación, pero no prometas que quedó disponible para futuros movimientos." };
  ctx.dirty = true;
  // S6 money-safety — a stated rate is a DELIBERATE value. Opt into the daily live
  // auto-refresh ONLY when the user explicitly asks (autoRefresh===true); ANY other case
  // (including re-stating a rate while auto was previously on) PINS this value, so the
  // cron never silently overwrites a rate the user just gave. We always set the flag so a
  // fresh statement can't leave a stale auto_refresh=true behind.
  const refreshStored = await deps.setFxAutoRefresh(
    ctx.userId,
    from,
    to,
    wantsAuto,
  );
  if (!refreshStored) {
    return {
      status: "error",
      effect: "wrote",
      summary:
        `La tasa 1 ${from} = ${rate} ${to} SÍ quedó guardada, pero no pude probar si quedó ${wantsAuto ? "automática" : "fija"}. No prometas ese modo; es seguro reintentar la misma solicitud.`,
    };
  }
  const autoNote = wantsAuto
    ? " La actualizo diariamente con la tasa de mercado (blue)."
    : " La dejo fija, pero si pasan varios días te pediré renovarla antes de usarla como valor actual.";
  return { status: "done", summary: `Guardé la tasa 1 ${from} = ${rate} ${to}.${autoNote} Confírmalo breve.` };
}

async function executeSetExchangeRate(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  return executeSetExchangeRateWith(args, ctx, {
    upsertFxRate,
    setFxAutoRefresh,
  });
}

async function executeConvertCurrency(args: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
  const amount = typeof args.amount === "number" ? args.amount : NaN;
  const from = typeof args.from === "string" ? args.from.trim().toUpperCase() : "";
  const to = typeof args.to === "string" ? args.to.trim().toUpperCase() : "";
  if (!Number.isFinite(amount) || from.length !== 3 || to.length !== 3) return { status: "needs_info", summary: "¿Cuánto y de qué moneda a qué moneda?" };
  // Cache-first: the user's manual rate wins; then the global reference cache; then a
  // live Frankfurter fetch (cached on success); else ask. Never invents a rate.
  const [manual, cached] = await Promise.all([readFxRates(ctx.userId).then((read) => usableCurrentRates(read)), loadLatestCachedRates(from, to)]);
  const res = await resolveRate(amount, from, to, { knownRates: [...manual, ...cached], provider: frankfurterProvider });
  if (res.fetched && res.ok && res.rateDate) await cacheProviderRate(from, to, res.rate, res.rateDate);
  if (!res.ok) return { status: "needs_info", summary: `No tengo la tasa ${from}→${to} (ni de referencia ni tuya). Pregúntale a cuánto la tiene (ej. "¿a cuánto está el ${from}?") y guárdala con set_exchange_rate; NUNCA la inventes.` };
  const kind = res.source === "manual" ? "la tasa que me diste" : res.source === "same" ? "" : "tasa de referencia (no la del banco; puede variar un poco)";
  return { status: "done", summary: `${amount} ${from} = ${res.baseAmount} ${to}${kind ? ` (${kind})` : ""}. Dilo simple y corto; no expliques de más ni la presentes como garantizada.` };
}

// Register a NEW card/debt from chat (e.g. a statement for an unregistered card),
// only after the user confirms. The created card is pushed into the live context
// so the SAME turn can update its obligations and import its movements by id —
// no FX is invented (base balance only set when the card is in the base currency).
export function resolveExistingInstrumentName<T extends { id: string; name: string }>(
  name: string,
  rows: T[],
): { exact: T | null; possible: T[] } {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  const wanted = normalize(name);
  if (!wanted) return { exact: null, possible: [] };
  const exact = rows.filter((row) => normalize(row.name) === wanted);
  if (exact.length === 1) return { exact: exact[0], possible: [] };
  const possible = rows.filter((row) => {
    const candidate = normalize(row.name);
    return candidate.includes(wanted) || wanted.includes(candidate);
  });
  return { exact: null, possible };
}

type AgentInstrumentRpc = (
  name: "kipu_create_account_idempotent" | "kipu_create_debt_account_idempotent",
  payload: { p: Record<string, unknown> },
) => PromiseLike<{ data: unknown; error: unknown }>;

export async function createAgentInstrumentWith(
  kind: "account" | "debt",
  payload: Record<string, unknown>,
  rpc: AgentInstrumentRpc,
): Promise<{ ok: true; id: string; replayed: boolean } | { ok: false }> {
  try {
    const { data, error } = await rpc(
      kind === "account"
        ? "kipu_create_account_idempotent"
        : "kipu_create_debt_account_idempotent",
      { p: payload },
    );
    const row = data as {
      outcome?: unknown;
      account_id?: unknown;
      debt_account_id?: unknown;
    } | null;
    const id =
      kind === "account" ? row?.account_id : row?.debt_account_id;
    if (
      error ||
      typeof id !== "string" ||
      !id ||
      (row?.outcome !== "created" && row?.outcome !== "replayed")
    ) {
      return { ok: false };
    }
    return { ok: true, id, replayed: row.outcome === "replayed" };
  } catch {
    return { ok: false };
  }
}

function agentInstrumentDedupe(
  ctx: AgentContext,
  kind: "account" | "debt",
  parts: unknown[],
): string {
  return householdActionDedupe(ctx, `create-${kind}`, parts);
}

async function executeCreateCard(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) return { status: "needs_info", summary: "¿Cómo se llama la tarjeta o deuda que agrego?" };
  // Idempotency: never create a SECOND card for one the user already has — a
  // resumable statement can drive create_card from two paths (chat answer +
  // re-upload). Reuse an existing card whose name matches (the live context is
  // reloaded each turn, so a card committed by a prior run is visible here).
  const existing = resolveExistingInstrumentName(name, ctx.debtAccounts);
  if (existing.exact) {
    return {
      status: "done",
      effect: "noop",
      summary: `Ya tienes esa tarjeta ("${existing.exact.name}", id=${existing.exact.id}); no creé otra. Si quieres usarla, continúa con esa tarjeta.`,
      data: {
        id: existing.exact.id,
        debtAccountId: existing.exact.id,
        name: existing.exact.name,
        currency: existing.exact.currency,
        noop: true,
      },
    };
  }
  if (existing.possible.length > 0) {
    return {
      status: "needs_info",
      summary: `Antes de crear "${name}", confirma si es una tarjeta nueva o si te refieres a ${existing.possible.map((row) => `"${row.name}"`).join(", ")}. No creé nada.`,
    };
  }
  const type = ["credit_card", "loan", "family_debt", "other_debt"].includes(args.kind as string)
    ? (args.kind as string)
    : "credit_card";
  const explicit =
    typeof args.currency === "string" && /^[A-Za-z]{3}$/.test(args.currency.trim())
      ? (args.currency.trim().toUpperCase() as CurrencyCode)
      : undefined;
  if (args.currency !== undefined && !explicit) {
    return {
      status: "needs_info",
      summary:
        "La moneda de la tarjeta debe ser un código ISO de 3 letras; no la creé en la moneda base por defecto.",
    };
  }
  const currency = explicit ?? ctx.baseCurrency;
  const nonNegativeMoney = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? toCents(n) : undefined;
  };
  const signedMoney = (v: unknown): number | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? toCents(n) : undefined;
  };
  const day = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 31 ? n : undefined;
  };
  const parsedBalance = signedMoney(args.currentBalance);
  if (args.currentBalance !== undefined && parsedBalance === undefined) {
    return {
      status: "needs_info",
      summary:
        "No entendí el saldo actual de la tarjeta; no lo convertí en cero ni creé la tarjeta.",
    };
  }
  const balance = parsedBalance ?? 0;
  const sameCur = currency === ctx.baseCurrency;
  const convertedBalance = sameCur
    ? { ok: true as const, baseAmount: balance }
    : convertFx(balance, currency, ctx.baseCurrency, ctx.fxRates ?? []);
  if (balance !== 0 && !convertedBalance.ok) {
    return {
      status: "needs_info",
      summary: `La tarjeta está en ${currency} y su saldo es ${balance} ${currency}, pero tu base es ${ctx.baseCurrency}. Necesito la tasa antes de crearla con un equivalente real; no guardé 0 ni inventé 1:1.`,
    };
  }
  const knownBase = convertedBalance.ok ? convertedBalance.baseAmount : 0;
  const minimum = nonNegativeMoney(args.minimumPayment);
  const fullDue = nonNegativeMoney(args.totalDueThisMonth);
  const dueDay = day(args.dueDay);
  const cutoffDay = day(args.cutoffDay);
  if (args.minimumPayment !== undefined && minimum === undefined) {
    return {
      status: "needs_info",
      summary:
        "El pago mínimo debe ser cero o un monto positivo; no creé la tarjeta con ese dato descartado.",
    };
  }
  if (args.totalDueThisMonth !== undefined && fullDue === undefined) {
    return {
      status: "needs_info",
      summary:
        "El pago total del mes debe ser cero o un monto positivo; no creé la tarjeta con ese dato descartado.",
    };
  }
  if (args.dueDay !== undefined && dueDay === undefined) {
    return {
      status: "needs_info",
      summary: "El día de pago debe estar entre 1 y 31; no creé la tarjeta.",
    };
  }
  if (args.cutoffDay !== undefined && cutoffDay === undefined) {
    return {
      status: "needs_info",
      summary: "El día de corte debe estar entre 1 y 31; no creé la tarjeta.",
    };
  }
  try {
    const supabase = createSupabaseAdminClient();
    const created = await createAgentInstrumentWith(
      "debt",
      {
        user_id: ctx.userId,
        dedupe_key: agentInstrumentDedupe(ctx, "debt", [
          name,
          type,
          currency,
          balance,
          knownBase,
          minimum ?? null,
          fullDue ?? null,
          dueDay ?? null,
          cutoffDay ?? null,
        ]),
        name,
        type,
        currency,
        base_currency: ctx.baseCurrency,
        current_balance_original: balance,
        current_balance_base: knownBase,
        minimum_payment: minimum ?? null,
        full_payment_due: fullDue ?? null,
        due_day: dueDay ?? null,
        cutoff_day: cutoffDay ?? null,
      },
      (rpcName, payload) => supabase.rpc(rpcName, payload),
    );
    if (!created.ok) {
      return {
        status: "error",
        summary:
          "No pude probar que la tarjeta y su identidad durable aterrizaran juntas; no afirmes que existe.",
      };
    }
    const id = created.id;
    // Make it usable THIS turn (obligations + imports) without a stale-context miss.
    ctx.debtAccounts.push({
      id,
      userId: ctx.userId,
      name,
      type: type as DebtAccount["type"],
      currency,
      currentBalanceOriginal: balance,
      currentBalanceBase: knownBase,
      minimumPayment: minimum,
      fullPaymentDue: fullDue,
      dueDay,
      cutoffDay,
      createdAt: new Date().toISOString(),
    } as DebtAccount);
    const note = !sameCur
      ? ` Está en ${currency} (≠ tu base ${ctx.baseCurrency}); su equivalente en base se ajusta con el tipo de cambio real, no inventado.`
      : "";
    return {
      status: "done",
      effect: created.replayed ? "noop" : "wrote",
      summary: created.replayed
        ? `Esa tarjeta ya se había creado por esta misma operación; reutilicé "${name}" (id=${id}) y no la dupliqué.`
        : `Creé la tarjeta "${name}" (id=${id}, ${currency})${balance ? `, saldo ${balance} ${currency}` : ""}. Ahora usa ESE id para update_card_obligations y para registrar los consumos/pagos del estado.${note}`,
      data: {
        id,
        debtAccountId: id,
        name,
        currency,
        replayed: created.replayed,
      },
    };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "create_card failed" };
  }
}

// Register a NEW account / payment method from chat (e.g. the source account of a
// statement payment the user wants to add), only after the user confirms. Pushed
// into the live context so the SAME turn can use it as a source. Idempotent by
// name (reuses an existing account instead of creating a duplicate).
async function executeCreateAccount(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) return { status: "needs_info", summary: "¿Cómo se llama la cuenta que agrego?" };
  const existing = resolveExistingInstrumentName(name, ctx.accounts);
  if (existing.exact) {
    return {
      status: "done",
      effect: "noop",
      summary: `Ya tienes esa cuenta ("${existing.exact.name}", id=${existing.exact.id}); no creé otra.`,
      data: {
        id: existing.exact.id,
        accountId: existing.exact.id,
        name: existing.exact.name,
        currency: existing.exact.currency,
        noop: true,
      },
    };
  }
  if (existing.possible.length > 0) {
    return {
      status: "needs_info",
      summary: `Antes de crear "${name}", confirma si es una cuenta nueva o si te refieres a ${existing.possible.map((row) => `"${row.name}"`).join(", ")}. No creé nada.`,
    };
  }
  const type = ["bank", "cash", "wallet"].includes(args.kind as string) ? (args.kind as string) : "bank";
  const explicit =
    typeof args.currency === "string" && /^[A-Za-z]{3}$/.test(args.currency.trim())
      ? (args.currency.trim().toUpperCase() as CurrencyCode)
      : undefined;
  if (args.currency !== undefined && !explicit) {
    return {
      status: "needs_info",
      summary:
        "La moneda de la cuenta debe ser un código ISO de 3 letras; no la creé en la moneda base por defecto.",
    };
  }
  const currency = explicit ?? ctx.baseCurrency;
  const n = Number(args.currentBalance);
  const balance =
    args.currentBalance === undefined || args.currentBalance === null
      ? 0
      : Number.isFinite(n)
        ? toCents(n)
        : NaN;
  if (!Number.isFinite(balance)) {
    return {
      status: "needs_info",
      summary: `No entendí el saldo inicial de "${name}". Dime el monto o déjalo sin saldo para empezar en 0.`,
    };
  }
  const sameCur = currency === ctx.baseCurrency;
  const convertedBalance = sameCur
    ? { ok: true as const, baseAmount: balance }
    : convertFx(balance, currency, ctx.baseCurrency, ctx.fxRates ?? []);
  if (balance !== 0 && !convertedBalance.ok) {
    return {
      status: "needs_info",
      summary: `La cuenta está en ${currency} y su saldo es ${balance} ${currency}, pero tu base es ${ctx.baseCurrency}. Necesito la tasa antes de crearla con un equivalente real; no guardé 0 ni inventé 1:1.`,
    };
  }
  const knownBase = convertedBalance.ok ? convertedBalance.baseAmount : 0;
  try {
    const supabase = createSupabaseAdminClient();
    const created = await createAgentInstrumentWith(
      "account",
      {
        user_id: ctx.userId,
        dedupe_key: agentInstrumentDedupe(ctx, "account", [
          name,
          type,
          currency,
          balance,
          knownBase,
        ]),
        name,
        type,
        currency,
        base_currency: ctx.baseCurrency,
        current_balance_original: balance,
        current_balance_base: knownBase,
      },
      (rpcName, payload) => supabase.rpc(rpcName, payload),
    );
    if (!created.ok) {
      return {
        status: "error",
        summary:
          "No pude probar que la cuenta y su identidad durable aterrizaran juntas; no afirmes que existe.",
      };
    }
    const id = created.id;
    ctx.accounts.push({
      id,
      userId: ctx.userId,
      name,
      type: type as Account["type"],
      currency,
      currentBalanceOriginal: balance,
      currentBalanceBase: knownBase,
      isGoalAccount: false,
      createdAt: new Date().toISOString(),
    } as Account);
    return {
      status: "done",
      effect: created.replayed ? "noop" : "wrote",
      summary: created.replayed
        ? `Esa cuenta ya se había creado por esta misma operación; reutilicé "${name}" (id=${id}) y no la dupliqué.`
        : `Creé la cuenta "${name}" (id=${id}, ${currency})${balance ? `, saldo ${balance} ${currency}` : ""}. Ya puedes usarla como origen de un pago en este mismo turno.`,
      data: {
        id,
        accountId: id,
        name,
        currency,
        replayed: created.replayed,
      },
    };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "create_account failed" };
  }
}

async function executePlanReserveWithdrawal(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { status: "needs_info", summary: "¿Cuánto necesitas juntar?" };
  // The dispatcher refreshes and validates the complete Saldo + treasury map
  // before entering this executor.
  const treasury = ctx.briefing?.treasury;
  const sk = ctx.briefing?.margenKipu?.saldo;
  if (
    !sk ||
    !Number.isFinite(sk.saldo) ||
    !Number.isFinite(sk.reserva)
  ) {
    return {
      status: "error",
      summary:
        "No pude probar el Saldo y la Reserva que necesita este plan. No fabriqué ceros ni propuse movimientos; reintenta.",
    };
  }
  if (!treasury || treasury.accounts.length < 2) {
    // Distinguish a REAL mono-account user from a briefing that failed to build
    // the map — never fabricate "todo vive en una sola cuenta" for a multi-account user.
    const liquid = ctx.accounts.filter((a) => !a.isGoalAccount && a.liquidity !== "non_liquid");
    if (liquid.length >= 2) {
      return { status: "error", summary: "No pude armar el mapa de cuentas en este momento — dile al usuario que lo intente de nuevo en un momento; NO inventes dónde está su plata." };
    }
    return { status: "done", summary: "Toda su plata líquida vive en una sola cuenta — no hay movimientos que planear; puede usarla directo. Recuerda avisar el cruce de capa si el monto supera su Saldo." };
  }
  const plan = planWithdrawal(treasury, {
    amount,
    destinationAccountId: String(args.destinationAccountId ?? ""),
    saldo: sk.saldo,
    reserva: sk.reserva,
  });
  if (!plan) return { status: "needs_info", summary: "¿A qué cuenta necesitas llevar la plata? Usa el id de una de sus cuentas." };
  const base = ctx.baseCurrency;
  const homes = treasury.layerHomes.map((h) => `${money(h.amount, base)} en ${h.name}`).join(", ") || "sin plata libre hoy";
  const movesTxt = plan.moves.length
    ? plan.moves.map((m) => `mover ${money(m.amount, base)} de ${m.fromName} a ${m.toName}${m.crossesCurrency ? " (cruza moneda — el monto exacto depende del tipo de cambio del día)" : ""}`).join("; ")
    : "ningún movimiento (ya está donde lo necesita)";
  const layerTxt =
    plan.layerCrossed === "reserva"
      ? " OJO: este monto supera su Saldo — cruza a la capa RESERVA (avísalo claro, sin bloquear)."
      : plan.layerCrossed === "beyond_reserva"
        ? " OJO: este monto supera Saldo + Reserva — la parte faltante saldría de capas peores (vender inversión / deuda). Avísalo claro, sin bloquear."
        : "";
  const shortTxt = plan.shortfall > 0 ? ` FALTAN ${money(plan.shortfall, base)} que sus cuentas líquidas no cubren sin romper sus pisos operativos.` : "";
  return {
    status: "done",
    summary: `PLAN (solo recomendación, NO muevas dinero tú): su plata libre vive así: ${homes}. En ${plan.destinationName} ya hay ${money(plan.alreadyThere, base)} libres. Para juntar ${money(plan.targetAmount, base)}: ${movesTxt}.${shortTxt}${layerTxt} Los pisos operativos y los movimientos urgentes ya pendientes quedan respetados (el plan solo toca plata realmente libre). Cuando el usuario confirme que hizo un movimiento, regístralo con transfer_between_accounts.`,
    data: plan,
  };
}

export interface TransferExecutorDeps {
  applyFxTransfer: typeof applyFxTransfer;
}

export async function executeTransferWith(
  args: Record<string, unknown>,
  ctx: AgentContext,
  deps: TransferExecutorDeps,
): Promise<ToolResult> {
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { status: "needs_info", summary: "Transfer needs a valid amount." };
  const source = ctx.accounts.find((a) => a.id === args.sourceAccountId);
  const destination = ctx.accounts.find((a) => a.id === args.destinationAccountId);
  if (!source || !destination) return { status: "needs_info", summary: "Transfer needs a known source and destination account." };
  if (source.id === destination.id) return { status: "refused", summary: "Source and destination are the same account." };
  // Cross-currency uses two native legs. A normal `transfer` applies ONE
  // original amount to both accounts and would turn (say) 1,500,000 ARS into
  // 1,500,000 USD. Migration 088 commits two single-sided adjustments plus a
  // durable group under one operation id, so neither side can land alone.
  if (source.currency !== destination.currency) {
    const receivedAmount = Number(args.receivedAmount);
    if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) {
      return {
        status: "needs_info",
        summary:
          `${source.name} está en ${source.currency} y ${destination.name} en ${destination.currency}. ` +
          `¿Cuánto salió exactamente de ${source.name} y cuánto entró exactamente en ${destination.name}? ` +
          "Necesito las dos patas; no registré una sola a medias.",
      };
    }
    if (!ctx.operationId) {
      return {
        status: "error",
        summary:
          "No pude probar la identidad de esta entrega. No moví ninguna de las dos patas; reintenta.",
      };
    }
    // A turn may contain more than one exchange. The raw turn operation id is
    // therefore only a namespace; include both native legs and the per-turn
    // occurrence so distinct transfers do not collide, while a redelivery
    // reconstructs the same identities in the same order.
    const fxOperationId = dedupeKeyFor(ctx, {
      type: `fx_transfer:${destination.currency}:${Math.round(receivedAmount * 100)}`,
      amount,
      currency: source.currency,
      sourceAccountId: source.id,
      destinationAccountId: destination.id,
    });
    if (!fxOperationId) {
      return {
        status: "error",
        summary:
          "No pude construir una identidad estable para las dos patas. No moví nada; reintenta.",
      };
    }
    const sourceResolution = resolveAgentMovementCurrency(ctx, {
      instruments: [source.currency],
    });
    const destinationResolution = resolveAgentMovementCurrency(ctx, {
      instruments: [destination.currency],
    });
    if (!sourceResolution.ok || !destinationResolution.ok) {
      return {
        status: "needs_info",
        summary:
          `Tengo los dos montos, pero no una valuación confiable de ${source.currency}/${destination.currency} contra ${ctx.baseCurrency}. ` +
          "Guarda primero la tasa con set_exchange_rate y reintenta; no escribí ninguna pata.",
      };
    }
    try {
      const result = await deps.applyFxTransfer({
        userId: ctx.userId,
        operationId: fxOperationId,
        sourceAccountId: source.id,
        destinationAccountId: destination.id,
        sourceAmount: amount,
        sourceCurrency: source.currency,
        sourceRateToBase: sourceResolution.resolution.exchangeRateToBase,
        destinationAmount: receivedAmount,
        destinationCurrency: destination.currency,
        destinationRateToBase:
          destinationResolution.resolution.exchangeRateToBase,
        baseCurrency: ctx.baseCurrency,
        description: String(args.description ?? "Cambio entre cuentas"),
        channel: ctx.channel,
        rawInput: ctx.rawMessage,
      });
      ctx.dirty = true;
      return {
        status: "done",
        effect: result.replayed ? "noop" : "wrote",
        data: {
          operationId: result.operationId,
          transactionIds: result.transactionIds,
        },
        summary: result.replayed
          ? result.status === "reversed"
            ? "Ese cambio entre cuentas ya existía, pero después fue revertido. No lo reapliqué ni moví una sola pata."
            : "Ese cambio entre cuentas ya estaba registrado con la misma identidad; no lo apliqué dos veces."
          : `Listo: salieron ${money(amount, source.currency)} de ${source.name} y entraron ${money(receivedAmount, destination.currency)} en ${destination.name}, juntos en una sola operación. No es gasto ni ingreso y no toca tu Saldo.`,
      };
    } catch (error) {
      return {
        status: "error",
        summary:
          error instanceof Error
            ? error.message
            : "No pude registrar el cambio entre cuentas; ninguna pata quedó a medias.",
      };
    }
  }
  const cr = resolveAgentMovementCurrency(ctx, {
    instruments: [source.currency],
  });
  if (!cr.ok) {
    return { status: "needs_info", summary: cr.reason === "fx_unavailable" ? `Esa transferencia está en ${cr.original}, distinta a tu moneda base ${cr.base}; necesito un tipo de cambio confiable para reflejarla. Dímelo o la vemos aparte.` : "¿En qué moneda es la transferencia?" };
  }
  try {
    const intent: TransferIntent = { type: "transfer", description: String(args.description ?? "Movimiento entre cuentas"), category: "other", originalAmount: amount, originalCurrency: cr.resolution.original, baseCurrency: cr.resolution.base, exchangeRateToBase: cr.resolution.exchangeRateToBase, confidenceScore: 0.9, status: "ready", sourceAccountId: source.id, destinationAccountId: destination.id };
    const applied = await applyAgentChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId, dedupeKey: dedupeKeyFor(ctx, { type: "transfer", amount, currency: cr.resolution.original, sourceAccountId: source.id, destinationAccountId: destination.id }) });
    return {
      status: "done",
      data: { transactionIds: applied.financialWriteReceipt?.transactionIds ?? [] },
      summary: `Transferred ${amount} from ${source.name} to ${destination.name} (not spending/income).`,
    };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "transfer failed" };
  }
}

async function executeTransfer(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  return executeTransferWith(args, ctx, { applyFxTransfer });
}

async function readCompleteRecentForTool(
  userId: string,
  options: { windowHours?: number } = {},
): Promise<RecentTransactions | null> {
  const read = await readRecentTransactionsForCorrection(userId, options);
  return read.ok && read.complete ? read.recent : null;
}

const MEMORY_SEARCH_STOP_WORDS = new Set([
  "a",
  "al",
  "con",
  "de",
  "del",
  "el",
  "en",
  "la",
  "las",
  "lo",
  "los",
  "mi",
  "mis",
  "para",
  "por",
  "que",
  "un",
  "una",
  "y",
]);

function normalizedMemorySearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Search the complete in-turn memory catalog rather than a second capped DB
 * read. `buildUserFinancialContext` requests CAP+1 and throws on overflow, so
 * production can only set `userContextNotesAvailable=true` when this array is
 * complete. Matching is intentionally evidence retrieval, not intent routing:
 * the planner has already understood the request and supplies its concepts. */
async function executeSearchLearnedMemory(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (query.length < 2) {
    return {
      status: "needs_info",
      summary:
        "La búsqueda de memoria necesita una persona, entidad, preferencia o concepto concreto.",
    };
  }
  if (
    ctx.userContextNotesAvailable !== true ||
    !Array.isArray(ctx.userContextNotes)
  ) {
    return {
      status: "error",
      summary:
        "No pude leer de forma completa la memoria aprendida. No asumí que el dato nunca se hubiera guardado; reintenta.",
      data: {
        query,
        catalogReadProven: false,
        complete: false,
        matches: [],
      },
    };
  }
  const normalizedQuery = normalizedMemorySearchText(query);
  const tokens = [...new Set(normalizedQuery.split(" "))].filter(
    (token) => token.length >= 2 && !MEMORY_SEARCH_STOP_WORDS.has(token),
  );
  if (!normalizedQuery || tokens.length === 0) {
    return {
      status: "needs_info",
      summary:
        "La búsqueda de memoria necesita conceptos más específicos.",
    };
  }
  const requestedLimit = Number(args.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 50)
    : 20;
  const matches = ctx.userContextNotes
    .filter((note) => note.isActive)
    .map((note) => {
      const searchable = normalizedMemorySearchText(
        `${note.noteType} ${note.source} ${note.content}`,
      );
      const matchedTokens = tokens.filter((token) => searchable.includes(token));
      const exact = searchable.includes(normalizedQuery);
      return {
        note,
        exact,
        matchedTokens,
        score:
          (exact ? 100 : 0) +
          matchedTokens.length * 10 +
          (matchedTokens.length === tokens.length ? 25 : 0),
      };
    })
    .filter((row) => row.exact || row.matchedTokens.length > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.note.createdAt.localeCompare(left.note.createdAt),
    );
  const returned = matches.slice(0, limit).map(({ note, matchedTokens }) => ({
    id: note.id,
    kind: note.noteType,
    source: note.source,
    content: note.content,
    createdAt: note.createdAt,
    matchedConcepts: matchedTokens,
  }));
  const complete = matches.length <= limit;
  return {
    status: "done",
    summary:
      returned.length > 0
        ? `Encontré ${returned.length} recuerdos relevantes en el catálogo completo. ${complete ? "Devolví todas las coincidencias para este criterio." : "Hay más coincidencias: estos resultados prueban presencia, no ausencia."}`
        : "No encontré coincidencias para esos conceptos dentro del catálogo completo de memoria activa. Esto sólo prueba el criterio buscado, no sinónimos que no se hayan consultado.",
    data: {
      query,
      catalogReadProven: true,
      complete,
      searchedActiveNotes: ctx.userContextNotes.filter((note) => note.isActive)
        .length,
      totalMatches: matches.length,
      matches: returned,
    },
  };
}

async function executeListOpenReceivables(ctx: AgentContext): Promise<ToolResult> {
  const read = await readOpenReceivables(ctx.userId);
  if (!moneyReadPublishable(read)) {
    return {
      status: "error",
      summary:
        "No pude leer de forma completa los préstamos por cobrar. No asumí que no existan; reintenta antes de planificar una devolución.",
      data: { readProven: false, complete: false, receivables: [] },
    };
  }
  return {
    status: "done",
    summary: read.receivables.length
      ? `Encontré ${read.receivables.length} préstamo${read.receivables.length === 1 ? "" : "s"} por cobrar abierto${read.receivables.length === 1 ? "" : "s"}.`
      : "La lectura completa no encontró préstamos por cobrar abiertos.",
    data: {
      readProven: true,
      complete: true,
      receivables: read.receivables.map((row) => ({
        id: row.id,
        counterparty: row.counterparty,
        outstandingAmount: row.outstandingAmount,
        currency: row.currency,
        reason: row.reason,
        status: row.status,
      })),
    },
  };
}

async function executeSearchConversationHistory(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const before = typeof args.before === "string" ? args.before.trim() : "";
  const after = typeof args.after === "string" ? args.after.trim() : "";
  if (!query && !before && !after) {
    return {
      status: "needs_info",
      summary:
        "Para buscar en la conversación necesito conceptos concretos o un intervalo de fechas. No consulté una página arbitraria del historial.",
    };
  }
  const beforeMs = before ? Date.parse(before) : null;
  const afterMs = after ? Date.parse(after) : null;
  if (
    (before && !Number.isFinite(beforeMs)) ||
    (after && !Number.isFinite(afterMs)) ||
    (beforeMs != null && afterMs != null && afterMs >= beforeMs)
  ) {
    return {
      status: "needs_info",
      summary:
        "El intervalo del historial no es válido: usa timestamps ISO y deja after antes de before. No hice una lectura que pudiera fingir ausencia.",
    };
  }
  const read = await searchConversationArchive({
    userId: ctx.userId,
    query,
    before: before || null,
    after: after || null,
    limit: Number.isFinite(Number(args.limit)) ? Number(args.limit) : 30,
  });
  if (!read.ok) {
    return {
      status: "error",
      summary:
        "No pude buscar de forma confiable en el historial completo. No asumí que ese dato nunca se hubiera dicho; reintenta.",
    };
  }
  const messages = read.messages.map((message) => ({
    id: message.id,
    channel: message.channel,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  }));
  return {
    status: "done",
    summary:
      messages.length > 0
        ? `Encontré ${messages.length} turnos que coinciden. La búsqueda fue ${read.complete ? "completa para este criterio" : "topada: estos resultados prueban presencia, no ausencia"}.`
        : read.complete
          ? "No encontré turnos que coincidan con ese criterio en el historial durable."
          : "La búsqueda no devolvió coincidencias dentro de una lectura topada; no prueba ausencia.",
    data: {
      query: query || null,
      before: before || null,
      after: after || null,
      complete: read.complete,
      asOf: read.asOf,
      messages,
    },
  };
}

async function executeListRecent(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);
  const recent = await readCompleteRecentForTool(ctx.userId);
  if (!recent) {
    return {
      status: "error",
      summary:
        "No pude probar que leí completos tus movimientos recientes. No afirmé que no hubiera ninguno; reintenta.",
    };
  }
  const fxDestinationByRef = new Map(
    recent.transactions
      .filter(
        (t) =>
          t.type === "adjustment" &&
          t.destinationAccountId &&
          t.externalRef?.startsWith("fx-transfer:"),
      )
      .map((t) => [t.externalRef!, t]),
  );
  const items = recent.transactions
    .filter(
      (t) =>
        t.type !== "reversal" &&
        (t.type !== "adjustment" ||
          (!!t.sourceAccountId &&
            t.externalRef?.startsWith("fx-transfer:"))),
    )
    .slice(0, limit)
    .map((t, i) => {
      const fxDestination = t.externalRef
        ? fxDestinationByRef.get(t.externalRef)
        : undefined;
      return {
        ref: i + 1,
        id: t.id,
        type: fxDestination ? "exchange" : t.type,
        description: t.description,
        amount: t.originalAmount,
        currency: t.originalCurrency,
        destinationAmount: fxDestination?.originalAmount ?? null,
        destinationCurrency: fxDestination?.originalCurrency ?? null,
        source: sourceLabel(t, ctx.accounts, ctx.debtAccounts),
        when: t.occurredAt,
        reversed: recent.reversedOriginalIds.has(t.id),
      };
    });
  if (items.length === 0) {
    return { status: "done", summary: "Sin movimientos recientes." };
  }
  const lines = items
    .map(
      (it) =>
        `${it.ref}. id=${it.id} | ${it.description} ${money(it.amount, it.currency)}${it.destinationAmount != null && it.destinationCurrency ? ` → ${money(it.destinationAmount, it.destinationCurrency)}` : ""} | ${it.source} | ${it.type}${it.reversed ? " | YA REVERTIDO" : ""}`,
    )
    .join("\n");
  return {
    status: "done",
    summary: `Movimientos recientes (más nuevo primero). Usa el id exacto para undo_movement/correct_movement:\n${lines}`,
    data: items,
  };
}

export async function executeListRecentAgentOperations(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const limit = Math.min(Math.max(Math.floor(Number(args.limit) || 12), 1), 20);
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const before = typeof args.before === "string" ? args.before.trim() : "";
  const after = typeof args.after === "string" ? args.after.trim() : "";
  const beforeMs = before ? Date.parse(before) : null;
  const afterMs = after ? Date.parse(after) : null;
  if (
    (before && !Number.isFinite(beforeMs)) ||
    (after && !Number.isFinite(afterMs)) ||
    (beforeMs != null && afterMs != null && afterMs >= beforeMs)
  ) {
    return {
      status: "needs_info",
      summary:
        "El intervalo de operaciones no es válido: usa timestamps ISO y deja after antes de before. No consulté una página arbitraria.",
    };
  }
  const read = await searchCompletedAgentOperations({
    userId: ctx.userId,
    query,
    before: before || null,
    after: after || null,
    limit,
  });
  if (!read.ok) {
    return {
      status: "error",
      summary:
        "No pude leer el historial durable de operaciones. No inferí una operación por cercanía ni deshice nada.",
    };
  }
  const mapCompletedOperation = (
    operation: (typeof read.operations)[number],
  ) => ({
    id: operation.id,
    request: operation.requestText,
    latestRequest: operation.latestRequestText,
    channel: operation.channel,
    completedAt: operation.completedAt,
    steps: operation.steps.map((step) => ({
      id: step.stepKey,
      capability: step.capability,
      status: step.status,
      arguments: step.arguments,
      result: step.result,
      affectedRefs: step.affectedRefs,
    })),
  });
  const operations = read.operations.map(mapCompletedOperation);
  // Muestra v25 (ME9): un query semántico exige que TODAS sus palabras
  // aparezcan en el texto durable. Un miss con scan completo prueba que esas
  // PALABRAS no coinciden — jamás que la operación no exista — y presentarlo
  // como «no hay operaciones» convirtió una paráfrasis en un reclamo falso de
  // ausencia y bloqueó el undo. El miss se declara como miss y degrada a
  // evidencia: las completadas recientes SIN filtrar, para que una sola
  // lectura baste para ver el trabajo real.
  const queryMissed = query.length > 0 && operations.length === 0 && read.complete;
  let recentUnfiltered: ReturnType<typeof mapCompletedOperation>[] = [];
  let recentUnfilteredComplete: boolean | null = null;
  if (queryMissed) {
    const recent = await readRecentCompletedAgentOperations(ctx.userId, limit);
    if (recent.ok) {
      recentUnfiltered = recent.operations.map(mapCompletedOperation);
      recentUnfilteredComplete = recent.complete;
    }
  }
  return {
    status: "done",
    summary:
      operations.length > 0
        ? `Encontré ${operations.length} operaciones completadas. La lectura fue ${read.complete ? "completa dentro del límite pedido" : "topada; prueba presencia, no ausencia"}. Usa el id de la operación exacta, no ids de movimientos sueltos.`
        : queryMissed
          ? recentUnfilteredComplete != null
            ? `Ninguna operación completada coincide con esas palabras exactas; eso prueba el FILTRO, no la ausencia. En recentUnfiltered van las ${recentUnfiltered.length} completadas más recientes sin filtrar: verifica ahí la operación exacta o busca con otras palabras del pedido original.`
            : "Ninguna operación completada coincide con esas palabras exactas y no pude leer las recientes sin filtrar. Eso NO prueba que la operación no exista: busca con otras palabras del pedido original."
          : read.complete
            ? "No hay operaciones completadas en este historial."
            : "No encontré una operación dentro de una lectura topada; eso no prueba que no exista.",
    data: {
      complete: read.complete,
      asOf: read.asOf,
      operations,
      // Veredicto TERNARIO (Codex v27): `false` afirma una negación y sólo es
      // legítimo con cero coincidencias sobre un scan COMPLETO. Una lectura
      // topada sin coincidencias observadas queda en `null` — el booleano no
      // puede contradecir la prosa que rehúsa inferir ausencia.
      queryMatched:
        query.length === 0
          ? null
          : operations.length > 0
            ? true
            : read.complete
              ? false
              : null,
      ...(queryMissed
        ? { recentUnfiltered, recentUnfilteredComplete }
        : {}),
    },
  };
}

async function executeUndoAgentOperation(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const targetOperationId =
    typeof args.targetOperationId === "string"
      ? args.targetOperationId.trim()
      : "";
  if (
    !targetOperationId ||
    !ctx.durableOperationId ||
    !ctx.durableOperationLeaseToken ||
    !ctx.activePlannedAction?.id
  ) {
    return {
      status: "error",
      summary:
        "No pude probar la identidad durable de la corrección y su operación objetivo. No deshice nada.",
    };
  }
  const reversed = await reverseAgentOperation({
    userId: ctx.userId,
    reversalOperationId: ctx.durableOperationId,
    targetOperationId,
    stepKey: ctx.activePlannedAction.id,
    leaseToken: ctx.durableOperationLeaseToken,
    message: ctx.rawMessage,
    channel: ctx.channel,
  });
  if (!reversed.ok) {
    return {
      status: reversed.reason === "write_failed" ? "error" : "needs_info",
      summary:
        reversed.reason === "conflict"
          ? "La operación cambió mientras intentaba corregirla. No deshice ninguna parte; vuelve a listar las operaciones y reintenta."
          : reversed.reason === "unsafe"
            ? "Esa operación no puede deshacerse completa con recibos reversibles probados. No deshice una parte aislada."
            : "No pude verificar el undo completo. La base revirtió el intento y no repetí la operación.",
      // Rama exacta del rechazo para QA/metadata durable. Sin esto, una
      // muestra roja no puede nombrar su causa después del cleanup (v27).
      data: {
        undoRefusal: reversed.reason,
        undoDetail: reversed.reason === "write_failed" ? null : reversed.detail ?? null,
        targetOperationId,
      },
    };
  }
  ctx.dirty = true;
  return {
    status: "done",
    effect: reversed.replayed ? "noop" : "wrote",
    operationStepReceipt: "writer",
    summary: reversed.replayed
      ? "Esa operación completa ya estaba deshecha; no moví nada otra vez."
      : "Deshice de forma atómica todos los movimientos reversibles de esa operación. La historia original y sus reversas quedaron auditables.",
    data: {
      targetOperationId: reversed.targetOperationId,
      affectedRefs: reversed.affectedRefs,
    },
  };
}

async function executeUndoMovement(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  if (typeof args.transactionId === "string" && args.transactionId) {
    const read = await readTransactionById(ctx.userId, args.transactionId);
    if (!read.ok) {
      return {
        status: "error",
        summary: "No pude leer ese movimiento con certeza; no revertí nada.",
      };
    }
    if (!read.found) {
      return { status: "needs_info", summary: "No encuentro ese id; vuelve a llamar list_recent_movements." };
    }
    const tx = read.transaction;
    if (
      tx.type === "adjustment" &&
      tx.externalRef?.startsWith("fx-transfer:")
    ) {
      try {
        const fx = await reverseFxTransferByTransaction({
          userId: ctx.userId,
          transactionId: tx.id,
          message: ctx.rawMessage,
          channel: ctx.channel,
        });
        if (!fx.matched) {
          return {
            status: "error",
            summary:
              "Ese movimiento parece un cambio entre monedas, pero no pude probar su grupo completo. No revertí una sola pata.",
          };
        }
        ctx.dirty = true;
        return {
          status: "done",
          effect: fx.alreadyReversed ? "noop" : "wrote",
          summary: fx.alreadyReversed
            ? "Ese cambio entre cuentas ya estaba revertido; no moví nada otra vez."
            : "Revertí juntas las dos patas del cambio entre cuentas. No quedó una moneda corregida y la otra no.",
        };
      } catch {
        return {
          status: "error",
          summary:
            "No pude revertir juntas las dos patas del cambio; no revertí una sola a medias.",
        };
      }
    }
    if (!isUndoEligible(tx, new Set(read.reversed ? [tx.id] : []))) {
      return { status: "done", effect: "noop", summary: `Ese movimiento (${tx.description} ${money(tx.originalAmount, tx.originalCurrency)}) ya estaba revertido o no se puede revertir; nada cambió.` };
    }
    try {
      const r = await reverseStoredTransaction({ userId: ctx.userId, transaction: tx, message: ctx.rawMessage, channel: ctx.channel });
      return { status: "done", effect: r.alreadyReversed ? "noop" : "wrote", summary: r.alreadyReversed ? "Ya estaba revertido; nada cambió." : `Revertí ${tx.description} ${money(tx.originalAmount, tx.originalCurrency)} (${sourceLabel(tx, ctx.accounts, ctx.debtAccounts)}); saldo restaurado.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : "undo failed";
      return /KIPU_NEEDS_INFO/.test(message)
        ? { status: "needs_info", summary: message.replace(/^.*KIPU_NEEDS_INFO:\s*/, "") }
        : { status: "error", summary: message };
    }
  }

  const recent = await readCompleteRecentForTool(ctx.userId);
  if (!recent) {
    return {
      status: "error",
      summary:
        "No pude probar que leí completos tus movimientos recientes. No revertí nada.",
      };
  }
  const rawHint = typeof args.hint === "string" ? args.hint.trim() : "";
  // `isUndoEligible` intentionally excludes individual FX legs. For an
  // unqualified "deshaz lo último", preserve the visible-operation semantics:
  // if the newest row belongs to an exchange, route that whole group instead
  // of silently skipping it and reversing an older movement.
  const newestVisible = recent.transactions.find((tx) => tx.type !== "reversal");
  if (
    !rawHint &&
    newestVisible?.type === "adjustment" &&
    newestVisible.externalRef?.startsWith("fx-transfer:")
  ) {
    return executeUndoMovement({ transactionId: newestVisible.id }, ctx);
  }
  const found = findUndoTarget(recent, rawHint);
  if (found.status === "none") {
    return { status: "needs_info", summary: "No hay un movimiento reciente elegible para deshacer." };
  }
  if (found.status === "ambiguous" && found.candidates) {
    const cands = found.candidates.map((t) => ({ id: t.id, description: t.description, amount: t.originalAmount, currency: t.originalCurrency, source: sourceLabel(t, ctx.accounts, ctx.debtAccounts) }));
    return {
      status: "needs_info",
      summary: `Varias coincidencias para esa pista. NO repitas la pista: muéstrale estas opciones (por su fuente) y luego llama undo_movement con el id exacto. Candidatos: ${cands.map((c) => `id=${c.id} ${c.description} ${money(c.amount, c.currency)} (${c.source})`).join("; ")}`,
      data: cands,
    };
  }
  if (!found.target) return { status: "error", summary: "No pude resolver el movimiento." };
  try {
    const r = await reverseStoredTransaction({ userId: ctx.userId, transaction: found.target, message: ctx.rawMessage, channel: ctx.channel });
    return { status: "done", effect: r.alreadyReversed ? "noop" : "wrote", summary: r.alreadyReversed ? "Ya estaba revertido; nada cambió." : `Revertí ${found.target.description} ${money(found.target.originalAmount, found.target.originalCurrency)}; saldo restaurado.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "undo failed";
    return /KIPU_NEEDS_INFO/.test(message)
      ? { status: "needs_info", summary: message.replace(/^.*KIPU_NEEDS_INFO:\s*/, "") }
      : { status: "error", summary: message };
  }
}

async function executeUndoRecent(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const count = Math.min(Math.max(Number(args.count) || 1, 1), 10);
  const recent = await readCompleteRecentForTool(ctx.userId);
  if (!recent) {
    return {
      status: "error",
      summary:
        "No pude probar que leí completo el grupo de movimientos a deshacer. No cambié ninguno.",
    };
  }
  const eligible = recent.transactions
    .filter((t) => isUndoEligible(t, recent.reversedOriginalIds))
    .slice(0, count);
  // Batch reversal is atomic only for independent transaction rows. An FX
  // exchange is a grouped operation with two legs and its own RPC. Refuse the
  // whole request instead of reversing one leg or silently skipping it and
  // undoing older rows.
  const newestVisible = recent.transactions
    .filter((tx) => tx.type !== "reversal")
    .slice(0, count);
  if (
    newestVisible.some(
      (tx) =>
        tx.type === "adjustment" &&
        tx.externalRef?.startsWith("fx-transfer:"),
    )
  ) {
    return {
      status: "needs_info",
      summary:
        "Entre esos movimientos hay un cambio entre dos monedas, que debe revertirse como una sola operación. No deshice nada: usa list_recent_movements y luego undo_movement con el id exacto del cambio.",
    };
  }
  if (eligible.length === 0) {
    return { status: "needs_info", summary: "No hay movimientos recientes elegibles para deshacer." };
  }
  try {
    const results = await reverseStoredTransactionsAtomically({
      userId: ctx.userId,
      transactionIds: eligible.map((tx) => tx.id),
      message: ctx.rawMessage,
      channel: ctx.channel,
    });
    const wrote = results.some((row) => !row.alreadyReversed);
    const labels = eligible.map((tx) => `${tx.description} ${money(tx.originalAmount, tx.originalCurrency)}`);
    return {
      status: "done",
      effect: wrote ? "wrote" : "noop",
      summary: wrote
        ? `Deshice juntos ${eligible.length} movimiento(s): ${labels.join(", ")}. Si uno no hubiera sido seguro, no se habría cambiado ninguno.`
        : "Esos movimientos ya estaban revertidos; nada cambió.",
      data: { count: eligible.length },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "batch undo failed";
    return /KIPU_NEEDS_INFO/.test(message)
      ? { status: "needs_info", summary: message.replace(/^.*KIPU_NEEDS_INFO:\s*/, "") }
      : {
          status: "error",
          summary: "No pude deshacer el grupo completo, así que no cambié ninguno. Reinténtalo en un momento.",
        };
  }
}

async function executeRemoveDuplicate(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  // Exact id given → reverse that copy (idempotent).
  if (typeof args.transactionId === "string" && args.transactionId) {
    const read = await readTransactionById(ctx.userId, args.transactionId);
    if (!read.ok) {
      return {
        status: "error",
        summary: "No pude leer esa copia con certeza; no quité nada.",
      };
    }
    if (!read.found) return { status: "needs_info", summary: "No encuentro ese id; llama list_recent_movements." };
    const tx = read.transaction;
    if (
      tx.type === "adjustment" &&
      tx.externalRef?.startsWith("fx-transfer:")
    ) {
      return {
        status: "refused",
        summary:
          "Esa fila es una pata de un cambio entre monedas, no una copia duplicada. No quité nada; si quieres deshacer el cambio completo usa undo_movement con ese id.",
      };
    }
    if (!isUndoEligible(tx, new Set(read.reversed ? [tx.id] : []))) {
      return { status: "done", effect: "noop", summary: "Esa copia ya estaba quitada; queda una sola." };
    }
    try {
      const reversed = await reverseStoredTransaction({
        userId: ctx.userId,
        transaction: tx,
        message: ctx.rawMessage,
        channel: ctx.channel,
      });
      return {
        status: "done",
        effect: reversed.alreadyReversed ? "noop" : "wrote",
        summary: reversed.alreadyReversed
          ? "Esa copia ya estaba quitada; queda una sola."
          : `Quité la copia repetida de ${tx.description} ${money(tx.originalAmount, tx.originalCurrency)} y dejé una.`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "remove_duplicate failed";
      return /KIPU_NEEDS_INFO/.test(message)
        ? { status: "needs_info", summary: message.replace(/^.*KIPU_NEEDS_INFO:\s*/, "") }
        : { status: "error", summary: message };
    }
  }

  const recent = await readCompleteRecentForTool(ctx.userId);
  if (!recent) {
    return {
      status: "error",
      summary:
        "No pude probar que leí completos los movimientos recientes. No quité ninguna copia.",
    };
  }
  const dup = findDuplicateCandidates(recent);
  if (dup.status === "none") {
    return { status: "needs_info", summary: "No veo dos movimientos iguales recientes. ¿Cuál era el repetido? (puedo listar los recientes)." };
  }
  if (dup.status === "ambiguous" && dup.pairs) {
    return {
      status: "needs_info",
      summary: `Hay varios pares parecidos. Muéstrale las opciones y quita por id. Pares: ${dup.pairs.map((p) => `quitar id=${p.remove.id} (${p.remove.description} ${money(p.remove.originalAmount, p.remove.originalCurrency)})`).join("; ")}`,
      data: dup.pairs,
    };
  }
  if (!dup.remove) return { status: "error", summary: "No pude resolver el duplicado." };
  try {
    const r = await reverseStoredTransaction({ userId: ctx.userId, transaction: dup.remove, message: ctx.rawMessage, channel: ctx.channel });
    return { status: "done", effect: r.alreadyReversed ? "noop" : "wrote", summary: r.alreadyReversed ? "Esa copia ya estaba quitada; queda una sola." : `Quité la copia repetida de ${dup.remove.description} ${money(dup.remove.originalAmount, dup.remove.originalCurrency)} y dejé una. Tu saldo ya no la cuenta dos veces.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "remove_duplicate failed";
    return /KIPU_NEEDS_INFO/.test(message)
      ? { status: "needs_info", summary: message.replace(/^.*KIPU_NEEDS_INFO:\s*/, "") }
      : { status: "error", summary: message };
  }
}

async function executeResolveObjectiveClose(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const destination =
    args.destination === "reservas" || args.destination === "meta" || args.destination === "deuda" || args.destination === "otro"
      ? String(args.destination)
      : "";
  if (!destination) return { status: "needs_info", summary: "¿A dónde va el sobrante? (reservas por defecto, o meta/deuda/otro)" };
  const explicitMonth = typeof args.month === "string" && /^\d{4}-\d{2}$/.test(args.month) ? args.month : null;
  const latestRead = await readLatestClose(ctx.userId);
  if (!latestRead.ok) {
    return { status: "refused", summary: "No pude leer el cierre mensual ahora, así que no registré ninguna decisión. Reinténtalo en un momento." };
  }
  const month = explicitMonth ?? latestRead.close?.month ?? null;
  if (!month) return { status: "needs_info", summary: "No encuentro un cierre de mes registrado todavía; el cierre llega al inicio de cada mes." };
  const resolved = await resolveMonthClose(ctx.userId, month, destination);
  if (!resolved.ok) {
    return { status: "refused", summary: "No pude guardar esa decisión ahora; no cambié el cierre. Reinténtalo en un momento." };
  }
  if (resolved.updated === 0) return { status: "needs_info", summary: `No hay cierre registrado para ${month}.` };
  return {
    status: "done",
    summary:
      destination === "reservas"
        ? `Anotado: el sobrante de ${month} se queda protegido en su Reserva (no hay que mover nada).`
        : `Anotado: el sobrante de ${month} va a ${destination}. OJO: esto solo REGISTRA la decisión — ejecuta el movimiento real con la herramienta correspondiente (meta → log_movement goal_contribution; deuda → register_card_payment) si el usuario quiere hacerlo ya.`,
  };
}

export interface CorrectMovementDeps {
  readTarget: (userId: string, transactionId: string) => Promise<TransactionByIdRead>;
  correctMetadata: typeof correctTransactionMetadata;
  correctReplacement: typeof correctTransactionByReplacement;
}

export async function executeCorrectMovementWith(
  args: Record<string, unknown>,
  ctx: AgentContext,
  deps: CorrectMovementDeps,
): Promise<ToolResult> {
  const id = typeof args.transactionId === "string" ? args.transactionId : "";
  if (!id) return { status: "needs_info", summary: "Falta el id; llama list_recent_movements." };
  const targetRead = await deps.readTarget(ctx.userId, id);
  if (!targetRead.ok) {
    return {
      status: "needs_info",
      summary: "No pude verificar ese movimiento ahora, así que no cambié nada. Reinténtalo en un rato.",
    };
  }
  if (!targetRead.found) {
    return { status: "needs_info", summary: "No encuentro ese movimiento; vuelve a listar los recientes." };
  }
  const tx = targetRead.transaction;
  if (targetRead.reversed) {
    return { status: "refused", summary: "Ese movimiento ya fue revertido; no se puede corregir." };
  }
  if (!isUndoEligible(tx, new Set())) {
    return { status: "refused", summary: "Ese tipo de movimiento no admite una corrección automática segura." };
  }
  if (args.newSourceAccountId && args.newDebtAccountId) {
    return { status: "needs_info", summary: "Indica una sola fuente nueva: una cuenta o una tarjeta, no ambas." };
  }

  const newAmount = Number.isFinite(Number(args.newAmount)) && Number(args.newAmount) > 0 ? Number(args.newAmount) : undefined;
  if (args.newAmount !== undefined && args.newAmount !== null && newAmount === undefined) {
    return { status: "needs_info", summary: "El monto corregido debe ser mayor a cero." };
  }
  const newOccurredAtISO = validOccurredAtISO(
    args.newOccurredAtISO,
    todayISO(ctx),
  );
  if (
    args.newOccurredAtISO !== undefined &&
    args.newOccurredAtISO !== null &&
    newOccurredAtISO === undefined
  ) {
    return { status: "needs_info", summary: "La fecha corregida no es válida. Dímela como AAAA-MM-DD." };
  }
  const account = ctx.accounts.find((a) => a.id === args.newSourceAccountId);
  const debt = ctx.debtAccounts.find((d) => d.id === args.newDebtAccountId);
  if (args.newSourceAccountId && !account) {
    return { status: "needs_info", summary: "No reconozco esa cuenta nueva; vuelve a elegirla entre tus cuentas." };
  }
  if (args.newDebtAccountId && !debt) {
    return { status: "needs_info", summary: "No reconozco esa tarjeta nueva; vuelve a elegirla entre tus tarjetas." };
  }
  const newCategory = typeof args.newCategory === "string" && VALID_CATEGORIES.has(args.newCategory as FinancialCategory) ? (args.newCategory as FinancialCategory) : undefined;
  const newDescription = typeof args.newDescription === "string" && args.newDescription.trim() ? args.newDescription.trim() : undefined;
  const requestedTreatment =
    args.newBudgetTreatment === "saldo" || args.newBudgetTreatment === "objective"
      ? (args.newBudgetTreatment as "objective" | "saldo")
      : undefined;
  // Stage H (P2-4) — SAME guard as log_movement: 'saldo' (extraordinary) only
  // means something when the movement's category HAS an active objective to
  // bypass. Without one, food/transport is reserved whole and a per-txn Saldo
  // drain would double-count — and the engine would ignore the flag anyway, so
  // confirming it would be a lie. Refuse honestly instead of writing a no-op.
  const effectiveCategory = newCategory ?? (tx.category as FinancialCategory);
  const hasObjectiveForTx =
    ctx.briefing?.objectives?.states?.some((st) => st.category === effectiveCategory) ?? false;
  if (requestedTreatment === "saldo" && !(isObjectiveCategory(effectiveCategory) && hasObjectiveForTx)) {
    return {
      status: "refused",
      summary: isObjectiveCategory(effectiveCategory)
        ? `No puedo separarlo del objetivo: no tiene un objetivo mensual activo de ${effectiveCategory === "food" ? "comida" : "transporte"}. Explícale que lo extraordinario se separa CONTRA un objetivo, y ofrécele ponerse uno (update_budget_category). NO afirmes que salió de su Saldo.`
        : `"Sale de mi Saldo" solo aplica a comida/transporte (las categorías con objetivo mensual). Este movimiento es ${effectiveCategory} y ya se trata según su categoría. NO cambies nada ni digas que lo moviste.`,
    };
  }
  const newBudgetTreatment = requestedTreatment;

  const balanceChange = newAmount !== undefined || newOccurredAtISO !== undefined || account || debt;

  try {
    if (!balanceChange) {
      if (!newCategory && !newDescription && !newBudgetTreatment) {
        return { status: "needs_info", summary: "Dime qué corregir: monto, cuenta, fecha, categoría, descripción o si va al objetivo/Saldo." };
      }
      await deps.correctMetadata({ userId: ctx.userId, transactionId: id, category: newCategory, description: newDescription, budgetTreatment: newBudgetTreatment });
      const treatNote = newBudgetTreatment === "saldo" ? "ahora sale directo de tu Saldo (extraordinario, no consume tu objetivo)" : newBudgetTreatment === "objective" ? "ahora cuenta dentro de tu objetivo del mes" : "";
      return { status: "done", summary: `Corregí ${[newCategory ? `la categoría a ${newCategory}` : "", treatNote, !newCategory && !treatNote ? "la nota" : ""].filter(Boolean).join(" y ")} de ${tx.description}; el saldo de tus cuentas no cambia.` };
    }
    const corrected = buildAgentCorrectedIntent(tx, { newAmount, account, debt, newCategory, newDescription, newBudgetTreatment }, ctx.accounts);
    if (!corrected) {
      return { status: "needs_info", summary: "No puedo corregir ese movimiento con esos datos; pídele al usuario una sola precisión (monto o cuenta)." };
    }
    await deps.correctReplacement({ userId: ctx.userId, original: tx, correctedIntent: corrected, correctedOccurredAtISO: newOccurredAtISO, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, message: ctx.rawMessage, channel: ctx.channel, chatId: ctx.chatId });
    const changes = [
      newAmount ? `ahora ${money(newAmount, tx.originalCurrency)}` : "",
      account ? `desde ${account.name}` : debt ? `con ${debt.name}` : "",
      newOccurredAtISO ? `con fecha ${newOccurredAtISO.slice(0, 10)}` : "",
    ].filter(Boolean);
    return { status: "done", summary: `Corregí ${tx.description}: ${changes.join(", ")}. Ajusté los saldos.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "correct failed";
    if (/KIPU_NEEDS_INFO/.test(message)) {
      return {
        status: "needs_info",
        summary: message.replace(/^.*KIPU_NEEDS_INFO:\s*/, ""),
      };
    }
    return { status: "error", summary: message };
  }
}

async function executeCorrectMovement(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  return executeCorrectMovementWith(args, ctx, {
    readTarget: readTransactionById,
    correctMetadata: correctTransactionMetadata,
    correctReplacement: correctTransactionByReplacement,
  });
}

export function personPaymentRequiresCounterparty(
  args: Record<string, unknown>,
): boolean {
  return !(
    args.direction === "in" &&
    args.inflowKind === "capital_return_unrecorded"
  );
}

async function executePersonPayment(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { status: "needs_info", summary: "Falta el monto." };
  if (args.direction !== "in" && args.direction !== "out") {
    return { status: "needs_info", summary: "¿La plata salió o te llegó? No registré nada." };
  }
  const direction = args.direction;
  const person = typeof args.person === "string" ? args.person.trim() : "";
  if (!person && personPaymentRequiresCounterparty(args)) {
    return {
      status: "needs_info",
      summary:
        "¿Con qué persona fue? Necesito esa identidad para no mezclar un gasto, préstamo, reembolso o devolución.",
    };
  }
  const account = ctx.accounts.find((a) => a.id === args.accountId);
  const debt = ctx.debtAccounts.find((d) => d.id === args.debtAccountId);
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  const provedOccurredAt = validOccurredAtISO(
    args.occurredAtISO,
    todayISO(ctx),
  );
  if (args.occurredAtISO != null && !provedOccurredAt) {
    return {
      status: "needs_info",
      summary:
        "La fecha del movimiento no es válida. Dímela como AAAA-MM-DD y no posterior a hoy; no registré nada.",
    };
  }
  const occurredAtISO =
    provedOccurredAt ?? `${todayISO(ctx)}T12:00:00.000Z`;
  const occurredDate = occurredAtISO.slice(0, 10);

  try {
    if (direction === "out") {
      if (!account && !debt) return { status: "needs_info", summary: "¿De qué cuenta o tarjeta salió?" };
      if (typeof args.isLoan !== "boolean") {
        return {
          status: "needs_info",
          summary:
            `¿Es plata que ${person} te va a devolver, o fue un pago/gasto definitivo? No registré nada.`,
        };
      }
      const isLoan = args.isLoan === true;
      // A card payment is denominated in the CARD currency, not the (absent) cash
      // account's — resolved deterministically (instrument → primary), with no
      // invented USD and no fabricated rate.
      const cr = resolveAgentMovementCurrency(ctx, {
        instruments: [account?.currency, debt?.currency],
      });
      if (!cr.ok) return {
        status: "needs_info",
        summary: cr.reason === "fx_unavailable"
          ? ctx.fxRatesReadOk === false
            ? `No pude leer las tasas vigentes para valorar ${cr.original} en ${cr.base}. No registré nada; reintenta en un momento.`
            : `Ese movimiento está en ${cr.original}, distinta a tu moneda base ${cr.base}; necesito una tasa confiable ${cr.original}→${cr.base}.`
          : "¿En qué moneda fue? No pude derivarla de la cuenta/tarjeta.",
      };
      const currency = cr.resolution.original;
      const who = person ? ` a ${person}` : "";
      const intent: ExpenseIntent = {
        type: "expense",
        description: isLoan ? `Préstamo${who}${reason ? ` (${reason})` : ""}` : `${reason || "transferencia"}${who}`,
        category: isLoan ? "other" : category(args.category, "other"),
        originalAmount: amount,
        originalCurrency: currency,
        baseCurrency: cr.resolution.base,
        exchangeRateToBase: cr.resolution.exchangeRateToBase,
        confidenceScore: 0.9,
        status: "ready",
        occurredAt: occurredAtISO,
        sourceAccountId: account?.id,
        debtAccountId: debt?.id,
      };
      if (isLoan) {
        const dedupe =
          dedupeKeyFor(ctx, { type: "expense", amount, currency, sourceAccountId: account?.id, debtAccountId: debt?.id, occurredDate }) ??
          `agent:loanout:${createHash("sha256")
            .update([ctx.userId, ctx.rawMessage.trim(), Math.round(amount * 100), currency, account?.id ?? debt?.id ?? "", occurredDate].join("|"))
            .digest("hex")
            .slice(0, 32)}`;
        const atomic = await applyPersonLoanOut(
          {
            userId: ctx.userId,
            type: "expense",
            effectType: "expense",
            description: intent.description,
            category: "other",
            originalAmount: amount,
            originalCurrency: currency,
            exchangeRateToBase: cr.resolution.exchangeRateToBase,
            baseAmount: amount * cr.resolution.exchangeRateToBase,
            baseCurrency: cr.resolution.base,
            sourceAccountId: account?.id ?? null,
            debtAccountId: debt?.id ?? null,
            rawInput: ctx.rawMessage,
            inputChannel: ctx.channel === "web" ? "web" : "chat",
            occurredAtISO,
            dedupeKey: dedupe,
          },
          {
            counterparty: person || "alguien",
            amount,
            currency,
            reason: reason || null,
          },
        );
        if (!atomic.ok) {
          return {
            status: atomic.reason === "unsafe" ? "needs_info" : "error",
            summary: atomic.reason === "unsafe"
              ? "El préstamo no pasó las validaciones de cuenta, moneda o identidad; no registré ninguna mitad."
              : "No pude probar que la salida y lo que te deben aterrizaran juntos; la operación se revirtió completa.",
          };
        }
        ctx.dirty = true;
        return {
          status: "done",
          effect: atomic.replayed ? "noop" : "wrote",
          data: {
            transactionId: atomic.transactionId,
            receivableId: atomic.receivableId,
          },
          summary: atomic.replayed
            ? `Ese préstamo de ${money(amount, currency)}${who} ya estaba registrado; no moví el dinero ni dupliqué lo que te deben.`
            : `Registré préstamo ${money(amount, currency)}${who}: la salida y lo que te deben quedaron juntos.`,
        };
      }
      const applied = await applyAgentChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId, occurredAtISO, dedupeKey: dedupeKeyFor(ctx, { type: "expense", amount, currency, sourceAccountId: account?.id, debtAccountId: debt?.id, occurredDate }) });
      return {
        status: "done",
        data: { transactionIds: applied.financialWriteReceipt?.transactionIds ?? [] },
        summary: `Registré ${money(amount, currency)}${who} como gasto desde ${account?.name ?? debt?.name}.`,
      };
    }
    // direction === "in"
    if (!account) return { status: "needs_info", summary: "¿A qué cuenta te llegó?" };
    if (!["income", "refund", "loan_repayment", "capital_return_unrecorded", "borrowed"].includes(args.inflowKind as string)) {
      return {
        status: "needs_info",
        summary:
          `¿Lo de ${person} fue ingreso/regalo, reembolso de una compra, devolución de un préstamo que te debían (registrado o no) o dinero que ahora tú debes? No registré nada.`,
      };
    }
    const inflowKind = args.inflowKind as "income" | "refund" | "loan_repayment" | "capital_return_unrecorded" | "borrowed";
    const crIn = resolveAgentMovementCurrency(ctx, {
      instruments: [account.currency],
    });
    if (!crIn.ok) return {
      status: "needs_info",
      summary: crIn.reason === "fx_unavailable"
        ? ctx.fxRatesReadOk === false
          ? `No pude leer las tasas vigentes para valorar ${crIn.original} en ${crIn.base}. No registré nada; reintenta en un momento.`
          : `Ese ingreso está en ${crIn.original}, distinta a tu moneda base ${crIn.base}; necesito una tasa confiable ${crIn.original}→${crIn.base}.`
        : "¿En qué moneda te llegó?",
    };
    const currency = crIn.resolution.original;
    const who = person ? ` de ${person}` : "";
    if (inflowKind === "capital_return_unrecorded") {
      const actionId = ctx.activePlannedAction?.id ?? "capital-return";
      const dedupe =
        dedupeKeyFor(ctx, {
          type: "adjustment",
          amount,
          currency,
          destinationAccountId: account.id,
          occurredDate,
        }) ??
        `agent:capital-return:${createHash("sha256")
          .update(
            [
              ctx.userId,
              ctx.operationId ?? "",
              actionId,
              account.id,
              Math.round(amount * 100),
              currency,
              occurredDate,
            ].join("|"),
          )
          .digest("hex")
          .slice(0, 32)}`;
      const transactionId = await applyLedgerEntry(createSupabaseAdminClient(), {
        userId: ctx.userId,
        type: "adjustment",
        effectType: "adjustment",
        description: `Capital devuelto${who} (préstamo original no registrado)`,
        category: "other",
        originalAmount: amount,
        originalCurrency: currency,
        exchangeRateToBase: crIn.resolution.exchangeRateToBase,
        baseAmount: amount * crIn.resolution.exchangeRateToBase,
        baseCurrency: crIn.resolution.base,
        destinationAccountId: account.id,
        confidenceScore: 0.9,
        rawInput: ctx.rawMessage,
        inputChannel: ctx.channel === "web" ? "web" : "chat",
        occurredAtISO,
        externalRef: `capital_return_unrecorded:${ctx.durableOperationId ?? ctx.operationId ?? actionId}`,
        dedupeKey: dedupe,
      });
      ctx.dirty = true;
      const refreshed = await refreshAgentContextIfDirty(ctx);
      return {
        status: "done",
        effect: "wrote",
        data: { transactionId },
        summary: withRefreshCaveat(
          refreshed,
          `Registré ${money(amount, currency)}${who} en ${account.name} como devolución de capital cuyo préstamo original no estaba en Kipu. Subió la caja; no lo conté como ingreso ni fabriqué una deuda o un préstamo por cobrar.`,
        ),
      };
    }
    if (inflowKind === "borrowed") {
      if (!isConcreteLenderName(person)) {
        return {
          status: "needs_info",
          summary:
            "Sé que fueron fondos prestados, pero no sé quién es el prestamista. Pregunta el nombre de la persona o entidad; no acredité la cuenta ni inventé una deuda genérica.",
        };
      }
      const liability = ctx.debtAccounts.find(
        (row) => row.id === args.debtAccountId,
      );
      if (!liability || liability.type === "credit_card") {
        return {
          status: "needs_info",
          summary:
            `No encuentro una deuda no-tarjeta de ${person} a la que sumar ${money(amount, currency)}. No registré el dinero como ingreso. Pregunta si quiere crear esa deuda con ese nombre y saldo inicial 0; después acredita el préstamo en esta cuenta.`,
        };
      }
      const lender = normName(person);
      const liabilityName = normName(liability.name);
      if (
        !liabilityName.includes(lender) &&
        !lender.includes(liabilityName)
      ) {
        return {
          status: "needs_info",
          summary:
            `La deuda elegida es "${liability.name}", pero el prestamista nombrado es "${person}". No moví dinero: pregunta cuál deuda corresponde para no aumentar la obligación equivocada.`,
        };
      }
      if (String(liability.currency).toUpperCase() !== currency) {
        return {
          status: "needs_info",
          summary:
            `El dinero llegó en ${currency}, pero la deuda "${liability.name}" está en ${liability.currency}. No registré nada: confirma el monto en la moneda de la deuda o usa una deuda en ${currency}.`,
        };
      }
      const identity = createHash("sha256")
        .update([
          ctx.userId,
          ctx.operationId ?? "",
          ctx.rawMessage.trim(),
          account.id,
          liability.id,
          Math.round(amount * 100),
          currency,
        ].join("|"))
        .digest("hex")
        .slice(0, 40);
      if (!ctx.durableOperationId || !ctx.activePlannedAction?.id) {
        return {
          status: "error",
          summary:
            "No pude probar la identidad durable del préstamo. No acredité la cuenta ni aumenté la deuda.",
        };
      }
      const applied = await applyDebtProceeds({
        userId: ctx.userId,
        operationId: ctx.durableOperationId,
        leaseToken: ctx.durableOperationLeaseToken ?? "",
        stepKey: ctx.activePlannedAction.id,
        dedupeKey: `agent:borrowed-in:${identity}`,
        accountId: account.id,
        debtAccountId: liability.id,
        amount,
        originalCurrency: currency,
        exchangeRateToBase: crIn.resolution.exchangeRateToBase,
        baseCurrency: crIn.resolution.base,
        occurredAtISO,
        rawInput: ctx.rawMessage,
        inputChannel: ctx.channel === "web" ? "web" : "chat",
      });
      if (!applied.ok) {
        return {
          status: applied.reason === "write_failed" ? "error" : "needs_info",
          summary:
            applied.reason === "conflict"
              ? "La cuenta o la deuda cambió mientras registraba el préstamo. No quedó nada a medias; relee y reintenta."
              : applied.reason === "unsafe"
                ? "El préstamo no pasó las validaciones de cuenta, deuda o moneda. No acredité la cuenta ni aumenté la deuda."
                : "No pude probar que la cuenta y la deuda cambiaran juntas; la operación se revirtió completa.",
        };
      }
      ctx.dirty = true;
      const refreshed = await refreshAgentContextIfDirty(ctx);
      return {
        status: "done",
        effect: applied.replayed ? "noop" : "wrote",
        operationStepReceipt: "writer",
        data: { transactionId: applied.transactionId },
        summary: withRefreshCaveat(
          refreshed,
          applied.replayed
            ? `Ese préstamo de ${money(amount, currency)} de ${person} ya estaba registrado; no lo dupliqué.`
            : `Registré ${money(amount, currency)} prestados por ${person} en ${account.name}: la cuenta subió y la deuda "${liability.name}" aumentó juntas. No lo conté como ingreso.`,
        ),
      };
    }
    if (inflowKind === "refund") {
      // L-1: category/budgetTreatment from the tool are model proposals, never
      // authority. The complete ledger fact wins byte-for-byte, including a
      // NULL treatment (objective-by-default). If the read is incomplete, or
      // candidates disagree, no money moves.
      const refundRecent = await loadRefundContext(ctx.userId);
      const registration = planPersonRefundRegistration({
        amount,
        currency,
        message: ctx.rawMessage ?? "",
        originalTransactionId:
          typeof args.originalTransactionId === "string"
            ? args.originalTransactionId
            : null,
        originalWasNotRecorded: args.originalWasNotRecorded === true,
        read: refundRecent,
        nowMs: Date.now(),
      });
      if (registration.outcome === "ask") {
        if (registration.reason === "unreadable") {
          return {
            status: "needs_info",
            summary:
              "No pude leer de forma completa las compras que podrían corresponder a ese reembolso. No registré nada: reintenta en un momento para no devolver dinero al objetivo o al Saldo equivocado.",
          };
        }
        if (registration.reason === "ambiguous") {
          const refundCandidates = registration.options.slice(0, 20);
          const candidateSummary = refundCandidates
            .map(
              (candidate, index) =>
                `${index + 1}) ${candidate.description ?? "Gasto"} · ${money(
                  candidate.originalCents / 100,
                  currency,
                )} · ${new Date(candidate.occurredAtMs)
                  .toISOString()
                  .slice(0, 10)} · id=${candidate.id}`,
            )
            .join("; ");
          return {
            status: "needs_info",
            summary:
              `Encontré ${registration.candidates} compras que ese reembolso de ${money(amount, currency)} podría estar devolviendo. Pregunta cuál fue usando estas opciones de la misma lectura completa: ${candidateSummary}. Vuelve con su originalTransactionId; no registré nada todavía.`,
            data: {
              refundCandidates,
              totalCandidates: registration.candidates,
            },
          };
        }
        if (registration.reason === "invalid_original") {
          return {
            status: "needs_info",
            summary:
              "Encontré la compra original, pero su categoría/tratamiento histórico no es publicable. No registré el reembolso: corrige primero ese movimiento o elige otro original.",
          };
        }
        return {
          status: "needs_info",
          summary:
            `No pude identificar una compra original compatible con ese reembolso de ${money(amount, currency)}. Confirma monto, moneda y comercio de la compra. Si nunca estuvo registrada en Kipu, que lo diga explícitamente; entonces moveré la caja sin tocar objetivo ni Saldo.`,
        };
      }
      const intent: RefundIntent = {
        type: "refund",
        description: `Reembolso${who}${reason ? ` (${reason})` : ""}`,
        originalAmount: amount,
        originalCurrency: currency,
        baseCurrency: crIn.resolution.base,
        exchangeRateToBase: crIn.resolution.exchangeRateToBase,
        confidenceScore: 0.9,
        status: "ready",
        destinationAccountId: account.id,
        category: registration.category as FinancialCategory,
        budgetTreatment: registration.budgetTreatment,
        relatedTransactionId:
          registration.relatedTransactionId ?? undefined,
        recurringExpenseId:
          registration.recurringExpenseId ?? undefined,
        originalExternalRef:
          registration.originalExternalRef ?? undefined,
        registrationProvenance: registration.derived
          ? "derived_original"
          : "confirmed_unrecorded",
      };
      const applied = await applyAgentChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId, occurredAtISO, dedupeKey: dedupeKeyFor(ctx, { type: "refund", amount, currency, destinationAccountId: account.id, occurredDate }) });
      return {
        status: "done",
        data: { transactionIds: applied.financialWriteReceipt?.transactionIds ?? [] },
        summary: `Registré reembolso ${money(amount, currency)}${who} a ${account.name} (no lo cuento como ingreso nuevo).`,
      };
    }
    if (inflowKind === "loan_repayment") {
      // Bloque I (re-auditoría) — la lectura y el matching van ANTES de cualquier
      // escritura. El flujo viejo registraba el ingreso primero y descontaba después
      // con una lectura fail-open: un blip dejaba el movimiento registrado y el
      // préstamo pendiente para siempre, presentado como éxito.
      const recRead = await readOpenReceivables(ctx.userId);
      if (!moneyReadPublishable(recRead)) {
        return { status: "needs_info", summary: "Ahora mismo no pude leer los préstamos que le deben, así que no registré NADA (ni el ingreso): registrarlo sin poder descontarlo dejaría la deuda figurando pendiente. Dile que lo reintente en un rato." };
      }
      // Punto 4 — la devolución solo cierra préstamos EN SU MONEDA: sin el filtro,
      // 100 ARS cerraban 100 USD. Si no hay match exacto, se pregunta; jamás se
      // degrada a ingreso normal por descarte.
      const registration = repaymentRegistrationDecision({
        receivables: recRead.receivables,
        counterparty: person || null,
        amount,
        currency,
      });
      if (registration.outcome === "ambiguous") {
        return {
          status: "needs_info",
          summary:
            `Hay ${registration.candidates} préstamos por cobrar compatibles. Pregunta quién devolvió el dinero; no registré ni repartí el monto por antigüedad.`,
        };
      }
      if (registration.outcome === "unmatched_amount") {
        return {
          status: "needs_info",
          summary:
            `El monto supera lo que Kipu puede descontar con certeza de ese préstamo. No registré nada: confirma qué representa la diferencia de ${money(registration.remainder, currency)}.`,
        };
      }
      if (registration.outcome === "ready") {
        const plannedReceivableIds = Array.isArray(args.receivableIds)
          ? [...new Set(args.receivableIds.filter(
              (value): value is string =>
                typeof value === "string" && value.trim().length > 0,
            ))].sort()
          : [];
        const resolvedReceivableIds = [...new Set(
          registration.allocations.map((row) => row.receivableId),
        )].sort();
        if (
          ctx.activePlannedAction &&
          (plannedReceivableIds.length !== resolvedReceivableIds.length ||
            plannedReceivableIds.some(
              (id, index) => id !== resolvedReceivableIds[index],
            ))
        ) {
          return {
            status: "refused",
            summary:
              "Los préstamos del plan no coinciden con los que siguen abiertos. Relee list_open_receivables y vuelve a planificar; no registré nada.",
          };
        }
        const rate = crIn.resolution.exchangeRateToBase ?? 1;
        const repaymentActionId =
          ctx.activePlannedAction?.id ?? "loan-repayment";
        // La MISMA operación: ingreso al ledger + descuento del receivable en UNA
        // transacción (RPC kipu_apply_repayment). El CAS del outstanding leído hace
        // que un conflicto revierta TODO — cuesta un reintento, nunca una devolución
        // a medias.
        const atomic = await applyRepaymentEntry(
          {
            userId: ctx.userId,
            type: "income",
            effectType: "income",
            description: `Devolución de préstamo${who}`,
            category: "income",
            originalAmount: amount,
            originalCurrency: currency,
            exchangeRateToBase: rate,
            baseAmount: amount * rate,
            baseCurrency: crIn.resolution.base,
            destinationAccountId: account.id,
            confidenceScore: 0.9,
            rawInput: ctx.rawMessage,
            inputChannel: ctx.channel === "web" ? "web" : "chat",
            occurredAtISO,
            externalRef: `receivable_repayment:${ctx.durableOperationId ?? ctx.operationId ?? repaymentActionId}`,
            // La RPC EXIGE identidad (punto 3). Los canales sin operationId por
            // turno (nota de voz, correo, form actions web) no pueden quedarse sin
            // repago por eso: el fallback es determinístico sobre el contenido +
            // el día — una redelivery del mismo mensaje replaya sin doble
            // descuento; dos repagos idénticos el mismo día por esos canales se
            // dedupean (trade-off confesado, mismo del handler legacy).
            dedupeKey:
              dedupeKeyFor(ctx, { type: "income", amount, currency, destinationAccountId: account.id, occurredDate }) ??
              `agent:repayment:${createHash("sha256")
                .update([ctx.userId, ctx.rawMessage.trim(), Math.round(amount * 100), currency, account.id, occurredDate].join("|"))
                .digest("hex")
                .slice(0, 32)}`,
          },
          registration.allocations,
        );
        if (!atomic.ok) {
          return { status: atomic.reason === "conflict" ? "needs_info" : "error", summary: atomic.reason === "conflict"
            ? "El préstamo cambió mientras registraba la devolución, así que NO registré nada para no descontar de más. Dile que lo reintente — todo quedó como estaba."
            : "No pude registrar la devolución con certeza, así que NO quedó nada a medias. Dile que lo reintente en un rato." };
        }
        if (atomic.replayed) {
          // Punto 3 — la misma identidad ya está commiteada: el retry NO volvió a
          // descontar. Narrar "ya estaba", jamás un descuento nuevo.
          ctx.dirty = true;
          return {
            status: "done",
            effect: "noop",
            data: { transactionId: atomic.transactionId },
            summary: `Esa devolución de ${money(amount, currency)}${who} YA estaba registrada (fue un reintento del mismo mensaje); no desconté nada dos veces.`,
          };
        }
        ctx.dirty = true;
        return {
          status: "done",
          data: { transactionId: atomic.transactionId },
          summary: `Registré la devolución de ${money(amount, currency)}${who} y la descontué de lo que te debían (todo en una sola operación).`,
        };
      }
      // ¿Había préstamo de ESA persona (o de cualquiera, si no dijo quién) pero en
      // otra moneda? Mismo matching del plan, sin el filtro de moneda.
      const rpNorm = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
      const rpTarget = person ? rpNorm(person) : null;
      const hadOtherCurrency = recRead.receivables.some(
        (r) =>
          (r.currency || "").trim().toUpperCase() !== currency.trim().toUpperCase() &&
          (!rpTarget || rpNorm(r.counterparty).includes(rpTarget) || rpTarget.includes(rpNorm(r.counterparty))),
      );
      if (hadOtherCurrency) {
        // Préstamos abiertos solo en OTRA moneda: no se cierran con esta plata sin
        // una conversión que el usuario confirme. Registrar el ingreso mezclando
        // monedas descontaría deuda 1:1 fabricado.
        return { status: "needs_info", summary: `Le deben plata, pero en otra moneda distinta a ${currency} — no puedo descontar un préstamo con una devolución en otra moneda sin que me confirme. Pregúntale si esta plata corresponde a ese préstamo y en qué moneda quedó, o si es un ingreso aparte.` };
      }
      // Sin préstamo abierto que coincida, la etiqueta "loan_repayment" no es
      // permiso para fabricar ingreso. Preguntar es la única salida que preserva
      // ambas posibilidades: capital no registrado o una contraparte distinta.
      return {
        status: "needs_info",
        summary:
          `No encontré un préstamo abierto compatible con ${person || "esa devolución"}. No registré nada como ingreso: confirma si el préstamo original nunca estuvo en Kipu o quién debía ese dinero.`,
      };
    }
    const intent: IncomeIntent = { type: "income", description: `Ingreso${who}${reason ? ` (${reason})` : ""}`, originalAmount: amount, originalCurrency: currency, baseCurrency: crIn.resolution.base, exchangeRateToBase: crIn.resolution.exchangeRateToBase, confidenceScore: 0.9, status: "ready", occurredAt: occurredAtISO, destinationAccountId: account.id, category: "income" };
    const applied = await applyAgentChatTransactionIntent({ userId: ctx.userId, message: ctx.rawMessage, intent, accounts: ctx.accounts, debtAccounts: ctx.debtAccounts, goals: ctx.goals, parserSource: "ai", parserConfidenceScore: 0.9, channel: ctx.channel, chatId: ctx.chatId, occurredAtISO, dedupeKey: dedupeKeyFor(ctx, { type: "income", amount, currency, destinationAccountId: account.id, occurredDate }) });
    return {
      status: "done",
      data: { transactionIds: applied.financialWriteReceipt?.transactionIds ?? [] },
      summary: `Registré ingreso ${money(amount, currency)}${who} a ${account.name}.`,
    };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "person_payment failed" };
  }
}

async function executeCreateFixed(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const amount = Number(args.amount);
  if (!name) return { status: "needs_info", summary: "¿De qué es el gasto fijo?" };
  if (!Number.isFinite(amount) || amount <= 0) return { status: "needs_info", summary: "¿De cuánto es?" };
  const frequency = ["weekly", "biweekly", "monthly", "yearly"].includes(args.frequency as string)
    ? (args.frequency as PaymentFrequency)
    : null;
  if (!frequency) {
    return {
      status: "needs_info",
      summary: "¿Cada cuánto ocurre ese gasto fijo? No asumí que fuera mensual.",
    };
  }
  const account = ctx.accounts.find((a) => a.id === args.sourceAccountId);
  if (
    typeof args.sourceAccountId === "string" &&
    args.sourceAccountId.trim() &&
    !account
  ) {
    return {
      status: "needs_info",
      summary:
        "No reconozco la cuenta indicada para ese gasto fijo; no creé el plan sin su vínculo.",
    };
  }
  const startDate = validISODate(args.startDate) ?? null;
  const isVariable = args.isVariable === true;
  const currencyPlan = planFixedExpenseCurrency({
    explicitCurrency: args.currency,
    sourceCurrency: account ? accountCurrency(account) : null,
    baseCurrency: ctx.baseCurrency,
  });
  if (!currencyPlan.ok && currencyPlan.reason === "invalid_explicit") {
    return {
      status: "needs_info",
      summary:
        "La moneda del gasto fijo debe ser un código ISO de 3 letras; no creé el plan.",
    };
  }
  if (args.startDate != null && !startDate) {
    return {
      status: "needs_info",
      summary:
        "La fecha inicial no existe o no está en formato YYYY-MM-DD; no creé el gasto fijo.",
    };
  }
  if (args.payNow === true && startDate) {
    return {
      status: "needs_info",
      summary:
        "Pediste que el plan empiece en el futuro y también pagarlo hoy. Aclara cuál de las dos aplica; no guardé ninguna mitad.",
    };
  }
  if (args.payNow === true && !account) {
    return {
      status: "needs_info",
      summary:
        "¿Desde qué cuenta se pagó hoy? No creé el plan sin poder registrar juntas las dos mitades.",
    };
  }

  const similarRead = await readSimilarFixedExpenses({ userId: ctx.userId, name });
  // Un guard que no pudo leer NO autoriza — y uno TOPADO tampoco (re-auditoría 2,
  // punto 5): "no vi ninguno parecido" solo vale si los vio TODOS. Crear el fijo
  // sobre media lista lo duplicaría justo cuando el guard más hacía falta, y un
  // fijo duplicado resta dos veces del ritmo.
  if (!moneyReadPublishable(similarRead)) {
    return { status: "needs_info", summary: "Ahora mismo no pude revisar si ya tiene un gasto fijo parecido, y no quiero duplicárselo. Pídele que lo reintente en un rato." };
  }
  const similar = similarRead.matches;
  if (similar.length > 0) {
    return { status: "needs_info", summary: `Ya existe un gasto fijo parecido: id=${similar[0].id} ${similar[0].name} ${money(similar[0].amount, similar[0].currency)}. Pregúntale si actualizar ese (update_fixed_expense) o crear uno nuevo.`, data: similar };
  }

  // The commitment is denominated in its source account's currency, or — when no
  // source is given — the user's base currency. Never a blind USD.
  if (!currencyPlan.ok && currencyPlan.reason === "source_mismatch") {
    return {
      status: "needs_info",
      summary:
        `El plan está expresado en ${String(args.currency).trim().toUpperCase()}, pero la cuenta "${account?.name}" está en ${account ? accountCurrency(account) : "otra moneda"}. ` +
        "No reetiqueté el monto ni creé el plan: pregunta en qué moneda queda realmente o elige una cuenta compatible.",
    };
  }
  if (!currencyPlan.ok) {
    return {
      status: "needs_info",
      summary:
        "No pude probar la moneda de ese gasto fijo; no creé el plan ni inventé USD.",
    };
  }
  const currency = currencyPlan.currency;
  if (args.payNow === true && !startDate && account) {
    const paymentCurrency = resolveAgentMovementCurrency(ctx, {
      instruments: [currency],
    });
    if (!paymentCurrency.ok) {
      return {
        status: "needs_info",
        summary:
          paymentCurrency.reason === "fx_unavailable"
            ? `El gasto fijo está en ${paymentCurrency.original} y tu base en ${paymentCurrency.base}; necesito una tasa confiable antes de crear el plan Y registrar el pago. No guardé ninguna mitad.`
            : "No pude determinar la moneda del gasto fijo; no creé el plan ni registré el pago.",
      };
    }
    const dedupe =
      dedupeKeyFor(ctx, { type: "expense", amount, currency, sourceAccountId: account.id }) ??
      `agent:fixedcreate:${createHash("sha256")
        .update([ctx.userId, ctx.rawMessage.trim(), name, Math.round(amount * 100), currency, account.id, todayISO(ctx)].join("|"))
        .digest("hex")
        .slice(0, 32)}`;
    const atomic = await applyFixedExpenseWithPayment({
      userId: ctx.userId,
      mode: "create",
      dedupeKey: dedupe,
      fixed: {
        name,
        amount,
        currency,
        category: category(args.category, "other"),
        frequency,
        start_date: null,
        payment_source_type: "account",
        payment_source_id: account.id,
        is_essential: false,
        is_variable: isVariable,
      },
      entry: {
        userId: ctx.userId,
        type: "expense",
        effectType: "expense",
        description: name,
        category: category(args.category, "other"),
        originalAmount: amount,
        originalCurrency: currency,
        exchangeRateToBase: paymentCurrency.resolution.exchangeRateToBase,
        baseAmount: amount * paymentCurrency.resolution.exchangeRateToBase,
        baseCurrency: paymentCurrency.resolution.base,
        sourceAccountId: account.id,
        rawInput: ctx.rawMessage,
        inputChannel: ctx.channel === "web" ? "web" : "chat",
        dedupeKey: dedupe,
      },
    });
    if (!atomic.ok) {
      return {
        status: atomic.reason === "unsafe" ? "needs_info" : "error",
        summary: "No pude registrar juntos el gasto fijo y el pago de hoy; no quedó ninguna mitad aplicada.",
      };
    }
    ctx.dirty = true;
    return {
      status: "done",
      effect: atomic.replayed ? "noop" : "wrote",
      summary: atomic.replayed
        ? `Ese gasto fijo y su pago de hoy ya estaban registrados; no los dupliqué.`
        : `Creé el gasto fijo ${name} (${money(amount, currency)} ${frequency}) y registré el pago de hoy en una sola operación.`,
      data: {
        fixedExpenseId: atomic.fixedExpenseId,
        transactionId: atomic.transactionId,
      },
    };
  }
  const created = await createFixedExpense({
    userId: ctx.userId,
    name,
    amount,
    currency,
    category: category(args.category, "other"),
    frequency,
    startDate,
    paymentSourceType: account ? "account" : undefined,
    paymentSourceId: account?.id,
    isVariable,
    operationKey: agentActionDedupe(ctx, "create-fixed", [
      name,
      amount,
      currency,
      frequency,
      startDate,
      account?.id ?? null,
    ]),
  });
  if (!created) return { status: "error", summary: "No pude guardar el gasto fijo." };
  return created.replayed
    ? {
        status: "done",
        effect: "noop",
        summary: `Ese gasto fijo ya estaba creado por este mismo pedido; no lo dupliqué.`,
        data: { fixedExpenseId: created.id },
      }
    : {
        status: "done",
        summary: `Creé el gasto fijo ${name} (${money(amount, currency)} ${frequency})${startDate ? `, empieza el ${startDate}` : ""}. No registro un pago hoy.`,
        data: { fixedExpenseId: created.id },
      };
}

async function executeUpdateFixed(
  args: Record<string, unknown>,
  ctx: AgentContext,
  serverAuthorized = false,
): Promise<ToolResult> {
  const id = typeof args.fixedExpenseId === "string" ? args.fixedExpenseId : "";
  if (!id) return { status: "needs_info", summary: "Falta el id del gasto fijo." };
  if (
    args.newAmount !== undefined &&
    (!Number.isFinite(Number(args.newAmount)) || Number(args.newAmount) <= 0)
  ) {
    return {
      status: "needs_info",
      summary:
        "El nuevo monto del gasto fijo debe ser mayor a cero; no guardé los demás cambios del patch.",
    };
  }
  if (args.startDate !== undefined && !validISODate(args.startDate)) {
    return {
      status: "needs_info",
      summary:
        "La fecha inicial no existe o no está en formato YYYY-MM-DD; no guardé los demás cambios del patch.",
    };
  }
  if (
    args.newName !== undefined &&
    (typeof args.newName !== "string" || !args.newName.trim())
  ) {
    return {
      status: "needs_info",
      summary:
        "El nombre nuevo del gasto fijo no puede estar vacío; no guardé los demás cambios del patch.",
    };
  }
  if (
    args.dueDay !== undefined &&
    (!Number.isInteger(Number(args.dueDay)) ||
      Number(args.dueDay) < 1 ||
      Number(args.dueDay) > 31)
  ) {
    return {
      status: "needs_info",
      summary:
        "El día de cobro debe estar entre 1 y 31; no guardé los demás cambios del patch.",
    };
  }
  if (
    args.currency !== undefined &&
    !(
      typeof args.currency === "string" &&
      /^[A-Za-z]{3}$/.test(args.currency.trim())
    )
  ) {
    return {
      status: "needs_info",
      summary:
        "La moneda del gasto fijo debe ser un código ISO de 3 letras; no guardé los demás cambios del patch.",
    };
  }
  const newAmount = Number.isFinite(Number(args.newAmount)) && Number(args.newAmount) > 0 ? Number(args.newAmount) : undefined;
  const startDate = validISODate(args.startDate);
  const action = args.action === "pause" || args.action === "resume" || args.action === "delete" ? args.action : undefined;
  const newName = typeof args.newName === "string" && args.newName.trim() ? args.newName.trim() : undefined;
  const dueDay = Number.isInteger(Number(args.dueDay)) && Number(args.dueDay) >= 1 && Number(args.dueDay) <= 31 ? Number(args.dueDay) : undefined;
  const newCurrency = typeof args.currency === "string" && /^[A-Za-z]{3}$/.test(args.currency.trim()) ? (args.currency.trim().toUpperCase() as CurrencyCode) : undefined;
  const isVariable = typeof args.isVariable === "boolean" ? args.isVariable : undefined;
  const notes = typeof args.notes === "string" ? args.notes : undefined;
  if (newAmount === undefined && startDate === undefined && action === undefined && newName === undefined && dueDay === undefined && newCurrency === undefined && isVariable === undefined && notes === undefined) {
    return { status: "needs_info", summary: "¿A cuánto queda o desde cuándo?" };
  }
  // Currency change without an amount would keep the same NUMBER in another
  // currency — an implicit re-denomination that is almost never what happened.
  if (newCurrency !== undefined && newAmount === undefined) {
    return { status: "needs_info", summary: `¿Y de cuánto queda en ${newCurrency}? Pregunta el monto en la nueva moneda antes de cambiar nada (el mismo número en otra moneda casi nunca es verdad).` };
  }
  // Soft-delete is destructive for the plan: explicit user confirmation first.
  if (action === "delete" && args.confirm !== true) {
    return { status: "needs_info", summary: "Eliminar ese gasto fijo lo saca de tu plan desde ya (el historial de pagos se conserva). Confirma con el usuario y vuelve a llamar con confirm=true." };
  }
  const fixedCatalogRead = await readFixedExpenseCatalog(ctx.userId);
  if (!moneyReadPublishable(fixedCatalogRead)) {
    return {
      status: "error",
      summary:
        "No pude leer el catálogo completo de gastos fijos, así que no asocié ese id a un gasto ni cambié nada. Reintenta.",
    };
  }
  const fixedTarget = fixedCatalogRead.expenses.find((row) => row.id === id);
  if (!fixedTarget) {
    return {
      status: "needs_info",
      summary:
        "Ese gasto fijo ya no existe o no pertenece a tu usuario. No cambié nada; vuelve a elegirlo desde la lista actual.",
    };
  }
  const fixedEntityGate = await guardResolvedEntityChoice({
    toolName: "update_fixed_expense",
    args,
    ctx,
    label: "el gasto fijo",
    chosen: fixedTarget,
    peers: fixedCatalogRead.expenses,
    serverAuthorized,
  });
  if (fixedEntityGate) return fixedEntityGate;
  const variabilityChanges =
    isVariable !== undefined &&
    isVariable !== (fixedTarget.isVariable === true);
  const changesCurrentVariableAmount =
    fixedTarget.isVariable === true && newAmount !== undefined;
  if (
    changesCurrentVariableAmount &&
    args.amountScope !== "from_now"
  ) {
    return {
      status: "needs_info",
      summary:
        "Ese gasto hoy es variable. Un monto distinto puede ser solo la factura de este ciclo: usa resolve_recurring_occurrence. Si cambió el plan de verdad, vuelve con amountScope=from_now y confirmación explícita.",
    };
  }
  if (
    (changesCurrentVariableAmount || variabilityChanges) &&
    !serverAuthorized
  ) {
    return {
      status: "needs_info",
      summary:
        variabilityChanges
          ? "Cambiar entre gasto fijo y variable altera cómo se planifica y aprende desde ahora. Pide confirmación explícita antes de continuar."
          : "Cambiar el monto permanente abre un régimen de aprendizaje nuevo. Pide confirmación explícita del cambio de plan antes de continuar.",
    };
  }
  const resultingVariable =
    isVariable ?? fixedTarget.isVariable === true;
  if (newAmount !== undefined && resultingVariable) {
    if (args.amountScope !== "from_now") {
      return {
        status: "needs_info",
        summary:
          "Ese gasto es variable. Si solo es la factura de este ciclo, usa resolve_recurring_occurrence (observe si no está pagada; confirm/correct si ya se pagó). Solo si el usuario dice que cambió permanentemente vuelve con amountScope=from_now.",
      };
    }
  }
  if (args.payNow === true && resultingVariable) {
    return {
      status: "needs_info",
      summary:
        "Un fijo variable no se cobra desde update_fixed_expense. Usa el aviso del calendario: observe si solo llegó la factura, o confirm/correct si ya se pagó. No cambié el plan ni moví dinero.",
    };
  }
  const account = ctx.accounts.find((a) => a.id === args.sourceAccountId);
  if (
    typeof args.sourceAccountId === "string" &&
    args.sourceAccountId.trim() &&
    !account
  ) {
    return {
      status: "needs_info",
      summary:
        "No reconozco la cuenta indicada; no actualicé ni cobré el gasto fijo.",
    };
  }
  if (args.payNow === true && startDate) {
    return {
      status: "needs_info",
      summary:
        "No puedo programar el cambio para una fecha futura y cobrarlo hoy. Aclara cuál de las dos aplica; no guardé nada.",
    };
  }
  if (args.payNow === true && newAmount === undefined) {
    return {
      status: "needs_info",
      summary:
        "Para registrar el pago de hoy necesito el monto nuevo exacto; no actualicé ni cobré nada.",
    };
  }
  if (args.payNow === true && !account) {
    return {
      status: "needs_info",
      summary:
        "¿Desde qué cuenta se pagó hoy? No actualicé el plan sin poder registrar juntas las dos mitades.",
    };
  }
  const planCurrency = (
    newCurrency ??
    fixedTarget.currency ??
    ctx.baseCurrency
  ).trim().toUpperCase();
  const currency = account ? accountCurrency(account) : planCurrency;
  const payNow = args.payNow === true && !startDate && newAmount !== undefined && account != null;
  if (args.payNow === true && action !== undefined) {
    return { status: "needs_info", summary: "No puedo pausar/reactivar/eliminar un gasto fijo y cobrarlo en la misma acción. Dime primero cuál de las dos quieres hacer; no cambié nada." };
  }
  if (payNow && account && newAmount !== undefined) {
    const currencyRead = await getFixedExpenseCurrency({ userId: ctx.userId, id });
    const expenseCurrency = newCurrency ?? (currencyRead.ok ? currencyRead.currency : null);
    if (!currencyRead.ok || expenseCurrency === null) {
      return { status: "needs_info", summary: "No pude probar la moneda del gasto fijo, así que no cambié el plan ni registré el pago. Reinténtalo en un rato." };
    }
    if (expenseCurrency !== currency) {
      return { status: "needs_info", summary: `El gasto quedaría en ${expenseCurrency} y la cuenta "${account.name}" está en ${currency}. No cambié ni cobré nada: pregunta cuánto salió realmente en ${currency}.` };
    }
    const paymentCurrency = resolveAgentMovementCurrency(ctx, {
      instruments: [currency],
    });
    if (!paymentCurrency.ok) {
      return {
        status: "needs_info",
        summary:
          paymentCurrency.reason === "fx_unavailable"
            ? `Ese pago está en ${paymentCurrency.original} y tu base en ${paymentCurrency.base}; necesito una tasa confiable. No cambié el plan ni registré el pago.`
            : "No pude determinar la moneda del pago. No cambié el plan ni registré nada.",
      };
    }
    const patch: Record<string, unknown> = { amount: newAmount };
    if (newName !== undefined) patch.name = newName;
    if (dueDay !== undefined) patch.expected_day = dueDay;
    if (newCurrency !== undefined) patch.currency = newCurrency;
    if (isVariable !== undefined) patch.is_variable = isVariable;
    if (notes !== undefined) patch.notes = notes;
    patch._expected_is_variable = fixedTarget.isVariable === true;
    const dedupe =
      dedupeKeyFor(ctx, { type: "expense", amount: newAmount, currency, sourceAccountId: account.id }) ??
      `agent:fixedupdate:${createHash("sha256")
        .update([ctx.userId, ctx.rawMessage.trim(), id, Math.round(newAmount * 100), currency, account.id, todayISO(ctx)].join("|"))
        .digest("hex")
        .slice(0, 32)}`;
    const atomic = await applyFixedExpenseWithPayment({
      userId: ctx.userId,
      mode: "update",
      dedupeKey: dedupe,
      fixedExpenseId: id,
      patch,
      entry: {
        userId: ctx.userId,
        type: "expense",
        effectType: "expense",
        description: newName ?? "Gasto fijo",
        category: "other",
        originalAmount: newAmount,
        originalCurrency: currency,
        exchangeRateToBase: paymentCurrency.resolution.exchangeRateToBase,
        baseAmount: newAmount * paymentCurrency.resolution.exchangeRateToBase,
        baseCurrency: paymentCurrency.resolution.base,
        sourceAccountId: account.id,
        rawInput: ctx.rawMessage,
        inputChannel: ctx.channel === "web" ? "web" : "chat",
        dedupeKey: dedupe,
      },
    });
    if (!atomic.ok) {
      return {
        status: atomic.reason === "unsafe" ? "needs_info" : "error",
        summary: "No pude aplicar juntos el cambio del gasto fijo y el pago; no quedó ninguna mitad guardada.",
      };
    }
    ctx.dirty = true;
    return {
      status: "done",
      effect: atomic.replayed ? "noop" : "wrote",
      summary: atomic.replayed
        ? "Ese cambio y pago ya estaban aplicados; no los dupliqué."
        : `Dejé el gasto fijo en ${money(newAmount, currency)} y registré el pago de hoy en una sola operación.`,
    };
  }

  const ok = await updateFixedExpenseFields({
    userId: ctx.userId,
    id,
    amount: newAmount,
    startDate,
    isActive: action === undefined ? undefined : action === "resume",
    expectedDay: dueDay,
    name: newName,
    currency: newCurrency,
    isVariable,
    expectedIsVariable: fixedTarget.isVariable === true,
    notes,
  });
  if (!ok) return { status: "error", summary: "No pude actualizar el gasto fijo." };
  ctx.dirty = true;

  // A pure is_variable / note change (no amount/timing/name) → confirm that alone,
  // without the amount-oriented copy below.
  if (newAmount === undefined && startDate === undefined && action === undefined && newName === undefined && dueDay === undefined && newCurrency === undefined) {
    const bits: string[] = [];
    if (isVariable !== undefined) bits.push(isVariable ? "lo marqué como variable (varía mes a mes; confirmaré cada ciclo y aprenderé de sus facturas reales)" : "lo marqué como fijo (monto estable)");
    if (notes !== undefined) bits.push(notes.trim() ? "guardé tu nota" : "quité la nota");
    return { status: "done", summary: `Listo: ${bits.join(" y ")}. No registré ningún pago. Confírmalo natural y breve.` };
  }

  // pause/resume/delete are plan changes, never a movement. 'delete' is a soft
  // delete (is_active=false): it stops counting immediately but the history of
  // payments already made stays auditable.
  if (action === "pause") {
    return { status: "done", summary: `Pausé ese gasto fijo: desde ya NO lo cuento en tu plan ni en tu Saldo. Cuando quieras lo reactivas. No registré ningún pago ni gasto.` };
  }
  if (action === "resume") {
    return { status: "done", summary: `Reactivé ese gasto fijo: lo vuelvo a contar en tu plan desde ya.` };
  }
  if (action === "delete") {
    return { status: "done", summary: `Eliminado: ese gasto fijo deja de contar desde ya en tu plan y tu Saldo. Los pagos que ya registraste se conservan en tu historial. Confírmalo como eliminado, simple.` };
  }

  // A future start date means: keep/update the recurring definition, do NOT
  // charge today — and CONFIRM the future timing back to the user.
  const startText = startDate ? ` Empieza el ${startDate}` : "";
  const changes: string[] = [];
  if (newAmount !== undefined) changes.push(`queda en ${money(newAmount, planCurrency)}`);
  else if (newCurrency !== undefined) changes.push(`ahora está en ${newCurrency}`);
  if (newName !== undefined) changes.push(`ahora se llama "${newName}"`);
  if (dueDay !== undefined) changes.push(`se cobra el día ${dueDay}`);
  const changesText = changes.length ? changes.join(", ") : "queda igual";
  return { status: "done", summary: `Dejé el gasto fijo así: ${changesText}${startText}. No registré ningún pago hoy. CONFIRMA al usuario el cambio y, si hay, la fecha de inicio.` };
}

async function executeSchedule(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const dueDate = validISODate(args.dueDate) ?? "";
  if (!name) return { status: "needs_info", summary: "¿Qué pago futuro recuerdo?" };
  if (!dueDate) {
    return {
      status: "needs_info",
      summary:
        "¿Para qué fecha real? Usa YYYY-MM-DD; no guardé una fecha inexistente.",
    };
  }
  const amount = Number.isFinite(Number(args.amount)) && Number(args.amount) > 0 ? Number(args.amount) : null;
  const recurring = args.recurring === true;

  // A scheduled/recurring commitment is denominated in the user's base currency
  // (no source movement yet), never a blind USD.
  const currency = ctx.baseCurrency;
  if (recurring) {
    if (amount == null) {
      return {
        status: "needs_info",
        summary:
          `¿De cuánto es "${name}" cada mes? No creé un gasto fijo activo en 0 ni un compromiso sin monto.`,
      };
    }
    const created = await createFixedExpense({
      userId: ctx.userId,
      name,
      amount,
      currency,
      category: category(args.category, "other"),
      frequency: "monthly",
      startDate: dueDate,
      operationKey: agentActionDedupe(ctx, "schedule-recurring", [
        name,
        amount,
        currency,
        dueDate,
      ]),
    });
    if (!created) return { status: "error", summary: "No pude guardar el gasto futuro." };
    return created.replayed
      ? {
          status: "done",
          effect: "noop",
          summary: `Ese gasto futuro ya estaba anotado por este mismo pedido; no lo dupliqué.`,
        }
      : { status: "done", summary: `Anotado: ${name}${amount ? ` ${money(amount, currency)}` : ""} mensual, empieza el ${dueDate}. No lo cuento hasta que arranque.` };
  }
  const created = await createScheduledPayment({
    userId: ctx.userId,
    name,
    amount,
    currency,
    category: category(args.category, "other"),
    dueDate,
    recurring: false,
    rawInput: ctx.rawMessage,
    operationKey: agentActionDedupe(ctx, "schedule-payment", [
      name,
      amount,
      currency,
      dueDate,
    ]),
  });
  if (!created) return { status: "error", summary: "No pude guardar el recordatorio." };
  return created.replayed
    ? {
        status: "done",
        effect: "noop",
        summary: `Ese pago programado ya estaba anotado por este mismo pedido; no lo dupliqué.`,
      }
    : { status: "done", summary: `Listo, te recuerdo ${name}${amount ? ` por ${money(amount, currency)}` : ""} el ${dueDate}. No lo registro como gasto hasta que lo pagues.` };
}

async function executeSetAccountLiquidity(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const accountId = typeof args.accountId === "string" ? args.accountId : "";
  if (args.liquidity !== "liquid" && args.liquidity !== "non_liquid") {
    return {
      status: "needs_info",
      summary:
        "¿Esta cuenta es líquida para gastar o no líquida/protegida? No cambié su clasificación.",
    };
  }
  const liquidity = args.liquidity;
  const acct = ctx.accounts.find((a) => a.id === accountId);
  if (!acct) return { status: "needs_info", summary: "No reconozco esa cuenta; pregúntale cuál es." };
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("accounts")
      .update({ liquidity })
      .eq("id", accountId)
      .eq("user_id", ctx.userId)
      .select("id")
      .maybeSingle();
    if (error || data?.id !== accountId) {
      return { status: "error", summary: error?.message ?? "No pude probar el cambio de liquidez; no afirmes que se guardó." };
    }
    acct.liquidity = liquidity;
    return {
      status: "done",
      summary:
        liquidity === "non_liquid"
          ? `${acct.name} marcada como ahorro/inversión: ya NO la cuento como disponible para gastar, solo la menciono aparte.`
          : `${acct.name} marcada como cuenta para gastar (líquida).`,
    };
  } catch (error) {
    return { status: "error", summary: error instanceof Error ? error.message : "set_account_liquidity failed" };
  }
}

async function executeReconcileBalance(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const accountId = typeof args.accountId === "string" ? args.accountId : "";
  const realBalance = Number(args.realBalance);
  const account = ctx.accounts.find((a) => a.id === accountId);
  if (!account) return { status: "needs_info", summary: "¿Cuál de las cuentas es la que ves distinta?" };
  if (!Number.isFinite(realBalance) || realBalance < 0) {
    return { status: "needs_info", summary: "¿Cuál es el saldo real que ves en esa cuenta?" };
  }
  if (
    ctx.operationManifestAuthorized !== true &&
    asksAboutPastReconcile(ctx.rawMessage)
  ) {
    const recent = await readRecentTransactionsForCorrection(ctx.userId);
    if (!moneyReadPublishable(recent)) {
      return {
        status: "error",
        summary:
          "No pude leer el historial completo del cuadre anterior, así que no moví nada ni voy a inventar la diferencia. Reinténtalo en un rato.",
      };
    }
    const previous = latestReconcileAdjustment(
      account.id,
      recent.recent.transactions,
      recent.recent.reversedOriginalIds,
    );
    if (!previous) {
      return {
        status: "done",
        effect: "read",
        summary: `No encontré un ajuste de cuadre activo reciente para ${account.name}. No escribí nada.`,
      };
    }
    return {
      status: "done",
      effect: "read",
      data: { transactionId: previous.id, amount: previous.amount, direction: previous.direction },
      summary:
        `El cuadre anterior de ${account.name} fue ${previous.direction === "up" ? "por +" : "por −"}${money(previous.amount, previous.currency)}. ` +
        `Esto salió del movimiento guardado ${previous.id}; NO ejecuté otro cuadre.`,
    };
  }
  try {
    // Monotonic per-turn sequence: the 1st reconcile uses seq 1, the 2nd seq 2,
    // etc. — so two reconciliations in one turn cannot collide on the same op id.
    // The counter resets per agent run, so a retry of the whole delivery
    // reproduces the same seq assignments (durable idempotency).
    ctx.reconcileSeq ??= { n: 0 };
    const seq = (ctx.reconcileSeq.n += 1);
    const r = await reconcileAccountBalance({
      userId: ctx.userId,
      account,
      targetBalanceBase: realBalance,
      message: ctx.rawMessage,
      channel: ctx.channel,
      // Stable per-turn reconcile op id → a channel retry reuses it and the
      // durable idempotency (migration 020) returns the original result.
      operationId: reconcileOperationId(ctx.operationId, seq),
    });
    if (r.alreadyMatched) {
      // J-8 (D4): esto NO es una acción realizada. En la beta, «¿cuánto cuadraste?»
      // se respondió RE-EJECUTANDO este write: la cuenta ya estaba en el objetivo,
      // salió `alreadyMatched`, y el usuario recibió «Fue 0$» como si ése hubiera
      // sido el ajuste real (había sido 743.93). Una pregunta se contesta leyendo,
      // no volviendo a escribir. La marca `noop` viaja para que no se narre como hecho.
      return {
        status: "done",
        data: { noop: true },
        effect: "noop",
        summary: `NO escribí nada: ${account.name} ya estaba en ${money(realBalance, account.currency)}. Si el usuario está PREGUNTANDO por un cuadre anterior, NO respondas con este cero — búscalo con list_recent_movements y cita ESE monto.`,
      };
    }
    const dir = r.delta > 0 ? "faltaba sumar" : "sobraba";
    return {
      status: "done",
      data: r.transactionId ? { transactionId: r.transactionId } : { noop: true },
      summary: `Ajusté ${account.name} a ${money(r.newBalanceBase, account.currency)} (${dir} ${money(Math.abs(r.delta), account.currency)}). Lo registré como AJUSTE de cuadre, no como ingreso. Confírmaselo así.`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "reconcile failed";
    if (/KIPU_FX_REQUIRED/.test(msg)) {
      return {
        status: "needs_info",
        summary: `Esa cuenta (${account.name}) está en una moneda distinta a tu moneda base; todavía no puedo cuadrarla sin un tipo de cambio confiable. Dímelo en tu moneda base o lo vemos aparte.`,
      };
    }
    return { status: "error", summary: msg };
  }
}

/** A question about an already-applied reconcile is a READ, never permission to
 * re-run the writer with the old target. Keep this structural and narrow:
 * commands such as "cuadra/ajusta la cuenta a 0" remain writes. */
export function asksAboutPastReconcile(rawMessage: string): boolean {
  const text = normName(rawMessage);
  const asks = /(?:cuanto|cual|que monto|de cuanto)/.test(text);
  const past = /(?:fue|era|quedo|cuadraste|ajustaste|habias cuadrado|habias ajustado)/.test(text);
  const subject = /(?:diferencia|cuadre|ajuste|balance)/.test(text);
  return asks && past && subject;
}

export function latestReconcileAdjustment(
  accountId: string,
  transactions: StoredTransaction[],
  reversedOriginalIds: Set<string>,
): { id: string; amount: number; currency: string; direction: "up" | "down" } | null {
  const row = transactions.find(
    (tx) =>
      tx.type === "adjustment" &&
      !reversedOriginalIds.has(tx.id) &&
      (tx.sourceAccountId === accountId || tx.destinationAccountId === accountId),
  );
  if (!row) return null;
  return {
    id: row.id,
    amount: row.originalAmount,
    currency: row.originalCurrency,
    direction: row.destinationAccountId === accountId ? "up" : "down",
  };
}

async function executeSetSavingsPlan(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const pick = (v: unknown): number | undefined =>
    Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined;
  const monthlySavings = pick(args.monthlySavings);
  const monthlyInvestment = pick(args.monthlyInvestment);
  const essentialMonthlyEstimate = pick(args.essentialMonthlyEstimate);
  const invalidFields = [
    ["monthlySavings", args.monthlySavings, monthlySavings],
    ["monthlyInvestment", args.monthlyInvestment, monthlyInvestment],
    [
      "essentialMonthlyEstimate",
      args.essentialMonthlyEstimate,
      essentialMonthlyEstimate,
    ],
  ].filter(
    ([, raw, parsed]) => raw !== undefined && raw !== null && parsed === undefined,
  );
  if (invalidFields.length > 0) {
    return {
      status: "needs_info",
      summary:
        `Estos montos mensuales deben ser números mayores o iguales a 0: ${invalidFields.map(([name]) => name).join(", ")}. ` +
        "No guardé solo la parte que sí entendí.",
    };
  }
  if (monthlySavings === undefined && monthlyInvestment === undefined && essentialMonthlyEstimate === undefined) {
    return { status: "needs_info", summary: "Dime cuánto ahorras/inviertes al mes o tu estimado de gastos esenciales." };
  }
  const ok = await setMargenCommitments({
    userId: ctx.userId,
    monthlySavings,
    monthlyInvestment,
    essentialMonthlyEstimate,
  });
  if (!ok) return { status: "error", summary: "No pude guardar el plan de ahorro/inversión." };
  const parts: string[] = [];
  if (monthlySavings !== undefined) parts.push(`ahorro ${money(monthlySavings, ctx.snapshot.baseCurrency)}/mes`);
  if (monthlyInvestment !== undefined) parts.push(`inversión ${money(monthlyInvestment, ctx.snapshot.baseCurrency)}/mes`);
  if (essentialMonthlyEstimate !== undefined) parts.push(`esenciales ~${money(essentialMonthlyEstimate, ctx.snapshot.baseCurrency)}/mes`);
  return {
    status: "done",
    summary: `Guardado: ${parts.join(", ")}. Ahora lo reservo antes de calcular tu Saldo Kipu, así puedes gastar tranquilo sin tocar eso. (El Saldo Kipu se recalcula en tu próxima consulta.)`,
  };
}

// Stage 32 (Item A4) — the "sí, actualízalo" path for per-category budgets. The
// documented budget category set (budget_categories rows are spend plans, so
// "income" is excluded) with the Spanish labels Kipu speaks.
const BUDGET_LABEL_ES: Record<string, string> = {
  food: "Comida",
  transport: "Transporte",
  shopping: "Compras",
  subscriptions: "Suscripciones",
  travel: "Viajes",
  housing: "Vivienda",
  utilities: "Servicios",
  health: "Salud",
  education: "Educación",
  entertainment: "Entretenimiento",
  family: "Familia",
  debt: "Deuda",
  savings: "Ahorro",
  other: "Otros",
};

// Loose Spanish-label resolution ("comida", "el súper", "salidas") against the
// documented set. Normalized (case/diacritics); returns null when nothing
// matches so the tool asks instead of guessing a category.
const BUDGET_CATEGORY_ALIASES: [FinancialCategory, string[]][] = [
  ["food", ["comida", "alimentacion", "alimentos", "mercado", "supermercado", "super", "restaurante"]],
  ["transport", ["transporte", "movilidad", "gasolina", "nafta", "taxi", "uber", "bus"]],
  ["shopping", ["compras", "ropa", "shopping"]],
  ["subscriptions", ["suscripcion", "suscripciones", "streaming"]],
  ["travel", ["viaje", "viajes"]],
  ["housing", ["vivienda", "arriendo", "renta", "alquiler", "casa"]],
  ["utilities", ["servicios", "luz", "agua", "internet", "gas"]],
  ["health", ["salud", "medicina", "farmacia"]],
  ["education", ["educacion", "estudios", "colegio", "universidad"]],
  ["entertainment", ["entretenimiento", "salidas", "ocio", "diversion", "cine"]],
  ["family", ["familia"]],
  ["debt", ["deuda", "deudas"]],
  ["savings", ["ahorro", "ahorros"]],
  ["other", ["otro", "otros", "varios"]],
];

function resolveBudgetCategoryLabel(raw: string): FinancialCategory | null {
  const t = raw.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  if (!t) return null;
  for (const [cat, aliases] of BUDGET_CATEGORY_ALIASES) {
    if (aliases.some((a) => t === a || t.includes(a))) return cat;
  }
  return null;
}

async function executeUpdateBudgetCategory(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const explicit =
    typeof args.category === "string" &&
    args.category !== "income" &&
    VALID_CATEGORIES.has(args.category as FinancialCategory)
      ? (args.category as FinancialCategory)
      : null;
  const fromLabel =
    !explicit && typeof args.categoryLabel === "string"
      ? resolveBudgetCategoryLabel(args.categoryLabel)
      : null;
  const cat = explicit ?? fromLabel;
  if (!cat) {
    return {
      status: "needs_info",
      summary: `No reconozco esa categoría de presupuesto. Las válidas son: ${Object.values(BUDGET_LABEL_ES).join(", ")}. Pregúntale a cuál se refiere.`,
    };
  }
  const amountRaw = Number(args.newMonthlyAmount);
  if (!Number.isFinite(amountRaw) || amountRaw <= 0) {
    return { status: "needs_info", summary: "¿En cuánto queda el presupuesto MENSUAL de esa categoría?" };
  }
  const stated =
    typeof args.currency === "string" && /^[A-Za-z]{3}$/.test(args.currency.trim())
      ? (args.currency.trim().toUpperCase() as CurrencyCode)
      : null;
  // Store the budget in the currency the user actually named (NATIVE), so the
  // context builder re-values it at the LIVE rate every turn instead of freezing
  // it at today's. We still REQUIRE a known rate for a non-base currency — not to
  // convert-and-freeze, but because a native budget the engine can't convert would
  // corrupt the base-denominated Margen. No rate → refuse (never a fabricated 1:1).
  // Base (or no currency named) is stored as-is.
  const foreign = stated != null && stated !== ctx.baseCurrency;
  let baseEquiv = toCents(amountRaw);
  if (foreign) {
    const res = convertFx(amountRaw, stated as CurrencyCode, ctx.baseCurrency, ctx.fxRates ?? []);
    if (!res.ok) {
      return {
        status: "needs_info",
        summary: `El monto está en ${stated} y tu moneda base es ${ctx.baseCurrency}: no tengo un tipo de cambio confiable de ese par y NUNCA lo invento. Pregunta a cuánto está ${stated}/${ctx.baseCurrency}, guárdalo con set_exchange_rate y reintenta con el mismo monto.`,
      };
    }
    baseEquiv = toCents(res.baseAmount);
  }
  const storeCurrency = (foreign ? (stated as CurrencyCode) : ctx.baseCurrency);
  // Stage H (P1-1/P1-3) — for an OBJECTIVE category the current pointer AND the
  // month's immutable version must land TOGETHER (one RPC = one transaction):
  // a partial write would move the objective while losing its history, and the
  // user would be told it worked. The month is the USER'S; amount_base freezes
  // the equivalence as decided today so a later FX move can't rewrite it.
  const isObjective = isObjectiveCategory(cat);
  const ok = await upsertBudgetObjective({
    userId: ctx.userId,
    category: cat,
    amount: toCents(amountRaw),
    currency: storeCurrency,
    effectiveMonth: isObjective ? makeDayKey(ctx.briefing?.timezone ?? null)(new Date()).slice(0, 7) : null,
    amountBase: isObjective ? baseEquiv : null,
    baseCurrency: isObjective ? ctx.baseCurrency : null,
  });
  if (!ok) {
    return {
      status: "error",
      summary: "No pude guardar ese cambio (no cambié NADA — ni el objetivo ni su historial). Dile que no quedó guardado y ofrécele reintentar; no afirmes que lo actualizaste.",
    };
  }
  ctx.dirty = true;
  const label = BUDGET_LABEL_ES[cat] ?? cat;
  const nativeShown = money(amountRaw, storeCurrency);
  const baseNote = foreign
    ? ` (≈ ${money(baseEquiv, ctx.baseCurrency)} a tu tasa de hoy; se recalcula solo si cambia la tasa)`
    : "";
  return {
    status: "done",
    summary: `Listo: el presupuesto mensual de ${label} queda en ${nativeShown}${baseNote}. Es un cambio de PLAN — no registré ningún gasto; su seguimiento del mes se recalcula con este número. Confírmalo cálido y breve.`,
  };
}

async function executeSetEngagementMode(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const mode =
    args.mode === "paused" ||
    args.mode === "light" ||
    args.mode === "normal"
      ? args.mode
      : null;
  if (!mode) {
    return {
      status: "needs_info",
      summary:
        "El modo debe ser normal, ligero o pausado; no cambié tus recordatorios.",
    };
  }
  const pauseDays = Number(args.pauseDays);
  if (
    args.pauseDays != null &&
    (!Number.isFinite(pauseDays) || pauseDays <= 0 || pauseDays > 365)
  ) {
    return {
      status: "needs_info",
      summary:
        "La pausa debe ser un número de días entre 1 y 365; no cambié el modo.",
    };
  }
  const pausedUntil =
    mode === "paused" && Number.isFinite(pauseDays) && pauseDays > 0
      ? new Date(Date.now() + pauseDays * 86_400_000).toISOString()
      : null;
  const ok = await setEngagementMode({ userId: ctx.userId, mode, pausedUntil });
  if (!ok) return { status: "error", summary: "No pude guardar el modo." };
  const label =
    mode === "paused"
      ? "Pausé los recordatorios proactivos"
      : mode === "light"
        ? "Activé el modo ligero (mínimo y suave)"
        : "Volví al modo normal";
  return {
    status: "done",
    summary: `${label}.${pausedUntil ? " Lo reactivo cuando me digas o cuando pase ese tiempo." : ""} Sin culpa; cuando quieras retomamos.`,
  };
}

export async function executeSetAmbientPreferences(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const patch: AmbientPrefPatch = {};
  const parts: string[] = [];
  const hour = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : undefined;
  };
  if (args.resume === true) {
    patch.ambientEnabled = true;
    patch.mode = "normal";
    patch.pausedUntilISO = null;
    parts.push("reactivé los recordatorios");
  } else if (args.enabled === false) {
    patch.ambientEnabled = false;
    parts.push("apagué los mensajes proactivos");
  } else if (args.enabled === true) {
    patch.ambientEnabled = true;
    parts.push("activé los mensajes proactivos");
  }
  const pauseDays = Number(args.pauseDays);
  if (Number.isFinite(pauseDays) && pauseDays > 0) {
    patch.mode = "paused";
    patch.pausedUntilISO = new Date(Date.now() + pauseDays * 86_400_000).toISOString();
    parts.push(`pausé ${Math.round(pauseDays)} día(s)`);
  }
  if (typeof args.pauseUntilISO === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.pauseUntilISO)) {
    patch.mode = "paused";
    // Anchor at midday UTC so a localized "el lunes" snooze lifts on the morning
    // of that day in LatAm timezones (UTC-3..-8), never the night before.
    patch.pausedUntilISO = `${args.pauseUntilISO}T12:00:00.000Z`;
    parts.push(`pausé hasta el ${args.pauseUntilISO}`);
  }
  const qs = hour(args.quietHoursStart);
  const qe = hour(args.quietHoursEnd);
  if (qs !== undefined) patch.quietHoursStart = qs;
  if (qe !== undefined) patch.quietHoursEnd = qe;
  if (qs !== undefined || qe !== undefined) parts.push("ajusté tus horas de silencio");
  if (["auto", "daily", "weekly", "off"].includes(args.frequency as string)) {
    patch.frequency = args.frequency as AmbientPrefPatch["frequency"];
    parts.push(`frecuencia ${args.frequency}`);
  }
  if (Array.isArray(args.weekdays)) {
    const wd = Array.from(new Set(args.weekdays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)));
    if (wd.length > 0) {
      patch.nudgeWeekdays = wd;
      if (patch.frequency === undefined) patch.frequency = "weekly";
      parts.push("días específicos de la semana");
    } else if (args.frequency === "weekly") {
      // "solo los viernes" but no day survived → ask, never silently nudge daily.
      return { status: "needs_info", summary: "¿Qué día(s) de la semana quieres que te escriba?" };
    }
  }
  const mpd = Number(args.maxPerDay);
  if (Number.isFinite(mpd) && mpd >= 0 && mpd <= 10) {
    patch.maxNudgesPerDay = Math.floor(mpd);
    parts.push(Math.floor(mpd) === 0 ? "ninguno por día" : `máximo ${Math.floor(mpd)} al día`);
  }
  if (typeof args.timezone === "string" && args.timezone.trim()) {
    const tz = args.timezone.trim().slice(0, 60);
    // Only persist a REAL IANA zone — a bad value would silently shift quiet hours.
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: tz });
      patch.timezone = tz;
    } catch {
      // Reject the WHOLE patch before any write. Silently ignoring an invalid
      // zone while applying the other preferences would answer "done" to a
      // request whose day/quiet-hours semantics remain wrong.
      return {
        status: "needs_info",
        summary:
          `No reconozco "${tz}" como zona horaria IANA y no guardé ninguno de estos cambios. ` +
          "Pide una zona como America/Argentina/Buenos_Aires o la ciudad del usuario.",
      };
    }
  }
  if (Object.keys(patch).length === 0) {
    return { status: "needs_info", summary: "¿Qué ajusto de los recordatorios: pausar, horario de silencio, frecuencia, o activarlos?" };
  }
  const ok = await saveAmbientPrefs(ctx.userId, patch);
  if (!ok) return { status: "error", summary: "No pude guardar tu preferencia de recordatorios." };
  return {
    status: "done",
    summary: `Ajusté tus recordatorios (${parts.join(", ") || "preferencias"}). Confírmaselo natural, sin tecnicismos, respetando lo que pidió; nada de listas de ajustes.`,
  };
}

async function executeMarkReconciled(ctx: AgentContext): Promise<ToolResult> {
  const ok = await markWeekReconciled(ctx.userId);
  return {
    status: ok ? "done" : "error",
    summary: ok ? "Semana cuadrada y confirmada." : "No pude guardar la conciliación.",
  };
}

/** Durable memory stores the user's words, not a model paraphrase. The model
 * may classify the note, but it cannot add facts that later influence account
 * choice, risk posture or coaching. A bare confirmation contains no reusable
 * fact and is deliberately rejected. */
export function userAuthoredMemoryText(rawMessage: string): string | null {
  const text = rawMessage.replace(/\s+/g, " ").trim();
  if (
    text.length < 3 ||
    explicitActionConfirmation(text) ||
    !/[\p{L}]{2,}/u.test(text)
  ) {
    return null;
  }
  return text.slice(0, 500);
}

async function executeRememberFact(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const content = userAuthoredMemoryText(ctx.rawMessage);
  if (!content) {
    return {
      status: "needs_info",
      summary:
        "No encontré un hecho nuevo dicho por el usuario en este turno. No guardé la paráfrasis propuesta por el modelo; pídele que lo diga con sus palabras.",
    };
  }
  const noteType = VALID_NOTE_TYPES.has(args.noteType as string) ? (args.noteType as string) : "general";
  const created = await insertIdempotentUserRow({
    table: "user_context_notes",
    userId: ctx.userId,
    row: {
      user_id: ctx.userId,
      note_type: noteType,
      content,
      source: "manual",
      is_active: true,
    },
    identity: {
      operationKey: agentActionDedupe(ctx, "remember-fact", [
        noteType,
        content,
      ]),
    },
  });
  if (!created) {
    return { status: "error", summary: "No pude probar que el recuerdo se guardara." };
  }
  return created.replayed
    ? {
        status: "done",
        effect: "noop",
        summary: "Ese recuerdo ya estaba guardado por este mismo mensaje; no lo dupliqué.",
      }
    : { status: "done", summary: `Remembered (${noteType}): ${content.slice(0, 120)}` };
}

// ── Stage 26 — total control by chat: incomes, scheduled changes, accounts.
// Changing a salary / pausing a subscription / programming a future raise are
// PLAN updates: they never touch the transaction ledger. Every write is scoped
// to ctx.userId through the typed stores.

const normName = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function incomeFrequencyText(f: string): string {
  return f === "weekly" ? "a la semana" : f === "biweekly" ? "por quincena" : f === "yearly" ? "al año" : "al mes";
}

function cadenceText(c: ScheduledCadence): string {
  return c === "monthly" ? "cada mes" : c === "quarterly" ? "cada 3 meses" : c === "semiannual" ? "cada 6 meses" : c === "yearly" ? "cada año" : "";
}

function todayISO(ctx: Pick<AgentContext, "timezone">): string {
  if (!ctx.timezone) throw new Error("KIPU_TIMEZONE_REQUIRED");
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: ctx.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    throw new Error("KIPU_TIMEZONE_REQUIRED");
  }
}

// Resolve one income by how the user refers to it. Exactly one name match →
// that one; no match but a single income → that one ("mi sueldo" vs its real
// stored name); anything else → ambiguous, the caller asks.
// Generic self-references ("mi sueldo", "mi ingreso") may fall back to the
// single income; a SPECIFIC name that matches nothing must NOT — "el arriendo
// que me pagan" is probably a different income, not a rename of the only one.
const GENERIC_INCOME_REFS = new Set(["", "sueldo", "mi sueldo", "salario", "mi salario", "ingreso", "mi ingreso", "pago", "mi pago"]);
function resolveIncomeByName(
  incomes: StoredIncomeSource[],
  nameRaw: string,
): StoredIncomeSource | null {
  const target = normName(nameRaw);
  const matches = target
    ? incomes.filter((i) => {
        const n = normName(i.name);
        return n.includes(target) || target.includes(n);
      })
    : [];
  if (matches.length === 1) return matches[0];
  if (matches.length === 0 && incomes.length === 1 && GENERIC_INCOME_REFS.has(target)) return incomes[0];
  return null;
}

export type CalendarLinkedTransactionFact = {
  transaction: { kind: "transaction"; value: string };
  transactionType: string;
  occurredAtISO: string;
  actualSource:
    | { kind: "account" | "debt_account"; value: string; name: string }
    | null;
  destinationAccount:
    | { kind: "account"; value: string; name: string }
    | null;
};

type CalendarExpectedSource = {
  kind: "account" | "debt_account";
  value: string;
  name: string;
};

type CalendarLinkedFactsRead =
  | { ok: true; facts: CalendarLinkedTransactionFact[] }
  | { ok: false };

/** Read evidence for ledger rows that predate the calendar resolution. The
 * typed ids intentionally live under `value`, not `transactionId`: these are
 * evidence, never effects owned by the current operation for replay or undo. */
async function readCalendarLinkedTransactionFacts(
  userId: string,
  transactionIds: string[],
): Promise<CalendarLinkedFactsRead> {
  const orderedIds = [...new Set(transactionIds)].slice(0, 20);
  if (orderedIds.length !== transactionIds.length || orderedIds.length === 0) {
    return { ok: false };
  }
  try {
    const supabase = createSupabaseAdminClient();
    const txRead = await supabase
      .from("transactions")
      .select(
        "id, type, source_account_id, destination_account_id, debt_account_id, occurred_at",
      )
      .eq("user_id", userId)
      .in("id", orderedIds);
    if (txRead.error || !txRead.data || txRead.data.length !== orderedIds.length) {
      return { ok: false };
    }
    const txRows = txRead.data as Array<Record<string, unknown>>;
    const accountIds = new Set<string>();
    const debtIds = new Set<string>();
    for (const row of txRows) {
      if (row.source_account_id) accountIds.add(String(row.source_account_id));
      if (row.destination_account_id) accountIds.add(String(row.destination_account_id));
      if (row.debt_account_id) debtIds.add(String(row.debt_account_id));
    }
    const accountNames = new Map<string, string>();
    if (accountIds.size > 0) {
      const read = await supabase
        .from("accounts")
        .select("id, name")
        .eq("user_id", userId)
        .in("id", [...accountIds]);
      if (read.error || !read.data || read.data.length !== accountIds.size) {
        return { ok: false };
      }
      for (const row of read.data as Array<Record<string, unknown>>) {
        accountNames.set(String(row.id), String(row.name));
      }
    }
    const debtNames = new Map<string, string>();
    if (debtIds.size > 0) {
      const read = await supabase
        .from("debt_accounts")
        .select("id, name")
        .eq("user_id", userId)
        .in("id", [...debtIds]);
      if (read.error || !read.data || read.data.length !== debtIds.size) {
        return { ok: false };
      }
      for (const row of read.data as Array<Record<string, unknown>>) {
        debtNames.set(String(row.id), String(row.name));
      }
    }
    const byId = new Map(txRows.map((row) => [String(row.id), row]));
    const facts: CalendarLinkedTransactionFact[] = [];
    for (const transactionId of orderedIds) {
      const row = byId.get(transactionId);
      if (!row) return { ok: false };
      const sourceAccountId = row.source_account_id
        ? String(row.source_account_id)
        : null;
      const debtAccountId = row.debt_account_id
        ? String(row.debt_account_id)
        : null;
      const destinationAccountId = row.destination_account_id
        ? String(row.destination_account_id)
        : null;
      const occurredAtISO = String(row.occurred_at ?? "");
      if (!/^\d{4}-\d{2}-\d{2}/.test(occurredAtISO)) return { ok: false };
      const actualSource = sourceAccountId
        ? {
            kind: "account" as const,
            value: sourceAccountId,
            name: accountNames.get(sourceAccountId) ?? "",
          }
        : debtAccountId
          ? {
              kind: "debt_account" as const,
              value: debtAccountId,
              name: debtNames.get(debtAccountId) ?? "",
            }
          : null;
      const destinationAccount = destinationAccountId
        ? {
            kind: "account" as const,
            value: destinationAccountId,
            name: accountNames.get(destinationAccountId) ?? "",
          }
        : null;
      if (
        (actualSource && !actualSource.name) ||
        (destinationAccount && !destinationAccount.name)
      ) {
        return { ok: false };
      }
      facts.push({
        transaction: { kind: "transaction", value: transactionId },
        transactionType: String(row.type ?? ""),
        occurredAtISO,
        actualSource,
        destinationAccount,
      });
    }
    return { ok: true, facts };
  } catch {
    return { ok: false };
  }
}

export function calendarPreexistingResolutionReceipt(input: {
  occurrenceId: string;
  facts: CalendarLinkedTransactionFact[];
  expectedSource: CalendarExpectedSource | null;
}): { summary: string; data: Record<string, unknown> } {
  const actualSources = [
    ...new Map(
      input.facts
        .map((fact) => fact.actualSource)
        .filter((source): source is NonNullable<typeof source> => source != null)
        .map((source) => [`${source.kind}:${source.value}`, source]),
    ).values(),
  ];
  const sourceMismatch =
    input.expectedSource != null &&
    !(
      actualSources.length === 1 &&
      actualSources[0].kind === input.expectedSource.kind &&
      actualSources[0].value === input.expectedSource.value
    )
      ? {
          kind: "source_account_mismatch",
          expected: input.expectedSource,
          actual: actualSources,
        }
      : null;
  const registeredFacts = input.facts
    .map((fact) => {
      const date = fact.occurredAtISO.slice(0, 10);
      if (fact.actualSource) return `${date} desde ${fact.actualSource.name}`;
      if (fact.destinationAccount) {
        return `${date} hacia ${fact.destinationAccount.name}`;
      }
      return date;
    })
    .join("; ");
  const mismatchSummary = sourceMismatch
    ? actualSources.length > 0
      ? ` Los pagos ya registrados salieron de ${actualSources.map((source) => source.name).join(", ")}, no de ${input.expectedSource!.name}.`
      : ` Las transacciones ligadas no tienen como origen ${input.expectedSource!.name}.`
    : "";
  return {
    summary:
      `Resolución de calendario sin movimiento nuevo: los pagos ya estaban registrados (${registeredFacts}).` +
      mismatchSummary,
    data: {
      receiptKind: "calendar_preexisting_transactions",
      receiptRole: "evidence_only",
      occurrenceId: input.occurrenceId,
      movedMoney: false,
      linkedTransactions: input.facts,
      expectedSource: input.expectedSource,
      sourceMismatch,
    },
  };
}

async function executeResolveRecurring(
  args: Record<string, unknown>,
  ctx: AgentContext,
  serverAuthorized = false,
): Promise<ToolResult> {
  const action = String(args.action ?? "");
  if (!["observe", "confirm", "correct", "unpaid", "retract", "skip", "snooze", "dismiss"].includes(action)) {
    return {
      status: "needs_info",
      summary: "¿Solo anoto cuánto vino, ya se pagó, hay que corregirlo, marcarlo como que no llegó, posponerlo, o dejar de preguntar?",
    };
  }
  const paymentAccountId =
    typeof args.paymentSourceAccountId === "string" &&
    args.paymentSourceAccountId.trim()
      ? args.paymentSourceAccountId.trim()
      : null;
  const paymentCardId =
    typeof args.paymentSourceCardId === "string" &&
    args.paymentSourceCardId.trim()
      ? args.paymentSourceCardId.trim()
      : null;
  if (paymentAccountId && paymentCardId) {
    return {
      status: "needs_info",
      summary:
        "Ese pago no puede salir a la vez de una cuenta y de una tarjeta. Pregunta cuál instrumento se usó realmente.",
    };
  }
  if (
    action === "observe" &&
    (paymentAccountId || paymentCardId || args.paymentDate != null)
  ) {
    return {
      status: "needs_info",
      summary:
        "Solo informó la factura, no un pago. No uses cuenta/tarjeta/fecha de pago hasta que confirme que el dinero se movió.",
    };
  }
  const paymentDateISO =
    args.paymentDate == null
      ? undefined
      : validOccurredAtISO(args.paymentDate, todayISO(ctx))?.slice(0, 10);
  if (args.paymentDate != null && !paymentDateISO) {
    return {
      status: "needs_info",
      summary:
        "La fecha de pago no es una fecha válida o está en el futuro. Pregunta el día real; no moví dinero.",
    };
  }
  const cycleDateWasStated = args.cycleDate != null;
  const today = todayISO(ctx);
  const cycleFactDate =
    args.cycleDate == null
      ? today
      : validCalendarDateISO(args.cycleDate);
  if (!cycleFactDate) {
    return {
      status: "needs_info",
      summary:
        "La fecha del ciclo no es una fecha real YYYY-MM-DD. Pregunta a qué factura/mes corresponde; no abrí ningún aviso ni moví dinero.",
    };
  }
  let paymentSource: ResolveInput["paymentSource"];
  if (paymentAccountId) {
    const account = ctx.accounts.find((row) => row.id === paymentAccountId);
    if (!account) {
      return {
        status: "needs_info",
        summary:
          "No pude probar esa cuenta de pago entre sus cuentas activas. Pregunta cuál usó; no moví dinero.",
      };
    }
    const gate = await guardResolvedEntityChoice({
      toolName: "resolve_recurring_occurrence",
      args,
      ctx,
      label: "la cuenta de pago",
      chosen: account,
      peers: ctx.accounts,
      serverAuthorized,
    });
    if (gate) return gate;
    paymentSource = {
      id: account.id,
      currency: account.currency,
      isCard: false,
    };
  } else if (paymentCardId) {
    const cards = ctx.debtAccounts.filter((row) => row.type === "credit_card");
    const card = cards.find((row) => row.id === paymentCardId);
    if (!card) {
      return {
        status: "needs_info",
        summary:
          "No pude probar esa tarjeta entre sus tarjetas activas. Pregunta cuál usó; no moví dinero.",
      };
    }
    const gate = await guardResolvedEntityChoice({
      toolName: "resolve_recurring_occurrence",
      args,
      ctx,
      label: "la tarjeta de pago",
      chosen: card,
      peers: cards,
      serverAuthorized,
    });
    if (gate) return gate;
    paymentSource = {
      id: card.id,
      currency: card.currency,
      isCard: true,
    };
  }
  const match = await matchOpenOccurrence(ctx.userId, {
    occurrenceId: typeof args.occurrenceId === "string" ? args.occurrenceId : null,
    flowName: typeof args.flowName === "string" ? args.flowName : null,
    kind:
      typeof args.fixedExpenseId === "string" ? "expense" : null,
    fixedExpenseId:
      typeof args.fixedExpenseId === "string" ? args.fixedExpenseId : null,
    occurrenceDate: cycleDateWasStated ? cycleFactDate : null,
  });
  // J-3 — «no pude leer» ≠ «no sé a cuál te referís». Preguntarle «¿a cuál?»
  // sobre algo que ACABA de responder lo deja pending, y el notifier se lo vuelve
  // a preguntar mañana. Se dice la verdad y se pide reintento.
  if (!match.ok) {
    return {
      status: "needs_info",
      summary:
        "No pude leer tus flujos del calendario, así que NO resolví nada ni registré un movimiento nuevo. Dile que no pudiste verificarlo ahora y que lo reintente en un rato.",
    };
  }
  let occurrenceId = match.id;
  // A variable utility bill can arrive before the nightly calendar reaches
  // its expected day. Absence of an occurrence is not absence of the plan:
  // prove the complete catalog, resolve the human entity, derive the SAME
  // canonical due date the cron will use, then create the pending row
  // idempotently. The money/observation still lands through the atomic K RPC.
  if (
    match.id === null &&
    match.reason === "none" &&
    ["observe", "confirm", "correct", "retract"].includes(action) &&
    (typeof args.fixedExpenseId === "string" ||
      typeof args.flowName === "string")
  ) {
    const catalogRead = await readFixedExpenseCatalog(ctx.userId);
    if (!moneyReadPublishable(catalogRead)) {
      return {
        status: "needs_info",
        summary:
          "No pude comprobar el catálogo completo de gastos fijos. No creé ningún aviso ni movimiento; dile que lo reintente.",
      };
    }
    const requestedId =
      typeof args.fixedExpenseId === "string" ? args.fixedExpenseId : "";
    const wanted =
      typeof args.flowName === "string" ? normName(args.flowName) : "";
    const namedCatalog = wanted
      ? catalogRead.expenses.filter((expense) => {
          const candidate = normName(expense.name);
          return candidate.includes(wanted) || wanted.includes(candidate);
        })
      : [];
    const catalogTarget = requestedId
      ? catalogRead.expenses.find((expense) => expense.id === requestedId) ?? null
      : namedCatalog.length === 1
        ? namedCatalog[0]
        : null;
    const catalogTargetMatchesName =
      catalogTarget != null &&
      (!wanted ||
        normName(catalogTarget.name).includes(wanted) ||
        wanted.includes(normName(catalogTarget.name)));

    // `dismissed` means “stop reminding me”, not “forget this invoice”.
    // Those facts intentionally stay outside OPEN_STATUSES, so a later
    // “ya pagué la luz” must recover the exact historical occurrence from the
    // durable known-bill feed before deciding that no calendar item exists.
    // The complete read is essential: uniqueness on a capped list is fiction.
    if (catalogTargetMatchesName) {
      const knownRead = await readKnownVariableFixedBills(ctx.userId);
      if (!knownRead.ok || !knownRead.complete) {
        return {
          status: "needs_info",
          summary:
            "No pude comprobar todas las facturas variables conocidas. No abrí otro ciclo ni registré dinero; dile que lo reintente.",
        };
      }
      const knownMatch = matchKnownVariableFixedBillCycle({
        bills: knownRead.bills,
        fixedExpenseId: catalogTarget.id,
        cycleDate: cycleDateWasStated ? cycleFactDate : null,
        includeSettled: action === "correct" || action === "retract",
      });
      if (!knownMatch.ok) {
        return {
          status: "needs_info",
          summary:
            "Hay más de una factura conocida de ese gasto todavía sin pago. Pregunta a qué mes/ciclo se refiere; no cambié ninguna.",
        };
      }
      if (knownMatch.bill) {
        const historicalGate = await guardResolvedEntityChoice({
          toolName: "resolve_recurring_occurrence",
          args,
          ctx,
          label: "el gasto fijo variable histórico",
          chosen: catalogTarget,
          peers: catalogRead.expenses,
          serverAuthorized,
        });
        if (historicalGate) return historicalGate;
        occurrenceId = knownMatch.bill.occurrenceId;
      }
    }

    // `retract` never manufactures a cycle. Its only valid name-based
    // recovery here is the durable observed/dismissed fact proved above.
    // Without that fact, creating a fresh pending row and immediately
    // retracting it would fabricate audit history for a bill Kipu never knew.
    if (occurrenceId === null && action === "retract") {
      return {
        status: "needs_info",
        summary:
          "No encontré una factura variable conocida que pueda retirar. Pide el mes/ciclo exacto; no creé ningún aviso ni cambié dinero.",
      };
    }

    const activeVariables = catalogRead.expenses.filter(
      (expense) => expense.isVariable === true && expense.isActive !== false,
    );
    const named = wanted
      ? activeVariables.filter((expense) => {
          const candidate = normName(expense.name);
          return candidate.includes(wanted) || wanted.includes(candidate);
        })
      : [];
    const target = requestedId
      ? activeVariables.find((expense) => expense.id === requestedId) ?? null
      : named.length === 1
        ? named[0]
        : null;
    if (
      occurrenceId === null &&
      (!target ||
        (wanted &&
          !(
            normName(target.name).includes(wanted) ||
            wanted.includes(normName(target.name))
          )))
    ) {
      return {
        status: "needs_info",
        summary:
          activeVariables.length === 0
            ? "No encuentro un gasto fijo variable activo para esa factura. Pregunta si quiere crearlo primero."
            : `No puedo probar cuál factura variable es. Tiene: ${activeVariables.map((expense) => `"${expense.name}"`).join(", ")}. Pregúntale cuál.`,
      };
    }
    if (occurrenceId === null) {
      // The branch above proved this before any async work. Keeping a stable
      // local binding also prevents a future refactor from accidentally
      // consulting a different catalog row midway through the decision.
      const activeTarget = target!;
      const entityGate = await guardResolvedEntityChoice({
        toolName: "resolve_recurring_occurrence",
        args,
        ctx,
        label: "el gasto fijo variable",
        chosen: activeTarget,
        peers: activeVariables,
        serverAuthorized,
      });
      if (entityGate) return entityGate;

      const forecastRead = await readVariableFixedForecasts(ctx.userId);
      if (!forecastRead.ok || !forecastRead.complete) {
        return {
          status: "needs_info",
          summary:
            "No pude probar la estimación vigente de esa factura. No creé ningún aviso ni movimiento; dile que lo reintente.",
        };
      }
      const forecast = forecastRead.forecasts.find(
        (row) => row.fixedExpenseId === activeTarget.id,
      );
      if (
        !forecast ||
        !variableFixedForecastMatchesPlan(forecast, activeTarget) ||
        !Number.isFinite(forecast.planningAmount)
      ) {
        return {
          status: "needs_info",
          summary:
            "La factura variable no tiene una estimación nativa publicable. No asumí el monto declarado; dile que lo reintente.",
        };
      }
    const occurrenceDate = reportedOccurrenceDate(
      {
        frequency: activeTarget.frequency as PaymentFrequency,
        expectedDay: activeTarget.expectedDay,
        expectedWeekday: activeTarget.expectedWeekday,
        payAnchorDate: activeTarget.payAnchorDate,
      },
      cycleFactDate,
    );
    if (
      occurrenceDate &&
      !cycleDateWasStated &&
      occurrenceDate > today
    ) {
      return {
        status: "needs_info",
        summary:
          `Ese plan vence el ${occurrenceDate}, pero también podría tratarse del ciclo anterior que llegó tarde. Pregunta a qué mes/ciclo corresponde y vuelve con cycleDate; no abrí ningún aviso ni moví dinero.`,
      };
    }
    if (
      occurrenceDate &&
      !reportedOccurrenceIsPlausible(
        {
          frequency: activeTarget.frequency as PaymentFrequency,
          expectedDay: activeTarget.expectedDay,
          expectedWeekday: activeTarget.expectedWeekday,
          payAnchorDate: activeTarget.payAnchorDate,
        },
        today,
        occurrenceDate,
      )
    ) {
      return {
        status: "needs_info",
        summary:
          "Ese ciclo queda demasiado lejos en el futuro para el plan vigente. Revisa la fecha; no abrí ningún aviso ni moví dinero.",
      };
    }
    if (
      !occurrenceDate ||
      (activeTarget.startDate && occurrenceDate < activeTarget.startDate)
    ) {
      return {
        status: "needs_info",
        summary:
          "No pude ubicar esa factura dentro de un ciclo válido del plan; no registré nada.",
      };
    }
    const cycleRead = await readFixedExpenseCycleOccurrences({
      userId: ctx.userId,
      fixedExpenseId: activeTarget.id,
      frequency: activeTarget.frequency as PaymentFrequency,
      occurrenceDate,
    });
    const cycleVerdict = earlyVariableFixedCycleVerdict({
      cycleRead:
        cycleRead.ok && cycleRead.complete
          ? {
              ok: true,
              complete: true,
              occurrenceIds: cycleRead.occurrences.map((row) => row.id),
            }
          : cycleRead.ok
            ? { ok: true, complete: false, occurrenceIds: [] }
            : { ok: false, complete: false },
      occurrenceDate,
      planCreatedAt: activeTarget.createdAt ?? "",
      regimeStartedAt: forecast.regimeStartedAt,
    });
    if (!cycleVerdict.ok && cycleVerdict.reason === "unreadable") {
      return {
        status: "needs_info",
        summary:
          "No pude probar si ese ciclo ya tenía un aviso histórico. No creé otro ni moví dinero; dile que lo reintente.",
      };
    }
    if (!cycleVerdict.ok && cycleVerdict.reason === "ambiguous") {
      return {
        status: "needs_info",
        summary:
          "Ese ciclo tiene más de un aviso histórico y no puedo elegir uno sin riesgo. No cambié nada; revisa los avisos antes de resolverlo.",
      };
    }
    if (cycleVerdict.ok && cycleVerdict.action === "reuse") {
      occurrenceId = cycleVerdict.occurrenceId;
    } else {
      if (!cycleVerdict.ok) {
        return {
          status: "needs_info",
          summary:
            "Ese ciclo es anterior al plan o a su régimen vigente y no existe un aviso histórico que pruebe cómo estaba configurado. No lo mezclé con el aprendizaje actual: ofrécele registrarlo como gasto puntual sin ligarlo al fijo.",
        };
      }
      const ensured = await createOccurrenceIfAbsent({
        userId: ctx.userId,
        fixedExpenseId: activeTarget.id,
        occurrenceDate,
        kind: "expense",
        mode: "ask",
        expectedAmount: forecast.planningAmount,
        currency: forecast.currency,
      });
      if (!ensured) {
        return {
          status: "needs_info",
          summary:
            "No pude abrir el ciclo de esa factura. No registré dinero; dile que lo reintente.",
        };
      }
      occurrenceId = ensured.occurrence.id;
    }
    }
  }
  if (!occurrenceId) {
    return { status: "needs_info", summary: "¿A cuál de los movimientos sin confirmar te refieres? Nómbralo y lo resuelvo." };
  }
  if (
    ctx.operationManifestAuthorized !== true &&
    statesIncomeArrivedToday(ctx.rawMessage)
  ) {
    const occurrenceRead = await readOccurrenceById(ctx.userId, occurrenceId);
    if (!occurrenceRead.ok || !occurrenceRead.occurrence) {
      return {
        status: "needs_info",
        summary:
          "Dices que un ingreso llegó hoy, pero no pude releer el aviso que el modelo intentó cerrar. No cerré el aviso ni registré un ingreso nuevo; reintenta.",
      };
    }
    const currentDayPlan = planIncomeOccurrenceReply({
      rawMessage: ctx.rawMessage,
      kind: occurrenceRead.occurrence.kind,
      occurrenceDate: occurrenceRead.occurrence.occurrenceDate,
      today,
    });
    if (!currentDayPlan.ok) {
      return {
        status: "needs_info",
        summary:
          `El aviso abierto corresponde al ingreso del ${currentDayPlan.occurrenceDate}, pero el usuario dice que su sueldo llegó hoy (${currentDayPlan.today}). ` +
          "No cerré el aviso viejo ni sumé dinero hoy. Pregunta cuánto sueldo entró hoy y si además quiere cerrar el aviso anterior.",
      };
    }
  }
  const res = await resolveOccurrence({
    userId: ctx.userId,
    occurrenceId,
    action: action as ResolveAction,
    amount: typeof args.amount === "number" ? args.amount : undefined,
    scope: args.scope === "from_now" ? "from_now" : args.scope === "once" ? "once" : undefined,
    snoozeUntilISO: typeof args.snoozeUntil === "string" ? args.snoozeUntil : undefined,
    paymentDateISO,
    defaultPaymentDateISO: today,
    paymentSource,
    operationId: ctx.operationId,
  });
  if (!res.ok) return { status: "needs_info", summary: res.detail };
  ctx.dirty = true;
  if (
    res.movedMoney === false &&
    res.linkedPreexistingTransactionIds &&
    res.linkedPreexistingTransactionIds.length > 0
  ) {
    const factsRead = await readCalendarLinkedTransactionFacts(
      ctx.userId,
      res.linkedPreexistingTransactionIds,
    );
    if (!factsRead.ok) {
      return {
        status: "error",
        summary:
          "El aviso se resolvió sin mover dinero, pero no pude verificar la procedencia de las transacciones ya ligadas. No atribuyas una cuenta de origen.",
        data: {
          receiptKind: "calendar_preexisting_transactions",
          occurrenceId,
          movedMoney: false,
          evidenceStatus: "read_failed",
        },
      };
    }
    const expectedSource = paymentAccountId
      ? {
          kind: "account" as const,
          value: paymentAccountId,
          name:
            ctx.accounts.find((account) => account.id === paymentAccountId)
              ?.name ?? paymentAccountId,
        }
      : paymentCardId
        ? {
            kind: "debt_account" as const,
            value: paymentCardId,
            name:
              ctx.debtAccounts.find((card) => card.id === paymentCardId)
                ?.name ?? paymentCardId,
          }
        : null;
    const receipt = calendarPreexistingResolutionReceipt({
      occurrenceId,
      facts: factsRead.facts,
      expectedSource,
    });
    return {
      status: "done",
      summary: receipt.summary,
      data: receipt.data,
    };
  }
  return {
    status: "done",
    summary: `Flujo recurrente resuelto (${action}): ${res.detail}. Confírmalo cálido y breve; no repitas el monto salvo que ayude.`,
    data:
      res.movedMoney == null
        ? undefined
        : {
            receiptKind: "calendar_resolution",
            occurrenceId,
            movedMoney: res.movedMoney,
          },
  };
}

async function executeUpdateIncome(
  args: Record<string, unknown>,
  ctx: AgentContext,
  serverAuthorized = false,
): Promise<ToolResult> {
  const incomeName = typeof args.incomeName === "string" ? args.incomeName.trim() : "";
  const action = args.action === "pause" || args.action === "resume" || args.action === "end" ? args.action : "update";
  // Ended (cancelled) incomes no longer exist for resolution; paused ones stay
  // findable so "reactiva ese ingreso" works.
  // "No pude leer" no es "no tiene": ofrecerle CREAR un ingreso que ya existe lo
  // duplicaría, y el ingreso es la raíz de todo el tanque.
  const incomesRead = await readIncomeSources(ctx.userId);
  if (!moneyReadPublishable(incomesRead)) {
    return { status: "needs_info", summary: "Ahora mismo no pude leer sus ingresos. NO afirmes que no tiene ninguno ni ofrezcas crearlo; dile que lo reintente en un rato." };
  }
  const incomes = incomesRead.sources.filter((i) => i.status !== "cancelled");
  if (incomes.length === 0) {
    return { status: "needs_info", summary: "No tengo ingresos registrados a tu nombre; ¿lo creo? Dime nombre, monto y frecuencia." };
  }
  const income = resolveIncomeByName(incomes, incomeName);
  if (!income) {
    const list = incomes.map((i) => `"${i.name}" (${money(i.amount, i.currency)} ${incomeFrequencyText(i.frequency)})`).join(", ");
    return {
      status: "needs_info",
      summary:
        incomes.length === 1
          ? `El nombre "${incomeName}" no coincide con su único ingreso registrado: ${list}. Pregúntale si se refiere a ese, o si es un ingreso nuevo (create_income).`
          : `Tiene varios ingresos y no sé cuál es: ${list}. Pregúntale cuál.`,
    };
  }
  const incomeEntityGate = await guardResolvedEntityChoice({
    toolName: "update_income",
    args,
    ctx,
    label: "el ingreso",
    chosen: income,
    peers: incomes,
    serverAuthorized,
  });
  if (incomeEntityGate) return incomeEntityGate;

  if (action !== "update") {
    const mixedUpdateFields = [
      "newAmount",
      "currency",
      "frequency",
      "expectedDay",
      "payAnchorDate",
      "isVariable",
      "isOccasional",
      "minAmount",
      "maxAmount",
    ].filter((key) => args[key] !== undefined);
    if (mixedUpdateFields.length > 0) {
      return {
        status: "needs_info",
        summary:
          `No puedo ${action === "pause" ? "pausar" : action === "resume" ? "reactivar" : "terminar"} el ingreso y cambiar ${mixedUpdateFields.join(", ")} en la misma operación. Elige primero una acción; no guardé nada.`,
      };
    }
    // Ending an income is destructive for the plan (it disappears from
    // resolution): explicit user confirmation first.
    if (action === "end" && args.confirm !== true) {
      return { status: "needs_info", summary: `Terminar el ingreso "${income.name}" (${money(income.amount, income.currency)} ${incomeFrequencyText(income.frequency)}) lo saca de tu plan desde ya. Confirma con el usuario y vuelve a llamar con confirm=true.` };
    }
    const status = action === "pause" ? ("paused" as const) : action === "resume" ? ("active" as const) : ("cancelled" as const);
    const ok = await updateIncomeSourceFields(ctx.userId, income.id, { status });
    if (!ok) return { status: "error", summary: "No pude actualizar ese ingreso." };
    ctx.dirty = true;
    const text =
      action === "pause"
        ? `Pausé el ingreso ${income.name}; no lo cuento en tu Saldo ni en tu flujo hasta que lo reactives.`
        : action === "resume"
          ? `Reactivé el ingreso ${income.name}; lo vuelvo a contar en tu plan.`
          : `Listo, di por terminado el ingreso ${income.name}; ya no lo cuento en tu plan.`;
    return { status: "done", summary: `${text} No registré ningún movimiento.` };
  }

  const newAmount = Number(args.newAmount);
  const hasAmount = Number.isFinite(newAmount) && newAmount > 0;
  const currency = typeof args.currency === "string" && /^[A-Za-z]{3}$/.test(args.currency.trim()) ? args.currency.trim().toUpperCase() : undefined;
  const frequency = ["weekly", "biweekly", "monthly", "yearly"].includes(args.frequency as string) ? (args.frequency as IncomeFrequency) : undefined;
  const expectedDay = Number.isInteger(Number(args.expectedDay)) && Number(args.expectedDay) >= 1 && Number(args.expectedDay) <= 31 ? Number(args.expectedDay) : undefined;
  const payAnchorDate = validISODate(args.payAnchorDate);
  // S31 (item 5.5) — variable-income fields, so a chat salary change can't
  // leave a stale onboarding minimum silently driving the Margen forever.
  const isVariableArg = typeof args.isVariable === "boolean" ? args.isVariable : undefined;
  const minAmount = Number.isFinite(Number(args.minAmount)) && Number(args.minAmount) > 0 ? Number(args.minAmount) : undefined;
  const maxAmount = Number.isFinite(Number(args.maxAmount)) && Number(args.maxAmount) > 0 ? Number(args.maxAmount) : undefined;
  if (
    args.newAmount !== undefined &&
    (!Number.isFinite(newAmount) || newAmount <= 0)
  ) {
    return {
      status: "needs_info",
      summary:
        "El nuevo monto del ingreso debe ser mayor a cero; no guardé los demás cambios del patch.",
    };
  }
  if (
    args.currency !== undefined &&
    !(
      typeof args.currency === "string" &&
      /^[A-Za-z]{3}$/.test(args.currency.trim())
    )
  ) {
    return {
      status: "needs_info",
      summary:
        "La moneda del ingreso debe ser un código ISO de 3 letras; no guardé los demás cambios del patch.",
    };
  }
  if (args.frequency !== undefined && !frequency) {
    return {
      status: "needs_info",
      summary:
        "La frecuencia del ingreso debe ser semanal, quincenal, mensual o anual; no guardé los demás cambios del patch.",
    };
  }
  if (
    args.expectedDay !== undefined &&
    expectedDay === undefined
  ) {
    return {
      status: "needs_info",
      summary:
        "El día esperado debe estar entre 1 y 31; no guardé los demás cambios del patch.",
    };
  }
  if (args.payAnchorDate !== undefined && !payAnchorDate) {
    return {
      status: "needs_info",
      summary:
        "La fecha del último pago no existe o no está en formato YYYY-MM-DD; no guardé los demás cambios del patch.",
    };
  }
  if (
    args.minAmount !== undefined &&
    (!Number.isFinite(Number(args.minAmount)) || Number(args.minAmount) <= 0)
  ) {
    return {
      status: "needs_info",
      summary:
        "El mínimo del ingreso variable debe ser mayor a cero; no guardé los demás cambios del patch.",
    };
  }
  if (
    args.maxAmount !== undefined &&
    (!Number.isFinite(Number(args.maxAmount)) || Number(args.maxAmount) <= 0)
  ) {
    return {
      status: "needs_info",
      summary:
        "El máximo del ingreso variable debe ser mayor a cero; no guardé los demás cambios del patch.",
    };
  }
  if (!hasAmount && !currency && !frequency && expectedDay === undefined && !payAnchorDate && isVariableArg === undefined && minAmount === undefined && maxAmount === undefined) {
    return { status: "needs_info", summary: "¿Qué cambio de ese ingreso: el monto, la frecuencia, la fecha de pago o su rango variable?" };
  }
  // Currency change without an amount = same number silently re-denominated.
  if (currency && !hasAmount && currency !== income.currency) {
    return { status: "needs_info", summary: `¿Y de cuánto queda en ${currency}? Pregunta el monto en la nueva moneda antes de cambiar nada (el mismo número en otra moneda casi nunca es verdad).` };
  }
  // Frequency change without an amount is ambiguous: "ahora me pagan quincenal"
  // can mean the SAME amount each quincena (income ×2) or the salary split in
  // two. Never guess a plan-income multiplier.
  if (frequency && !hasAmount && frequency !== income.frequency) {
    return { status: "needs_info", summary: `Para pasar "${income.name}" a ${incomeFrequencyText(frequency)}: ¿le pagan ${money(income.amount, income.currency)} cada vez, u otro monto por periodo? Pregunta el monto por periodo y vuelve a llamar con newAmount.` };
  }
  // A plain newAmount on a VARIABLE income is ambiguous: the engines plan with
  // its MINIMUM, so silently setting `amount` would change nothing real (the
  // stale onboarding minimum keeps ruling the Margen). Ask once, with the exact
  // re-call shapes, instead of guessing what the user meant.
  if (hasAmount && income.isVariable && isVariableArg === undefined && minAmount === undefined) {
    const range = income.minExpectedAmount != null ? ` (hoy planifico con su mínimo de ${money(income.minExpectedAmount, income.currency)}${income.maxExpectedAmount != null ? `, hasta ${money(income.maxExpectedAmount, income.currency)}` : ""})` : "";
    return { status: "needs_info", summary: `"${income.name}" es un ingreso VARIABLE${range}. Pregunta si ${money(newAmount, income.currency)} es su nuevo MÍNIMO seguro (sigue variando) o si ahora es FIJO. Luego re-llama: variable → isVariable=true con minAmount (y maxAmount si lo da); fijo → isVariable=false con newAmount.` };
  }
  // Declaring a range IS declaring variability; never store an inert min/max.
  const effectiveVariable = isVariableArg ?? (minAmount !== undefined || maxAmount !== undefined ? true : undefined);
  const finalMin = effectiveVariable === false ? null : minAmount ?? (effectiveVariable === true && hasAmount && minAmount === undefined ? newAmount : undefined);
  const finalMax = effectiveVariable === false ? null : maxAmount;
  if (effectiveVariable === true && finalMin == null && income.minExpectedAmount == null) {
    return { status: "needs_info", summary: `Para tratar "${income.name}" como variable necesito su MÍNIMO seguro por periodo (con eso planifico sin pasarme). Pregúntalo y re-llama con minAmount.` };
  }
  const checkMin = finalMin ?? income.minExpectedAmount ?? null;
  const checkMax = finalMax !== undefined ? finalMax : effectiveVariable === false ? null : income.maxExpectedAmount;
  if (effectiveVariable !== false && checkMin != null && checkMax != null && checkMin > checkMax) {
    return { status: "needs_info", summary: `El mínimo (${money(checkMin, income.currency)}) quedaría por encima del máximo (${money(checkMax, income.currency)}); confirma el rango correcto.` };
  }
  // The patch is applied in the INCOME'S OWN currency (or the one the user just
  // set) — never converted here; the context builder normalizes for the engines.
  const nextOccasional = typeof args.isOccasional === "boolean" ? args.isOccasional : undefined;
  const ok = await updateIncomeSourceFields(ctx.userId, income.id, {
    amount: hasAmount ? newAmount : undefined,
    currency,
    frequency,
    expectedDay,
    payAnchorDate,
    isVariable: effectiveVariable,
    isOccasional: nextOccasional,
    minExpectedAmount: finalMin,
    maxExpectedAmount: finalMax,
  });
  if (!ok) return { status: "error", summary: "No pude actualizar ese ingreso." };
  ctx.dirty = true;
  const finalAmount = hasAmount ? newAmount : income.amount;
  const finalCurrency = currency ?? income.currency;
  const finalFreq = frequency ?? income.frequency;
  const nowVariable = effectiveVariable ?? income.isVariable;
  const shownMin = finalMin ?? income.minExpectedAmount;
  const variableText = nowVariable
    ? ` Es variable: planifico con su mínimo${shownMin != null ? ` de ${money(shownMin, finalCurrency)}` : ""}${finalMax != null ? ` (hasta ${money(finalMax, finalCurrency)})` : ""}.`
    : effectiveVariable === false && income.isVariable
      ? " Ya no lo trato como variable: cuenta fijo, sin rango."
      : "";
  const extras = `${expectedDay !== undefined ? `, pagado el día ${expectedDay}` : ""}${payAnchorDate ? `, con último pago real el ${payAnchorDate}` : ""}`;
  return {
    status: "done",
    summary: `Listo: ${income.name} quedó en ${money(finalAmount, finalCurrency)} ${incomeFrequencyText(finalFreq)} desde ya${extras}.${variableText} Es un cambio del plan: NO registré ningún ingreso hoy. Confírmalo natural y breve.`,
  };
}

async function executeCreateIncome(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const amount = Number(args.amount);
  if (!name) return { status: "needs_info", summary: "¿Cómo se llama ese ingreso?" };
  if (!Number.isFinite(amount) || amount <= 0) return { status: "needs_info", summary: `¿De cuánto es ${name}?` };
  const frequency = ["weekly", "biweekly", "monthly", "yearly"].includes(args.frequency as string)
    ? (args.frequency as IncomeFrequency)
    : null;
  if (!frequency) {
    return {
      status: "needs_info",
      summary: "¿Cada cuánto recibes ese ingreso? No asumí que fuera mensual.",
    };
  }
  const statedCurrency =
    typeof args.currency === "string" &&
    /^[A-Za-z]{3}$/.test(args.currency.trim())
      ? args.currency.trim().toUpperCase()
      : null;
  if (args.currency != null && !statedCurrency) {
    return {
      status: "needs_info",
      summary: "La moneda del ingreso debe ser un código ISO de 3 letras; no creé el ingreso.",
    };
  }
  const currency = statedCurrency ?? ctx.baseCurrency;
  const expectedDay =
    Number.isInteger(Number(args.expectedDay)) &&
    Number(args.expectedDay) >= 1 &&
    Number(args.expectedDay) <= 31
      ? Number(args.expectedDay)
      : null;
  if (args.expectedDay != null && expectedDay == null) {
    return {
      status: "needs_info",
      summary: "El día esperado debe estar entre 1 y 31; no creé el ingreso.",
    };
  }
  const payAnchorDate = validISODate(args.payAnchorDate) ?? null;
  if (args.payAnchorDate != null && !payAnchorDate) {
    return {
      status: "needs_info",
      summary: "La fecha del último pago no existe o no está en formato YYYY-MM-DD; no creé el ingreso.",
    };
  }
  // Bloque I — el guard de duplicado leía con un loader que devolvía [] al fallar, así
  // que un blip lo APAGABA justo cuando más hace falta: se creaba un segundo sueldo, y
  // el ingreso es la raíz de monthlyTrulyFree — el tanque entero pasa a llenarse con el
  // doble. Un guard que no pudo leer no autoriza: pide reintento, no sigue de largo.
  const incomesRead = await readIncomeSources(ctx.userId);
  if (!moneyReadPublishable(incomesRead)) {
    return { status: "needs_info", summary: "Ahora mismo no pude leer sus ingresos, así que no puedo verificar si este ya existe — y crear un sueldo repetido le duplicaría el plan entero. NO lo des por creado ni afirmes que no lo tenía: dile en una frase que lo reintente en un rato." };
  }
  const existing = incomesRead.sources.filter((i) => i.status !== "cancelled");
  const dup = existing.find((i) => {
    const n = normName(i.name);
    const t = normName(name);
    return n.includes(t) || t.includes(n);
  });
  if (dup && args.confirmedNew !== true) {
    return issueDuplicateConfirmation(
      "create_income",
      args,
      ctx,
      `Ya existe un ingreso parecido: "${dup.name}" (${money(dup.amount, dup.currency)} ${incomeFrequencyText(dup.frequency)}).`,
    );
  }
  // Item 1.7 — "Se deposita en": persist the deposit account when the user
  // names one, so income logging can default to it later. Unresolvable → ask.
  let destinationAccountId: string | null = null;
  const destRef = typeof args.destinationAccount === "string" ? args.destinationAccount.trim() : "";
  if (destRef) {
    const t = normName(destRef);
    const hit = ctx.accounts.find((a) => a.id === destRef) ?? (() => {
      const matches = ctx.accounts.filter((a) => !a.isGoalAccount && (() => { const n = normName(a.name); return n.includes(t) || t.includes(n); })());
      return matches.length === 1 ? matches[0] : null;
    })();
    if (!hit) {
      const list = ctx.accounts.filter((a) => !a.isGoalAccount).map((a) => `"${a.name}"`).join(", ");
      return { status: "needs_info", summary: `No reconozco la cuenta "${destRef}" donde se deposita. ${list ? `Tiene: ${list}. Pregúntale cuál.` : "No tiene cuentas registradas; crea la cuenta primero (create_account)."}` };
    }
    destinationAccountId = hit.id;
  }
  const occasional = args.occasional === true;
  const created = await createIncomeSource(ctx.userId, {
    name,
    amount,
    currency,
    frequency,
    expectedDay,
    payAnchorDate,
    destinationAccountId,
    isOccasional: occasional,
    operationKey: agentActionDedupe(ctx, "create-income", [
      name,
      amount,
      currency,
      frequency,
      expectedDay,
      payAnchorDate,
      destinationAccountId,
      occasional,
    ]),
  });
  if (!created) return { status: "error", summary: "No pude guardar el ingreso." };
  ctx.dirty = true;
  const destName = destinationAccountId ? ctx.accounts.find((a) => a.id === destinationAccountId)?.name : null;
  const planText = occasional
    ? "Lo dejo como ocasional: NO lo sumo a tu plan mensual (para no inflar el Saldo); lo tengo presente y lo cuento cuando de verdad entre."
    : "Ya lo cuento en tu plan; NO registré dinero recibido hoy.";
  return created.replayed
    ? {
        status: "done",
        effect: "noop",
        summary: `Ese ingreso ya estaba creado por este mismo pedido; no lo dupliqué.`,
        data: { incomeSourceId: created.id },
      }
    : {
        status: "done",
        summary: `Creé el ingreso ${name}: ${money(amount, currency)} ${incomeFrequencyText(frequency)}${expectedDay ? `, pagado el día ${expectedDay}` : ""}${destName ? `, depositado en "${destName}"` : ""}. ${planText}`,
        data: { incomeSourceId: created.id },
      };
}

const SCHEDULE_KINDS = new Set<ScheduledChangeKind>(["set_amount", "adjust_percent", "adjust_fixed", "pause", "resume", "set_frequency", "reminder"]);

function describeScheduledChange(r: ScheduledChange, fallbackCurrency: string): string {
  const amt = (v: number) => money(v, r.currency ?? fallbackCurrency);
  switch (r.changeKind) {
    case "set_amount":
      return `pasa a ${amt(r.amount ?? 0)}`;
    case "adjust_percent":
      return `${(r.amount ?? 0) >= 0 ? "sube" : "baja"} ${Math.abs(r.amount ?? 0)}%`;
    case "adjust_fixed":
      return `${(r.amount ?? 0) >= 0 ? "sube" : "baja"} ${amt(Math.abs(r.amount ?? 0))}`;
    case "pause":
      return "se pausa";
    case "resume":
      return "se reactiva";
    case "set_frequency":
      return `pasa a frecuencia ${r.newFrequency ?? "?"}`;
    default:
      return "recordatorio";
  }
}

async function executeScheduleChange(
  args: Record<string, unknown>,
  ctx: AgentContext,
  serverAuthorized = false,
): Promise<ToolResult> {
  const targetName = typeof args.targetName === "string" ? args.targetName.trim() : "";
  if (!targetName) return { status: "needs_info", summary: "¿Sobre qué es el cambio (el sueldo, un gasto fijo, una meta, tu ahorro/inversión mensual, o un recordatorio)?" };
  let changeKind = SCHEDULE_KINDS.has(args.changeKind as ScheduledChangeKind) ? (args.changeKind as ScheduledChangeKind) : null;
  let targetTypeRaw = ["income", "fixed_expense", "goal", "reminder", "savings_plan"].includes(args.targetType as string) ? (args.targetType as string) : null;
  if (!changeKind || !targetTypeRaw) {
    return { status: "needs_info", summary: "¿Qué cambia exactamente: el monto, un porcentaje, la frecuencia, pausar/reactivar, o solo recordarte algo?" };
  }
  // Stage 37 — the "Tu mes" plan numbers. savings_plan needs to know WHICH
  // commitment; a goal with targetField=contribution schedules the APORTE.
  const targetField = ["savings", "investment", "essential", "contribution"].includes(args.targetField as string)
    ? (args.targetField as ScheduledPlanField)
    : null;
  const isPlanCommitment = targetTypeRaw === "savings_plan";
  const isGoalContribution = targetTypeRaw === "goal" && targetField === "contribution";
  if (isPlanCommitment) {
    if (!targetField || targetField === "contribution") {
      return { status: "needs_info", summary: "¿Qué cambia: su ahorro mensual, su inversión mensual o su estimado de esenciales? Vuelve a llamar con targetField=savings|investment|essential." };
    }
    if (changeKind !== "set_amount" && changeKind !== "adjust_percent" && changeKind !== "adjust_fixed") {
      return { status: "needs_info", summary: "Para ahorro/inversión/esenciales solo puedo programar cambios de monto (nuevo monto, % o ajuste fijo). Para dejar de apartar, programa set_amount con 0." };
    }
  }
  // A reminder never mutates a target: normalize both sides so it can't reach
  // the amount-change path in the cron.
  if (changeKind === "reminder" || targetTypeRaw === "reminder") {
    changeKind = "reminder";
    targetTypeRaw = "reminder";
  }

  const effectiveDate = validISODate(args.effectiveDate);
  if (!effectiveDate) return { status: "needs_info", summary: "¿Desde qué fecha aplica? Pídele la fecha (día y mes)." };
  if (effectiveDate < todayISO(ctx)) {
    return { status: "needs_info", summary: "Esa fecha ya pasó; ¿cuál es la fecha desde la que aplica? (Si el cambio ya está vigente, usa update_income / update_fixed_expense en vez de programarlo.)" };
  }
  if (
    args.cadence !== undefined &&
    !["once", "monthly", "quarterly", "semiannual", "yearly"].includes(
      args.cadence as string,
    )
  ) {
    return {
      status: "needs_info",
      summary:
        "La cadencia debe ser una vez, mensual, trimestral, semestral o anual; no la convertí en un cambio de una sola vez.",
    };
  }
  const cadence: ScheduledCadence = ["once", "monthly", "quarterly", "semiannual", "yearly"].includes(args.cadence as string) ? (args.cadence as ScheduledCadence) : "once";

  const amount = Number(args.amount);
  const needsAmount = changeKind === "set_amount" || changeKind === "adjust_percent" || changeKind === "adjust_fixed";
  if (needsAmount && !Number.isFinite(amount)) {
    return { status: "needs_info", summary: "¿De cuánto es el cambio?" };
  }
  // Plan commitments and goal contributions accept 0 ("dejar de apartar").
  const zeroOk = isPlanCommitment || isGoalContribution;
  if (changeKind === "set_amount" && (zeroOk ? amount < 0 : amount <= 0)) {
    return { status: "needs_info", summary: zeroOk ? "¿A cuánto queda? Puede ser 0 para dejar de apartar, pero no negativo." : "¿A cuánto queda exactamente? Necesito un monto mayor a cero." };
  }
  // >50% is unusual but legitimate (mudanzas, renegociaciones): ask once, then
  // accept with confirm=true so the user isn't stuck in an ask loop.
  if (changeKind === "adjust_percent" && Math.abs(amount) > 50 && args.confirm !== true) {
    return { status: "needs_info", summary: `¿Un ajuste de ${amount}%? Suena muy grande; confirma el porcentaje con el usuario y, si es correcto, vuelve a llamar con confirm=true.` };
  }
  const newFrequency = ["weekly", "biweekly", "monthly", "yearly"].includes(args.newFrequency as string) ? (args.newFrequency as string) : undefined;
  if (changeKind === "set_frequency" && !newFrequency) {
    return { status: "needs_info", summary: "¿A qué frecuencia pasa: semanal, quincenal, mensual o anual?" };
  }

  let targetId: string | null = null;
  let targetLabel = targetName;
  let targetCurrency: string | null = null;
  if (isPlanCommitment) {
    targetLabel = targetField === "investment" ? "Inversión mensual" : targetField === "essential" ? "Esenciales del mes" : "Ahorro mensual";
    targetCurrency = ctx.baseCurrency;
  } else if (targetTypeRaw === "income") {
    const incRead = await readIncomeSources(ctx.userId);
    if (!moneyReadPublishable(incRead)) {
      return { status: "needs_info", summary: "Ahora mismo no pude leer sus ingresos, así que no puedo programar el cambio con certeza. NO afirmes que no tiene ingresos; dile que lo reintente en un rato." };
    }
    const incomes = incRead.sources.filter((i) => i.status !== "cancelled");
    if (incomes.length === 0) {
      return { status: "needs_info", summary: "No tengo ingresos registrados; primero crea el ingreso (create_income) y luego programo el cambio." };
    }
    const income = resolveIncomeByName(incomes, targetName);
    if (!income) {
      const list = incomes.map((i) => `"${i.name}"`).join(", ");
      return { status: "needs_info", summary: `¿Cuál ingreso? Tiene: ${list}. Pregúntale cuál.` };
    }
    const incomeEntityGate = await guardResolvedEntityChoice({
      toolName: "schedule_change",
      args,
      ctx,
      label: "el ingreso",
      chosen: income,
      peers: incomes,
      serverAuthorized,
    });
    if (incomeEntityGate) return incomeEntityGate;
    targetId = income.id;
    targetLabel = income.name;
    targetCurrency = income.currency;
  } else if (targetTypeRaw === "fixed_expense") {
    const matchRead2 = await readSimilarFixedExpenses({ userId: ctx.userId, name: targetName });
    // Publicable, no solo ok (re-auditoría 2, punto 5): el programador de cambios
    // decide contra QUÉ fijo se agenda un cambio de dinero — media lista no prueba
    // ni el match único ni la ausencia.
    if (!moneyReadPublishable(matchRead2)) return { status: "needs_info", summary: "Ahora mismo no pude leer sus gastos fijos. NO afirmes que no existe; dile que lo reintente en un rato." };
    const matches = matchRead2.matches;
    if (matches.length === 0) {
      return { status: "needs_info", summary: `No encuentro un gasto fijo que suene a "${targetName}"; pregúntale a cuál se refiere (mira la lista de gastos fijos del contexto).` };
    }
    if (matches.length > 1) {
      return { status: "needs_info", summary: `Hay varios gastos fijos parecidos: ${matches.map((m) => `"${m.name}"`).join(", ")}. Pregúntale cuál.` };
    }
    const fixedCatalogRead = await readFixedExpenseCatalog(ctx.userId);
    if (!moneyReadPublishable(fixedCatalogRead)) {
      return {
        status: "needs_info",
        summary:
          "Ahora mismo no pude comprobar el catálogo completo de gastos fijos. No programé el cambio; dile que lo reintente.",
      };
    }
    const fixedEntityGate = await guardResolvedEntityChoice({
      toolName: "schedule_change",
      args,
      ctx,
      label: "el gasto fijo",
      chosen: matches[0],
      peers: fixedCatalogRead.expenses,
      serverAuthorized,
    });
    if (fixedEntityGate) return fixedEntityGate;
    targetId = matches[0].id;
    targetLabel = matches[0].name;
    targetCurrency = matches[0].currency;
  } else if (targetTypeRaw === "goal") {
    const goal = resolveExplicitOrSingle(
      ctx.goals,
      targetName,
      (row) => row.name,
    );
    if (!goal) {
      return { status: "needs_info", summary: ctx.goals.length ? `¿Cuál meta? Tiene: ${ctx.goals.map((g) => `"${g.name}"`).join(", ")}. Pregúntale cuál.` : "No tiene metas registradas para programarle un cambio." };
    }
    const goalEntityGate = await guardResolvedEntityChoice({
      toolName: "schedule_change",
      args,
      ctx,
      label: "la meta",
      chosen: goal,
      peers: ctx.goals,
      serverAuthorized,
    });
    if (goalEntityGate) return goalEntityGate;
    targetId = goal.id;
    targetLabel = goal.name;
    targetCurrency = goal.currency;
  }

  // If the user STATED a currency and it isn't the target's, never convert and
  // never store the raw number — ask for the amount in the target's currency.
  const statedCurrency = typeof args.currency === "string" && /^[A-Za-z]{3}$/.test(args.currency.trim()) ? args.currency.trim().toUpperCase() : undefined;
  if (statedCurrency && targetCurrency && needsAmount && statedCurrency !== String(targetCurrency).toUpperCase()) {
    return { status: "needs_info", summary: `El monto viene en ${statedCurrency}, pero "${targetLabel}" está en ${targetCurrency}. Pregunta el monto en ${targetCurrency} (NUNCA lo conviertas tú), o sugiere cambiar primero la moneda del objetivo.` };
  }

  const targetType: ScheduledTargetType = targetTypeRaw === "income" ? "income_source" : (targetTypeRaw as ScheduledTargetType);
  const res = await createScheduledChange(ctx.userId, {
    targetType,
    targetId,
    targetField: isPlanCommitment || isGoalContribution ? targetField : null,
    targetLabel,
    changeKind,
    amount: needsAmount ? amount : null,
    currency: targetCurrency,
    newFrequency: newFrequency ?? null,
    effectiveDate,
    cadence,
    note: typeof args.note === "string" && args.note.trim() ? args.note.trim() : null,
    operationKey: agentActionDedupe(ctx, "schedule-change", [
      targetType,
      targetId,
      targetField,
      targetLabel,
      changeKind,
      needsAmount ? amount : null,
      targetCurrency,
      newFrequency ?? null,
      effectiveDate,
      cadence,
    ]),
  });
  if (!res.ok) {
    if (res.reason === "falta_frecuencia") {
      return { status: "needs_info", summary: "Falta la nueva frecuencia (semanal, quincenal, mensual o anual). Pregúntale cuál." };
    }
    if (res.reason === "falta_campo") {
      return { status: "needs_info", summary: "¿Qué cambia: su ahorro mensual, su inversión mensual o su estimado de esenciales? Vuelve a llamar con targetField." };
    }
    if (res.reason === "moneda_distinta") {
      return { status: "needs_info", summary: `El monto está en otra moneda que "${targetLabel}". Pide el monto en la moneda del objetivo (o primero cámbiale la moneda con update_income/update_fixed_expense).` };
    }
    return { status: "error", summary: "No pude guardar el cambio programado ahora. Intenta de nuevo en un rato." };
  }

  const repeat = cadence === "once" ? "" : ` y se repite ${cadenceText(cadence)}`;
  const when = `el ${effectiveDate}`;
  const cur = targetCurrency ?? ctx.baseCurrency;
  let what: string;
  if (changeKind === "reminder") {
    what = `te recuerdo "${targetLabel}" ${when}${repeat}`;
  } else if (changeKind === "set_amount") {
    what = isGoalContribution
      ? `${when} el aporte a "${targetLabel}" pasa a ${money(amount, cur)}${amount === 0 ? " (deja de apartar)" : ""}${repeat}`
      : `${when} ${targetLabel} pasa a ${money(amount, cur)}${isPlanCommitment && amount === 0 ? " (deja de apartar)" : ""}${repeat}`;
  } else if (changeKind === "adjust_percent") {
    what = `${when} ${targetLabel} ${amount >= 0 ? "sube" : "baja"} ${Math.abs(amount)}%${repeat}`;
  } else if (changeKind === "adjust_fixed") {
    what = `${when} ${targetLabel} ${amount >= 0 ? "sube" : "baja"} ${money(Math.abs(amount), cur)}${repeat}`;
  } else if (changeKind === "pause") {
    what = `${when} pauso ${targetLabel} (desde ese día no lo cuento)${repeat}`;
  } else if (changeKind === "resume") {
    what = `${when} reactivo ${targetLabel}${repeat}`;
  } else {
    what = `desde ${when} ${targetLabel} pasa a frecuencia ${newFrequency}${repeat}`;
  }
  return res.replayed
    ? {
        status: "done",
        effect: "noop",
        summary: `Ese cambio ya estaba programado por este mismo pedido; no lo dupliqué.`,
      }
    : { status: "done", summary: `Programado: ${what}. Nada cambia hoy; se aplica solo ese día y te lo confirmo cuando pase.` };
}

async function executeListScheduledChanges(ctx: AgentContext): Promise<ToolResult> {
  const rows = scheduledChangesForDecision(
    await readScheduledChanges(ctx.userId),
  );
  if (!rows) {
    return {
      status: "error",
      summary:
        "No pude comprobar la lista completa de cambios programados. No afirmes que no hay ninguno; pide reintentar.",
    };
  }
  const pending = rows.filter((r) => r.status === "pending");
  const failed = rows.filter((r) => r.status === "failed");
  if (pending.length === 0 && failed.length === 0) {
    return { status: "done", summary: "No tienes cambios programados. Si el usuario esperaba uno, ofrécele programarlo." };
  }
  const line = (r: ScheduledChange) =>
    `- ${r.targetLabel}: ${describeScheduledChange(r, ctx.baseCurrency)} — próxima vez el ${r.nextRunDate}${r.cadence !== "once" ? ` (${cadenceText(r.cadence)})` : ""}`;
  const pendingText = pending.length ? `Cambios programados pendientes:\n${pending.map(line).join("\n")}` : "No hay cambios pendientes.";
  const failedText = failed.length
    ? ` OJO: estos fallaron al aplicarse (dilo honesto y ofrece reprogramarlos): ${failed.map((r) => `${r.targetLabel} (${r.effectiveDate})`).join("; ")}.`
    : "";
  return { status: "done", summary: `${pendingText}${failedText} Resúmelo natural, sin ids.`, data: { pending, failed } };
}

async function executeCancelScheduledChange(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const reference = typeof args.reference === "string" ? args.reference.trim() : "";
  if (!reference) return { status: "needs_info", summary: "¿Cuál cambio programado cancelo?" };
  const rows = scheduledChangesForDecision(
    await readScheduledChanges(ctx.userId),
  );
  if (!rows) {
    return {
      status: "error",
      summary:
        "No pude comprobar la lista completa de cambios programados. No cancelé nada; pide reintentar.",
    };
  }
  const pending = rows.filter((r) => r.status === "pending");
  if (pending.length === 0) {
    return { status: "done", effect: "noop", summary: "No tienes cambios programados pendientes que cancelar." };
  }
  const ref = normName(reference);
  let matches = pending.filter((r) => {
    const label = normName(r.targetLabel);
    return label.includes(ref) || ref.includes(label) || r.nextRunDate === reference || r.effectiveDate === reference;
  });
  // Single-pending fallback ONLY for generic references ("ese cambio"). A
  // specific reference that matches nothing must ask — never cancel a guess.
  const GENERIC_CHANGE_REFS = new Set(["ese cambio", "el cambio", "ese", "el programado", "el cambio programado", "eso"]);
  if (matches.length === 0 && pending.length === 1 && GENERIC_CHANGE_REFS.has(ref)) matches = pending;
  if (matches.length === 0) {
    return { status: "needs_info", summary: `"${reference}" no coincide con ningún cambio pendiente. Pendientes: ${pending.map((r) => `${r.targetLabel} (${r.nextRunDate})`).join("; ")}. Pregúntale cuál.` };
  }
  if (matches.length > 1) {
    return { status: "needs_info", summary: `Hay varios que encajan: ${matches.map((r) => `${r.targetLabel} — ${describeScheduledChange(r, ctx.baseCurrency)} el ${r.nextRunDate}`).join("; ")}. Pregúntale cuál cancelo.` };
  }
  const ok = await cancelScheduledChange(ctx.userId, matches[0].id);
  if (!ok) return { status: "error", summary: "No pude cancelarlo; puede que ya se haya aplicado. Revísalo con list_scheduled_changes." };
  return { status: "done", summary: `Cancelado: ya no aplicaré ese cambio (${matches[0].targetLabel}, ${matches[0].nextRunDate}).` };
}

// Count how many ledger movements reference an account or card, so a
// currency/close decision can be made against REAL state (never a guess). A
// query error is treated as "unknown, assume it has movements" — the safe
// (refusing) side for a destructive/irreversible reinterpretation.
async function accountMovementCount(
  userId: string,
  columns: string[],
  id: string,
): Promise<number | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const or = columns.map((c) => `${c}.eq.${id}`).join(",");
    const { count, error } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .or(or);
    if (error || count == null) return null;
    return count;
  } catch {
    return null;
  }
}

// Rename a card/debt. Mirrors executeUpdateAccount's name-resolution + clash
// guard so two cards never collide on one name (which would poison every
// name-based resolver). Renaming only — obligations/close are separate tools.
async function executeRenameCard(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const cardName = typeof args.cardName === "string" ? args.cardName.trim() : "";
  const newName = typeof args.newName === "string" ? args.newName.trim().slice(0, 80) : "";
  if (!cardName) return { status: "needs_info", summary: "¿Cuál tarjeta?" };
  const target = normName(cardName);
  const matches = ctx.debtAccounts.filter((d) => {
    const n = normName(d.name);
    return n.includes(target) || target.includes(n);
  });
  const card = matches.length === 1 ? matches[0] : null;
  if (!card) {
    const acctHit = ctx.accounts.find((a) => {
      const n = normName(a.name);
      return n.includes(target) || target.includes(n);
    });
    if (acctHit) {
      return { status: "needs_info", summary: `"${acctHit.name}" es una cuenta, no una tarjeta/deuda; para renombrar cuentas usa update_account. Dile qué encontraste y pregúntale.` };
    }
    const list = (matches.length > 1 ? matches : ctx.debtAccounts).map((d) => `"${d.name}"`).join(", ");
    return { status: "needs_info", summary: list ? `Ese nombre no coincide claro. ¿Cuál de estas tarjetas/deudas: ${list}? Pregúntale.` : "No tiene tarjetas ni deudas registradas." };
  }
  if (!newName) return { status: "needs_info", summary: `¿Cómo la renombro?` };
  const newNorm = normName(newName);
  const clash =
    ctx.debtAccounts.find((d) => d.id !== card.id && normName(d.name) === newNorm) ??
    ctx.accounts.find((a) => normName(a.name) === newNorm);
  if (clash) {
    return { status: "needs_info", summary: `Ya existe "${clash.name}" y dos nombres iguales confundirían los registros. Pregúntale por otro nombre.` };
  }
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("debt_accounts")
      .update({ name: newName })
      .eq("id", card.id)
      .eq("user_id", ctx.userId)
      .select("id")
      .maybeSingle();
    if (error || data?.id !== card.id) return { status: "error", summary: "No pude probar que la tarjeta se renombrara; no afirmes el cambio e intenta de nuevo en un momento." };
    const oldName = card.name;
    card.name = newName;
    return { status: "done", summary: `Listo: la tarjeta "${oldName}" ahora se llama "${newName}". Su saldo, sus obligaciones y su historial quedan igual.` };
  } catch {
    return { status: "error", summary: "No pude renombrar la tarjeta ahora. Intenta de nuevo en un momento." };
  }
}

// Soft-close an account: reconcile it to 0 (an auditable balance ADJUSTMENT,
// never a hard delete or a fabricated income/expense) and flip status='closed'
// so it stops being counted. Confirms first; warns when the balance ≠ 0 (that
// money is adjusted out). A non-base account with a non-zero balance can't be
// reconciled without a trusted rate → refuse honestly rather than fabricate FX.
async function executeCloseAccount(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const accountId = typeof args.accountId === "string" ? args.accountId : "";
  const account = ctx.accounts.find((a) => a.id === accountId);
  if (!account) return { status: "needs_info", summary: "¿Cuál cuenta cierro? Muéstrale sus cuentas y que elija." };
  const balance = account.currentBalanceOriginal ?? 0;
  const hasBalance = Math.abs(balance) >= 0.01;
  if (args.confirm !== true) {
    const warn = hasBalance
      ? `OJO — dile esto tal cual ANTES de preguntar: "${account.name}" todavía tiene ${money(balance, account.currency)}; al cerrarla ese saldo se ajusta a 0 (queda registrado como ajuste, no se pierde el historial). `
      : "";
    return { status: "needs_info", summary: `${warn}Cerrar "${account.name}" la desactiva: deja de contar en tu Saldo y no se podrá usar como origen mientras esté cerrada. No se borra nada (su historial se conserva y puede reabrirse de forma segura). Pregúntale si está seguro y, si dice que sí, vuelve a llamar close_account con confirm=true.` };
  }
  // Balance adjustment and status transition are one DB transaction. The old
  // two-step flow could leave a zeroed but still-active account, and even ignored
  // a zero-row UPDATE while claiming it was closed.
  ctx.reconcileSeq ??= { n: 0 };
  const seq = (ctx.reconcileSeq.n += 1);
  const closeOperationId =
    reconcileOperationId(ctx.operationId, seq) ??
    `agent:close:${createHash("sha256")
      .update([ctx.userId, ctx.rawMessage.trim(), account.id, todayISO(ctx)].join("|"))
      .digest("hex")
      .slice(0, 32)}`;
  // A native residue the stored base leg values at zero may only be swept
  // against a CURRENT rate (099). ctx.fxRates already holds current rates only,
  // so derive it here rather than letting the writer assume 1.
  // `rateToBase` and not `convert(1, …).baseAmount`: one unit of a weak currency
  // rounds to 0.00 in base, which would report "no rate" and make the sub-cent
  // residue sweep unreachable from chat. `findRate` already returns 1 for a
  // same-currency pair, so there is a single path here.
  const closeRate = rateToBase(account.currency, ctx.baseCurrency, ctx.fxRates ?? []);
  const closed = await closeAccountAtomically({
    userId: ctx.userId,
    accountId: account.id,
    operationId: closeOperationId,
    message: ctx.rawMessage,
    exchangeRateToBase: closeRate,
    channel: ctx.channel,
  });
  if (!closed.ok) {
    return {
      status: closed.reason === "unsafe" ? "needs_info" : "error",
      summary: closed.reason === "unsafe"
        ? `"${account.name}" no se puede cerrar de forma segura ahora (por moneda, propiedad o estado). No ajusté su saldo ni cambié su estado.`
        : "No pude cerrar la cuenta de forma atómica; no quedó ajustada a medias. Ofrécele reintentar.",
    };
  }
  // Keep this turn's context honest: drop it from the live list so same-turn
  // reads don't offer a closed account as a source.
  ctx.accounts = ctx.accounts.filter((a) => a.id !== account.id);
  ctx.dirty = true;
  return {
    status: "done",
    effect: closed.alreadyClosed ? "noop" : "wrote",
    summary: closed.alreadyClosed
      ? `"${account.name}" ya estaba cerrada; no moví nada.`
      : `Listo: cerré "${account.name}". Su saldo quedó en 0 (ajuste auditable) y ya no la cuento en tu Saldo ni la ofrezco como origen. Su historial se conserva. Confírmalo simple y sin drama.`,
  };
}

async function executeReopenAccount(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const accountName = typeof args.accountName === "string" ? args.accountName.trim() : "";
  if (!accountName) {
    return { status: "needs_info", summary: "¿Cuál cuenta cerrada quieres reabrir?" };
  }
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id,name,status")
    .eq("user_id", ctx.userId)
    .eq("status", "closed")
    .order("name", { ascending: true })
    .limit(101);
  if (error || !data) {
    return {
      status: "error",
      summary: "No pude leer tus cuentas cerradas ahora, así que no reabrí ninguna. Reinténtalo en un momento.",
    };
  }
  if (data.length > 100) {
    return {
      status: "needs_info",
      summary: "Hay demasiadas cuentas cerradas para identificar una con seguridad. No cambié ninguna.",
    };
  }
  const wanted = normName(accountName);
  const matches = data.filter((row) => {
    const name = normName(String(row.name ?? ""));
    return name === wanted || name.includes(wanted) || wanted.includes(name);
  });
  if (matches.length !== 1) {
    return {
      status: "needs_info",
      summary:
        matches.length > 1
          ? `Hay varias cuentas cerradas que coinciden: ${matches.map((row) => `"${row.name}"`).join(", ")}. ¿Cuál reabro?`
          : data.length > 0
            ? `No encuentro "${accountName}" entre las cuentas cerradas. Cerradas: ${data.map((row) => `"${row.name}"`).join(", ")}.`
            : "No tienes cuentas cerradas que pueda reabrir.",
    };
  }
  const reopened = await reopenAccountAtomically({
    userId: ctx.userId,
    accountId: String(matches[0].id),
    message: ctx.rawMessage,
    channel: ctx.channel,
  });
  if (!reopened.ok) {
    return {
      status: reopened.reason === "historical_close" || reopened.reason === "unsafe" ? "needs_info" : "error",
      summary:
        reopened.reason === "historical_close"
          ? `Ese cierre es anterior al historial atómico y no puedo reconstruir con certeza el saldo previo. No reabrí "${matches[0].name}" ni moví dinero; revísala manualmente.`
          : reopened.reason === "unsafe"
            ? `No pude demostrar que "${matches[0].name}" se pueda reabrir de forma segura; no cambié nada.`
            : `No pude reabrir "${matches[0].name}" de forma atómica; no quedó a medias. Reinténtalo en un momento.`,
    };
  }
  ctx.dirty = true;
  return {
    status: "done",
    effect: reopened.alreadyOpen ? "noop" : "wrote",
    summary: reopened.alreadyOpen
      ? `"${matches[0].name}" ya estaba abierta; no cambié nada.`
      : `Reabrí "${matches[0].name}". Si el cierre había generado un ajuste, también lo revertí en la misma operación; el saldo y el estado volvieron juntos.`,
  };
}

// Soft-close a card/debt: flip status='closed' so it stops counting. Confirms
// first; warns when there is outstanding debt ≠ 0 (closing would hide a real
// debt — better to pay it off / reverse it first). Never a hard delete.
async function executeCloseCard(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const debtId = typeof args.debtAccountId === "string" ? args.debtAccountId : "";
  const card = ctx.debtAccounts.find((d) => d.id === debtId);
  if (!card) return { status: "needs_info", summary: "¿Cuál tarjeta/deuda cierro? Muéstrale las suyas y que elija." };
  const owed = card.currentBalanceOriginal ?? 0;
  const hasDebt = Math.abs(owed) >= 0.01;
  // Hiding a non-zero debt makes every debt-pressure/capacity number look
  // better than reality. Confirmation cannot authorize a false financial
  // state: pay/reconcile the card first, then close it.
  if (hasDebt) {
    return {
      status: "refused",
      summary: `"${card.name}" todavía tiene ${money(owed, card.currency)}. No la cierro porque ocultaría una deuda real de tu presión y de tus planes. Primero registra el pago/reembolso que la deja en cero y luego vuelve a cerrarla; no cambié nada.`,
    };
  }
  if (args.confirm !== true) {
    return { status: "needs_info", summary: `Cerrar "${card.name}" la desactiva: deja de contar en tu presión de deuda y ya no la usarás. No se borra nada (su historial se conserva). Pregúntale si está seguro y, si dice que sí, vuelve a llamar close_card con confirm=true.` };
  }
  const closed = await closeDebtAccountAtomically({
    userId: ctx.userId,
    debtAccountId: card.id,
  });
  if (!closed.ok) {
    return {
      status: closed.reason === "outstanding" || closed.reason === "unsafe" ? "needs_info" : "error",
      summary:
        closed.reason === "outstanding"
          ? `"${card.name}" todavía tiene saldo u obligaciones del estado. No la cerré porque ocultaría deuda; revisa/paga esos montos primero.`
          : closed.reason === "unsafe"
            ? `No pude demostrar que "${card.name}" sea tuya y esté lista para cerrar; no cambié nada.`
            : "No pude cerrar la tarjeta de forma comprobable; no afirmes que se cerró y reintenta en un momento.",
    };
  }
  ctx.debtAccounts = ctx.debtAccounts.filter((d) => d.id !== card.id);
  ctx.dirty = true;
  return {
    status: "done",
    effect: closed.alreadyClosed ? "noop" : "wrote",
    summary: closed.alreadyClosed
      ? `"${card.name}" ya estaba cerrada y sin deuda; no cambié nada.`
      : `Listo: cerré "${card.name}" en cero; ya no la cuento en tu presión de deuda. Su historial se conserva. Confírmalo simple.`,
  };
}

// Change an account's currency — ONLY when safe: zero movements AND zero balance.
// Otherwise refusing protects every stored amount from being silently
// reinterpreted (a fabricated conversion). Never converts numbers.
async function executeChangeAccountCurrency(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const accountId = typeof args.accountId === "string" ? args.accountId : "";
  const newCurrency = typeof args.newCurrency === "string" && /^[A-Za-z]{3}$/.test(args.newCurrency.trim())
    ? (args.newCurrency.trim().toUpperCase() as CurrencyCode)
    : null;
  const account = ctx.accounts.find((a) => a.id === accountId);
  if (!account) return { status: "needs_info", summary: "¿A cuál cuenta le cambio la moneda?" };
  if (!newCurrency) return { status: "needs_info", summary: "¿A qué moneda? Dame el código de 3 letras (COP, UYU, USD…)." };
  if (newCurrency === account.currency) {
    return { status: "done", effect: "noop", summary: `"${account.name}" ya está en ${newCurrency}; no hay nada que cambiar.` };
  }
  // A1 (PRODUCT FIX 2) — reinterpret/relabel a MISLABELED currency: the number was
  // always in newCurrency, so keep the amount and only change its label + base.
  const reinterpret = args.reinterpret === true;
  const balance = account.currentBalanceOriginal ?? 0;
  if (!reinterpret && Math.abs(balance) >= 0.01) {
    return { status: "refused", summary: `No puedo cambiar la moneda de "${account.name}" a ${newCurrency}: tiene saldo (${money(balance, account.currency)}) y reinterpretarlo en otra moneda inventaría un tipo de cambio. Si ese número SIEMPRE fue ${newCurrency} (solo estaba mal etiquetado), dímelo y lo reinterpreto sin inventar cambio; si el saldo real es distinto, cuádralo primero; o ciérrala y crea una nueva en ${newCurrency}. Explícaselo así, sin tecnicismos.` };
  }
  const movements = await accountMovementCount(ctx.userId, ["source_account_id", "destination_account_id"], account.id);
  if (movements === null || movements > 0) {
    return { status: "refused", summary: `No puedo cambiar la moneda de "${account.name}" a ${newCurrency}: ya tiene movimientos registrados y cambiarla reinterpretaría esos montos (FX inventado). Lo correcto es cerrarla y crear una cuenta nueva en ${newCurrency}. Explícaselo así.` };
  }
  // Compute the new stored amounts. Empty path → both 0 (original safe behavior).
  // Reinterpret path → keep the original number, recompute base at a KNOWN rate only.
  let newOriginal = 0;
  let newBase = 0;
  if (reinterpret) {
    newOriginal = balance;
    if (newCurrency === (ctx.baseCurrency || "").trim().toUpperCase()) {
      newBase = balance;
    } else {
      const conv = convertFx(balance, newCurrency, ctx.baseCurrency, ctx.fxRates ?? []);
      if (!conv.ok) {
        return { status: "needs_info", summary: `Para reinterpretar "${account.name}" como ${newCurrency} necesito el tipo de cambio ${newCurrency}→${ctx.baseCurrency}: dime a cuánto está (lo guardo con set_exchange_rate) y reintento. NUNCA lo invento.` };
      }
      newBase = conv.baseAmount;
    }
  }
  // Re-auditoría 2 de J-1 (P1): el UPDATE directo perdía la carrera contra el
  // PRIMER movimiento — el check de movimientos era previo y sin lock, y el write
  // pisaba los balances con la foto vieja del contexto. La RPC (068) bloquea la
  // cuenta, re-verifica moneda/balances (CAS) y movimientos DENTRO de la
  // transacción; además el trigger accounts_currency_change_guard hace imposible
  // el cambio con historia para CUALQUIER writer.
  const changed = await changeAccountCurrencyWith(
    async (payload) => {
      const supabase = createSupabaseAdminClient();
      return supabase.rpc("kipu_change_account_currency_v2", { p: payload });
    },
    {
      userId: ctx.userId,
      accountId: account.id,
      expectedCurrency: String(account.currency),
      expectedBalanceOriginal: account.currentBalanceOriginal ?? 0,
      expectedBalanceBase: account.currentBalanceBase ?? 0,
      newCurrency,
      newOriginal,
      newBase,
      reinterpret,
    },
  );
  if (!changed.ok) {
    return {
      status: changed.reason === "conflict" ? "error" : "refused",
      summary: changed.reason === "conflict"
        ? `La cuenta "${account.name}" cambió mientras editaba (¿aterrizó un movimiento?); NO toqué nada. Refresca y reintenta.`
        : `No pude cambiar la moneda de "${account.name}": la base la rechazó — puede tener movimientos, saldo, o estar cableada a algo denominado en ${account.currency} (una meta, un ingreso, un plan de ahorro, el pago de una tarjeta o un gasto fijo). Lo seguro es crear una cuenta nueva en ${newCurrency} y mover ahí lo que corresponda. NO quedó nada a medias; explícaselo así, sin tecnicismos.`,
    };
  }
  account.currency = newCurrency;
  account.currentBalanceOriginal = newOriginal;
  account.currentBalanceBase = newBase;
  ctx.dirty = true;
  return {
    status: "done",
    summary: reinterpret
      ? `Listo: reinterpreté "${account.name}" — el número (${money(newOriginal, newCurrency)}) siempre fue ${newCurrency}, solo estaba mal etiquetado. No inventé ningún cambio. Confírmalo simple.`
      : `Listo: "${account.name}" ahora está en ${newCurrency} (estaba vacía y sin movimientos, así que fue seguro). Confírmalo simple.`,
  };
}

type ScheduledPaymentRef = { id: string; name: string; amount: number | null; currency: string; dueDate: string };

/** Resolve one upcoming scheduled payment by a name fragment.
 *
 *  Bloque I — el resultado es una UNIÓN, no `{match, all}`: devolver `all: []` cuando la
 *  lectura no sirve deja al caller diciendo "No tienes pagos programados por ahora", que
 *  es exactamente el fallo disfrazado de hecho. Con la unión, el caller no puede tocar
 *  `.match` sin decidir antes qué hacer con `unreadable` — lo fuerza el compilador, no
 *  una convención.
 *
 *  `complete` importa tanto como `ok` acá: la ventana que pide esta tool es de 400 días
 *  y el tope del store es de 20 filas (pensado para 45), así que la cola truncada es
 *  probable, no teórica. Sobre una lista truncada un match ÚNICO no está probado —
 *  el homónimo puede estar justo en lo que no vimos — y estos callers EDITAN y CANCELAN:
 *  actuar ahí es escribir sobre el pago equivocado. */
async function resolveScheduledPayment(
  userId: string,
  reference: string,
): Promise<
  | { unreadable: true }
  | { unreadable: false; match: ScheduledPaymentRef | null; all: ScheduledPaymentRef[] }
> {
  const read = await readUpcomingScheduledPayments(userId, 400);
  if (!moneyReadPublishable(read)) return { unreadable: true };
  const all = read.payments;
  const target = normName(reference);
  const matches = target
    ? all.filter((p) => {
        const n = normName(p.name);
        return n.includes(target) || target.includes(n);
      })
    : all;
  return { unreadable: false, match: matches.length === 1 ? matches[0] : null, all };
}

// Un solo texto para las dos tools: no pude ver su lista entera, así que no puedo ni
// negar que el pago exista ni elegir uno.
const SCHEDULED_UNREADABLE = "Ahora mismo no pude leer su lista completa de pagos programados. NO afirmes que no tiene pagos ni que ese pago no existe, y no toques ninguno a ciegas: dile en una frase que lo reintente en un rato.";

async function executeUpdateScheduledPayment(
  args: Record<string, unknown>,
  ctx: AgentContext,
  serverAuthorized = false,
): Promise<ToolResult> {
  const reference = typeof args.reference === "string" ? args.reference.trim() : "";
  if (!reference) return { status: "needs_info", summary: "¿Cuál pago programado edito?" };
  const newAmount = Number.isFinite(Number(args.newAmount)) && Number(args.newAmount) > 0 ? Number(args.newAmount) : undefined;
  const newDueDate = validISODate(args.newDueDate);
  if (newAmount === undefined && !newDueDate) {
    return { status: "needs_info", summary: "¿Qué cambio de ese pago programado: el monto o la fecha?" };
  }
  const resolved = await resolveScheduledPayment(ctx.userId, reference);
  if (resolved.unreadable) return { status: "needs_info", summary: SCHEDULED_UNREADABLE };
  const { match, all } = resolved;
  if (!match) {
    if (all.length === 0) return { status: "done", effect: "noop", summary: "No tienes pagos programados por ahora." };
    const list = all.map((p) => `"${p.name}" (${p.amount != null ? money(p.amount, p.currency) : "sin monto"}, ${p.dueDate})`).join(", ");
    return { status: "needs_info", summary: `¿Cuál de estos pagos programados: ${list}? Pregúntale.` };
  }
  const scheduledEntityGate = await guardResolvedEntityChoice({
    toolName: "update_scheduled_payment",
    args,
    ctx,
    label: "el pago programado",
    chosen: match,
    peers: all,
    serverAuthorized,
  });
  if (scheduledEntityGate) return scheduledEntityGate;
  const ok = await updateScheduledPaymentFields({ userId: ctx.userId, id: match.id, amount: newAmount, dueDate: newDueDate });
  if (!ok) return { status: "error", summary: "No pude editar ese pago programado (quizá ya se aplicó o se canceló). Revísalo." };
  ctx.dirty = true;
  const changes: string[] = [];
  if (newAmount !== undefined) changes.push(`monto ${money(newAmount, match.currency)}`);
  if (newDueDate) changes.push(`fecha ${newDueDate}`);
  return { status: "done", summary: `Listo: actualicé el pago programado "${match.name}" (${changes.join(", ")}). No moví dinero; es solo el plan a futuro. Confírmalo simple.` };
}

async function executeCancelScheduledPayment(
  args: Record<string, unknown>,
  ctx: AgentContext,
  serverAuthorized = false,
): Promise<ToolResult> {
  const reference = typeof args.reference === "string" ? args.reference.trim() : "";
  if (!reference) return { status: "needs_info", summary: "¿Cuál pago programado cancelo?" };
  const resolved = await resolveScheduledPayment(ctx.userId, reference);
  if (resolved.unreadable) return { status: "needs_info", summary: SCHEDULED_UNREADABLE };
  const { match, all } = resolved;
  if (!match) {
    if (all.length === 0) return { status: "done", effect: "noop", summary: "No tienes pagos programados por ahora." };
    const list = all.map((p) => `"${p.name}" (${p.amount != null ? money(p.amount, p.currency) : "sin monto"}, ${p.dueDate})`).join(", ");
    return { status: "needs_info", summary: `¿Cuál de estos cancelo: ${list}? Pregúntale.` };
  }
  const scheduledEntityGate = await guardResolvedEntityChoice({
    toolName: "cancel_scheduled_payment",
    args,
    ctx,
    label: "el pago programado",
    chosen: match,
    peers: all,
    serverAuthorized,
  });
  if (scheduledEntityGate) return scheduledEntityGate;
  if (args.confirm !== true) {
    return { status: "needs_info", summary: `Voy a cancelar el pago programado "${match.name}" (${match.amount != null ? money(match.amount, match.currency) : "sin monto"}, ${match.dueDate}); no se moverá dinero y no volverá a aparecer. Pregúntale si está seguro y, si dice que sí, vuelve a llamar con confirm=true.` };
  }
  const ok = await setScheduledPaymentStatus({ userId: ctx.userId, id: match.id, status: "cancelled" });
  if (!ok) return { status: "error", summary: "No pude cancelarlo (quizá ya se aplicó). Revísalo." };
  ctx.dirty = true;
  return { status: "done", summary: `Cancelado: el pago programado "${match.name}" ya no aparecerá ni se registrará. No moví dinero. Confírmalo simple.` };
}

async function executeReportBug(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const message = typeof args.message === "string" ? args.message.trim() : "";
  if (!message) return { status: "needs_info", summary: "¿Qué es lo que está fallando o qué quieres reportar? Cuéntame breve y lo anoto." };
  const kind: FeedbackKind = ["bug", "idea", "confusion", "other"].includes(args.kind as string) ? (args.kind as FeedbackKind) : "bug";
  const context = typeof args.context === "string" && args.context.trim() ? args.context.trim() : null;
  const saved = await saveUserFeedback({
    userId: ctx.userId,
    message,
    kind,
    context,
    channel: ctx.channel ?? null,
    operationKey: agentActionDedupe(ctx, "report-bug", [
      kind,
      message,
      context,
    ]),
  });
  if (!saved.ok) {
    return { status: "error", summary: "Quise anotar el reporte pero no pude guardarlo ahora. Dile que igual lo tomaste en cuenta y que lo intente de nuevo en un rato." };
  }
  return saved.replayed
    ? {
        status: "done",
        effect: "noop",
        summary: "Ese reporte ya estaba guardado por este mismo mensaje; no lo dupliqué.",
      }
    : { status: "done", summary: `Reporte guardado (${kind}). Agradécele de verdad, con calidez, y dile que ya lo anotaste y el equipo lo revisa. No prometas una fecha de arreglo.` };
}

// Read-only transparency: describe what Kipu actually holds about the user, from
// real structured state, in natural language (NOT a raw dump). Powers "¿qué sabes
// de mí?" / "¿qué datos tienes?".
async function executeExplainMyData(ctx: AgentContext): Promise<ToolResult> {
  const parts: string[] = [];
  const activeAccounts = ctx.accounts;
  if (activeAccounts.length) {
    const list = activeAccounts.map((a) => `${a.name} (${money(a.currentBalanceOriginal ?? 0, a.currency)})`).join(", ");
    parts.push(`Cuentas (${activeAccounts.length}): ${list}.`);
  } else {
    parts.push("No tienes cuentas registradas todavía.");
  }
  if (ctx.debtAccounts.length) {
    const list = ctx.debtAccounts.map((d) => `${d.name}${(d.currentBalanceOriginal ?? 0) ? ` (debes ${money(d.currentBalanceOriginal ?? 0, d.currency)})` : ""}`).join(", ");
    parts.push(`Tarjetas/deudas (${ctx.debtAccounts.length}): ${list}.`);
  }
  const incomeRead = await readIncomeSources(ctx.userId);
  if (!incomeRead.ok || !incomeRead.complete) {
    return {
      status: "error",
      summary:
        "No pude leer de forma completa tus fuentes de ingreso, así que no voy a presentar una foto parcial como si fuera todo lo que sé de ti. Reintenta.",
    };
  }
  const incomes = incomeRead.sources.filter((i) => i.status !== "cancelled");
  if (incomes.length) {
    parts.push(`Ingresos (${incomes.length}): ${incomes.map((i) => `${i.name} ${money(i.amount, i.currency)} ${incomeFrequencyText(i.frequency)}`).join(", ")}.`);
  }
  const goals = ctx.briefing.goalsIntel.portfolio.goals.map((g) => g.goal);
  if (goals.length) {
    parts.push(`Metas (${goals.length}): ${goals.map((g) => g.name).join(", ")}.`);
  }
  const reservedFixed = ctx.briefing.margenKipu?.breakdown?.reservedFixed ?? 0;
  const upcoming = ctx.briefing.upcomingPayments?.length ?? 0;
  if (reservedFixed > 0 || upcoming > 0) parts.push(`Tienes gastos fijos y pagos próximos que también tomo en cuenta.`);
  // Stage 32 — active per-category budgets are part of "what Kipu knows":
  // name them so the month tracker never feels like hidden data.
  const budgetProgress = ctx.briefing.budgetProgress;
  if (budgetProgress?.hasBudgets) {
    parts.push(
      `Presupuestos del mes por categoría (${budgetProgress.items.length}): ${budgetProgress.items.map((i) => i.labelEs).join(", ")} — los sigo mes a mes y puedes ajustarlos cuando quieras.`,
    );
  }
  // S31 (item 1.1) — the notes the user left on entities are part of "what Kipu
  // knows": name them so "¿qué sabes de mí?" proves the memory is real.
  const noteSnippet = (s: string) => {
    const clean = s.replace(/\s+/g, " ").trim();
    return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean;
  };
  const entityNotes: string[] = [];
  for (const a of ctx.accounts) if (a.notes?.trim()) entityNotes.push(`${a.name}: "${noteSnippet(a.notes)}"`);
  for (const d of ctx.debtAccounts) if (d.notes?.trim()) entityNotes.push(`${d.name}: "${noteSnippet(d.notes)}"`);
  for (const g of ctx.goals) if (g.notes?.trim()) entityNotes.push(`${g.name}: "${noteSnippet(g.notes)}"`);
  for (const a of ctx.assets ?? []) if (a.notes?.trim()) entityNotes.push(`${a.name}: "${noteSnippet(a.notes)}"`);
  if (entityNotes.length) {
    parts.push(`Notas que me dejaste y tengo presentes (${entityNotes.length}): ${entityNotes.slice(0, 6).join("; ")}${entityNotes.length > 6 ? "; …" : ""}.`);
  }
  return {
    status: "done",
    summary: `Cuéntale con naturalidad y calidez qué sabes de él/ella — NO como un volcado ni una lista fría. Datos reales que tienes ahora: ${parts.join(" ")} También recuerdo tus correcciones, alias y preferencias para no repetir errores. Todo esto es suyo: puede pedir cambiarlo o exportarlo cuando quiera (export_my_data). Resume en 2-4 frases humanas, no repitas todos los números si son muchos${entityNotes.length ? " — y si viene al caso, menciona que guardas sus notas" : ""}.`,
    data: { accounts: activeAccounts.length, debts: ctx.debtAccounts.length, goals: goals.length, entityNotes: entityNotes.length },
  };
}

// Change the user's base/display currency — HIGH-IMPACT. Safe ONLY when there is
// no existing financial data whose stored base_amounts would be silently
// reinterpreted. If any account/card/movement exists, REFUSE and explain (never
// fabricate a conversion of stored base amounts). Requires explicit confirmation
// even when safe.
async function executeChangeBaseCurrency(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const newBase = typeof args.newBaseCurrency === "string" && /^[A-Za-z]{3}$/.test(args.newBaseCurrency.trim())
    ? args.newBaseCurrency.trim().toUpperCase()
    : null;
  if (!newBase) return { status: "needs_info", summary: "¿A qué moneda base? Dame el código de 3 letras (USD, COP, UYU…)." };
  if (newBase === ctx.baseCurrency) {
    return { status: "done", effect: "noop", summary: `Tu moneda base ya es ${newBase}; no hay nada que cambiar.` };
  }
  // Any existing money-holding entity means stored base_amounts exist; changing
  // the base without re-pricing them would silently lie about every number.
  const hasAccounts = ctx.accounts.length > 0;
  const hasDebts = ctx.debtAccounts.length > 0;
  let hasMovements = false;
  const cnt = await accountMovementCount(ctx.userId, ["user_id"], ctx.userId).catch(() => null);
  // accountMovementCount with user_id.eq is a plain count of the user's ledger.
  if (cnt === null || cnt > 0) hasMovements = true;
  if (hasAccounts || hasDebts || hasMovements) {
    return {
      status: "refused",
      summary: `No puedo cambiar tu moneda base a ${newBase} de forma segura: ya tienes datos financieros (cuentas, tarjetas o movimientos) guardados en ${ctx.baseCurrency}, y cambiar la base reinterpretaría todos esos montos con un tipo de cambio inventado. Cambiar la base solo es seguro antes de tener datos. Si de verdad necesitas otra base, lo mejor es hacerlo con soporte/onboarding para no dañar tus números. Explícaselo honesto y sin tecnicismos; NO inventes conversiones.`,
    };
  }
  if (args.confirm !== true) {
    return { status: "needs_info", summary: `Cambiar tu moneda base a ${newBase} afecta cómo se muestran TODOS tus números. Como aún no tienes datos, es seguro. Confírmalo con el usuario y vuelve a llamar con confirm=true.` };
  }
  // Re-auditoría 3 de J-1 (P1): el UPDATE directo tenía el MISMO check-then-update
  // que la cuenta — contaba datos y escribía después, sin lock ni CAS. La RPC (069)
  // bloquea el perfil, re-verifica cuentas/deudas/movimientos DENTRO de la
  // transacción y hace CAS sobre la base leída; `already_changed` cubre la
  // respuesta perdida.
  const changed = await changeBaseCurrencyWith(
    async (payload) => {
      const supabase = createSupabaseAdminClient();
      return supabase.rpc("kipu_change_base_currency_v2", { p: payload });
    },
    { userId: ctx.userId, expectedBase: String(ctx.baseCurrency ?? ""), newBase },
  );
  if (!changed.ok) {
    return {
      status: changed.reason === "conflict" ? "error" : "refused",
      summary: changed.reason === "conflict"
        ? `Tu moneda base cambió mientras editaba; NO toqué nada. Refresca y reintenta.`
        : `No pude cambiar tu moneda base a ${newBase}: la base la rechazó porque ya hay datos financieros guardados en ${ctx.baseCurrency} (cambiarla reinterpretaría esos montos con un cambio inventado). Explícaselo honesto; NO quedó nada a medias.`,
    };
  }
  ctx.dirty = true;
  return { status: "done", summary: `Listo: tu moneda base ahora es ${newBase}. De aquí en adelante tus números se manejan en ${newBase}. Confírmalo simple.` };
}

async function executeUpdateAccount(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const accountName = typeof args.accountName === "string" ? args.accountName.trim() : "";
  const newName = typeof args.newName === "string" ? args.newName.trim().slice(0, 80) : "";
  if (!accountName) return { status: "needs_info", summary: "¿Cuál cuenta?" };
  const target = normName(accountName);
  // Only real name matches count — NO single-account fallback: "renombra mi
  // Visa" (a card, not in ctx.accounts) must never rename the only account.
  const matches = ctx.accounts.filter((a) => {
    const n = normName(a.name);
    return n.includes(target) || target.includes(n);
  });
  const account = matches.length === 1 ? matches[0] : null;
  if (!account) {
    const cardHit = ctx.debtAccounts.find((d) => {
      const n = normName(d.name);
      return n.includes(target) || target.includes(n);
    });
    if (cardHit) {
      return { status: "needs_info", summary: `"${cardHit.name}" es una tarjeta/deuda, no una cuenta; este renombre es solo para cuentas. Dile al usuario qué encontraste y pregúntale qué quiere hacer.` };
    }
    const list = (matches.length > 1 ? matches : ctx.accounts).map((a) => `"${a.name}"`).join(", ");
    return { status: "needs_info", summary: list ? `Ese nombre no coincide claro. ¿Cuál de estas cuentas: ${list}? Pregúntale.` : "No tiene cuentas registradas." };
  }
  // Re-auditoría 2 de J-1: la preferencia moneda→cuenta es un HECHO estructurado
  // (068, único por moneda) que el executor de captura puede PROBAR — no texto
  // libre en memoria. RPC atómica: unset del anterior + set en una transacción.
  if (args.makeCurrencyDefault === true) {
    try {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase.rpc("kipu_set_currency_default_account", {
        p: { user_id: ctx.userId, account_id: account.id },
      });
      if (error || (data as { outcome?: string } | null)?.outcome !== "set") {
        return { status: "error", summary: `No pude guardar la preferencia con certeza; no quedó nada a medias. Reintenta.` };
      }
      // El contexto del turno también refleja el desplazamiento: si otra cuenta de
      // la misma moneda era el default, ya NO lo es (la RPC lo hizo en DB).
      for (const other of ctx.accounts) {
        if (other.id !== account.id && String(other.currency ?? "").toUpperCase() === String(account.currency ?? "").toUpperCase()) {
          other.isCurrencyDefault = false;
        }
      }
      account.isCurrencyDefault = true;
      ctx.dirty = true;
      if (!newName) {
        return { status: "done", summary: `Listo: "${account.name}" quedó como su cuenta por defecto para ${account.currency} — los próximos movimientos en ${account.currency} sin cuenta nombrada van ahí. Confírmalo simple.` };
      }
    } catch {
      return { status: "error", summary: "No pude guardar la preferencia ahora; reintenta." };
    }
  }
  if (!newName) {
    return { status: "needs_info", summary: `¿Cómo la renombro? Si lo que quiere es cerrar/eliminar "${account.name}": no borro cuentas (el historial se conserva); puedo dejarla en 0 con un ajuste (reconcile_account_balance) y renombrarla como cerrada. Pregúntale si lo hago así.` };
  }
  // A duplicate name would poison every name-based resolver from here on.
  const newNorm = normName(newName);
  const clash =
    ctx.accounts.find((a) => a.id !== account.id && normName(a.name) === newNorm) ??
    ctx.debtAccounts.find((d) => normName(d.name) === newNorm);
  if (clash) {
    return { status: "needs_info", summary: `Ya existe "${clash.name}" y dos nombres iguales confundirían los registros. Pregúntale por otro nombre.` };
  }
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("accounts")
      .update({ name: newName })
      .eq("id", account.id)
      .eq("user_id", ctx.userId)
      .select("id")
      .maybeSingle();
    if (error || data?.id !== account.id) return { status: "error", summary: "No pude probar que la cuenta se renombrara; no afirmes el cambio e intenta de nuevo en un momento." };
    const oldName = account.name;
    // Keep this turn's context consistent with the DB.
    account.name = newName;
    return { status: "done", summary: `Listo: la cuenta "${oldName}" ahora se llama "${newName}". Sus saldos y su historial quedan igual.` };
  } catch {
    return { status: "error", summary: "No pude renombrar la cuenta ahora. Intenta de nuevo en un momento." };
  }
}

// READ-ONLY affordability check for a HYPOTHETICAL purchase. Computes the
// after-purchase weekly state with the deterministic advisory engine so the
// agent answers about the AFTER margin, not the current one. Writes nothing.
// Stage H — ONE gate for every tool that would quote the Saldo/margen family.
// Returns a refusal when the number cannot be stated honestly; null when it can.
function saldoUnavailableResult(ctx: AgentContext): ToolResult | null {
  if (ctx.saldoAvailable !== false) return null;
  return {
    status: "refused",
    summary:
      "No puedo calcular su Saldo Kipu con certeza ahora mismo (no pude reconstruir su estado). NO cites, estimes ni insinúes ningún número de Saldo, tanque, Reserva, recarga ni margen, y NO respondas si le alcanza para algo. Dile en UNA frase, sin jerga, que ahora no puedes darle ese número con certeza y que lo reintente en un rato. Las acciones que ya se hayan guardado pueden confirmarse, pero sin añadir un número de Saldo.",
  };
}

// Every executor in this set either quotes Saldo/Reserva/ritmo, answers whether
// a purchase fits, or derives a recommendation from the same spendable margin.
// Keeping the gate at the dispatcher makes the invariant independent of each
// executor's internal ordering: refresh first, THEN decide if any number can be
// published. Add new Saldo consumers here as part of their implementation.
// The two installment writes are NOT Saldo-dependent — the registration is valid
// with or without a publishable Saldo, so they stay out of the refusal registry and
// keep writing. What they must NOT do is describe the recharge afterwards, and both
// summaries sit one line away from the healthy branch's money() interpolations of
// ctx.briefing.margenKipu.saldo — so they live here as their own functions, where a
// test can hold them to it instead of trusting a reviewer to notice.
export function installmentCreateDegradedSummary(i: {
  description: string; totalBase: number; cur: string; months: number;
  installmentBase: number; cardName: string; firstDue: string; costNote: string;
}): string {
  return `Plan de cuotas creado: "${i.description}" ${money(i.totalBase, i.cur)} en ${i.months} cuotas de ${money(i.installmentBase, i.cur)}/mes con "${i.cardName}" (primera cuota ~${i.firstDue}). La deuda total ya quedó registrada. No pude recalcular su Saldo ni su recarga con certeza ahora: NO cites ni estimes esos números; dile en una frase que esa parte se actualizará cuando lo reintente.${i.costNote}`;
}

export function installmentCloseDegradedSummary(i: {
  description: string; mode: string; remaining: number; tail: string;
}): string {
  return `Plan "${i.description}" cerrado (${i.mode === "paid_off" ? "liquidado antes de tiempo" : "cancelado"}) con ${i.remaining} cuotas sin facturar. No pude recalcular su recarga con certeza ahora: NO cites ni estimes ese cambio; dile en una frase que esa parte se actualizará cuando lo reintente.${i.tail}`;
}

const SALDO_DEPENDENT_TOOLS = new Set([
  "get_proactive_briefing",
  "evaluate_purchase",
  "plan_debt_payoff",
  "cashflow_outlook",
  "simulate_scenario",
  "plan_cashflow",
  "why_margin_changed",
  "spending_anomalies",
  "budget_suggestion",
  "recommend_cut",
  "evaluate_purchase_as_goal",
  "prioritize_goals",
  "plan_reserve_withdrawal",
]);

export function isSaldoDependentTool(name: string): boolean {
  return SALDO_DEPENDENT_TOOLS.has(name);
}

// Observable tool semantics belong next to the registry, not in a second
// hand-written list inside the orchestrator. Before J-8 only seven reads were
// known there; `net_worth`, `card_status`, `list_recent_movements`, etc. were
// marked as WRITES after a successful read and dirtied the turn. This set is
// deliberately exhaustive for tools whose executor never mutates state.
export const READ_ONLY_AGENT_TOOLS = new Set<string>([
  "get_financial_context",
  "get_proactive_briefing",
  "evaluate_purchase",
  "analyze_debt_health",
  "plan_debt_payoff",
  "compare_debt_vs_investment",
  "estimate_card_interest",
  "cashflow_outlook",
  "simulate_scenario",
  "plan_cashflow",
  "where_did_money_go",
  "why_margin_changed",
  "spending_anomalies",
  "my_subscriptions",
  "budget_suggestion",
  "recommend_cut",
  "evaluate_purchase_as_goal",
  "prioritize_goals",
  "net_worth",
  "get_personalization_profile",
  "explain_personalization",
  "household_summary",
  "household_visibility_explainer",
  "get_personality_test",
  "personality_test_result",
  "convert_currency",
  "plan_reserve_withdrawal",
  "list_open_receivables",
  "search_learned_memory",
  "search_conversation_history",
  "list_recent_movements",
  "list_recent_agent_operations",
  "list_scheduled_changes",
  "export_my_data",
  "explain_my_data",
  "card_status",
]);

export function isReadOnlyAgentTool(name: string): boolean {
  return READ_ONLY_AGENT_TOOLS.has(name);
}

/** Execution semantics are registry metadata, not a phrase router. Every tool
 * exposed to the planner must be classified explicitly. `economic_event`
 * means the invocation always changes an accounting balance and therefore its
 * plan must carry complete financial algebra. `contextual_event` means the
 * same typed tool has both money-moving and state-only modes (for example,
 * observing versus paying a recurring bill); its executor remains the final
 * authority. `domain_state` may change durable product state but cannot pretend
 * to be the mechanism that moved cash/debt/receivables.
 *
 * Keeping the state list explicit is intentional: a newly added mutating tool
 * has no default. The planner catalog fails closed until its author decides
 * which contract it belongs to. */
export type AgentToolEffectMode =
  | "read"
  | "domain_state"
  | "economic_event"
  | "contextual_event";

export const ECONOMIC_EVENT_AGENT_TOOLS = new Set<string>([
  "log_movement",
  "log_movements_batch",
  "transfer_between_accounts",
  "undo_agent_operation",
  "undo_movement",
  "undo_recent_movements",
  "remove_duplicate",
  "record_person_payment",
  "reconcile_account_balance",
  "register_card_payment",
  "create_installment_plan",
]);

export const CONTEXTUAL_EVENT_AGENT_TOOLS = new Set<string>([
  "create_fixed_expense",
  "update_fixed_expense",
  "resolve_recurring_occurrence",
  "close_installment_plan",
  "close_account",
  "reopen_account",
  // Metadata-only corrections are domain state; source/account corrections
  // may move balances through the same typed writer.
  "correct_movement",
]);

export const DOMAIN_STATE_AGENT_TOOLS = new Set<string>([
  "update_card_obligations",
  "learn_spending_correction",
  "create_goal",
  "create_mini_goal",
  "update_goal",
  "register_investment",
  "set_wealth_target",
  "set_ambition_mode",
  "set_financial_philosophy",
  "set_communication_preference",
  "set_risk_preference",
  "set_onboarding_mode",
  "set_nudge_sensitivity",
  "update_life_context",
  "forget_life_context",
  "personalization_feedback",
  "reset_personalization_preference",
  "create_household",
  "add_household_participant",
  "invite_household_member",
  "respond_household_invite",
  "add_shared_expense",
  "mark_reimbursement_paid",
  "create_shared_goal",
  "leave_household",
  "transfer_household_ownership",
  "set_household_visibility",
  "household_invite_link",
  "accept_household_invite",
  "add_recurring_shared_expense",
  "log_recurring_shared_expense",
  "settle_household",
  "edit_shared_expense",
  "cancel_shared_expense",
  "remove_household_member",
  "remove_recurring_shared_expense",
  "share_movement",
  "unshare_movement",
  "submit_personality_test",
  "reset_personality_test",
  "set_exchange_rate",
  "create_card",
  "create_account",
  "schedule_payment",
  "set_account_liquidity",
  "set_savings_plan",
  "update_budget_category",
  "resolve_objective_close",
  "set_engagement_mode",
  "set_ambient_preferences",
  "mark_week_reconciled",
  "remember_fact",
  "update_income",
  "create_income",
  "schedule_change",
  "cancel_scheduled_change",
  "update_account",
  "report_bug",
  "rename_card",
  "close_card",
  "change_account_currency",
  "update_scheduled_payment",
  "cancel_scheduled_payment",
  "change_base_currency",
  "add_asset",
  "update_asset",
  "remove_asset",
  "set_entity_note",
]);

export function agentToolEffectMode(name: string): AgentToolEffectMode | null {
  const matches = [
    READ_ONLY_AGENT_TOOLS.has(name),
    DOMAIN_STATE_AGENT_TOOLS.has(name),
    ECONOMIC_EVENT_AGENT_TOOLS.has(name),
    CONTEXTUAL_EVENT_AGENT_TOOLS.has(name),
  ].filter(Boolean).length;
  if (matches !== 1) return null;
  if (READ_ONLY_AGENT_TOOLS.has(name)) return "read";
  if (DOMAIN_STATE_AGENT_TOOLS.has(name)) return "domain_state";
  if (ECONOMIC_EVENT_AGENT_TOOLS.has(name)) return "economic_event";
  return "contextual_event";
}

const HOUSEHOLD_CONTEXT_TOOLS = new Set([
  "add_household_participant",
  "invite_household_member",
  "add_shared_expense",
  "household_summary",
  "mark_reimbursement_paid",
  "create_shared_goal",
  "leave_household",
  "transfer_household_ownership",
  "set_household_visibility",
  "household_invite_link",
  "add_recurring_shared_expense",
  "log_recurring_shared_expense",
  "settle_household",
  "household_visibility_explainer",
  "edit_shared_expense",
  "cancel_shared_expense",
  "remove_household_member",
  "remove_recurring_shared_expense",
  "share_movement",
  "unshare_movement",
]);

const LOCAL_DATE_TOOLS = new Set([
  "log_movement",
  "log_movements_batch",
  "correct_movement",
  "set_entity_note",
  "register_card_payment",
  "record_person_payment",
  "create_fixed_expense",
  "update_fixed_expense",
  "schedule_change",
  "close_account",
  "reopen_account",
  "create_mini_goal",
]);

function requireValidUserTimezone(
  name: string,
  ctx: AgentContext,
  args: Record<string, unknown>,
): ToolResult | null {
  if (!LOCAL_DATE_TOOLS.has(name)) return null;
  // A plain entity note has no calendar semantics. Requiring a timezone for it
  // hid the more important typed availability checks (for example, whether the
  // asset list was actually readable) and turned a harmless note into a
  // timezone-dependent write. Only the optional reminder date needs a local
  // day boundary.
  if (
    name === "set_entity_note" &&
    !(typeof args.scheduleReminderDate === "string" &&
      args.scheduleReminderDate.trim())
  ) {
    return null;
  }
  if (ctx.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: ctx.timezone }).format();
      return null;
    } catch {
      // fall through
    }
  }
  return {
    status: "needs_info",
    summary:
      "Me falta una zona horaria válida para guardar la fecha correcta de esta acción. Configúrala primero; no escribí nada.",
  };
}

async function requireCompleteHouseholdContext(
  name: string,
  ctx: AgentContext,
): Promise<ToolResult | null> {
  if (!HOUSEHOLD_CONTEXT_TOOLS.has(name)) return null;
  const read = await readHouseholdData(ctx.userId);
  if (!moneyReadPublishable(read)) {
    ctx.householdsAvailable = false;
    ctx.households = undefined;
    return {
      status: "error",
      summary:
        "No pude probar que vi completo tu hogar y sus saldos compartidos. No afirmé ausencia ni escribí cambios; reintenta.",
    };
  }
  ctx.householdsAvailable = true;
  ctx.households = read.households;
  return null;
}

export interface ToolExecutionEffect {
  wrote: boolean;
  failed: boolean;
  needsInfo: boolean;
}

/** One authority for turn state. Previously the orchestrator skipped the whole
 * status switch for read-only tools, so a failed read did not set hadError;
 * conversely any non-read `done` was called a write even when it was a proved
 * replay/no-op. */
export function classifyToolExecution(
  toolName: string,
  result: Pick<ToolResult, "status" | "effect">,
): ToolExecutionEffect {
  const wrote =
    result.effect === "wrote" ||
    (result.status === "done" &&
      result.effect == null &&
      !isReadOnlyAgentTool(toolName));
  return {
    wrote,
    failed: result.status === "error",
    needsInfo:
      result.status === "needs_info" ||
      result.status === "refused" ||
      result.status === "redirect",
  };
}

export async function refreshAgentContextIfDirty(ctx: AgentContext): Promise<boolean> {
  if (!ctx.dirty) return true;
  if (!ctx.refresh) {
    ctx.saldoAvailable = false;
    return false;
  }
  try {
    await ctx.refresh();
    ctx.dirty = false;
    return true;
  } catch {
    // A failed refresh must leave the context dirty. Otherwise a later tool in
    // this SAME turn can quote accounts/debts/goals/assets from before the
    // successful write. Saldo already failed closed; the rest of the live
    // financial state now follows the same contract and retries on the next
    // tool/model boundary.
    ctx.saldoAvailable = false;
    return false;
  }
}

async function requirePublishableSaldo(
  name: string,
  ctx: AgentContext,
): Promise<ToolResult | null> {
  if (!isSaldoDependentTool(name)) return null;
  await refreshAgentContextIfDirty(ctx);
  return saldoUnavailableResult(ctx);
}

async function executeEvaluatePurchase(
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult> {
  const amountOriginal = Number(args.amount);
  if (!Number.isFinite(amountOriginal) || amountOriginal <= 0) {
    return { status: "needs_info", summary: "¿De cuánto sería esa compra?" };
  }
  const s = ctx.snapshot;
  const onCard = args.onCard === true;
  const itemKind = classifyAdvisoryItemKind({
    itemDescription: typeof args.itemDescription === "string" ? args.itemDescription : null,
    message: ctx.rawMessage,
  });
  // Stage H (P1-2/P1-5) — a food/transport purchase does NOT cost its face value
  // in Saldo: inside the monthly objective it costs 0, and if it is the purchase
  // that CROSSES, only the part past the objective comes out (objetivo 500,
  // llevas 480, compra 50 → 30, ni 50 ni 0). Engine math, not the prompt's.
  const categoryFromMessage = inferFinancialCategory(ctx.rawMessage);
  const purchaseCategory =
    categoryFromMessage !== "other"
      ? categoryFromMessage
      : category(args.category, "other");
  const objState = ctx.briefing?.objectives?.states?.find(
    (st) => st.category === purchaseCategory,
  );
  const purchasePlan = planHypotheticalPurchase({
    amountOriginal,
    originalCurrency: hypotheticalCurrency(args, ctx),
    baseCurrency: s.baseCurrency,
    category: purchaseCategory,
    fxRates: ctx.fxRates ?? [],
    objectiveState: objState,
  });
  const planFailure = hypotheticalPlanFailure(purchasePlan);
  if (planFailure || !purchasePlan.ok) return planFailure!;
  const amount = purchasePlan.amountBase;
  const impact = purchasePlan.objectiveImpact;
  const saldoCost = purchasePlan.saldoCostBase;
  const amountText = hypotheticalAmountText(
    purchasePlan.amountOriginal,
    purchasePlan.originalCurrency,
    purchasePlan.amountBase,
    purchasePlan.baseCurrency,
  );
  const sk = ctx.briefing?.margenKipu?.saldo;
  if (
    !sk ||
    !Number.isFinite(sk.saldo) ||
    !Number.isFinite(sk.fillDaily)
  ) {
    return saldoUnavailableResult(ctx) ?? {
      status: "refused",
      summary: "No puedo comprobar tu Saldo ahora mismo. Reintenta en un rato.",
    };
  }
  // Fully absorbed by the objective and paid with cash: there is nothing to
  // weigh against the margin — the money was reserved before the tank was even
  // filled. Answer straight instead of asking the engine about a 0 purchase.
  if (!onCard && impact && objState && saldoCost <= 0.005) {
    return {
      status: "done",
      summary: `HIPOTÉTICO, no registrado. Esos ${amountText} entran COMPLETOS en su objetivo de ${objState.labelEs.toLowerCase()} (lleva ${money(objState.spentMTD, s.baseCurrency)} de ${money(objState.objectiveBase, s.baseCurrency)}): NO tocan su Saldo Kipu, que sigue en ${money(sk.saldo, s.baseCurrency)}. Díselo simple y tranquilo ("eso entra en tu objetivo, tu Saldo ni se entera"); no registres nada.${marginConfidenceNote(ctx)}`,
      data: { recommendation: "yes", severity: "none", withinObjective: true, drainsFromSaldo: 0 },
    };
  }
  const decision = evaluateAdvisoryDecision({
    amount,
    saldoCost,
    paymentMethodType: onCard ? "card" : "account",
    itemKind,
    currentSaldo: sk.saldo,
    dailyRefill: sk.fillDaily,
    debtPressureLevel: s.debtPressureLevel,
    totalDebt: s.totalDebt,
    availableCash: s.availableCash,
    suppressContributionPush: s.suppressContributionPush,
    baseCurrency: s.baseCurrency,
  });
  const confNote = marginConfidenceNote(ctx);
  // Stage D — the answer is the SALDO (the dashboard hero), never the retired
  // weekly rate: saldo AFTER the purchase, and the layer it would dip into when
  // it overflows (Reserva → aportes del mes → vender inversión → deuda).
  let objectiveLine = "";
  if (impact && objState) {
    if (impact.drainsFromSaldo <= 0.005) {
      objectiveLine = ` OJO: entra COMPLETO en su objetivo de ${objState.labelEs.toLowerCase()} (lleva ${money(objState.spentMTD, s.baseCurrency)} de ${money(objState.objectiveBase, s.baseCurrency)}) — NO toca su Saldo. Díselo así: "eso entra en tu objetivo, tu Saldo ni se entera".`;
    } else if (impact.crossesWithThisPurchase) {
      objectiveLine = ` OJO: esa compra CRUZA su objetivo de ${objState.labelEs.toLowerCase()} (lleva ${money(objState.spentMTD, s.baseCurrency)} de ${money(objState.objectiveBase, s.baseCurrency)}): ${money(impact.absorbedByObjective, s.baseCurrency)} los cubre el objetivo y SOLO ${money(impact.drainsFromSaldo, s.baseCurrency)} salen de su Saldo. Usa ESE número, nunca el total.`;
    } else {
      objectiveLine = ` OJO: ya cruzó su objetivo de ${objState.labelEs.toLowerCase()}, así que esta compra sale ENTERA de su Saldo (${money(impact.drainsFromSaldo, s.baseCurrency)}).`;
    }
  }
  const saldoAfter = Math.round((sk.saldo - saldoCost) * 100) / 100;
  const overflow = Math.round(Math.max(0, saldoCost - sk.saldo) * 100) / 100;
  const nextLayer = sk.layers.find((l) => l.amount === null || l.amount > 0);
  const layerLine =
    overflow > 0
      ? ` NO le alcanza el Saldo: faltan ${money(overflow, s.baseCurrency)}, que saldrían de la capa ${nextLayer?.label ?? "Reserva"} — AVISA el cruce de capa, sin bloquear ni juzgar.`
      : ` Le queda ${money(saldoAfter, s.baseCurrency)} de Saldo después.`;
  const paymentLine = onCard
    ? ` La tarjeta NO baja efectivo hoy, pero aumenta la deuda en ${money(amount, s.baseCurrency)}.`
    : ` El efectivo baja en ${money(amount, s.baseCurrency)}.`;
  return {
    status: "done",
    summary: `HIPOTÉTICO, no registrado. Si gasta ${amountText}${onCard ? " con tarjeta" : ""}: su Saldo Kipu AHORA es ${money(sk.saldo, s.baseCurrency)}.${objectiveLine}${layerLine}${paymentLine} Recomendación del motor: ${decision.recommendation} (severidad ${decision.severity}). Responde con el estado DESPUÉS de la compra en términos del Saldo (el MISMO número del dashboard); no registres nada.${confNote}`,
    data: decision,
  };
}

// J-8 (D6) — un refresh que falla NO significa "nada cambió". Si el estado no se
// pudo releer después de escribir, cualquier cifra del resumen puede ser la de
// ANTES. Es la doctrina del Bloque I aplicada a la capa del agente: «no pude
// leer» ≠ «no hay novedad». El write ya aterrizó; lo que no se puede es narrar
// números frescos sobre él.
export function withRefreshCaveat(
  refreshed: boolean,
  summary: string,
  safeFollowup?: string | null,
): string {
  return refreshed
    ? summary
    : "La escritura SÍ quedó registrada, pero no pude releer el estado después. Confirma únicamente que quedó guardada; NO cites, repitas ni estimes saldos, remanentes, totales, capas o montos del resumen anterior. Ofrece revisar los números en un momento." +
      (safeFollowup ? ` ${safeFollowup}` : "");
}

// ── J-8 (D2) — la barrera de corrección deja de vivir en UN executor ──────────
//
// J-2 construyó la defensa correcta («una corrección no es un movimiento nuevo»)
// y la cableó SOLO en `log_movement`. El agujero se cobró en producción — «Pero el pago fue
// de $743.93, ¿de dónde sacaste el $552.77?» produjo un SEGUNDO pago de tarjeta
// en vez de corregir el primero, y la deuda quedó reducida dos veces.
//
// El matcher ya sabía hacerlo (`capture-matching` mapea card_payment→debt_payment
// y vincula por identidad descriptiva aunque cambie el monto). La barrera vive
// en el chokepoint, pero SOLO para tools con un adapter exhaustivo hacia una fila
// del ledger; un tool nuevo debe agregar ese adapter (el tipo y los tests lo
// hacen visible), nunca entrar en una lista decorativa y fallar abierto.
// Tools donde un pago puede venir repartido entre dos orígenes reales.
const MULTI_SOURCE_TOOLS = new Set<string>([
  "register_card_payment",
  "record_person_payment",
  "log_movement",
]);

// La barrera solo enumera tools para los que existe un ADAPTER completo hacia
// una fila del ledger. La lista anterior tenía 15 nombres pero 12 caían por el
// `return null` final: parecía transversal y fallaba abierta. Los writes de
// dominio (household, cuotas, fijos, cierres) necesitan su propia corrección;
// incluirlos decorativamente es peor que no incluirlos.
export const CORRECTABLE_LEDGER_TOOLS = [
  "register_card_payment",
  "transfer_between_accounts",
  "record_person_payment",
  "create_installment_plan",
] as const;
type CorrectableLedgerTool = (typeof CORRECTABLE_LEDGER_TOOLS)[number];
const CORRECTABLE_LEDGER_TOOL_SET = new Set<string>(CORRECTABLE_LEDGER_TOOLS);

// El candidato que se compara contra los movimientos recientes. Se deriva de los
// args del tool: no hay entry construido todavía (ése es el punto — bloquear ANTES
// de escribir). `null` = este tool no aporta una identidad suficiente para decidir,
// y entonces NO se bloquea: la barrera sólo actúa sobre evidencia, nunca por
// sospecha (un falso positivo acá es un cerrojo sobre una captura legítima).
export function correctionCandidateForTool(
  name: CorrectableLedgerTool,
  args: Record<string, unknown>,
  ctx: {
    debtAccounts: { id: string; name: string; currency: string }[];
    accounts: { id: string; name: string; currency: string }[];
  },
): { type: string; amount: number; currency: string; description: string; sourceId: string | null } | null {
  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const byName = <T extends { id: string; name: string }>(list: T[], ref: unknown): T | null => {
    const r = typeof ref === "string" ? ref.trim() : "";
    if (!r) return null;
    const exact = list.find((x) => x.id === r);
    if (exact) return exact;
    const t = normName(r);
    const m = list.filter((x) => { const n = normName(x.name); return n.includes(t) || t.includes(n); });
    return m.length === 1 ? m[0] : null;
  };
  if (name === "register_card_payment") {
    const amount = num(args.amount);
    const card = byName(ctx.debtAccounts, args.cardName);
    if (amount == null || !card) return null;
    const src = byName(ctx.accounts, args.fromAccount);
    return {
      type: "debt_payment",
      amount,
      currency: card.currency,
      description: `Pago ${card.name}`,
      sourceId: src?.id ?? card.id,
    };
  }
  if (name === "transfer_between_accounts") {
    const amount = num(args.amount);
    const src = byName(ctx.accounts, args.sourceAccountId);
    if (amount == null || !src) return null;
    return {
      type: "transfer",
      amount,
      currency: src.currency,
      description: String(args.description ?? "Movimiento entre cuentas"),
      sourceId: src.id,
    };
  }
  if (name === "record_person_payment") {
    const amount = num(args.amount);
    if (amount == null) return null;
    // El schema real se llama `person`; `personName` nunca existió. Ese typo
    // hacía que toda corrección persona→persona fallara abierta.
    const who = typeof args.person === "string" ? args.person.trim() : "";
    if (!who) return null;
    if (args.direction !== "in" && args.direction !== "out") return null;
    const direction = args.direction;
    const inflowKind = [
      "refund",
      "loan_repayment",
      "capital_return_unrecorded",
      "borrowed",
    ].includes(String(args.inflowKind))
      ? String(args.inflowKind)
      : "income";
    const type = direction === "out"
      ? "expense"
      : inflowKind === "refund"
        ? "refund"
        : inflowKind === "capital_return_unrecorded" || inflowKind === "borrowed"
          ? "adjustment"
          : "income";
    const own = byName(ctx.accounts, args.accountId);
    return {
      type,
      amount,
      currency:
        typeof args.currency === "string" && args.currency.trim()
          ? args.currency.trim().toUpperCase()
          : own?.currency ?? "",
      description: who,
      sourceId: own?.id ?? null,
    };
  }
  if (name === "create_installment_plan") {
    const amount = num(args.totalAmount);
    const card = byName(ctx.debtAccounts, args.cardName);
    const description =
      typeof args.description === "string" ? args.description.trim() : "";
    if (amount == null || !card || !description) return null;
    return {
      type: "expense",
      amount,
      currency:
        typeof args.currency === "string" && args.currency.trim()
          ? args.currency.trim().toUpperCase()
          : card.currency,
      description,
      sourceId: card.id,
    };
  }
  return null; // exhaustividad defensiva para JS; TS no permite otro nombre.
}

// Fail-CLOSED igual que J-2: si el mensaje reformula una corrección y no podemos
// PROBAR que leímos los movimientos recientes completos, no se escribe. La
// asimetría es deliberada — una captura normal que falla abierto cuesta un
// duplicado que el usuario ve; una corrección que falla abierta cobra el mismo
// dinero dos veces y queda invisible.
export async function guardCorrectiveToolCallWith(
  name: CorrectableLedgerTool,
  args: Record<string, unknown>,
  ctx: AgentContext,
  readRecent: (userId: string) => Promise<DuplicateContextRead>,
): Promise<ToolResult | null> {
  if (ctx.operationManifestAuthorized === true) return null;
  const raw = ctx.rawMessage ?? "";
  if (!correctivePhrasing(raw)) return null;

  const cand = correctionCandidateForTool(name, args, ctx);
  if (!cand) {
    return {
      status: "needs_info",
      data: { correctionBlocked: true },
      summary:
        `Suena a una corrección, pero faltan datos para identificar con seguridad qué movimiento corrige. ` +
        `NO llamé ${name} ni escribí nada. Pide en una sola frase el movimiento/monto/instrumento que quiere corregir y usa list_recent_movements.`,
    };
  }

  const read = await readRecent(ctx.userId);
  if (!read.ok || !read.complete) {
    return {
      status: "needs_info",
      data: { correctionBlocked: true },
      summary: "Suena a una corrección y no pude probar que leí todos tus movimientos recientes. NO registré nada; reinténtalo en un rato.",
    };
  }

  const candidate: RecentMovementKey = {
    type: cand.type,
    cents: Math.round(cand.amount * 100),
    currency: cand.currency,
    sourceId: cand.sourceId,
    occurredAtMs: Date.now(),
    createdAtMs: Date.now(),
    merchantToken: "",
    correctionToken: correctionIdentityToken(cand.description),
    category: null,
  };
  const targets = movementCorrectionTargets(raw, candidate, read.context.recentKeys, {
    windowMs: 36 * 60 * 60_000,
  }).filter((t) => t.id);
  const first = targets[0];
  if (!first) {
    return {
      status: "needs_info",
      data: { correctionBlocked: true },
      summary:
        `Suena a una corrección, pero entre los movimientos recientes completos no encontré uno que pueda vincular con certeza. ` +
        `NO llamé ${name} ni escribí nada. Usa list_recent_movements y pregúntale cuál corrige.`,
    };
  }

  const label = (t: RecentMovementKey) =>
    `${t.id} — ${(t.description ?? "").trim() || "sin descripción"} (${money(t.cents / 100, t.currency)})`;
  if (targets.length === 1) {
    return {
      status: "redirect",
      data: { transactionId: first.id, correctionBlocked: true },
      summary: `Eso es una CORRECCIÓN de un movimiento que ya registré, no uno nuevo: ${label(first)}. Llama correct_movement con transactionId=${first.id} y solo el campo que cambió. NO vuelvas a llamar ${name}: registrarlo otra vez movería el mismo dinero dos veces.`,
    };
  }
  return {
    status: "needs_info",
    data: { correctionBlocked: true },
    summary: `Eso suena a una CORRECCIÓN y hay ${targets.length} candidatos recientes: ${targets.slice(0, 3).map(label).join(" · ")}. Pregúntale cuál corrige y luego llama correct_movement con ese transactionId. NO vuelvas a llamar ${name}.`,
  };
}

async function guardCorrectiveToolCall(
  name: CorrectableLedgerTool,
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<ToolResult | null> {
  return guardCorrectiveToolCallWith(name, args, ctx, loadDuplicateContext);
}

const ACTION_LABELS: Record<string, string> = {
  cancel_scheduled_change: "cancelar el cambio programado",
  cancel_scheduled_payment: "cancelar el pago programado",
  cancel_shared_expense: "cancelar el gasto compartido",
  change_account_currency: "cambiar la moneda de la cuenta",
  change_base_currency: "cambiar la moneda base",
  close_account: "cerrar la cuenta",
  close_card: "cerrar la tarjeta/deuda",
  close_installment_plan: "cerrar el plan de cuotas",
  create_account: "crear una cuenta",
  create_card: "crear una tarjeta/deuda",
  forget_life_context: "olvidar el dato personal",
  leave_household: "salir del grupo",
  transfer_household_ownership: "transferir la administración del grupo",
  remove_asset: "retirar el activo del patrimonio",
  remove_household_member: "quitar al miembro del grupo",
  remove_recurring_shared_expense: "quitar el gasto compartido recurrente",
  reopen_account: "reabrir la cuenta",
  reset_personality_test: "borrar el resultado del test",
  reset_personalization_preference: "restablecer la preferencia",
  remove_duplicate: "quitar la copia duplicada",
  settle_household: "liquidar las cuentas del grupo",
  set_household_visibility: "cambiar la privacidad del grupo",
  undo_movement: "deshacer el movimiento",
  undo_recent_movements: "deshacer varios movimientos recientes",
  undo_agent_operation: "deshacer una operación completa",
  unshare_movement: "dejar de compartir el movimiento",
};

const ACTION_ARG_LABELS: Record<string, string> = {
  accountId: "cuenta",
  accountName: "cuenta",
  amount: "monto",
  assetId: "activo",
  assetName: "activo",
  cardName: "tarjeta/deuda",
  currency: "moneda",
  currentBalance: "saldo inicial",
  debtAccountId: "tarjeta/deuda",
  destinationAccountId: "cuenta destino",
  dueDay: "día de vencimiento",
  goalId: "meta",
  kind: "tipo",
  minimumPayment: "pago mínimo",
  name: "nombre",
  newBaseCurrency: "nueva moneda base",
  newCurrency: "nueva moneda",
  reference: "referencia",
  sourceAccountId: "cuenta origen",
  totalDueThisMonth: "pago del mes",
  value: "valor",
};

/** Human-readable mirror of the exact payload that the server hashes and stores.
 * It deliberately omits model-owned `confirm` booleans: only the later delivery
 * can authorize the server-stored payload. Internal UUIDs are resolved to the
 * user's entity names where possible, otherwise shown as a stable short
 * reference instead of leaking implementation details. */
export function actionProposalSummary(
  toolName: string,
  args: Record<string, unknown>,
  ctx: Pick<
    AgentContext,
    | "accounts"
    | "debtAccounts"
    | "goals"
    | "fixedExpenses"
    | "assets"
    | "households"
  >,
): string {
  const entities = [
    ...(ctx.accounts ?? []).map((row) => ({ id: row.id, name: row.name })),
    ...(ctx.debtAccounts ?? []).map((row) => ({ id: row.id, name: row.name })),
    ...(ctx.goals ?? []).map((row) => ({ id: row.id, name: row.name })),
    ...(ctx.fixedExpenses ?? []).map((row) => ({ id: row.id, name: row.name })),
    ...(ctx.assets ?? []).map((row) => ({ id: row.id, name: row.name })),
    ...(ctx.households ?? []).map((row) => ({ id: row.id, name: row.name })),
  ];
  const resolveText = (value: string): string => {
    const hit = entities.find((row) => row.id === value);
    if (hit) return hit.name;
    return /^[a-f0-9-]{24,}$/i.test(value)
      ? `referencia …${value.slice(-6)}`
      : value;
  };
  const render = (value: unknown): string => {
    if (typeof value === "string") return resolveText(value.trim()).slice(0, 120);
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value == null) return "vacío";
    if (Array.isArray(value)) return `[${value.map(render).join(", ")}]`.slice(0, 240);
    if (typeof value === "object") {
      return Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => `${ACTION_ARG_LABELS[key] ?? key}: ${render(nested)}`)
        .join(", ")
        .slice(0, 240);
    }
    return String(value).slice(0, 120);
  };
  const details = Object.entries(args)
    .filter(([key, value]) => key !== "confirm" && key !== "confirmDefaultSource" && value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${ACTION_ARG_LABELS[key] ?? key}: ${render(value)}`);
  const action = ACTION_LABELS[toolName] ?? toolName.replaceAll("_", " ");
  return details.length > 0 ? `${action} — ${details.join(" · ")}` : action;
}

const ENTITY_SELECTION_TOOLS = new Set([
  "add_household_participant",
  "add_recurring_shared_expense",
  "add_shared_expense",
  "add_asset",
  "cancel_shared_expense",
  "change_account_currency",
  "close_account",
  "close_card",
  "create_card",
  "create_fixed_expense",
  "create_goal",
  "create_shared_goal",
  "create_income",
  "create_mini_goal",
  "edit_shared_expense",
  "household_invite_link",
  "invite_household_member",
  "leave_household",
  "log_movements_batch",
  "transfer_household_ownership",
  "log_recurring_shared_expense",
  "mark_reimbursement_paid",
  "reconcile_account_balance",
  "register_card_payment",
  "remove_household_member",
  "remove_recurring_shared_expense",
  "remove_asset",
  "rename_card",
  "schedule_payment",
  "set_household_visibility",
  "set_account_liquidity",
  "set_entity_note",
  "set_savings_plan",
  "settle_household",
  "share_movement",
  "unshare_movement",
  "update_account",
  "update_asset",
  "update_card_obligations",
  "update_goal",
]);

const ENTITY_WORDS = new Set([
  "account", "activo", "asset", "banco", "card", "cuenta", "debt", "deuda",
  "goal", "ingreso", "meta", "pago", "tarjeta", "visa", "mastercard",
]);

function namedEntityWasStated(
  rawMessage: string,
  name: string,
  peers: Array<{ name: string }>,
): boolean {
  const rawTokens = normName(rawMessage).split(/\s+/).filter(Boolean);
  const nameTokens = normName(name).split(/\s+/).filter(Boolean);
  if (nameTokens.length === 0) return false;
  for (let index = 0; index + nameTokens.length <= rawTokens.length; index += 1) {
    if (nameTokens.every((token, offset) => rawTokens[index + offset] === token)) {
      return true;
    }
  }
  const peerTokenCounts = new Map<string, number>();
  for (const peer of peers) {
    const tokens = new Set(
      normName(peer.name)
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !ENTITY_WORDS.has(token)),
    );
    for (const token of tokens) {
      peerTokenCounts.set(token, (peerTokenCounts.get(token) ?? 0) + 1);
    }
  }
  return nameTokens.some(
    (token) =>
      token.length >= 4 &&
      !ENTITY_WORDS.has(token) &&
      peerTokenCounts.get(token) === 1 &&
      rawTokens.includes(token),
  );
}

async function guardResolvedEntityChoice(
  input: {
    toolName: string;
    args: Record<string, unknown>;
    ctx: AgentContext;
    label: string;
    chosen: { name: string };
    peers: Array<{ name: string }>;
    serverAuthorized: boolean;
  },
): Promise<ToolResult | null> {
  if (!resolvedEntityNeedsConfirmation({
    rawMessage: input.ctx.rawMessage,
    authorityMessages: input.ctx.entityAuthorityMessages,
    chosen: input.chosen,
    peers: input.peers,
    serverAuthorized: input.serverAuthorized,
  })) {
    return null;
  }
  const guarded = await guardServerConfirmedActionWith(
    input.toolName,
    input.args,
    input.ctx,
    {
      proposalSummary: actionProposalSummary(
        input.toolName,
        input.args,
        input.ctx,
      ),
      unprovenEntity: `${input.label} "${input.chosen.name}"`,
    },
  );
  return guarded.result;
}

export function resolvedEntityNeedsConfirmation(input: {
  rawMessage: string;
  authorityMessages?: string[];
  chosen: { name: string };
  peers: Array<{ name: string }>;
  serverAuthorized: boolean;
}): boolean {
  if (input.serverAuthorized || input.peers.length <= 1) return false;
  if (namedEntityWasStated(input.rawMessage, input.chosen.name, input.peers)) {
    return false;
  }
  // A newly named peer is a correction and outranks inherited authority.
  if (
    input.peers.some(
      (peer) =>
        normName(peer.name) !== normName(input.chosen.name) &&
        namedEntityWasStated(input.rawMessage, peer.name, input.peers),
    )
  ) {
    return true;
  }
  return !(input.authorityMessages ?? []).some((message) =>
    namedEntityWasStated(message, input.chosen.name, input.peers),
  );
}

type SelectableEntity = { id: string; name: string; isCurrencyDefault?: boolean };

function selectedEntity(
  value: unknown,
  rows: readonly SelectableEntity[],
): SelectableEntity | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const direct = rows.find((row) => row.id === value);
  if (direct) return direct;
  const wanted = normName(value);
  const matches = rows.filter((row) => {
    const candidate = normName(row.name);
    return candidate === wanted ||
      candidate.includes(wanted) ||
      wanted.includes(candidate);
  });
  return matches.length === 1 ? matches[0] : null;
}

/** Canonical durable identity for a model-provided entity reference. This is
 * the same exact-id/unique-name resolver used by executeTool; proposal
 * consolidation may compare the id, but never gains a second entity router. */
export function canonicalAgentEntityId(
  value: unknown,
  rows: readonly SelectableEntity[],
): string | null {
  return selectedEntity(value, rows)?.id ?? null;
}

function originAccountWasStated(
  message: string,
  chosen: SelectableEntity,
  accounts: SelectableEntity[],
  debtAccounts: Array<{ name: string }>,
): boolean {
  const rawTokens = normName(message).split(/\s+/).filter(Boolean);
  const chosenTokens = normName(chosen.name).split(/\s+/).filter(Boolean);
  const entityRows = [...accounts, ...debtAccounts];
  const exactSpans = (tokens: string[]): Array<{ start: number; end: number }> => {
    const spans: Array<{ start: number; end: number }> = [];
    if (tokens.length === 0) return spans;
    for (let start = 0; start + tokens.length <= rawTokens.length; start += 1) {
      if (tokens.every((token, offset) => rawTokens[start + offset] === token)) {
        spans.push({ start, end: start + tokens.length });
      }
    }
    return spans;
  };
  const chosenSpans = exactSpans(chosenTokens);
  if (chosenSpans.length > 0) {
    const longerEntitySpans = entityRows.flatMap((entity) => {
      const tokens = normName(entity.name).split(/\s+/).filter(Boolean);
      return tokens.length > chosenTokens.length ? exactSpans(tokens) : [];
    });
    if (
      chosenSpans.some(
        (span) =>
          !longerEntitySpans.some(
            (longer) => longer.start <= span.start && longer.end >= span.end,
          ),
      )
    ) {
      return true;
    }
    // "Produbanco" inside the typed card name "Produbanco MV" names the
    // card, not the account. Every occurrence was owned by a longer entity.
    return false;
  }
  return namedEntityWasStated(message, chosen.name, entityRows);
}

/** Returns the human target that only the model selected.
 *
 * Money evidence already proves numbers, but a true amount attached to the
 * wrong goal/card/account is the same class of corruption. When several
 * candidates exist, an entity chosen by id/name must either be present in the
 * user's current delivery or be a structured account default. Otherwise the
 * durable challenge stores the exact proposal and a later bare confirmation
 * authorizes that proposal — never the model's guess.
 */
export function unprovenAgentEntitySelection(
  toolName: string,
  args: Record<string, unknown>,
  ctx: Pick<
    AgentContext,
    | "rawMessage"
    | "entityAuthorityMessages"
    | "accounts"
    | "debtAccounts"
    | "goals"
    | "assets"
    | "households"
  >,
): string | null {
  if (!ENTITY_SELECTION_TOOLS.has(toolName)) return null;
  const accountRows = ctx.accounts.map((row) => ({
    id: row.id,
    name: row.name,
    isCurrencyDefault: row.isCurrencyDefault,
  }));
  const debtRows = ctx.debtAccounts.map((row) => ({ id: row.id, name: row.name }));
  const goalRows = ctx.goals.map((row) => ({ id: row.id, name: row.name }));
  const assetRows = (ctx.assets ?? []).map((row) => ({ id: row.id, name: row.name }));
  const householdRows = (ctx.households ?? []).map((row) => ({
    id: row.id,
    name: row.name,
  }));
  const checks: Array<{
    label: string;
    value: unknown;
    rows: SelectableEntity[];
  }> = [
    { label: "la cuenta", value: args.accountId ?? args.accountName, rows: accountRows },
    { label: "la cuenta de origen", value: args.sourceAccountId ?? args.fromAccount, rows: accountRows },
    { label: "la cuenta de destino", value: args.destinationAccountId, rows: accountRows },
    { label: "la tarjeta/deuda", value: args.debtAccountId ?? args.cardName, rows: debtRows },
    { label: "la meta", value: args.goalId, rows: goalRows },
    { label: "el activo", value: args.assetId ?? args.assetName, rows: assetRows },
    {
      label: "el hogar/grupo",
      value: args.householdId ?? args.householdName,
      rows: householdRows,
    },
  ];
  if (toolName === "log_movements_batch" && Array.isArray(args.movements)) {
    args.movements.forEach((movement, index) => {
      if (!movement || typeof movement !== "object" || Array.isArray(movement)) {
        return;
      }
      const row = movement as Record<string, unknown>;
      checks.push(
        {
          label: `la cuenta de origen del movimiento ${index + 1}`,
          value: row.sourceAccountId ?? row.accountId ?? row.fromAccount,
          rows: accountRows,
        },
        {
          label: `la cuenta de destino del movimiento ${index + 1}`,
          value: row.destinationAccountId,
          rows: accountRows,
        },
        {
          label: `la tarjeta/deuda del movimiento ${index + 1}`,
          value: row.debtAccountId ?? row.cardName,
          rows: debtRows,
        },
        {
          label: `la meta del movimiento ${index + 1}`,
          value: row.goalId,
          rows: goalRows,
        },
      );
    });
  }
  if (toolName === "set_entity_note") {
    const kind = String(args.entityType ?? "");
    const rows =
      kind === "account"
        ? accountRows
        : kind === "card" || kind === "debt"
          ? debtRows
          : kind === "goal"
            ? goalRows
            : kind === "asset"
              ? assetRows
              : [];
    checks.unshift({
      label: `la entidad ${kind || "indicada"}`,
      value: args.nameOrId,
      rows,
    });
  }
  for (const check of checks) {
    if (check.rows.length <= 1) continue;
    const chosen = selectedEntity(check.value, check.rows);
    if (!chosen) continue;
    if (chosen.isCurrencyDefault === true) continue;
    if (
      [ctx.rawMessage, ...(ctx.entityAuthorityMessages ?? [])].some((message) =>
        namedEntityWasStated(message, chosen.name, check.rows),
      )
    ) {
      continue;
    }
    return `${check.label} "${chosen.name}"`;
  }
  return null;
}

type LoopOriginAuthorityContext = Pick<
  AgentContext,
  | "rawMessage"
  | "entityAuthorityMessages"
  | "operationManifestAuthorized"
  | "accounts"
  | "debtAccounts"
  | "fixedExpenses"
>;

type LoopOriginSelection = {
  label: string;
  value: unknown;
  fixedExpenseId?: unknown;
};

/** Loop-only authority for an account that money leaves from.
 *
 * An id/name copied by the model is an entity selection, not evidence that the
 * user chose that source. Unlike the older general entity guard, this boundary
 * deliberately does not waive the check for a sole candidate or a currency
 * default. The only server-owned substitutes are the card's S31 default-source
 * confirmation flow and an exact durable fixed-expense payment link. An
 * authorized operation manifest is the later-delivery proof for every staged
 * selection.
 */
export function unprovenLoopMonetaryOriginSelection(
  toolName: string,
  args: Record<string, unknown>,
  ctx: LoopOriginAuthorityContext,
): string | null {
  if (ctx.operationManifestAuthorized === true) return null;
  const selections: LoopOriginSelection[] = [];
  const outgoingMovement = (row: Record<string, unknown>): boolean =>
    ["expense", "debt_payment", "goal_contribution"].includes(
      String(row.type ?? ""),
    );

  if (toolName === "register_card_payment") {
    selections.push({ label: "la cuenta de origen", value: args.fromAccount });
  } else if (toolName === "transfer_between_accounts") {
    selections.push({
      label: "la cuenta de origen",
      value: args.sourceAccountId,
    });
  } else if (toolName === "log_movement" && outgoingMovement(args)) {
    selections.push({
      label: "la cuenta de origen",
      value: args.sourceAccountId,
      fixedExpenseId: args.fixedExpenseId,
    });
  } else if (toolName === "log_movements_batch" && Array.isArray(args.movements)) {
    args.movements.forEach((rawMovement, index) => {
      if (
        !rawMovement ||
        typeof rawMovement !== "object" ||
        Array.isArray(rawMovement)
      ) {
        return;
      }
      const movement = rawMovement as Record<string, unknown>;
      if (!outgoingMovement(movement)) return;
      selections.push({
        label: `la cuenta de origen del movimiento ${index + 1}`,
        value: movement.sourceAccountId,
        fixedExpenseId: movement.fixedExpenseId,
      });
    });
  } else if (
    toolName === "record_person_payment" &&
    args.direction === "out"
  ) {
    selections.push({ label: "la cuenta de origen", value: args.accountId });
  } else if (
    toolName === "create_fixed_expense" &&
    args.payNow === true
  ) {
    selections.push({
      label: "la cuenta de origen",
      value: args.sourceAccountId,
    });
  } else if (
    toolName === "update_fixed_expense" &&
    args.payNow === true
  ) {
    selections.push({
      label: "la cuenta de origen",
      value: args.sourceAccountId,
      fixedExpenseId: args.fixedExpenseId,
    });
  } else if (
    toolName === "resolve_recurring_occurrence" &&
    ["confirm", "correct"].includes(String(args.action ?? ""))
  ) {
    selections.push({
      label: "la cuenta de origen",
      value: args.paymentSourceAccountId,
      fixedExpenseId: args.fixedExpenseId,
    });
  } else if (toolName === "correct_movement") {
    selections.push({
      label: "la nueva cuenta de origen",
      value: args.newSourceAccountId,
    });
  }

  const accountRows = ctx.accounts.map((row) => ({
    id: row.id,
    name: row.name,
  }));
  const authorityMessages = [
    ctx.rawMessage,
    ...(ctx.entityAuthorityMessages ?? []),
  ];
  for (const selection of selections) {
    const chosen = selectedEntity(selection.value, accountRows);
    if (!chosen) continue;
    if (
      authorityMessages.some((message) =>
        originAccountWasStated(
          message,
          chosen,
          accountRows,
          ctx.debtAccounts,
        ),
      )
    ) {
      continue;
    }
    if (
      toolName === "register_card_payment" &&
      args.confirmDefaultSource === true
    ) {
      const card = selectedEntity(args.cardName, ctx.debtAccounts);
      if (card) {
        const stored = ctx.debtAccounts.find((row) => row.id === card.id);
        if (stored?.defaultPaymentAccountId === chosen.id) continue;
      }
    }
    const fixedExpenseId =
      typeof selection.fixedExpenseId === "string"
        ? selection.fixedExpenseId
        : null;
    const fixed = fixedExpenseId
      ? (ctx.fixedExpenses ?? []).find(
          (row) =>
            row.id === fixedExpenseId &&
            row.isActive &&
            row.paymentSourceType === "account" &&
            row.paymentSourceId === chosen.id,
        )
      : null;
    if (fixed) continue;
    return `${selection.label} "${chosen.name}"`;
  }
  return null;
}

type LoopOperationAuthorityContext = Pick<
  AgentContext,
  | "entityAuthorityMessages"
  | "operationManifestAuthorized"
  | "accounts"
  | "debtAccounts"
>;

function operationAuthoredAccount(
  ctx: Pick<
    LoopOperationAuthorityContext,
    "entityAuthorityMessages" | "accounts" | "debtAccounts"
  >,
): SelectableEntity | null {
  const accounts = ctx.accounts.map((row) => ({ id: row.id, name: row.name }));
  const named = accounts.filter((account) =>
    (ctx.entityAuthorityMessages ?? []).some((message) =>
      originAccountWasStated(message, account, accounts, ctx.debtAccounts),
    ),
  );
  return named.length === 1 ? named[0] : null;
}

/** Resolve only a MISSING source from user-authored messages owned by the
 * confirmed durable operation. This runs before S31/default-source handling;
 * a sole catalog candidate is deliberately not authority. */
export function loopOperationAuthorizedOriginArguments(
  toolName: string,
  inputArgs: Record<string, unknown>,
  ctx: LoopOperationAuthorityContext,
): Record<string, unknown> {
  if (ctx.operationManifestAuthorized !== true) return inputArgs;
  const account = operationAuthoredAccount(ctx);
  if (!account) return inputArgs;
  const missing = (value: unknown): boolean =>
    typeof value !== "string" || !value.trim();
  const outgoingMovement = (row: Record<string, unknown>): boolean =>
    ["expense", "debt_payment", "goal_contribution"].includes(
      String(row.type ?? ""),
    );

  if (toolName === "register_card_payment" && missing(inputArgs.fromAccount)) {
    return { ...inputArgs, fromAccount: account.id };
  }
  if (
    toolName === "transfer_between_accounts" &&
    missing(inputArgs.sourceAccountId)
  ) {
    return { ...inputArgs, sourceAccountId: account.id };
  }
  if (
    toolName === "log_movement" &&
    outgoingMovement(inputArgs) &&
    missing(inputArgs.sourceAccountId)
  ) {
    return { ...inputArgs, sourceAccountId: account.id };
  }
  if (
    toolName === "log_movements_batch" &&
    Array.isArray(inputArgs.movements)
  ) {
    let changed = false;
    const movements = inputArgs.movements.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
      const movement = raw as Record<string, unknown>;
      if (!outgoingMovement(movement) || !missing(movement.sourceAccountId)) {
        return raw;
      }
      changed = true;
      return { ...movement, sourceAccountId: account.id };
    });
    return changed ? { ...inputArgs, movements } : inputArgs;
  }
  if (
    toolName === "record_person_payment" &&
    missing(inputArgs.accountId)
  ) {
    return { ...inputArgs, accountId: account.id };
  }
  if (
    ["create_fixed_expense", "update_fixed_expense"].includes(toolName) &&
    inputArgs.payNow === true &&
    missing(inputArgs.sourceAccountId)
  ) {
    return { ...inputArgs, sourceAccountId: account.id };
  }
  if (
    toolName === "resolve_recurring_occurrence" &&
    ["confirm", "correct"].includes(String(inputArgs.action ?? "")) &&
    missing(inputArgs.paymentSourceAccountId)
  ) {
    return { ...inputArgs, paymentSourceAccountId: account.id };
  }
  if (
    toolName === "correct_movement" &&
    missing(inputArgs.newSourceAccountId)
  ) {
    return { ...inputArgs, newSourceAccountId: account.id };
  }
  return inputArgs;
}

export type LoopStagingCompleteness =
  | { ok: true; arguments: Record<string, unknown> }
  | { ok: false; question: string };

/** Resolve writer-required durable links before a proposal can be confirmed.
 * The first consumer is borrowed funds: cash destination and the existing
 * non-card liability must both be concrete at staging, never discovered by
 * the writer after confirmation. */
export function completeLoopStagedArguments(
  toolName: string,
  inputArgs: Record<string, unknown>,
  ctx: Pick<
    AgentContext,
    "entityAuthorityMessages" | "accounts" | "debtAccounts"
  >,
): LoopStagingCompleteness {
  if (
    toolName !== "record_person_payment" ||
    inputArgs.direction !== "in" ||
    inputArgs.inflowKind !== "borrowed"
  ) {
    return { ok: true, arguments: inputArgs };
  }
  const person =
    typeof inputArgs.person === "string" ? inputArgs.person.trim() : "";
  if (!person) {
    return {
      ok: false,
      question:
        "Antes de preparar el préstamo recibido necesito el prestamista concreto; pregunta quién entregó los fondos.",
    };
  }
  let argumentsRow = inputArgs;
  const account = selectedEntity(inputArgs.accountId, ctx.accounts);
  if (!account) {
    const authored = operationAuthoredAccount(ctx);
    if (!authored) {
      return {
        ok: false,
        question:
          "Antes de preparar el préstamo recibido necesito la cuenta exacta donde entró el dinero.",
      };
    }
    argumentsRow = { ...argumentsRow, accountId: authored.id };
  }

  const liabilities = ctx.debtAccounts.filter(
    (row) => row.type !== "credit_card",
  );
  const supplied = selectedEntity(argumentsRow.debtAccountId, liabilities);
  const named = selectedEntity(person, liabilities);
  if (supplied) {
    if (named && named.id !== supplied.id) {
      return {
        ok: false,
        question:
          `La deuda elegida es "${supplied.name}", pero el prestamista es "${person}". ` +
          "Pregunta cuál obligación existente debe aumentar.",
      };
    }
    return { ok: true, arguments: argumentsRow };
  }
  if (named) {
    return {
      ok: true,
      arguments: { ...argumentsRow, debtAccountId: named.id },
    };
  }
  const available = liabilities.map((row) => `"${row.name}"`).join(", ");
  return {
    ok: false,
    question: available
      ? `No hay una deuda no-tarjeta inequívoca de "${person}". Pregunta cuál corresponde entre: ${available}.`
      : `No existe una deuda no-tarjeta de "${person}". Pregunta si primero quiere crear esa obligación; no prepares todavía la entrada de dinero.`,
  };
}

/** Runtime-only compatibility for legacy executor confirmations. Durable
 * manifest authorization is the second delivery; it may satisfy the boolean
 * `confirm` expected by close_card without changing persisted step arguments. */
export function loopManifestExecutionArguments(
  toolName: string,
  inputArgs: Record<string, unknown>,
  ctx: LoopOperationAuthorityContext,
): Record<string, unknown> {
  const withOrigin = loopOperationAuthorizedOriginArguments(
    toolName,
    inputArgs,
    ctx,
  );
  return ctx.operationManifestAuthorized === true &&
    toolName === "close_card" &&
    withOrigin.confirm !== true
    ? { ...withOrigin, confirm: true }
    : withOrigin;
}

export type RuntimeToolSchema = {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, RuntimeToolSchema>;
  required?: string[];
  items?: RuntimeToolSchema;
  additionalProperties?: boolean;
};

export type AgentToolArgumentIssueKind =
  | "missing_required"
  | "unknown_property"
  | "invalid_type"
  | "invalid_enum"
  | "unknown_tool";

export interface AgentToolArgumentIssue {
  kind: AgentToolArgumentIssueKind;
  path: string;
  message: string;
}

function runtimeSchemaIssues(
  schema: RuntimeToolSchema,
  value: unknown,
  path: string,
): AgentToolArgumentIssue[] {
  const issues: AgentToolArgumentIssue[] = [];
  if (schema.type === "object") {
    if (
      value == null ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      const target = path || "payload";
      return [{
        kind: "invalid_type",
        path: target,
        message: `${target} debe ser un objeto`,
      }];
    }
    const row = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in row) || row[key] == null) {
        const target = `${path ? `${path}.` : ""}${key}`;
        issues.push({
          kind: "missing_required",
          path: target,
          message: `${target} es obligatorio`,
        });
      }
    }
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(row)) {
        if (!(key in properties)) {
          const target = `${path ? `${path}.` : ""}${key}`;
          issues.push({
            kind: "unknown_property",
            path: target,
            message: `${target} no está permitido`,
          });
        }
      }
    }
    for (const [key, nested] of Object.entries(properties)) {
      if (row[key] !== undefined && row[key] !== null) {
        issues.push(
          ...runtimeSchemaIssues(
            nested,
            row[key],
            path ? `${path}.${key}` : key,
          ),
        );
      }
    }
    return issues;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      return [{
        kind: "invalid_type",
        path,
        message: `${path} debe ser una lista`,
      }];
    }
    if (schema.items) {
      value.forEach((item, index) => {
        issues.push(
          ...runtimeSchemaIssues(schema.items!, item, `${path}[${index}]`),
        );
      });
    }
    return issues;
  }
  if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push({
        kind: "invalid_type",
        path,
        message: `${path} debe ser un número finito`,
      });
    }
  } else if (schema.type === "string") {
    if (typeof value !== "string") {
      issues.push({
        kind: "invalid_type",
        path,
        message: `${path} debe ser texto`,
      });
    }
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") {
      issues.push({
        kind: "invalid_type",
        path,
        message: `${path} debe ser booleano`,
      });
    }
  }
  if (schema.enum && !schema.enum.some((candidate) => candidate === value)) {
    issues.push({
      kind: "invalid_enum",
      path,
      message: `${path} no pertenece al conjunto permitido`,
    });
  }
  return issues;
}

/** Validate a candidate against the exact capability schema supplied to the
 * planner. Keeping this generic matters for tests and future dynamic tools:
 * plan validation must not consult a second registry with a potentially
 * different shape. */
export function runtimeToolArgumentIssues(
  schema: unknown,
  value: unknown,
): AgentToolArgumentIssue[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  return runtimeSchemaIssues(schema as RuntimeToolSchema, value, "");
}

/** Runtime mirror of the function schema. OpenAI normally obeys the JSON
 * schema, but the executor is also called by tests, recovery paths and future
 * channels. A malformed enum/required field must never reach a permissive
 * fallback such as "monthly", base currency or false. */
export function agentToolArgumentIssues(
  toolName: string,
  args: Record<string, unknown>,
): AgentToolArgumentIssue[] {
  const tool = KIPU_TOOL_SCHEMAS.find(
    (candidate) =>
      candidate.type === "function" &&
      candidate.function.name === toolName,
  );
  if (!tool || tool.type !== "function") {
    return [{
      kind: "unknown_tool",
      path: "tool",
      message: `tool desconocido: ${toolName}`,
    }];
  }
  return runtimeToolArgumentIssues(tool.function.parameters, args);
}

export function agentToolArgumentErrors(
  toolName: string,
  args: Record<string, unknown>,
): string[] {
  return agentToolArgumentIssues(toolName, args).map((issue) => issue.message);
}

/** Missing required data can be supplied by the user. An unknown property,
 * wrong type or invalid enum is instead a model/planner contract defect: asking
 * the user cannot remove it from the saved payload and creates an infinite
 * clarification loop. */
export function toolArgumentFailureDisposition(
  issues: AgentToolArgumentIssue[],
): "needs_info" | "error" | null {
  if (issues.length === 0) return null;
  return issues.every((issue) => issue.kind === "missing_required")
    ? "needs_info"
    : "error";
}

function plannedEconomicClassifications(ctx: AgentContext): Set<string> {
  return new Set(
    (ctx.activePlannedAction?.effects ?? [])
      .map((effect) =>
        typeof effect.classification === "string"
          ? effect.classification
          : "",
      )
      .filter(Boolean),
  );
}

/** Monetary authority that comes from typed, current server state rather than
 * from a number the model copied into its payload. This is deliberately a
 * path-level proof registry: each new derived amount needs its own exact
 * domain verifier. It is not a phrase list and it never trusts
 * `effect.amount_source` merely because the planner wrote `stored_fact`.
 *
 * Stable fixed expenses are the first class. When the user says “pagué el
 * arriendo” and later supplies only the source account, the declared native
 * amount remains the amount of that named plan. Asking the user to confirm the
 * same stored number a third time adds no authority. A variable bill, a
 * mismatched amount/currency, an incomplete catalog, or any conflicting amount
 * stated anywhere in the durable operation stays behind the normal challenge.
 */
export function serverVerifiedStoredMonetaryClaimPaths(
  name: string,
  args: Record<string, unknown>,
  ctx: Pick<
    AgentContext,
    "fixedExpenses" | "rawMessage" | "entityAuthorityMessages"
  > &
    Partial<Pick<AgentContext, "debtAccounts" | "baseCurrency" | "activePlannedAction">>,
): string[] {
  const authorities = storedFactAuthoritiesForAction({
    capability: name,
    arguments: args,
    catalog: {
      complete:
        Array.isArray(ctx.fixedExpenses) && Array.isArray(ctx.debtAccounts),
      baseCurrency: ctx.baseCurrency ?? "",
      fixedExpenses: ctx.fixedExpenses ?? [],
      debtAccounts: ctx.debtAccounts ?? [],
    },
  });
  if (authorities.length === 0) return [];

  const userAuthoredOperationText = [
    ...(ctx.entityAuthorityMessages ?? []),
    ctx.rawMessage,
  ]
    .filter(Boolean)
    .join("\n");
  const userAmounts = statedAmounts(userAuthoredOperationText);
  const provenanceByPath = new Map(
    (ctx.activePlannedAction?.provenance ?? []).map((row) => [row.path, row]),
  );
  return authorities.flatMap((authority) => {
    const claim = monetaryClaimsFromToolArgs(args).find(
      (candidate) => candidate.path === authority.path,
    );
    const provenance = provenanceByPath.get(authority.path);
    const sameAmount =
      claim != null &&
      Math.round(claim.amount * 100) === Math.round(authority.amount * 100);
    const sourceBound =
      provenance?.kind === "stored_fact" &&
      provenance.source_ref === authority.source_ref;
    const contradicted = userAmounts.some(
      (amount) =>
        Math.round(amount * 100) !== Math.round(authority.amount * 100),
    );
    return sameAmount && sourceBound && !contradicted
      ? [authority.path]
      : [];
  });
}

/** Native loop variant of the stored-money verifier. The planner provenance
 * envelope does not exist in this mode, so authority is derived directly from
 * the complete current catalog and exact validated arguments. It preserves
 * the same amount/currency and contradiction checks; no model-authored source
 * token is accepted. */
export function loopServerVerifiedStoredMonetaryClaimPaths(
  name: string,
  args: Record<string, unknown>,
  ctx: Pick<AgentContext, "fixedExpenses" | "debtAccounts" | "baseCurrency" | "rawMessage" | "entityAuthorityMessages">,
): string[] {
  const authorities = storedFactAuthoritiesForAction({
    capability: name,
    arguments: args,
    catalog: {
      complete: Array.isArray(ctx.fixedExpenses) && Array.isArray(ctx.debtAccounts),
      baseCurrency: ctx.baseCurrency,
      fixedExpenses: ctx.fixedExpenses ?? [],
      debtAccounts: ctx.debtAccounts ?? [],
    },
  });
  const userAmounts = statedAmounts(
    [...(ctx.entityAuthorityMessages ?? []), ctx.rawMessage]
      .filter(Boolean)
      .join("\n"),
  );
  const claims = monetaryClaimsFromToolArgs(args);
  return authorities.flatMap((authority) => {
    const claim = claims.find((candidate) => candidate.path === authority.path);
    const sameAmount =
      claim != null &&
      Math.round(claim.amount * 100) === Math.round(authority.amount * 100);
    const contradicted = userAmounts.some(
      (amount) => Math.round(amount * 100) !== Math.round(authority.amount * 100),
    );
    return sameAmount && !contradicted ? [authority.path] : [];
  });
}

/** The planner may understand arbitrary prose, but the final tool arguments
 * must preserve the economic effect it declared. This is the deterministic
 * boundary that prevents a phrase about returned capital from turning into
 * income or a new liability because a second model pass chose a different
 * enum. No lexical classifier participates. */
function plannedEconomicCompatibility(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentContext,
): ToolResult | null {
  if (!ctx.activePlannedAction) return null;
  const classifications = plannedEconomicClassifications(ctx);
  let expected: string | null = null;
  if (name === "log_movement") {
    const type = String(args.type ?? "");
    expected =
      type === "income"
        ? "income"
        : type === "expense"
          ? "expense"
          : type === "debt_payment"
            ? "payment"
            : null;
  } else if (name === "log_movements_batch") {
    const rows = Array.isArray(args.movements) ? args.movements : [];
    const incomeRows = rows.filter(
      (row) =>
        row &&
        typeof row === "object" &&
        String((row as Record<string, unknown>).type ?? "") === "income",
    ).length;
    const plannedIncome = [...classifications].filter(
      (classification) => classification === "income",
    ).length;
    const incompatibleInflow = [...classifications].some((classification) =>
      [
        "debt_proceeds",
        "receivable_repayment",
        "capital_return_unrecorded",
        "refund",
      ].includes(classification),
    );
    if (incomeRows > 0 && (plannedIncome === 0 || incompatibleInflow)) {
      return {
        status: "refused",
        summary:
          "El lote contiene una entrada que no está validada como ingreso. No registré ninguna fila; separa devoluciones, reembolsos o deuda recibida en su herramienta económica.",
      };
    }
  } else if (name === "record_person_payment" && args.direction === "in") {
    expected =
      args.inflowKind === "income"
        ? "income"
        : args.inflowKind === "refund"
          ? "refund"
          : args.inflowKind === "loan_repayment"
            ? "receivable_repayment"
            : args.inflowKind === "borrowed"
              ? "debt_proceeds"
              : args.inflowKind === "capital_return_unrecorded"
                ? "capital_return_unrecorded"
                : null;
  }
  if (expected && !classifications.has(expected)) {
    return {
      status: "refused",
      summary:
        `La herramienta propone ${expected}, pero ése no es el efecto económico validado por el plan. ` +
        "No moví dinero; vuelve a planificar quién debía a quién y qué balance cambia.",
    };
  }
  return null;
}

export async function executeTool(
  name: string,
  inputArgs: Record<string, unknown>,
  ctx: AgentContext,
  options: {
    mode?: "planned" | "loop";
    loopStep?: {
      id: string;
      capability: string;
      arguments: Record<string, unknown>;
      effects: Array<Record<string, unknown>>;
    };
    loopEconomicPreflightOnly?: boolean;
    loopEconomicExecutionPermit?: LoopEconomicExecutionPermit;
  } = {},
): Promise<ToolResult> {
  let args = inputArgs;
  const loopMode = options.mode === "loop";
  if (!loopMode && ctx.plannedCapabilities && !ctx.plannedCapabilities.has(name)) {
    return {
      status: "refused",
      summary:
        "Esa capacidad no pertenece al plan validado de esta operación. No ejecuté nada; vuelve a planificar con el pedido completo.",
    };
  }
  if (!loopMode && ctx.plannedActions) {
    const canonical = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
      if (value && typeof value === "object") {
        const row = value as Record<string, unknown>;
        return `{${Object.keys(row)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
          .join(",")}}`;
      }
      return JSON.stringify(value);
    };
    const planned = ctx.plannedActions.find(
      (action) =>
        !action.consumed &&
        action.capability === name &&
        canonical(action.arguments) === canonical(inputArgs),
    );
    if (!planned) {
      return {
        status: "refused",
        summary:
          "La llamada no coincide con ningún paso exacto del plan validado. No ejecuté nada; vuelve a planificar con los datos actuales.",
      };
    }
    const blockedDependency = planned.dependsOn.find((dependency) => {
      const prior = ctx.plannedActions?.find((action) => action.id === dependency);
      return !prior || prior.outcome !== "succeeded";
    });
    if (blockedDependency) {
      return {
        status: "refused",
        summary:
          "Un paso anterior del plan todavía no está verificado. No ejecuté este paso ni adelanté sus efectos.",
      };
    }
    planned.consumed = true;
    ctx.activePlannedAction = {
      id: planned.id,
      capability: planned.capability,
      arguments: planned.arguments,
      effects: planned.effects,
      provenance: planned.provenance,
    };
  }
  if (loopMode) {
    // Gate 3 remains active but correctly sees no planner algebra in native
    // mode. The durable marker describes economic class, not a fabricated
    // direction/surface. Executors receive the staged identity immediately
    // after this compatibility gate.
    ctx.activePlannedAction = null;
  }
  const economicPlanGate = plannedEconomicCompatibility(name, args, ctx);
  if (economicPlanGate) return economicPlanGate;
  if (loopMode) {
    const step = options.loopStep;
    if (!step || step.capability !== name) {
      return {
        status: "error",
        summary:
          "La llamada nativa no tiene una identidad durable stageada. No ejecuté nada.",
      };
    }
    ctx.activePlannedAction = {
      id: step.id,
      capability: step.capability,
      arguments: step.arguments,
      effects: step.effects,
      provenance: [],
    };
    ctx.loopDispatcherAuthorized = true;
  }
  // Global post-write freshness barrier. Saldo-dependent tools already had a
  // typed gate, but accounts/debts/goals/assets could still be read from the
  // start-of-turn cache after a failed refresh. No second action or read may
  // proceed on that stale state: the first write is durable, and the honest
  // outcome is to confirm that fact while asking the user to retry the rest.
  if (ctx.dirty && !(await refreshAgentContextIfDirty(ctx))) {
    return {
      status: "error",
      summary:
        "La acción anterior sí puede haber quedado guardada, pero no pude releer tu estado financiero actualizado. No hice esta segunda acción ni voy a citar saldos, cuentas, deudas, metas o patrimonio viejos; reintenta en un momento.",
    };
  }
  if (loopMode) {
    // Loop-only and server-derived. The persisted manifest arguments remain
    // exact; execution may consume user-authored operation authority and the
    // manifest's own second-delivery confirmation before legacy S31/confirm
    // branches get a chance to ask for the same fact again.
    args = loopManifestExecutionArguments(name, args, ctx);
  }
  const saldoGate = await requirePublishableSaldo(name, ctx);
  if (saldoGate) return saldoGate;
  // Auto-sizing a mini-goal is itself a Saldo decision. Run this typed gate
  // before timezone and the generic amount-evidence challenge so an unavailable
  // engine never gets disguised as a missing timezone or merely "please confirm
  // the model's number".
  if (
    name === "create_mini_goal" &&
    !(Number.isFinite(Number(args.weeklyContribution)) && Number(args.weeklyContribution) > 0)
  ) {
    const autoMiniSaldoGate = await requirePublishableSaldo(
      "evaluate_purchase_as_goal",
      ctx,
    );
    if (autoMiniSaldoGate) return autoMiniSaldoGate;
  }
  // Validate after the fail-closed Saldo barrier, but before any other read,
  // write or durable challenge. This ordering preserves the stronger contract:
  // a Saldo-dependent tool can never publish/continue on stale money merely
  // because its model payload is also malformed. A bare later confirmation is
  // intentionally allowed through so the server can restore the exact
  // previously validated payload; it is validated again below before dispatch.
  const issues = agentToolArgumentIssues(name, args);
  const disposition = toolArgumentFailureDisposition(issues);
  if (disposition) {
    return {
      status: disposition,
      summary: disposition === "needs_info"
        ? `La propuesta de ${name} está incompleta: ${issues.map((issue) => issue.message).join("; ")}. No ejecuté nada; pide únicamente esos datos aportables.`
        : `El plan produjo argumentos incompatibles para ${name}: ${issues.map((issue) => issue.message).join("; ")}. No ejecuté nada; vuelve a planificar internamente y no le pidas al usuario que corrija un campo inventado por el modelo.`,
    };
  }
  const timezoneGate = requireValidUserTimezone(name, ctx, args);
  if (timezoneGate) return timezoneGate;
  const householdGate = await requireCompleteHouseholdContext(name, ctx);
  if (householdGate) return householdGate;
  // J-8 (D2): la corrección se evalúa ANTES de despachar para cada tool que tiene
  // adapter completo. `log_movement` conserva además su barrera propia (trabaja
  // sobre el entry ya construido y cubre el lote).
  if (CORRECTABLE_LEDGER_TOOL_SET.has(name) && name !== "register_card_payment") {
    const corrective = await guardCorrectiveToolCall(name as CorrectableLedgerTool, args, ctx);
    if (corrective) return corrective;
  }
  // J-8 (D3+D5): si el mensaje declara DOS orígenes para un mismo movimiento, se
  // pregunta el reparto ANTES de escribir. Escribir una parte y preguntar el resto
  // —lo que pasó con «Produbanco MÁS un dinero prestado de Alpaca»— deja el otro
  // lado sin contar y presenta como completo algo que no lo está.
  // `register_card_payment` owns a stricter ordered preflight inside its
  // executor: amount truth first, then durable cross-turn source state. Running
  // this generic guard first would ask only for the split, skip persistence and
  // reopen the exact founder bug on the next message.
  if (
    ctx.operationManifestAuthorized !== true &&
    MULTI_SOURCE_TOOLS.has(name) &&
    name !== "register_card_payment"
  ) {
    const split = planMultiSourcePayment({
      rawMessage: ctx.rawMessage ?? "",
      instrumentNames: [...ctx.accounts.map((a) => a.name), ...ctx.debtAccounts.map((d) => d.name)],
      totalAmount: Number.isFinite(Number(args.amount)) ? Number(args.amount) : null,
    });
    if (!split.ok) return { status: "needs_info", summary: split.reason };
    if (split.allocations) {
      return {
        status: "needs_info",
        summary:
          `Detecté un reparto real entre ${split.allocations.map((row) => `${row.name}: ${row.amount}`).join(" · ")}. ` +
          `NO llamé ${name}: ese writer acepta una sola fuente y perdería una pata. ` +
          `Si es un pago de tarjeta usa register_card_payment: ese executor deriva el reparto del mensaje crudo; para otro tipo de movimiento pide registrarlo como operaciones separadas y explícitas.`,
      };
    }
  }
  // `confirmDefaultSource` is not authority by itself. If the model sets it on
  // a first call, resolve the exact saved account on the server so the durable
  // proposal names what would be charged. An ambiguous/missing card cannot
  // create a vague challenge that a bare “sí” later authorizes.
  if (
    name === "register_card_payment" &&
    args.confirmDefaultSource === true &&
    !(typeof args.fromAccount === "string" && args.fromAccount.trim())
  ) {
    const ref =
      typeof args.cardName === "string" ? normName(args.cardName) : "";
    const cards = ctx.debtAccounts.filter((row) => {
      const candidate = normName(row.name);
      return (
        row.id === args.cardName ||
        (ref.length > 0 &&
          (candidate.includes(ref) || ref.includes(candidate)))
      );
    });
    const card = cards.length === 1 ? cards[0] : null;
    const saved = card?.defaultPaymentAccountId
      ? ctx.accounts.find(
          (row) => row.id === card.defaultPaymentAccountId,
        ) ?? null
      : null;
    if (!card || !saved) {
      return {
        status: "needs_info",
        summary:
          "No pude probar qué tarjeta y qué cuenta habitual autorizaba esa confirmación. No registré nada; nombra la tarjeta y la cuenta.",
      };
    }
    args = { ...args, fromAccount: saved.id };
  }
  const permit = options.loopEconomicExecutionPermit;
  if (
    permit &&
    (!loopMode ||
      permit.stepKey !== options.loopStep?.id ||
      permit.capability !== name)
  ) {
    return {
      status: "error",
      summary:
        "El permiso request-local no coincide con el step económico stageado. No ejecuté nada.",
    };
  }
  const confirmation = permit
    ? {
        result: null,
        authorizedArgs: permit.authorizedArgs,
        serverAuthorized: permit.serverAuthorized,
      }
    : await guardServerConfirmedActionWith(name, args, ctx, {
        readOnly: isReadOnlyAgentTool(name),
        proposalSummary: actionProposalSummary(name, args, ctx),
        unprovenEntity: loopMode
          ? unprovenLoopMonetaryOriginSelection(name, args, ctx) ??
            unprovenAgentEntitySelection(name, args, ctx)
          : unprovenAgentEntitySelection(name, args, ctx),
        serverVerifiedMonetaryClaimPaths:
          loopMode
            ? loopServerVerifiedStoredMonetaryClaimPaths(name, args, ctx)
            : serverVerifiedStoredMonetaryClaimPaths(name, args, ctx),
        serverVerifiedDeclaredStoredFacts:
          ctx.serverVerifiedDeclaredStoredFacts,
      });
  if (confirmation.result) return confirmation.result;
  args = confirmation.authorizedArgs;
  const authorizedErrors = agentToolArgumentErrors(name, args);
  if (authorizedErrors.length > 0) {
    return {
      status: "error",
      summary:
        `La propuesta confirmada no pasó el contrato del tool (${authorizedErrors.join("; ")}). ` +
        "No ejecuté nada; genera una propuesta nueva con los datos correctos.",
    };
  }
  if (options.loopEconomicPreflightOnly) {
    if (
      !loopMode ||
      !options.loopStep ||
      !["economic_event", "contextual_event"].includes(
        agentToolEffectMode(name) ?? "",
      )
    ) {
      return {
        status: "error",
        summary:
          "El preflight económico sólo admite un step loop económico stageado. No ejecuté nada.",
      };
    }
    return {
      status: "done",
      effect: "noop",
      summary:
        "Preflight económico completo; el dispatcher todavía no ejecutó el writer.",
      data: {
        loopEconomicPreflightReady: true,
        permit: {
          stepKey: options.loopStep.id,
          capability: name,
          authorizedArgs: args,
          serverAuthorized: confirmation.serverAuthorized,
        } satisfies LoopEconomicExecutionPermit,
      },
    };
  }
  switch (name) {
    case "get_financial_context": {
      // A broad hidden prompt is not numerical provenance for the final reply:
      // the founder incident used a TRUE account balance as the WRONG card
      // payment. Return the requested entity/value associations through a typed
      // tool result so the output-grounding barrier can prove every quoted
      // native amount without authorizing cross-entity substitution.
      const accounts = ctx.accounts
        .filter((row) => !row.isGoalAccount)
        .map(
          (row) =>
            `${row.name}: ${money(row.currentBalanceOriginal ?? 0, row.currency)}`,
        );
      const debts = ctx.debtAccounts.map(
        (row) =>
          `${row.name}: ${money(row.currentBalanceOriginal ?? 0, row.currency)} de saldo/deuda`,
      );
      const goals = ctx.goals.map(
        (row) =>
          `${row.name}: ${money(row.currentAmount ?? 0, row.currency)} de ${money(row.targetAmount ?? 0, row.currency)}`,
      );
      const incomes = (ctx.incomeSources ?? []).map(
        (row) =>
          `${row.name}: ${money(row.originalAmount ?? row.amount, row.originalCurrency ?? row.currency)} · ${row.frequency} · ${row.status}`,
      );
      const fixedExpenses = (ctx.fixedExpenses ?? []).map((row) => {
        const nativeAmount =
          row.planningAmount ?? row.originalAmount ?? row.amount;
        const nativeCurrency = row.originalCurrency ?? row.currency;
        return `${row.name}: ${money(nativeAmount, nativeCurrency)} · ${row.frequency} · ${row.isActive ? "activo" : "inactivo"}${row.isVariable ? " · variable" : ""}`;
      });
      const assets =
        ctx.assetsAvailable === false
          ? null
          : (ctx.assets ?? []).map((row) => ({
              entity: row.name,
              amount: row.valueOriginal ?? row.valueBase,
              currency: row.currency ?? ctx.baseCurrency,
              valueBase: row.valueBase,
              baseCurrency: ctx.baseCurrency,
              assetClass: row.assetClass,
            }));
      const saldo =
        ctx.saldoAvailable === false
          ? null
          : {
              amount: ctx.briefing.margenKipu.saldo.saldo,
              currency: ctx.baseCurrency,
              safeToday: ctx.briefing.cashflow.safeToday,
              safeThisWeek: ctx.briefing.cashflow.safeThisWeek,
              upcomingPayments: ctx.briefing.upcomingPayments,
            };
      return {
        status: "done",
        summary:
          `Estado financiero nativo verificado.\nCuentas:\n${accounts.join("\n") || "ninguna"}\n` +
          `Tarjetas/deudas:\n${debts.join("\n") || "ninguna"}\n` +
          `Metas:\n${goals.join("\n") || "ninguna"}\n` +
          `Ingresos recurrentes:\n${incomes.join("\n") || "ninguno"}\n` +
          `Gastos fijos:\n${fixedExpenses.join("\n") || "ninguno"}\n` +
          (assets == null
            ? "Activos: lectura no disponible; no afirmes que no existen ni cierres un total patrimonial.\n"
            : `Activos:\n${assets.map((row) => `${row.entity}: ${money(row.amount, row.currency)}`).join("\n") || "ninguno"}\n`) +
          (saldo == null
            ? "Saldo Kipu/cashflow: no publicable en esta lectura.\n"
            : `Saldo Kipu: ${money(saldo.amount, saldo.currency)} · seguro hoy ${money(saldo.safeToday, saldo.currency)} · esta semana ${money(saldo.safeThisWeek, saldo.currency)}\n`) +
          "Usa cada monto solo con la entidad nombrada en esta misma línea; no cruces un saldo de cuenta con una deuda, pago o meta.",
        data: {
          accounts: ctx.accounts
            .filter((row) => !row.isGoalAccount)
            .map((row) => ({
              entity: row.name,
              amount: row.currentBalanceOriginal ?? 0,
              currency: row.currency,
            })),
          debts: ctx.debtAccounts.map((row) => ({
            entity: row.name,
            amount: row.currentBalanceOriginal ?? 0,
            currency: row.currency,
          })),
          goals: ctx.goals.map((row) => ({
            entity: row.name,
            currentAmount: row.currentAmount ?? 0,
            targetAmount: row.targetAmount ?? 0,
            currency: row.currency,
          })),
          incomeSources: (ctx.incomeSources ?? []).map((row) => ({
            entity: row.name,
            amount: row.originalAmount ?? row.amount,
            currency: row.originalCurrency ?? row.currency,
            frequency: row.frequency,
            status: row.status,
            variable: row.isVariable,
          })),
          fixedExpenses: (ctx.fixedExpenses ?? []).map((row) => ({
            entity: row.name,
            declaredAmount:
              row.declaredAmount ?? row.originalAmount ?? row.amount,
            planningAmount:
              row.planningAmount ?? row.originalAmount ?? row.amount,
            currency: row.originalCurrency ?? row.currency,
            frequency: row.frequency,
            active: row.isActive,
            variable: row.isVariable,
            projectionProven: row.planningProjectionAvailable !== false,
            valuationProven: row.planningValuationAvailable !== false,
          })),
          assets,
          assetsReadProven: ctx.assetsAvailable !== false,
          saldo,
          saldoReadProven: ctx.saldoAvailable !== false,
        },
      };
    }
    case "get_proactive_briefing": {
      // The dispatcher already refreshed and proved the Saldo publishable. The
      // digest leads with that number, so no executor-local escape hatch exists.
      const b = ctx.briefing;
      // This digest quotes Margen; if the spendable number is weak, flag it so
      // Kipu never presents a preliminary figure as solid (confidence contract).
      const confNote = marginConfidenceNote(ctx);
      return {
        status: "done",
        summary: `${b.digest}${confNote}`,
        data: {
          signals: b.signals,
          nextBestAction: b.nextBestAction,
          upcomingPayments: b.upcomingPayments,
          receivablesOutstanding: b.receivablesOutstanding,
          cardsDueSoon: b.cardsDueSoon,
          daysSinceLastActivity: b.daysSinceLastActivity,
          marginConfidence: (ctx.briefing?.margenKipu as { confidence?: string })?.confidence ?? null,
        },
      };
    }
    case "evaluate_purchase":
      return executeEvaluatePurchase(args, ctx);
    case "log_movement":
      return executeLogMovement(args, ctx, confirmation.serverAuthorized);
    case "log_movements_batch":
      return executeLogMovementsBatch(
        args,
        ctx,
        confirmation.serverAuthorized,
      );
    case "update_card_obligations":
      return executeUpdateCardObligations(args, ctx);
    case "analyze_debt_health":
      return executeAnalyzeDebtHealth(args, ctx);
    case "plan_debt_payoff":
      return executePlanDebtPayoff(args, ctx);
    case "compare_debt_vs_investment":
      return executeCompareDebtVsInvestment(args, ctx);
    case "estimate_card_interest":
      return executeEstimateCardInterest(args, ctx);
    case "cashflow_outlook":
      return executeCashflowOutlook(args, ctx);
    case "simulate_scenario":
      return executeSimulateScenario(args, ctx);
    case "plan_cashflow":
      return executePlanCashflow(args, ctx);
    case "where_did_money_go":
      return executeWhereDidMoneyGo(ctx);
    case "why_margin_changed":
      return executeWhyMarginChanged(ctx);
    case "spending_anomalies":
      return executeSpendingAnomalies(ctx);
    case "my_subscriptions":
      return executeMySubscriptions(ctx);
    case "budget_suggestion":
      return executeBudgetSuggestion(ctx);
    case "recommend_cut":
      return executeRecommendCut(ctx);
    case "learn_spending_correction":
      return executeLearnSpendingCorrection(args, ctx);
    case "evaluate_purchase_as_goal":
      return executeEvaluatePurchaseAsGoal(args, ctx);
    case "create_goal":
      return executeCreateGoal(args, ctx);
    case "create_mini_goal":
      return executeCreateMiniGoal(args, ctx);
    case "prioritize_goals":
      return executePrioritizeGoals(ctx);
    case "update_goal":
      return executeUpdateGoal(args, ctx);
    case "register_investment":
      return executeRegisterInvestment(args, ctx);
    case "net_worth":
      return executeNetWorth(ctx);
    case "set_wealth_target":
      return executeSetWealthTarget(args, ctx);
    case "set_ambition_mode":
      return executeSetAmbitionMode(args, ctx);
    case "set_financial_philosophy":
      return executeSetFinancialPhilosophy(args, ctx);
    case "get_personalization_profile":
      return executeGetPersonalizationProfile(ctx);
    case "set_communication_preference":
      return executeSetCommunicationPreference(args, ctx);
    case "set_risk_preference":
      return executeSetRiskPreference(args, ctx);
    case "set_onboarding_mode":
      return executeSetOnboardingMode(args, ctx);
    case "set_nudge_sensitivity":
      return executeSetNudgeSensitivity(args, ctx);
    case "update_life_context":
      return executeUpdateLifeContext(args, ctx);
    case "forget_life_context":
      return executeForgetLifeContext(args, ctx);
    case "explain_personalization":
      return executeExplainPersonalization(ctx);
    case "personalization_feedback":
      return executePersonalizationFeedback(args, ctx);
    case "reset_personalization_preference":
      return executeResetPersonalization(ctx);
    case "create_household":
      return executeCreateHousehold(args, ctx);
    case "add_household_participant":
      return executeAddHouseholdParticipant(args, ctx);
    case "invite_household_member":
      return executeInviteHouseholdMember(args, ctx);
    case "respond_household_invite":
      return executeRespondHouseholdInvite(args, ctx);
    case "add_shared_expense":
      return executeAddSharedExpense(args, ctx);
    case "household_summary":
      return executeHouseholdSummary(args, ctx);
    case "mark_reimbursement_paid":
      return executeMarkReimbursementPaid(args, ctx);
    case "create_shared_goal":
      return executeCreateSharedGoal(args, ctx);
    case "leave_household":
      return executeLeaveHousehold(args, ctx);
    case "transfer_household_ownership":
      return executeTransferHouseholdOwnership(args, ctx);
    case "set_household_visibility":
      return executeSetHouseholdVisibility(args, ctx);
    case "household_invite_link":
      return executeHouseholdInviteLink(args, ctx);
    case "accept_household_invite":
      return executeAcceptHouseholdInvite(args, ctx);
    case "add_recurring_shared_expense":
      return executeAddRecurringSharedExpense(args, ctx);
    case "log_recurring_shared_expense":
      return executeLogRecurringSharedExpense(args, ctx);
    case "settle_household":
      return executeSettleHousehold(args, ctx);
    case "household_visibility_explainer":
      return executeHouseholdVisibilityExplainer(args, ctx);
    case "edit_shared_expense":
      return executeEditSharedExpense(args, ctx);
    case "cancel_shared_expense":
      return executeCancelSharedExpense(args, ctx);
    case "remove_household_member":
      return executeRemoveHouseholdMember(args, ctx);
    case "remove_recurring_shared_expense":
      return executeRemoveRecurringShared(args, ctx);
    case "share_movement":
      return executeShareMovement(args, ctx);
    case "unshare_movement":
      return executeUnshareMovement(args, ctx);
    case "get_personality_test":
      return executeGetPersonalityTest();
    case "submit_personality_test":
      return executeSubmitPersonalityTest(args, ctx);
    case "personality_test_result":
      return executePersonalityTestResult(ctx);
    case "reset_personality_test":
      return executeResetPersonalityTest(ctx);
    case "set_exchange_rate":
      return executeSetExchangeRate(args, ctx);
    case "convert_currency":
      return executeConvertCurrency(args, ctx);
    case "create_card":
      return executeCreateCard(args, ctx);
    case "create_account":
      return executeCreateAccount(args, ctx);
    case "transfer_between_accounts":
      return executeTransfer(args, ctx);
    case "plan_reserve_withdrawal":
      return executePlanReserveWithdrawal(args, ctx);
    case "list_open_receivables":
      return executeListOpenReceivables(ctx);
    case "search_conversation_history":
      return executeSearchConversationHistory(args, ctx);
    case "search_learned_memory":
      return executeSearchLearnedMemory(args, ctx);
    case "list_recent_movements":
      return executeListRecent(args, ctx);
    case "list_recent_agent_operations":
      return executeListRecentAgentOperations(args, ctx);
    case "undo_agent_operation":
      return executeUndoAgentOperation(args, ctx);
    case "undo_movement":
      return executeUndoMovement(args, ctx);
    case "undo_recent_movements":
      return executeUndoRecent(args, ctx);
    case "correct_movement":
      return executeCorrectMovement(args, ctx);
    case "remove_duplicate":
      return executeRemoveDuplicate(args, ctx);
    case "record_person_payment":
      return executePersonPayment(args, ctx);
    case "create_fixed_expense":
      return executeCreateFixed(args, ctx);
    case "update_fixed_expense":
      return executeUpdateFixed(args, ctx, confirmation.serverAuthorized);
    case "schedule_payment":
      return executeSchedule(args, ctx);
    case "set_account_liquidity":
      return executeSetAccountLiquidity(args, ctx);
    case "reconcile_account_balance":
      return executeReconcileBalance(args, ctx);
    case "set_savings_plan":
      return executeSetSavingsPlan(args, ctx);
    case "resolve_objective_close":
      return executeResolveObjectiveClose(args, ctx);
    case "update_budget_category":
      return executeUpdateBudgetCategory(args, ctx);
    case "set_ambient_preferences":
      return executeSetAmbientPreferences(args, ctx);
    case "set_engagement_mode":
      return executeSetEngagementMode(args, ctx);
    case "mark_week_reconciled":
      return executeMarkReconciled(ctx);
    case "remember_fact":
      return executeRememberFact(args, ctx);
    case "update_income":
      return executeUpdateIncome(args, ctx, confirmation.serverAuthorized);
    case "resolve_recurring_occurrence":
      return executeResolveRecurring(
        args,
        ctx,
        confirmation.serverAuthorized,
      );
    case "create_income":
      return executeCreateIncome(args, ctx);
    case "schedule_change":
      return executeScheduleChange(args, ctx, confirmation.serverAuthorized);
    case "list_scheduled_changes":
      return executeListScheduledChanges(ctx);
    case "cancel_scheduled_change":
      return executeCancelScheduledChange(args, ctx);
    case "update_account":
      return executeUpdateAccount(args, ctx);
    case "export_my_data":
      return executeExportMyData(ctx);
    case "explain_my_data":
      return executeExplainMyData(ctx);
    case "report_bug":
      return executeReportBug(args, ctx);
    case "rename_card":
      return executeRenameCard(args, ctx);
    case "close_account":
      return executeCloseAccount(args, ctx);
    case "reopen_account":
      return executeReopenAccount(args, ctx);
    case "close_card":
      return executeCloseCard(args, ctx);
    case "change_account_currency":
      return executeChangeAccountCurrency(args, ctx);
    case "update_scheduled_payment":
      return executeUpdateScheduledPayment(
        args,
        ctx,
        confirmation.serverAuthorized,
      );
    case "cancel_scheduled_payment":
      return executeCancelScheduledPayment(
        args,
        ctx,
        confirmation.serverAuthorized,
      );
    case "change_base_currency":
      return executeChangeBaseCurrency(args, ctx);
    case "add_asset":
      return executeAddAsset(args, ctx);
    case "update_asset":
      return executeUpdateAsset(args, ctx);
    case "remove_asset":
      return executeRemoveAsset(args, ctx);
    case "set_entity_note":
      return executeSetEntityNote(args, ctx, confirmation.serverAuthorized);
    case "register_card_payment":
      return executeRegisterCardPayment(args, ctx);
    case "card_status":
      return executeCardStatus(args, ctx);
    case "create_installment_plan":
      return executeCreateInstallmentPlan(args, ctx);
    case "close_installment_plan":
      return executeCloseInstallmentPlan(args, ctx);
    default:
      return { status: "refused", summary: `Unknown tool: ${name}` };
  }
}
