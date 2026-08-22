import {
  agentActionPayloadHash,
  liveAgentActionChallengeDeps,
  type AgentActionChallengeDeps,
  type AgentActionChallengeReason,
} from "@/lib/ai/agent/agent-action-challenges";
import {
  batchMovementAmountAssociationsProven,
  monetaryClaimsFromToolArgs,
  numericValueWasStated,
  statedAmounts,
  statedAmountsExcludingNamedStoredFacts,
  unstatedMonetaryClaims,
  type NamedStoredMoneyFact,
} from "@/lib/capture/amount-evidence";
import { correctivePhrasing } from "@/lib/capture/capture-matching";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import { loopActionSecondDeliveryReasons } from "@/lib/ai/agent/agent-operation-authority";

export interface AgentActionGuardContext {
  userId: string;
  channel?: ChatChannel;
  chatId?: string | null;
  operationId?: string | null;
  rawMessage: string;
  challengeDeps?: AgentActionChallengeDeps;
  /** Operation-level authority from PostgreSQL. When present, the current
   * exact plan/action was already authorized as part of one manifest. */
  operationManifestAuthorized?: boolean;
  /** Native-loop dispatcher proved that this exact call is stageable. The
   * guard returns any remaining requirement to that dispatcher; this flag is
   * never confirmation authority. */
  loopDispatcherAuthorized?: boolean;
  /** Loop-only, bounded telemetry for founder act A52. The sink contains no
   * user prose and is persisted through the existing assistant metadata. */
  modelAuthorityAdvisories?: ModelAuthorityCounterAdvisory[];
}

export interface AgentActionRequirement {
  reason: AgentActionChallengeReason;
  prompt: string;
}

export const MODEL_AUTHORITY_COUNTERS = [
  "server_monetary_evidence",
  "server_confirmation",
  "loop_monetary_origin",
  "chosen_account_evidence",
  "duplicate_movement",
  "model_call_slip",
] as const;

export const MODEL_AUTHORITY_COUNTER_REASONS = [
  "unstated_amount",
  "sensitive_create",
  "destructive",
  "unproven_entity",
  "unproven_origin",
  "unproven_choice",
  "duplicate_suspected",
  "correction_suspected",
  "invalid_arguments",
  "schema_mismatch",
  "effect_unclassified",
] as const;

export interface ModelAuthorityCounterAdvisory {
  code: "model_authority_counter";
  counter: (typeof MODEL_AUTHORITY_COUNTERS)[number];
  verdict: "would_have_asked" | "would_have_blocked";
  capability: string;
  reason: (typeof MODEL_AUTHORITY_COUNTER_REASONS)[number];
}

export function emitModelAuthorityCounter(
  sink: ModelAuthorityCounterAdvisory[] | undefined,
  advisory: Omit<ModelAuthorityCounterAdvisory, "code">,
): void {
  if (!sink) return;
  const row: ModelAuthorityCounterAdvisory = {
    code: "model_authority_counter",
    ...advisory,
  };
  if (
    sink.some(
      (current) =>
        current.counter === row.counter &&
        current.verdict === row.verdict &&
        current.capability === row.capability &&
        current.reason === row.reason,
    )
  ) {
    return;
  }
  sink.push(row);
}

