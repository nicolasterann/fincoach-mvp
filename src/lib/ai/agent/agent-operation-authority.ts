import { createHash } from "crypto";

import {
  monetaryClaimsFromToolArgs,
  numericValueWasStated,
  type MonetaryClaim,
} from "@/lib/capture/amount-evidence";
import type {
  AgentPlanActionRow,
  DurableAgentOperation,
  DurableAgentPlan,
} from "@/lib/ai/agent/agent-operation-store";
import { cardNativeStatementExpected } from "@/lib/financial/card-statement-amount";

/**
 * M0.11A — one semantic authority, one durable authorization unit.
 *
 * The model owns meaning: whether a turn continues, confirms, modifies,
 * rejects or merely observes prior work. Mechanical code may validate that
 * declaration against durable structure, but it must never infer the same
 * meaning again from a regex over the user's prose.
 */
export const AGENT_OPERATION_TRANSITIONS = [
  "new",
  "observed",
  "resolved",
  "partially_resolved",
  "insufficient",
  "modified",
  "confirmed",
  "rejected",
  "abandoned",
  "unrelated",
] as const;

export type AgentOperationTransitionKind =
  (typeof AGENT_OPERATION_TRANSITIONS)[number];

const TRANSITIONS_REQUIRING_TARGET = new Set<AgentOperationTransitionKind>([
  "observed",
  "resolved",
  "partially_resolved",
  "insufficient",
  "modified",
  "confirmed",
  "rejected",
  "abandoned",
]);

const TRANSITIONS_REQUIRING_CONTINUATION = new Set<AgentOperationTransitionKind>([
  "resolved",
  "partially_resolved",
  "insufficient",
  "modified",
  "confirmed",
]);

const TRANSITIONS_REQUIRING_NULL_CONTINUATION = new Set<
  AgentOperationTransitionKind
>(["new", "observed", "rejected", "abandoned", "unrelated"]);

/** Exact model-facing lifecycle wire contract. Runtime validation below uses
 * these same sets, so prompt and validator cannot drift into a hidden schema. */
export function operationTransitionWireContractForPlanner(): Record<
  string,
  unknown
> {
  return {
    model_owned: ["kind", "target_operation_id", "rationale"],
    server_compiled: [
      "consumed_pending_keys",
      "remaining_pending_keys",
      "continuation_operation_id",
      "plan.observed_operation_ids membership",
      "abandon_operation_ids",
    ],
    target_operation_id: {
      required_for: [...TRANSITIONS_REQUIRING_TARGET],
      must_be_null_for: AGENT_OPERATION_TRANSITIONS.filter(
        (kind) => !TRANSITIONS_REQUIRING_TARGET.has(kind),
      ),
    },
    continuation_operation_id: {
      must_equal_target_for: [...TRANSITIONS_REQUIRING_CONTINUATION],
      must_be_null_for: [...TRANSITIONS_REQUIRING_NULL_CONTINUATION],
    },
    observed: {
      observed_operation_ids: "must contain target_operation_id",
      actions: [],
      missing_fields: [],
    },
    confirmed: {
      actions: [],
      missing_fields: [],
      meaning: "authorize the exact persisted manifest; do not reproduce payloads",
    },
    rejected_or_abandoned: {
      abandon_operation_ids: "must contain target_operation_id",
      actions: [],
      missing_fields: [],
    },
  };
}

export interface AgentOperationTransition {
  kind: AgentOperationTransitionKind;
  target_operation_id: string | null;
  consumed_pending_keys: string[];
  remaining_pending_keys: string[];
  /** A short model-authored account of how the current delivery affected the
   * prior operation. It is audit evidence, never executable authority. */
  rationale: string;
}

export const AGENT_VALUE_PROVENANCE_KINDS = [
  "user_stated",
  "stored_fact",
  "derived",
] as const;

export type AgentValueProvenanceKind =
  (typeof AGENT_VALUE_PROVENANCE_KINDS)[number];

export const AGENT_DERIVATION_RULES = [
  "current_balance",
  "target_balance",
  "exact_difference",
  "full_obligation",
  "stored_fixed_amount",
  "period_obligations",
] as const;

export type AgentDerivationRule = (typeof AGENT_DERIVATION_RULES)[number];

export const AGENT_DRIFT_POLICIES = [
  "exact",
  "rederive_if_same_consequence",
  "dynamic_as_authorized",
] as const;

export type AgentDriftPolicy = (typeof AGENT_DRIFT_POLICIES)[number];

const LIVE_PLANNER_PROVENANCE_KINDS = [
  "user_stated",
  "stored_fact",
] as const satisfies readonly AgentValueProvenanceKind[];

/** Exact live provenance wire. `derived` remains part of the durable type so
 * M0.11B can add one locked verifier at a time without making old plans
 * unreadable, but A exposes no derived rule to the model because runtime can
 * currently re-execute none. A wire contract must describe what can succeed
 * now, not advertise reserved enum values that every validator rejects. */
export function valueProvenanceWireContractForPlanner(): Record<
  string,
  unknown
> {
  return {
    live_kinds: [...LIVE_PLANNER_PROVENANCE_KINDS],
    user_stated: {
      source_ref:
        '"current_delivery" or one exact "operation_delivery:<delivery-key>" exposed by OPEN_OPERATIONS',
      quote: "exact excerpt containing the value",
      state_witness: null,
      derivation: null,
    },
    stored_fact: {
      source_ref: "one exact source_ref from the capability storedFactProvenanceContracts registry",
      quote: null,
      state_witness: "the exact id/version/value witness for that registry row",
      derivation: null,
    },
    derived: {
      live_rules: [],
      status:
        "reserved for M0.11B; do not emit until the shared registry publishes a locked verifier",
    },
  };
}

