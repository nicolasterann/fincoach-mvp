import { createHash } from "crypto";

import type { DurableAgentPlan } from "@/lib/ai/agent/agent-operation-store";
import { cardNativeStatementExpected } from "@/lib/financial/card-statement-amount";

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

export interface AgentOperationTransition {
  kind: AgentOperationTransitionKind;
  target_operation_id: string | null;
  consumed_pending_keys: string[];
  remaining_pending_keys: string[];
  rationale: string;
}

export interface AgentValueProvenance {
  path: string;
  kind: "user_stated" | "stored_fact" | "derived";
  source_ref: string;
  quote: string | null;
  state_witness: Record<string, unknown> | null;
  derivation: {
    rule: string;
    drift_policy: string;
  } | null;
}

export interface AgentOperationManifest {
  version: 1;
  execution_policy: "independent" | "dependency_ordered" | "atomic";
  actions: Array<{
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
  }>;
  projected_state: Array<{
    ordinal: number;
    state_witness: Record<string, unknown>;
    effects: Array<Record<string, unknown>>;
    postconditions: Array<Record<string, unknown>>;
  }>;
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

export function agentOperationManifestHash(
  manifest: AgentOperationManifest,
): string {
  return createHash("sha256").update(canonical(manifest)).digest("hex");
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
  const executionPolicy: AgentOperationManifest["execution_policy"] = hasAtomic
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

/** Exact positive authorities for one already model-selected action. */
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
    const amount = cardNativeStatementExpected(card, input.catalog.baseCurrency);
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

/** Founder act A52: only destructive/social lifecycle actions need a second delivery. */
export const SECOND_DELIVERY_CAPABILITIES = new Set([
  "cancel_scheduled_change",
  "cancel_scheduled_payment",
  "cancel_shared_expense",
  "change_account_currency",
  "change_base_currency",
  "close_account",
  "close_card",
  "close_installment_plan",
  "forget_life_context",
  "leave_household",
  "remove_asset",
  "remove_household_member",
  "remove_recurring_shared_expense",
  "reset_personality_test",
  "reset_personalization_preference",
  "settle_household",
  "set_household_visibility",
  "undo_recent_movements",
  "undo_agent_operation",
  "remove_duplicate",
  "transfer_household_ownership",
  "unshare_movement",
  "accept_household_invite",
  "add_household_participant",
  "household_invite_link",
  "invite_household_member",
  "respond_household_invite",
]);

const CONDITIONAL_SECOND_DELIVERY_RULES: Array<{
  code: string;
  matches: (action: { capability: string; arguments: Record<string, unknown> }) => boolean;
}> = [
  {
    code: "cancel_goal",
    matches: (action) =>
      action.capability === "update_goal" && action.arguments.status === "cancelled",
  },
  {
    code: "delete_fixed_expense_plan",
    matches: (action) =>
      action.capability === "update_fixed_expense" && action.arguments.action === "delete",
  },
  {
    code: "end_income",
    matches: (action) =>
      action.capability === "update_income" && action.arguments.action === "end",
  },
];

/** Mechanical sensitivity policy for the native loop. It never reads user prose. */
export function loopActionSecondDeliveryReasons(input: {
  capability: string;
  arguments: Record<string, unknown>;
}): string[] {
  const reasons: string[] = [];
  if (SECOND_DELIVERY_CAPABILITIES.has(input.capability)) {
    reasons.push(`$loop_action:capability:${input.capability}`);
  }
  for (const rule of CONDITIONAL_SECOND_DELIVERY_RULES) {
    if (rule.matches(input)) reasons.push(`$loop_action:rule:${rule.code}`);
  }
  return reasons;
}