function normalized(text: unknown): string {
  return (typeof text === "string" ? text : "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function explicitActionConfirmation(rawMessage: string): boolean {
  const text = normalized(rawMessage).trim();
  if (/\b(no|mejor no|cancela|dejalo|olvidalo|todavia no)\b/.test(text)) {
    return false;
  }
  // `si` without an accent is also a conditional ("si puedo...", "si hay...").
  // Only a leading/standalone confirmation counts; embedded words do not.
  if (/^si\s+(puedo|hay|tengo|quiero|fuera|fuese|es|esta|son)\b/.test(text)) {
    return false;
  }
  // A confirmation authorizes the exact server-stored payload. If the same
  // sentence adds an account, amount, condition or other correction, it is a
  // NEW proposal and must replace the challenge rather than consuming the old
  // one. Keep this grammar deliberately small and whole-message anchored.
  const compact = text.replace(/[.!]+$/g, "").trim();
  return /^(?:si|claro|dale|hazlo|confirmo|confirmado|correcto|exacto|asi es|adelante|ok|okay|de acuerdo|esta bien)(?:,\s*(?:hazlo|dale|adelante|correcto|confirmo|confirmado|claro|exacto|asi es|esta bien))?(?:,?\s+por favor)?$/.test(
    compact,
  );
}

const DESTRUCTIVE_TOOLS = new Set([
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
]);

const SENSITIVE_CREATE_TOOLS = new Set(["create_account", "create_card"]);
const SENSITIVE_SOCIAL_TOOLS = new Set([
  "accept_household_invite",
  "add_household_participant",
  "household_invite_link",
  "invite_household_member",
  "respond_household_invite",
]);
const TOOLS_WITH_CONFIRM_FIELD = new Set([
  "cancel_shared_expense",
  "cancel_scheduled_payment",
  "change_base_currency",
  "close_account",
  "close_card",
  "remove_asset",
  "remove_household_member",
  "remove_recurring_shared_expense",
  "schedule_change",
  "unshare_movement",
  "update_fixed_expense",
  "update_goal",
  "update_income",
]);

function socialActionReadyForConfirmation(
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  if (toolName === "respond_household_invite") {
    return (
      typeof args.inviteId === "string" &&
      args.inviteId.trim().length > 0 &&
      typeof args.accept === "boolean"
    );
  }
  if (toolName === "accept_household_invite") {
    return typeof args.code === "string" && args.code.trim().length > 0;
  }
  if (toolName === "add_household_participant") {
    return (
      typeof args.displayName === "string" &&
      args.displayName.trim().length > 0
    );
  }
  if (toolName === "invite_household_member") {
    return typeof args.label === "string" && args.label.trim().length > 0;
  }
  // The household is resolved from trusted context later. A link without label
  // is intentionally generic, so it is still a complete proposal.
  return toolName === "household_invite_link";
}

function isConditionalDestructive(
  toolName: string,
  args: Record<string, unknown>,
  rawMessage: string,
): boolean {
  if (toolName === "update_goal") return args.status === "cancelled";
  if (toolName === "update_fixed_expense") {
    return (
      args.action === "delete" ||
      args.amountScope === "from_now" ||
      typeof args.isVariable === "boolean"
    );
  }
  if (toolName === "resolve_recurring_occurrence") {
    // Bloque K — `scope=from_now` is not a monthly observation flag: the
    // atomic writer rewrites the declared plan and opens a new learning
    // regime. A model-selected scope must therefore claim the same durable
    // server proposal as update_fixed_expense before it can touch the plan.
    return args.scope === "from_now";
  }
  if (toolName === "update_income") return args.action === "end";
  if (toolName === "schedule_change") {
    return args.kind === "adjust_percent" && Math.abs(Number(args.value)) > 50;
  }
  // `correct_movement` is intentionally fluid for an explicit correction
  // ("no era X, era Y"). Outside that semantic family, changing an existing
  // ledger row needs the same exact durable proposal as other sensitive edits:
  // a model-selected transaction id is not user authority.
  if (toolName === "correct_movement") {
    return !correctivePhrasing(rawMessage);
  }
  return false;
}

/** The native loop keeps the v39–v42 monetary evidence barrier but routes its
 * verdict into the operation manifest instead of the legacy per-tool
 * challenge. This helper contains only numeric association/provenance checks;
 * capability sensitivity remains the message-free registry in
 * agent-operation-authority.ts. */
export function serverMonetaryEvidenceRequirement(
  toolName: string,
  args: Record<string, unknown>,
  rawMessage: string,
  options: {
    readOnly?: boolean;
    serverVerifiedMonetaryClaimPaths?: readonly string[];
    serverVerifiedDeclaredStoredFacts?: readonly NamedStoredMoneyFact[];
    /** User-authored messages of the EXACT durable operation — the same source
     * the entity authority already consumes (v42). A value the user stated one
     * turn earlier inside this operation is still their own evidence. Ambiguity
     * checks stay scoped to the CURRENT delivery: several amounts inside ONE
     * utterance is what leaves an association unproven. */
    authorityMessages?: readonly string[];
    modelAuthorityRegistration?: boolean;
    modelAuthorityAdvisories?: ModelAuthorityCounterAdvisory[];
  } = {},
): AgentActionRequirement | null {
  let reason: AgentActionChallengeReason | null = null;
  const prompts: string[] = [];
  const operationMessages = (options.authorityMessages ?? []).filter(
    (message) => typeof message === "string" && message.trim().length > 0,
  );
  const operationStatedValue = (value: number): boolean =>
    operationMessages.some((message) => numericValueWasStated(message, value));
  const monetaryClaims = monetaryClaimsFromToolArgs(args);
  const isBatchMovement = toolName === "log_movements_batch";
  const currentDeliveryProvesEveryAssociation =
    isBatchMovement &&
    batchMovementAmountAssociationsProven(rawMessage, args);
  if (monetaryClaims.length >= 2 && !currentDeliveryProvesEveryAssociation) {
    reason = options.readOnly === true ? "unstated_amount" : "sensitive_create";
    prompts.push(
      options.readOnly === true
        ? "Este cálculo asigna varios montos a campos o entidades diferentes. Que los números aparezcan en el mensaje no prueba cuál corresponde a cuál; dime el desglose exacto que quieres calcular."
        : "Este cambio asigna varios montos a campos o entidades diferentes. Que los números aparezcan en el mensaje no prueba cuál corresponde a cuál; confirma el desglose exacto de la propuesta.",
    );
  }
  const deliveryAmounts = options.serverVerifiedDeclaredStoredFacts
    ? statedAmountsExcludingNamedStoredFacts(
        rawMessage,
        options.serverVerifiedDeclaredStoredFacts,
      )
    : statedAmounts(rawMessage);
  if (monetaryClaims.length === 1 && deliveryAmounts.length >= 2) {
    reason ??= "sensitive_create";
    prompts.push(
      `Tu mensaje contiene varios montos (${deliveryAmounts.join(", ")}), pero esta propuesta usaría ` +
        `${monetaryClaims[0].path}=${monetaryClaims[0].amount}. Que ese número aparezca no prueba que sea el correspondiente a esta acción; ` +
        (options.readOnly === true
          ? "dime cuál monto quieres calcular."
          : "confirma la asociación exacta antes de escribir."),
    );
  }
  const serverVerified = new Set(
    options.serverVerifiedMonetaryClaimPaths ?? [],
  );
  const unstated = unstatedMonetaryClaims(rawMessage, args).filter(
    (claim) =>
      !(toolName === "register_card_payment" && claim.path === "amount") &&
      !serverVerified.has(claim.path) &&
      !operationStatedValue(claim.amount),
  );
  if (unstated.length > 0) {
    reason ??= "unstated_amount";
    prompts.push(
      `No encontré en tu mensaje ${unstated.length === 1 ? "este monto" : "estos montos"}: ` +
        `${unstated.map((row) => `${row.path}=${row.amount}`).join(", ")}. ` +
        (options.readOnly === true
          ? "No voy a calcular ni recomendar sobre valores elegidos por el modelo. Dime el monto correcto."
          : "No voy a escribirlos como si los hubieras dicho. Confírmalos o corrígelos."),
    );
  }
  const persistedRateKeys = new Set(["rate", "interestRate", "expectedReturnPct"]);
  const missingRates: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (
      persistedRateKeys.has(key) &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      !numericValueWasStated(rawMessage, value) &&
      !operationStatedValue(value)
    ) {
      missingRates.push(`${key}=${value}`);
    }
  }
  if (
    toolName === "schedule_change" &&
    args.kind === "adjust_percent" &&
    typeof args.value === "number" &&
    Number.isFinite(args.value) &&
    !numericValueWasStated(rawMessage, args.value) &&
    !operationStatedValue(args.value)
  ) {
    missingRates.push(`value=${args.value}%`);
  }
  if (missingRates.length > 0) {
    reason ??= "unstated_amount";
    prompts.push(
      `Tampoco encontré en tu mensaje ${missingRates.join(", ")}. ` +
        (options.readOnly === true
          ? "No calcularé con una tasa o porcentaje elegido por el modelo; dime el valor correcto."
          : "No guardaré una tasa o porcentaje elegido por el modelo; confírmalo o corrígelo."),
    );
  }
  const requirement = reason && prompts.length > 0
    ? { reason, prompt: prompts.join(" ") }
    : null;
  if (
    requirement &&
    options.readOnly !== true &&
    options.modelAuthorityRegistration === true
  ) {
    emitModelAuthorityCounter(options.modelAuthorityAdvisories, {
      counter: "server_monetary_evidence",
      verdict: "would_have_blocked",
      capability: toolName,
      reason:
        requirement.reason === "unstated_amount"
          ? "unstated_amount"
          : "sensitive_create",
    });
    return null;
  }
  return requirement;
}