export interface AgentValueProvenance {
  /** Exact path inside action.arguments, e.g. amount or movements.0.amount. */
  path: string;
  kind: AgentValueProvenanceKind;
  /** User-stated authority names one exact durable delivery: either the
   * current delivery or one delivery already owned by this operation. General
   * chat history may help interpretation, but cannot authorize a new number. */
  source_ref: string;
  /** Exact excerpt of the named durable delivery for user_stated values. */
  quote: string | null;
  /** Server-verifiable witness for stored/derived values. */
  state_witness: Record<string, unknown> | null;
  derivation: {
    rule: AgentDerivationRule;
    drift_policy: AgentDriftPolicy;
  } | null;
}

export interface AgentStoredFactCatalog {
  complete: boolean;
  baseCurrency: string;
  fixedExpenses: Array<{
    id: string;
    isActive: boolean;
    isVariable: boolean;
    declaredAmount?: number | null;
    originalAmount?: number | null;
    amount: number;
    originalCurrency?: string | null;
    currency: string;
  }>;
  debtAccounts: Array<{
    id: string;
    name: string;
    type: string;
    currency: string;
    statementCovered?: boolean | null;
    fullPaymentDueOriginal?: number | null;
    fullPaymentDue?: number | null;
    statementTotalDue?: number | null;
    statementDate?: string | null;
    statementPeriodEnd?: string | null;
  }>;
}

export interface AgentStoredFactAuthority {
  capability: string;
  path: string;
  source_ref: string;
  amount: number;
  currency: string;
  state_witness: Record<string, unknown>;
}

export type StoredFactVerifierDefinition = {
  capability: string;
  path: string;
  source_ref_template: string;
  condition: string;
  executor_verification: string;
  /** A stored fact may own a monetary value that is intentionally absent from
   * the model payload. This rule is structural and model-visible: it tells the
   * same runtime that validates provenance when the verifier materializes the
   * omitted path. Null means the numeric argument itself must be present. */
  required_when_argument_missing: {
    argument_path: string;
    equals: string | number | boolean;
  } | null;
};

/**
 * Model-facing stored-fact registry. These are domain verifiers, never phrase
 * routes: the model remains free to understand arbitrary language, while the
 * server publishes which persisted monetary facts it can prove again.
 */
const STORED_FACT_VERIFIERS: readonly StoredFactVerifierDefinition[] = [
  {
    capability: "log_movement",
    path: "amount",
    source_ref_template:
      "fixed_expenses:<arguments.fixedExpenseId>:declared_amount",
    condition:
      "expense action; exact active non-variable fixed expense; native amount and currency",
    executor_verification:
      "complete fixed-expense catalog and the fixed-expense writer",
    required_when_argument_missing: null,
  },
  {
    capability: "register_card_payment",
    path: "amount",
    source_ref_template:
      "debt_accounts:<resolved credit-card id>:full_payment_due",
    condition:
      "exact live uncovered credit-card statement remainder in native currency",
    executor_verification:
      "current debt catalog, card-payment preflight and the locked PostgreSQL statement guard",
    required_when_argument_missing: {
      argument_path: "paidInFull",
      equals: true,
    },
  },
] as const;

export function storedFactProvenanceContractsForPlanner(
  capability: string,
): StoredFactVerifierDefinition[] {
  return STORED_FACT_VERIFIERS.filter(
    (definition) => definition.capability === capability,
  ).map((definition) => ({ ...definition }));
}

function argumentValueAtPath(
  argumentsValue: Record<string, unknown>,
  path: string,
): { found: boolean; value?: unknown } {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0) return { found: false };
  let cursor: unknown = argumentsValue;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return { found: false };
    }
    const row = cursor as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(row, segment)) {
      return { found: false };
    }
    cursor = row[segment];
  }
  return { found: true, value: cursor };
}

function storedFactMaterializesMissingPath(input: {
  capability: string;
  path: string;
  arguments: Record<string, unknown>;
}): boolean {
  const definition = STORED_FACT_VERIFIERS.find(
    (candidate) =>
      candidate.capability === input.capability &&
      candidate.path === input.path,
  );
  const rule = definition?.required_when_argument_missing;
  if (!rule) return false;
  const observed = argumentValueAtPath(input.arguments, rule.argument_path);
  return observed.found && observed.value === rule.equals;
}

/** One source of truth for the provenance rows an action owes. Most claims
 * come from numeric arguments. A registered stored-fact verifier may also
 * materialize an intentionally omitted numeric argument (paidInFull is the
 * first such shape). Only an exact live authority can contribute that claim;
 * a model-authored provenance row or witness never can. */
export function requiredMonetaryClaimsForAction(input: {
  capability: string;
  arguments: Record<string, unknown>;
  storedFactAuthorities?: AgentStoredFactAuthority[];
}): MonetaryClaim[] {
  const byPath = new Map(
    monetaryClaimsFromToolArgs(input.arguments).map((claim) => [
      claim.path,
      claim,
    ]),
  );
  for (const authority of input.storedFactAuthorities ?? []) {
    if (
      authority.capability !== input.capability ||
      byPath.has(authority.path) ||
      !storedFactMaterializesMissingPath({
        capability: input.capability,
        path: authority.path,
        arguments: input.arguments,
      })
    ) {
      continue;
    }
    byPath.set(authority.path, {
      path: authority.path,
      amount: authority.amount,
    });
  }
  return [...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function normalizedEntityRef(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueDebtAccount(
  ref: unknown,
  debts: AgentStoredFactCatalog["debtAccounts"],
): AgentStoredFactCatalog["debtAccounts"][number] | null {
  const text = String(ref ?? "").trim();
  if (!text) return null;
  const exact = debts.find((debt) => debt.id === text);
  if (exact) return exact;
  const normalized = normalizedEntityRef(text);
  const matches = debts.filter((debt) => {
    const name = normalizedEntityRef(debt.name);
    return name === normalized || name.includes(normalized) || normalized.includes(name);
  });
  return matches.length === 1 ? matches[0] : null;
}

/** Exact positive authorities for one already model-selected action. No
 * authority is produced from an incomplete catalog, an ambiguous entity, an
 * inactive/variable plan, a covered card, or a non-positive amount. */
export function storedFactAuthoritiesForAction(input: {
  capability: string;
  arguments: Record<string, unknown>;
  catalog: AgentStoredFactCatalog;
}): AgentStoredFactAuthority[] {
  if (!input.catalog.complete) return [];
  if (
    input.capability === "log_movement" &&
    input.arguments.type === "expense" &&
    typeof input.arguments.fixedExpenseId === "string"
  ) {
    const matches = input.catalog.fixedExpenses.filter(
      (fixed) =>
        fixed.id === input.arguments.fixedExpenseId &&
        fixed.isActive &&
        fixed.isVariable === false,
    );
    if (matches.length !== 1) return [];
    const fixed = matches[0];
    const amount = Number(
      fixed.declaredAmount ?? fixed.originalAmount ?? fixed.amount,
    );
    const currency = String(
      fixed.originalCurrency ?? fixed.currency ?? "",
    ).trim().toUpperCase();
    if (!(Number.isFinite(amount) && amount > 0 && currency)) return [];
    const proposedCurrency = String(input.arguments.currency ?? "")
      .trim()
      .toUpperCase();
    if (proposedCurrency && proposedCurrency !== currency) return [];
    return [{
      capability: input.capability,
      path: "amount",
      source_ref: `fixed_expenses:${fixed.id}:declared_amount`,
      amount,
      currency,
      state_witness: {
        fixed_expense_id: fixed.id,
        is_active: true,
        is_variable: false,
        amount,
        currency,
      },
    }];
  }
  if (input.capability === "register_card_payment") {
    const card = uniqueDebtAccount(
      input.arguments.cardName,
      input.catalog.debtAccounts.filter((debt) => debt.type === "credit_card"),
    );
    if (!card || card.statementCovered === true) return [];
    const amount = cardNativeStatementExpected(
      card,
      input.catalog.baseCurrency,
    );
    const currency = String(card.currency ?? "").trim().toUpperCase();
    if (!(amount != null && Number.isFinite(amount) && amount > 0 && currency)) {
      return [];
    }
    return [{
      capability: input.capability,
      path: "amount",
      source_ref: `debt_accounts:${card.id}:full_payment_due`,
      amount,
      currency,
      state_witness: {
        debt_account_id: card.id,
        statement_covered: false,
        statement_date: card.statementDate ?? null,
        statement_period_end: card.statementPeriodEnd ?? null,
        amount,
        currency,
      },
    }];
  }
  return [];
}

export type AgentManifestExecutionPolicy =
  | "independent"
  | "dependency_ordered"
  | "atomic";

export interface AgentOperationManifestAction {
  ordinal: number;
  action_id: string;
  capability: string;
  arguments: Record<string, unknown>;
  provenance: AgentValueProvenance[];
  atomic_group: string | null;
  depends_on: string[];
  state_witness: Record<string, unknown>;
  effects: Array<Record<string, unknown>>;
  postconditions: Array<Record<string, unknown>>;
}

export interface AgentOperationManifest {
  version: 1;
  execution_policy: AgentManifestExecutionPolicy;
  actions: AgentOperationManifestAction[];
  /** The final state the user is authorizing. It is derived from the same
   * action witnesses/effects/postconditions, not written as free prose. */
  projected_state: Array<{
    ordinal: number;
    state_witness: Record<string, unknown>;
    effects: Array<Record<string, unknown>>;
    postconditions: Array<Record<string, unknown>>;
  }>;
}

export interface DurableAgentOperationManifest {
  id: string;
  operationId: string;
  planVersion: number;
  status:
    | "proposed"
    | "authorized"
    | "executing"
    | "verified"
    | "rejected"
    | "superseded"
    | "failed_integrity";
  manifestHash: string;
  manifest: AgentOperationManifest;
  proposedDeliveryKey: string;
  authorizedDeliveryKey: string | null;
  verification: Record<string, unknown> | null;
  createdAt: string;
  authorizedAt: string | null;
  verifiedAt: string | null;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeQuestion(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function agentOperationManifestHash(
  manifest: AgentOperationManifest,
): string {
  return createHash("sha256").update(canonical(manifest)).digest("hex");
}

type PersistedPlannerMissingField = {
  key: string;
  reason: string;
  applies_to: string[];
  answer_shape: string;
};

export type PersistedAgentPlanRequest = {
  continuation_operation_id: string | null;
  supersede_operation_ids: string[];
  abandon_operation_ids: string[];
  plan: DurableAgentPlan;
  missing_fields: PersistedPlannerMissingField[];
  pending_question: string | null;
  operation_transition?: AgentOperationTransition;
};

function planWithoutPersistenceValidation(
  plan: DurableAgentPlan,
): Omit<DurableAgentPlan, "persistence_validation"> {
  const validatedPlan = { ...plan };
  delete validatedPlan.persistence_validation;
  return validatedPlan;
}

function persistenceValidationDigest(input: {
  plan: Omit<DurableAgentPlan, "persistence_validation">;
  request: Omit<PersistedAgentPlanRequest, "plan">;
}): string {
  return createHash("sha256").update(canonical(input)).digest("hex");
}

/** Attach a server-owned receipt only after validatePlannedAgentRequest has
 * accepted the complete root envelope. The operation row later owns two kinds
 * of pending state: this immutable PLANNER envelope and mutable EXECUTOR
 * clarifications. Exact worker recovery must resume the former; interpreting
 * the latter as new model output is the save→recovery asymmetry that made a
 * natural confirmation end in persisted_plan_invalid. */
export function attachPersistedAgentPlanValidation(input: {
  request: PersistedAgentPlanRequest;
  deliveryKey: string;
}): DurableAgentPlan {
  const deliveryKey = input.deliveryKey.trim();
  if (!deliveryKey) {
    throw new Error("persisted plan validation requires its durable delivery key");
  }
  const plan = planWithoutPersistenceValidation(input.request.plan);
  const request = {
    continuation_operation_id: input.request.continuation_operation_id,
    supersede_operation_ids: [...input.request.supersede_operation_ids],
    abandon_operation_ids: [...input.request.abandon_operation_ids],
    missing_fields: input.request.missing_fields.map((field) => ({
      key: field.key,
      reason: field.reason,
      applies_to: [...field.applies_to],
      answer_shape: field.answer_shape,
    })),
    pending_question: input.request.pending_question,
    ...(input.request.operation_transition
      ? { operation_transition: { ...input.request.operation_transition } }
      : {}),
  };
  return {
    ...plan,
    persistence_validation: {
      version: 1,
      delivery_key: deliveryKey,
      request,
      digest: persistenceValidationDigest({ plan, request }),
    },
  };
}

/** Recover the exact planner envelope attested at persistence time. This does
 * not waive validation: it verifies the plan+envelope digest and parses every
 * lifecycle field. It deliberately does not consume agent_operations.
 * missing_fields, because those rows may now describe an executor/preflight
 * refusal and are not a planner-authored ambiguity. */
export function recoverPersistedAgentPlanValidation(
  value: unknown,
):
  | { ok: true; deliveryKey: string; request: PersistedAgentPlanRequest }
  | { ok: false; reason: string } {
  const planRow = object(value);
  const receipt = object(planRow?.persistence_validation);
  const requestRow = object(receipt?.request);
  const deliveryKey = finiteText(receipt?.delivery_key, 240);
  const digest = finiteText(receipt?.digest, 64);
  if (
    !planRow ||
    !receipt ||
    receipt.version !== 1 ||
    !requestRow ||
    !deliveryKey ||
    !digest ||
    !/^[a-f0-9]{64}$/.test(digest)
  ) {
    return { ok: false, reason: "persisted plan has no valid server validation receipt" };
  }
  const continuation = requestRow.continuation_operation_id == null
    ? null
    : finiteText(requestRow.continuation_operation_id, 80);
  const supersede = stringArray(requestRow.supersede_operation_ids);
  const abandon = stringArray(requestRow.abandon_operation_ids);
  const missingRaw = Array.isArray(requestRow.missing_fields)
    ? requestRow.missing_fields
    : null;
  const pendingQuestion = requestRow.pending_question == null
    ? null
    : finiteText(requestRow.pending_question, 1_000);
  const transition = requestRow.operation_transition == null
    ? undefined
    : parseAgentOperationTransition(requestRow.operation_transition) ?? null;
  if (
    (requestRow.continuation_operation_id != null && !continuation) ||
    !supersede ||
    !abandon ||
    !missingRaw ||
    (requestRow.pending_question != null && !pendingQuestion) ||
    transition === null
  ) {
    return { ok: false, reason: "persisted plan validation receipt has an invalid root envelope" };
  }
  const missingFields: PersistedPlannerMissingField[] = [];
  for (const missing of missingRaw) {
    const row = object(missing);
    const key = finiteText(row?.key, 120);
    const reason = finiteText(row?.reason, 1_000);
    const appliesTo = stringArray(row?.applies_to);
    const answerShape = finiteText(row?.answer_shape, 500);
    if (!key || !reason || !appliesTo || appliesTo.length === 0 || !answerShape) {
      return { ok: false, reason: "persisted plan validation receipt has an invalid missing field" };
    }
    missingFields.push({
      key,
      reason,
      applies_to: appliesTo,
      answer_shape: answerShape,
    });
  }
  const plan = planRow as unknown as DurableAgentPlan;
  const request: Omit<PersistedAgentPlanRequest, "plan"> = {
    continuation_operation_id: continuation,
    supersede_operation_ids: supersede,
    abandon_operation_ids: abandon,
    missing_fields: missingFields,
    pending_question: pendingQuestion,
    ...(transition ? { operation_transition: transition } : {}),
  };
  const actual = persistenceValidationDigest({
    plan: planWithoutPersistenceValidation(plan),
    request,
  });
  if (actual !== digest) {
    return { ok: false, reason: "persisted plan or validation envelope changed after validation" };
  }
  return { ok: true, deliveryKey, request: { ...request, plan } };
}

export function buildAgentOperationManifest(
  plan: DurableAgentPlan,
): AgentOperationManifest {
  const atomicGroups = new Set(
    plan.actions
      .map((action) => action.atomic_group)
      .filter((group): group is string => Boolean(group)),
  );
  const hasAtomic =
    plan.actions.length > 0 &&
    atomicGroups.size === 1 &&
    plan.actions.every((action) => action.atomic_group != null);
  const hasDependencies = plan.actions.some((action) => action.depends_on.length > 0);
  const executionPolicy: AgentManifestExecutionPolicy = hasAtomic
    ? "atomic"
    : hasDependencies
      ? "dependency_ordered"
      : "independent";
  const actions = plan.actions.map((action, ordinal) => ({
    ordinal,
    action_id: action.id,
    capability: action.capability,
    arguments: action.arguments,
    provenance: action.provenance ?? [],
    atomic_group: action.atomic_group,
    depends_on: [...action.depends_on],
    state_witness: action.state_witness,
    effects: action.effects,
    postconditions: action.postconditions,
  }));
  return {
    version: 1,
    execution_policy: executionPolicy,
    actions,
    projected_state: actions.map((action) => ({
      ordinal: action.ordinal,
      state_witness: action.state_witness,
      effects: action.effects,
      postconditions: action.postconditions,
    })),
  };
}

const SECOND_DELIVERY_CAPABILITIES = new Set([
  "cancel_scheduled_change",
  "cancel_scheduled_payment",
  "cancel_shared_expense",
  "change_account_currency",
  "change_base_currency",
  "close_account",
  "close_card",
  "close_installment_plan",
  "correct_movement",
  "forget_life_context",
  "leave_household",
  "remove_asset",
  "remove_household_member",
  "remove_recurring_shared_expense",
  "reopen_account",
  "reset_personality_test",
  "reset_personalization_preference",
  "settle_household",
  "set_household_visibility",
  "undo_movement",
  "undo_recent_movements",
  "undo_agent_operation",
  "remove_duplicate",
  "transfer_household_ownership",
  "unshare_movement",
  "create_account",
  "create_card",
  "accept_household_invite",
  "add_household_participant",
  "household_invite_link",
  "invite_household_member",
  "respond_household_invite",
  "record_investment_contribution",
]);

const CONDITIONAL_SECOND_DELIVERY_RULES: Array<{
  code: string;
  modelContract: string;
  matches: (action: AgentPlanActionRow) => boolean;
}> = [
  {
    code: "confirmed_new",
    modelContract: "arguments.confirmedNew=true",
    matches: (action) => action.arguments.confirmedNew === true,
  },
  {
    code: "confirmed_default_source",
    modelContract: "arguments.confirmDefaultSource=true",
    matches: (action) => action.arguments.confirmDefaultSource === true,
  },
  {
    code: "cancel_goal",
    modelContract: 'capability=update_goal and arguments.status="cancelled"',
    matches: (action) =>
      action.capability === "update_goal" && action.arguments.status === "cancelled",
  },
  {
    code: "material_fixed_expense_change",
    modelContract:
      "capability=update_fixed_expense and action=delete, amountScope=from_now, or isVariable is present",
    matches: (action) =>
      action.capability === "update_fixed_expense" &&
      (action.arguments.action === "delete" ||
        action.arguments.amountScope === "from_now" ||
        typeof action.arguments.isVariable === "boolean"),
  },
  {
    code: "future_recurring_resolution",
    modelContract:
      'capability=resolve_recurring_occurrence and arguments.scope="from_now"',
    matches: (action) =>
      action.capability === "resolve_recurring_occurrence" &&
      action.arguments.scope === "from_now",
  },
  {
    code: "end_income",
    modelContract: 'capability=update_income and arguments.action="end"',
    matches: (action) =>
      action.capability === "update_income" && action.arguments.action === "end",
  },
  {
    code: "large_scheduled_adjustment",
    modelContract:
      "capability=schedule_change, kind=adjust_percent and abs(arguments.value)>50",
    matches: (action) =>
      action.capability === "schedule_change" &&
      action.arguments.kind === "adjust_percent" &&
      Math.abs(Number(action.arguments.value)) > 50,
  },
  {
    code: "automatic_fx_refresh",
    modelContract:
      "capability=set_exchange_rate and arguments.autoRefresh=true",
    matches: (action) =>
      action.capability === "set_exchange_rate" &&
      action.arguments.autoRefresh === true,
  },
  {
    code: "unrecorded_capital_return",
    modelContract:
      'capability=record_person_payment, arguments.direction="in", and arguments.inflowKind="capital_return_unrecorded"',
    matches: (action) =>
      action.capability === "record_person_payment" &&
      action.arguments.direction === "in" &&
      action.arguments.inflowKind === "capital_return_unrecorded",
  },
  {
    code: "unrecorded_borrowed_funds",
    modelContract:
      'capability=record_person_payment, arguments.direction="in", and arguments.inflowKind="borrowed"',
    matches: (action) =>
      action.capability === "record_person_payment" &&
      action.arguments.direction === "in" &&
      action.arguments.inflowKind === "borrowed",
  },
];

export function manifestAuthorizationPolicyForPlanner(): Record<string, unknown> {
  return {
    always_requires_second_delivery: [...SECOND_DELIVERY_CAPABILITIES].sort(),
    conditional_rules: CONDITIONAL_SECOND_DELIVERY_RULES.map(
      ({ code, modelContract }) => ({ code, when: modelContract }),
    ),
    authorization_prompt:
      "non-null natural question only when at least one action matches; otherwise null",
  };
}

export function manifestSecondDeliveryReasons(
  plan: DurableAgentPlan,
): string[] {
  return plan.actions.flatMap((action) => {
    const reasons: string[] = [];
    if (SECOND_DELIVERY_CAPABILITIES.has(action.capability)) {
      reasons.push(`${action.id}:capability:${action.capability}`);
    }
    for (const rule of CONDITIONAL_SECOND_DELIVERY_RULES) {
      if (rule.matches(action)) reasons.push(`${action.id}:rule:${rule.code}`);
    }
    return reasons;
  });
}

/** Confirmation policy is mechanical and plan-based. It never reads the user
 * message. Ordinary money actions execute from the instruction that requested
 * them; only capabilities with genuinely destructive/social lifecycle impact
 * need a second delivery. */
export function manifestRequiresSecondDelivery(
  plan: DurableAgentPlan,
): boolean {
  return manifestSecondDeliveryReasons(plan).length > 0;
}

/** Native-loop adapter for the exact same mechanical sensitivity registry.
 * It deliberately accepts no user text: capability + validated arguments are
 * the whole policy input, so the dispatcher cannot grow a second lexical
 * interpretation layer. */
export function loopActionSecondDeliveryReasons(input: {
  capability: string;
  arguments: Record<string, unknown>;
}): string[] {
  const action = {
    id: "$loop_action",
    capability: input.capability,
    arguments: input.arguments,
    atomic_group: null,
    depends_on: [],
    state_witness: {},
    effects: [],
    postconditions: [],
  } satisfies AgentPlanActionRow;
  return manifestSecondDeliveryReasons({
    goal: "native loop action",
    interpretation: "native loop action",
    assertions: [],
    ambiguities: [],
    required_reads: [],
    actions: [action],
    postconditions: [],
    response_intent: "act",
    requires_replan_after_reads: false,
  });
}

export function authorizationPromptContractError(
  plan: DurableAgentPlan,
  authorizationPrompt: string | null,
): string | null {
  const reasons = manifestSecondDeliveryReasons(plan);
  if (reasons.length > 0 && !authorizationPrompt) {
    return (
      "plan.authorization_prompt is required for the exact planned " +
      `actions ${JSON.stringify(reasons)}; write one natural question that ` +
      "explains the whole manifest and projected final state"
    );
  }
  if (reasons.length === 0 && authorizationPrompt) {
    return (
      "plan.authorization_prompt must be null because no planned action " +
      "matches the published second-delivery policy"
    );
  }
  return null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteText(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.trim() && value.length <= max
    ? value.trim()
    : null;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value.map((item) => item.trim()).filter(Boolean)
    : null;
}

export function parseAgentOperationTransition(
  raw: unknown,
): AgentOperationTransition | null {
  const row = object(raw);
  if (!row) return null;
  const kind = finiteText(row.kind, 40) as AgentOperationTransitionKind | null;
  const target = row.target_operation_id == null
    ? null
    : finiteText(row.target_operation_id, 80);
  const consumed = stringArray(row.consumed_pending_keys);
  const remaining = stringArray(row.remaining_pending_keys);
  const rationale = finiteText(row.rationale, 1_000);
  if (
    !kind ||
    !AGENT_OPERATION_TRANSITIONS.includes(kind) ||
    (row.target_operation_id != null && !target) ||
    !consumed ||
    !remaining ||
    !rationale ||
    new Set(consumed).size !== consumed.length ||
    new Set(remaining).size !== remaining.length
  ) {
    return null;
  }
  return {
    kind,
    target_operation_id: target,
    consumed_pending_keys: consumed,
    remaining_pending_keys: remaining,
    rationale,
  };
}

export function operationTransitionContractError(input: {
  transition: AgentOperationTransition;
  continuationOperationId: string | null;
  supersedeOperationIds: string[];
  abandonOperationIds: string[];
  observedOperationIds: string[];
  actions: AgentPlanActionRow[];
  missingFields: Array<{ key: string }>;
  pendingQuestion: string | null;
  openOperations?: DurableAgentOperation[];
}): string | null {
  const {
    transition,
    continuationOperationId,
    supersedeOperationIds,
    abandonOperationIds,
    observedOperationIds,
    actions,
    missingFields,
    pendingQuestion,
  } = input;
  const target = transition.target_operation_id;
  const prior = target
    ? input.openOperations?.find((operation) => operation.id === target) ?? null
    : null;
  const currentMissing = new Set(missingFields.map((field) => field.key));
  const priorMissing = new Set(
    (prior?.missingFields ?? [])
      .map((field) => finiteText(field.key, 120))
      .filter((key): key is string => Boolean(key)),
  );
  if (TRANSITIONS_REQUIRING_TARGET.has(transition.kind) && !target) {
    return (
      `operation_transition.target_operation_id is required when ` +
      `operation_transition.kind=${transition.kind}`
    );
  }
  if (!TRANSITIONS_REQUIRING_TARGET.has(transition.kind) && target) {
    return (
      `operation_transition.target_operation_id must be null when ` +
      `operation_transition.kind=${transition.kind}`
    );
  }
  if (
    TRANSITIONS_REQUIRING_CONTINUATION.has(transition.kind) &&
    continuationOperationId !== target
  ) {
    return (
      `operation_transition.target_operation_id must equal ` +
      `continuation_operation_id when operation_transition.kind=${transition.kind}`
    );
  }
  if (
    TRANSITIONS_REQUIRING_NULL_CONTINUATION.has(transition.kind) &&
    continuationOperationId !== null
  ) {
    return (
      "continuation_operation_id must be null when " +
      `operation_transition.kind=${transition.kind}`
    );
  }
  if (
    transition.kind === "observed" &&
    target &&
    !observedOperationIds.includes(target)
  ) {
    return (
      "plan.observed_operation_ids must contain " +
      "operation_transition.target_operation_id when kind=observed"
    );
  }
  if (transition.kind === "observed" && actions.length > 0) {
    return "plan.actions must be [] when operation_transition.kind=observed";
  }
  if (transition.kind === "observed" && missingFields.length > 0) {
    return "missing_fields must be [] when operation_transition.kind=observed";
  }
  if (
    ["rejected", "abandoned"].includes(transition.kind) &&
    target &&
    !abandonOperationIds.includes(target)
  ) {
    return (
      "abandon_operation_ids must contain operation_transition.target_operation_id " +
      `when operation_transition.kind=${transition.kind}`
    );
  }
  if (["rejected", "abandoned"].includes(transition.kind) && actions.length > 0) {
    return `plan.actions must be [] when operation_transition.kind=${transition.kind}`;
  }
  if (
    ["rejected", "abandoned"].includes(transition.kind) &&
    missingFields.length > 0
  ) {
    return `missing_fields must be [] when operation_transition.kind=${transition.kind}`;
  }
  if (transition.kind === "confirmed" && actions.length > 0) {
    return "plan.actions must be [] when operation_transition.kind=confirmed; the server reuses the persisted manifest";
  }
  if (transition.kind === "confirmed" && missingFields.length > 0) {
    return "missing_fields must be [] when operation_transition.kind=confirmed";
  }
  if (transition.kind === "resolved" && missingFields.length > 0) {
    return "missing_fields must be [] when operation_transition.kind=resolved";
  }
  if (transition.kind === "partially_resolved") {
    const progressed = [...priorMissing].some((key) => !currentMissing.has(key));
    if (!progressed || missingFields.length === 0 || !pendingQuestion) {
      return "partially_resolved must prove at least one prior field resolved and one concrete field remains";
    }
  }
  if (transition.kind === "insufficient") {
    if (missingFields.length === 0 || !pendingQuestion) {
      return "insufficient requires one concrete remaining question";
    }
    if (prior && normalizeQuestion(prior.pendingQuestion) === normalizeQuestion(pendingQuestion)) {
      return "insufficient consumed the delivery but repeated the same question; explain the unresolved distinction instead";
    }
    if (
      prior &&
      prior.semanticStallCount >= 1 &&
      priorMissing.size === currentMissing.size &&
      [...priorMissing].every((key) => currentMissing.has(key))
    ) {
      return "insufficient made no structural progress after one clarified retry; resolve, modify, abandon or leave the operation instead of looping";
    }
  }
  if (
    transition.consumed_pending_keys.some((key) => !priorMissing.has(key)) ||
    transition.remaining_pending_keys.some((key) => !currentMissing.has(key))
  ) {
    return "operation_transition pending keys contradict durable before/after state";
  }
  if (
    (transition.kind === "modified" || supersedeOperationIds.length > 0) &&
    !target
  ) {
    return (
      "operation_transition.target_operation_id is required when work is " +
      "modified or supersede_operation_ids is non-empty"
    );
  }
  return null;
}

export function parseAgentValueProvenance(
  raw: unknown,
): AgentValueProvenance | null {
  const row = object(raw);
  if (!row) return null;
  const path = finiteText(row.path, 160);
  const kind = finiteText(row.kind, 40) as AgentValueProvenanceKind | null;
  const sourceRef = finiteText(row.source_ref, 240);
  const quote = row.quote == null ? null : finiteText(row.quote, 500);
  const witness = row.state_witness == null ? null : object(row.state_witness);
  const derivationRaw = row.derivation == null ? null : object(row.derivation);
  const rule = derivationRaw
    ? (finiteText(derivationRaw.rule, 80) as AgentDerivationRule | null)
    : null;
  const drift = derivationRaw
    ? (finiteText(derivationRaw.drift_policy, 80) as AgentDriftPolicy | null)
    : null;
  if (
    !path ||
    !kind ||
    !AGENT_VALUE_PROVENANCE_KINDS.includes(kind) ||
    !sourceRef ||
    (row.quote != null && !quote) ||
    (row.state_witness != null && !witness) ||
    (row.derivation != null && (!derivationRaw || !rule || !drift)) ||
    (rule != null && !AGENT_DERIVATION_RULES.includes(rule)) ||
    (drift != null && !AGENT_DRIFT_POLICIES.includes(drift))
  ) {
    return null;
  }
  if (
    (kind === "user_stated" &&
      (!/^current_delivery$|^operation_delivery:[^:\s][^\s]{0,239}$/.test(sourceRef) ||
        !quote || witness || derivationRaw)) ||
    (kind === "stored_fact" &&
      (!witness || quote || derivationRaw || sourceRef === "current_delivery")) ||
    (kind === "derived" &&
      (!witness || !derivationRaw || quote || sourceRef === "current_delivery"))
  ) {
    return null;
  }
  return {
    path,
    kind,
    source_ref: sourceRef,
    quote,
    state_witness: witness,
    derivation: derivationRaw && rule && drift
      ? { rule, drift_policy: drift }
      : null,
  };
}

/** Validate origin, not meaning. For user_stated the server checks one exact
 * delivery owned by the operation and the exact amount; it never searches old
 * chat. Stored and derived values must carry a typed witness and are re-derived
 * again by their executor/preflight before write. */
export function actionProvenanceContractError(input: {
  actionId: string;
  capability?: string;
  arguments: Record<string, unknown>;
  provenance: AgentValueProvenance[];
  currentDelivery: string;
  operationDeliveries?: Array<{ deliveryKey: string; requestText: string }>;
  storedFactAuthorities?: AgentStoredFactAuthority[];
}): string | null {
  const claims = requiredMonetaryClaimsForAction({
    capability: String(input.capability ?? ""),
    arguments: input.arguments,
    storedFactAuthorities: input.storedFactAuthorities,
  });
  const byPath = new Map(input.provenance.map((row) => [row.path, row]));
  if (byPath.size !== input.provenance.length) {
    return `action ${input.actionId} has duplicate provenance paths`;
  }
  const expectedPaths = claims.map((claim) => claim.path).sort();
  const actualPaths = [...byPath.keys()].sort();
  if (canonical(expectedPaths) !== canonical(actualPaths)) {
    const missing = expectedPaths.filter((path) => !byPath.has(path));
    const unknown = actualPaths.filter(
      (path) => !claims.some((claim) => claim.path === path),
    );
    return (
      `action ${input.actionId}.provenance paths must equal ` +
      `${JSON.stringify(expectedPaths)}; missing=${JSON.stringify(missing)}; ` +
      `non_monetary_or_unknown=${JSON.stringify(unknown)}`
    );
  }
  for (const claim of claims) {
    const provenance = byPath.get(claim.path);
    if (!provenance) continue;
    if (provenance.kind === "user_stated") {
      const sourceText = provenance.source_ref === "current_delivery"
        ? input.currentDelivery
        : input.operationDeliveries?.find(
            (delivery) =>
              `operation_delivery:${delivery.deliveryKey}` === provenance.source_ref,
          )?.requestText ?? null;
      if (
        !sourceText ||
        !provenance.quote ||
        !sourceText.includes(provenance.quote) ||
        !numericValueWasStated(provenance.quote, claim.amount)
      ) {
        return `action ${input.actionId}.provenance[${claim.path}] is not proved by its exact durable-delivery quote`;
      }
    } else if (provenance.kind === "stored_fact") {
      const exactAuthorities = input.storedFactAuthorities ?? [];
      const exact = exactAuthorities.find(
        (authority) =>
          authority.capability === input.capability &&
          authority.path === claim.path &&
          authority.source_ref === provenance.source_ref &&
          Math.round(authority.amount * 100) ===
            Math.round(claim.amount * 100),
      );
      // Historical pure callers may not provide a live catalog. They still use
      // the same published structural registry, while every live planner pass
      // supplies exact authorities and therefore takes the stronger branch.
      const structurallySupported = storedFactProvenanceContractsForPlanner(
        String(input.capability ?? ""),
      ).some((definition) => {
        if (definition.path !== claim.path) return false;
        if (input.capability === "log_movement") {
          return provenance.source_ref ===
            `fixed_expenses:${String(input.arguments.fixedExpenseId ?? "")}:declared_amount`;
        }
        return input.capability === "register_card_payment" &&
          /^debt_accounts:[^:\s]+:full_payment_due$/.test(
            provenance.source_ref,
          );
      });
      if (
        provenance.derivation != null ||
        (input.storedFactAuthorities
          ? !exact
          : !structurallySupported)
      ) {
        const supported = exactAuthorities.length > 0
          ? exactAuthorities
              .filter((authority) => authority.path === claim.path)
              .map((authority) => authority.source_ref)
          : storedFactProvenanceContractsForPlanner(
              String(input.capability ?? ""),
            )
              .filter((definition) => definition.path === claim.path)
              .map((definition) => definition.source_ref_template);
        return (
          `action ${input.actionId}.provenance[${claim.path}] names an unsupported ` +
          `stored-fact verifier; supported=${JSON.stringify(supported)}`
        );
      }
    } else {
      // Phase B adds server-owned derivations one rule at a time. A model-owned
      // witness is not authority until the same rule can be rerun under lock.
      return `action ${input.actionId}.provenance[${claim.path}] names a derived rule with no locked verifier`;
    }
  }
  return null;
}

export function manifestMatchesPlan(
  manifest: AgentOperationManifest,
  plan: DurableAgentPlan,
): boolean {
  return agentOperationManifestHash(manifest) ===
    agentOperationManifestHash(buildAgentOperationManifest(plan));
}

export function manifestExecutionEqualityError(input: {
  manifest: AgentOperationManifest;
  steps: Array<{
    stepKey: string;
    capability: string | null;
    arguments: Record<string, unknown>;
    status: string;
    result: Record<string, unknown> | null;
  }>;
  plan: DurableAgentPlan;
  allowIncomplete?: boolean;
}): string | null {
  if (!manifestMatchesPlan(input.manifest, input.plan)) {
    return "authorized manifest no longer matches the durable plan";
  }
  const actionsById = new Map(input.plan.actions.map((action) => [action.id, action]));
  if (input.steps.length !== input.plan.actions.length) {
    return "executed step set does not equal the authorized action set";
  }
  for (const step of input.steps) {
    const action = actionsById.get(step.stepKey);
    if (
      !action ||
      action.capability !== step.capability ||
      canonical(action.arguments) !== canonical(step.arguments)
    ) {
      return `executed step ${step.stepKey} differs from its authorized action`;
    }
    const settled = input.allowIncomplete
      ? ["verified", "needs_input", "refused", "failed"].includes(step.status)
      : step.status === "verified";
    if (!settled) {
      return `authorized step ${step.stepKey} has no structurally verified outcome`;
    }
  }
  return null;
}