export function serverConfirmationRequirement(
  toolName: string,
  args: Record<string, unknown>,
  rawMessage: string,
  options: {
    readOnly?: boolean;
    proposalSummary?: string;
    unprovenEntity?: string | null;
    /** Monetary argument paths whose exact value was re-derived by a typed
     * executor from server-owned state. Omitting such a value from the current
     * user message is not a request for authority: the user is supplying a
     * different missing field in a durable continuation. */
    serverVerifiedMonetaryClaimPaths?: readonly string[];
    /** Complete typed catalog facts that can explain a separately mentioned
     * amount only when their durable entity is named in the same clause. */
    serverVerifiedDeclaredStoredFacts?: readonly NamedStoredMoneyFact[];
    /** User-authored messages of the EXACT durable operation — the same source
     * the entity authority already consumes (v42). A value the user stated one
     * turn earlier inside this operation is still their own evidence. Ambiguity
     * checks stay scoped to the CURRENT delivery: several amounts inside ONE
     * utterance is what leaves an association unproven. */
    authorityMessages?: readonly string[];
    modelAuthorityRegistration?: boolean;
    modelAuthorityAdvisories?: ModelAuthorityCounterAdvisory[];
  } = {},
): AgentActionRequirement | null {
  let reason: AgentActionChallengeReason | null = null;
  const prompts: string[] = [];
  const operationMessages = (options.authorityMessages ?? []).filter(
    (message) => typeof message === "string" && message.trim().length > 0,
  );
  const operationStatedValue = (value: number): boolean =>
    operationMessages.some((message) => numericValueWasStated(message, value));
  if (
    options.readOnly !== true &&
    (
      DESTRUCTIVE_TOOLS.has(toolName) ||
      isConditionalDestructive(toolName, args, rawMessage)
    )
  ) {
    reason = "destructive";
    prompts.push(
      `Esta acción cambia o desactiva datos de forma sensible (${toolName}). ` +
        "Explica en una frase qué cambiará y pide una confirmación explícita antes de ejecutarla.",
    );
  } else if (
    options.readOnly !== true &&
    SENSITIVE_CREATE_TOOLS.has(toolName)
  ) {
    reason = "sensitive_create";
    prompts.push(
      `Voy a crear un instrumento financiero nuevo con ${toolName}. ` +
        "Confirma primero que no es un instrumento existente con otro nombre.",
    );
  } else if (
    options.readOnly !== true &&
    SENSITIVE_SOCIAL_TOOLS.has(toolName) &&
    socialActionReadyForConfirmation(toolName, args)
  ) {
    reason = "sensitive_create";
    prompts.push(
      `Esta acción cambia quién puede participar o ver información compartida (${toolName}). ` +
        "Confirma la persona, el grupo, el rol y si se acepta o rechaza antes de ejecutarla.",
    );
  }
  // These booleans used to be model-owned escape hatches. A first-turn tool
  // call could set `confirmedNew=true` and bypass a proved duplicate, or set
  // `confirmDefaultSource=true` and charge the saved account without the user
  // ever answering the executor's question. They now mean only “claim the
  // exact server-stored proposal issued on the preceding delivery”.
  if (options.readOnly !== true && args.confirmedNew === true) {
    reason ??= "sensitive_create";
    prompts.push(
      "Este movimiento se parece a uno ya registrado. Confirma que es OTRO movimiento real y no un reintento o una corrección.",
    );
  }
  if (options.readOnly !== true && args.confirmDefaultSource === true) {
    reason ??= "sensitive_create";
    prompts.push(
      "Confirma que este pago salió de la cuenta habitual guardada que aparece en la propuesta.",
    );
  }

  // Finding the same numbers somewhere in the delivery does not prove their
  // association. A statement can contain minimum=10, due=100 and balance=500;
  // a model that swaps them would pass the generic evidence-membership check
  // while corrupting three different facts. The same applies to custom splits,
  // batches and two-native-leg FX transfers. Until a domain-specific parser
  // proves each association, two or more persisted money claims require the
  // exact durable proposal to be confirmed. Single-amount capture stays fluid.
  const monetaryClaims = monetaryClaimsFromToolArgs(args);
  const currentDeliveryProvesEveryAssociation =
    toolName === "log_movements_batch" &&
    batchMovementAmountAssociationsProven(rawMessage, args);
  if (
    monetaryClaims.length >= 2 &&
    !currentDeliveryProvesEveryAssociation
  ) {
    reason ??=
      options.readOnly === true ? "unstated_amount" : "sensitive_create";
    prompts.push(
      options.readOnly === true
        ? "Este cálculo asigna varios montos a campos o entidades diferentes. " +
            "Que los números aparezcan en el mensaje no prueba cuál corresponde a cuál; dime el desglose exacto que quieres calcular."
        : "Este cambio asigna varios montos a campos o entidades diferentes. " +
            "Que los números aparezcan en el mensaje no prueba cuál corresponde a cuál; confirma el desglose exacto de la propuesta.",
    );
  }
  // The inverse association is just as dangerous: one persisted field and
  // several user-stated money values. In the founder incident the account
  // balance (552.77) and the statement total (743.93) were both true; choosing
  // the former as `amount` still created a false card payment. Membership is
  // not association. Calendar/count/rate tokens are already excluded by
  // `statedAmounts`, so a real multi-money sentence receives one exact durable
  // proposal instead of letting the model silently pick a value.
  const deliveryAmounts = options.serverVerifiedDeclaredStoredFacts
    ? statedAmountsExcludingNamedStoredFacts(
        rawMessage,
        options.serverVerifiedDeclaredStoredFacts,
      )
    : statedAmounts(rawMessage);
  if (
    monetaryClaims.length === 1 &&
    deliveryAmounts.length >= 2
  ) {
    reason ??= "sensitive_create";
    prompts.push(
      `Tu mensaje contiene varios montos (${deliveryAmounts.join(", ")}), pero esta propuesta usaría ` +
        `${monetaryClaims[0].path}=${monetaryClaims[0].amount}. Que ese número aparezca no prueba que sea el correspondiente a esta acción; ` +
        (options.readOnly === true
          ? "dime cuál monto quieres calcular."
          : "confirma la asociación exacta antes de escribir."),
    );
  }

  // `register_card_payment` owns a stricter amount preflight than this generic
  // guard: it compares the proposed total with the live statement and with a
  // durable multi-turn split draft. On the second turn ("Alpaca 271,98 y el
  // resto de Produbanco") the total is intentionally absent from the CURRENT
  // message; challenging it here would dead-lock the already proven draft.
  // Only its `amount` is delegated. Every source amount/rate and all other tools
  // still go through this generic evidence barrier.
  const cardExecutorProvesAmount = toolName === "register_card_payment";
  const serverVerifiedMonetaryClaimPaths = new Set(
    options.serverVerifiedMonetaryClaimPaths ?? [],
  );
  const unstated = unstatedMonetaryClaims(rawMessage, args).filter(
    (claim) =>
      !(cardExecutorProvesAmount && claim.path === "amount") &&
      !serverVerifiedMonetaryClaimPaths.has(claim.path) &&
      !operationStatedValue(claim.amount),
  );
  if (unstated.length > 0) {
    reason ??= "unstated_amount";
    prompts.push(
      `No encontré en tu mensaje ${unstated.length === 1 ? "este monto" : "estos montos"}: ` +
        `${unstated.map((row) => `${row.path}=${row.amount}`).join(", ")}. ` +
        (options.readOnly === true
          ? "No voy a calcular ni recomendar sobre valores elegidos por el modelo. Dime el monto correcto."
          : "No voy a escribirlos como si los hubieras dicho. Confírmalos o corrígelos."),
    );
  }

  const persistedRateKeys = new Set(["rate", "interestRate", "expectedReturnPct"]);
  const missingRates: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (
      persistedRateKeys.has(key) &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      !numericValueWasStated(rawMessage, value) &&
      !operationStatedValue(value)
    ) {
      missingRates.push(`${key}=${value}`);
    }
  }
  if (
    toolName === "schedule_change" &&
    args.kind === "adjust_percent" &&
    typeof args.value === "number" &&
    Number.isFinite(args.value) &&
    !numericValueWasStated(rawMessage, args.value) &&
    !operationStatedValue(args.value)
  ) {
    missingRates.push(`value=${args.value}%`);
  }
  if (missingRates.length > 0) {
    reason ??= "unstated_amount";
    prompts.push(
      `Tampoco encontré en tu mensaje ${missingRates.join(", ")}. ` +
        (options.readOnly === true
          ? "No calcularé con una tasa o porcentaje elegido por el modelo; dime el valor correcto."
          : "No guardaré una tasa o porcentaje elegido por el modelo; confírmalo o corrígelo."),
    );
  }
  if (options.readOnly !== true && options.unprovenEntity) {
    reason ??= "sensitive_create";
    prompts.push(
      `La propuesta eligió ${options.unprovenEntity}, pero el mensaje actual no identifica esa entidad y hay varias candidatas. ` +
        "No voy a dejar que una elección del modelo se convierta en autoridad: confirma la entidad exacta de la propuesta.",
    );
  }
  if (
    options.readOnly !== true &&
    toolName === "set_exchange_rate" &&
    args.autoRefresh === true
  ) {
    reason ??= "sensitive_create";
    prompts.push(
      "Además, activar la actualización automática permitiría que una fuente externa cambie esta tasa en el futuro. Confirma explícitamente que quieres mantenerla actualizada automáticamente; si no, la guardaré fija.",
    );
  }
  const requirement = reason && prompts.length > 0
    ? {
        reason,
        prompt: [
          options.proposalSummary
            ? `Propuesta exacta: ${options.proposalSummary}.`
            : null,
          ...prompts,
          options.readOnly === true
            ? null
            : "Si la propuesta es correcta, confírmala de forma explícita. Si cambias el monto, la entidad o alguna condición, lo trataré como una propuesta nueva.",
        ]
          .filter(Boolean)
          .join(" "),
      }
    : null;
  if (
    requirement &&
    options.readOnly !== true &&
    options.modelAuthorityRegistration === true
  ) {
    emitModelAuthorityCounter(options.modelAuthorityAdvisories, {
      counter: "server_confirmation",
      verdict: "would_have_asked",
      capability: toolName,
      reason: options.unprovenEntity
        ? "unproven_entity"
        : requirement.reason === "unstated_amount"
          ? "unstated_amount"
          : requirement.reason === "destructive"
            ? "destructive"
            : "sensitive_create",
    });
    return null;
  }
  return requirement;
}

export interface GuardServerConfirmedActionResult {
  result: {
    status: "needs_info" | "error";
    summary: string;
    data?: Record<string, unknown>;
  } | null;
  authorizedArgs: Record<string, unknown>;
  /** True only when this delivery atomically claimed a proposal previously
   * stored by the server. A bare affirmation and a model-reconstructed payload
   * are never authority. */
  serverAuthorized: boolean;
}

/** A model-provided `confirm:true` is never proof. The first delivery can only
 * issue a durable challenge. A later, independently identified delivery claims
 * it; the DB rejects self-confirmation and double consumption. */
export async function guardServerConfirmedActionWith(
  toolName: string,
  args: Record<string, unknown>,
  ctx: AgentActionGuardContext,
  options: {
    readOnly?: boolean;
    proposalSummary?: string;
    unprovenEntity?: string | null;
    serverVerifiedMonetaryClaimPaths?: readonly string[];
    serverVerifiedDeclaredStoredFacts?: readonly NamedStoredMoneyFact[];
    /** Passed straight through to serverConfirmationRequirement. */
    authorityMessages?: readonly string[];
    modelAuthorityRegistration?: boolean;
  } = {},
): Promise<GuardServerConfirmedActionResult> {
  if (options.readOnly !== true && ctx.operationManifestAuthorized === true) {
    return {
      result: null,
      authorizedArgs: args,
      serverAuthorized: true,
    };
  }
  const modelAuthorityRegistration =
    options.modelAuthorityRegistration ??
    (ctx.loopDispatcherAuthorized === true &&
      options.readOnly !== true &&
      loopActionSecondDeliveryReasons({
        capability: toolName,
        arguments: args,
      }).length === 0);
  const requirement = serverConfirmationRequirement(
    toolName,
    args,
    ctx.rawMessage,
    {
      ...options,
      modelAuthorityRegistration,
      modelAuthorityAdvisories: ctx.modelAuthorityAdvisories,
    },
  );
  // Native-loop dispatch is not confirmation authority. It only proves that
  // the exact call already has a durable staged identity. Surface the natural
  // server requirement so the dispatcher can include that row in one manifest;
  // only execution of an authorized manifest may bypass this guard.
  if (options.readOnly !== true && ctx.loopDispatcherAuthorized === true) {
    return requirement
      ? {
          result: {
            status: "needs_info",
            summary: requirement.prompt,
            data: { loopManifestRequired: true },
          },
          authorizedArgs: args,
          serverAuthorized: false,
        }
      : { result: null, authorizedArgs: args, serverAuthorized: false };
  }
  const asksToConfirm =
    options.readOnly !== true && explicitActionConfirmation(ctx.rawMessage);
  // Read-only calculations still need user-authored amounts/rates. They do not
  // need (and must not create) a durable write challenge: ask for the missing
  // input directly, then recompute. Otherwise the model can invent a purchase
  // price, receive a deterministic calculation for that invented input and
  // make the output-grounding layer bless the result as trustworthy.
  if (options.readOnly === true && requirement) {
    return {
      result: { status: "needs_info", summary: requirement.prompt },
      authorizedArgs: args,
      serverAuthorized: false,
    };
  }
  if (!requirement && !asksToConfirm) {
    return { result: null, authorizedArgs: args, serverAuthorized: false };
  }

  if (!ctx.channel || !ctx.operationId) {
    return {
      result: {
        status: "error",
        summary:
          "No pude probar la identidad de esta entrega, así que no ejecuté la acción sensible ni escribí montos no declarados.",
      },
      authorizedArgs: args,
      serverAuthorized: false,
    };
  }

  const deps = ctx.challengeDeps ?? liveAgentActionChallengeDeps;
  const payloadHash = agentActionPayloadHash(toolName, args);
  const scope = {
    userId: ctx.userId,
    channel: ctx.channel,
    chatId: ctx.chatId,
    toolName,
    payloadHash,
    operationId: ctx.operationId,
  };
  const claimedPayload = asksToConfirm ? await deps.claim(scope) : null;
  if (claimedPayload) {
    return {
      result: null,
      authorizedArgs: {
        ...claimedPayload,
        ...(TOOLS_WITH_CONFIRM_FIELD.has(toolName)
          ? { confirm: true }
          : {}),
        ...(Object.hasOwn(claimedPayload, "confirmDefaultSource")
          ? { confirmDefaultSource: true }
          : {}),
      },
      serverAuthorized: true,
    };
  }
  // A bare confirmation may arrive with incomplete/different model args. We
  // attempted the claim by trusted conversation+tool identity; if there was no
  // pending proposal and the current args do not themselves require a challenge,
  // there is nothing to issue or authorize.
  if (!requirement) {
    return {
      result: {
        status: "needs_info",
        summary:
          "Ese sí no coincide con una propuesta pendiente guardada por el servidor. No ejecuté una acción reconstruida; vuelve a decir qué quieres hacer.",
      },
      authorizedArgs: args,
      serverAuthorized: false,
    };
  }

  const issued = await deps.issue({
    ...scope,
    reason: requirement.reason,
    prompt: requirement.prompt,
    payload: args,
  });
  if (!issued) {
    return {
      result: {
        status: "error",
        summary:
          "No pude guardar una confirmación durable para esta acción. No ejecuté nada; reintenta.",
      },
      authorizedArgs: args,
      serverAuthorized: false,
    };
  }
  return {
    result: { status: "needs_info", summary: requirement.prompt },
    authorizedArgs: args,
    serverAuthorized: false,
  };
}
