import {
  classifyRecoveryIntent,
  detectAffirmation,
  detectNegation,
  type RecoveryIntent,
} from "@/lib/ai/recovery-classifier";
import type { AdvisoryRecentMessage } from "@/lib/ai/advisory-classifier";
import {
  buildChatActionResult,
  buildChatTransactionClarificationResult,
  buildChatTransactionFailedResult,
  type ChatTransactionResult,
} from "@/lib/ai/chat-transaction-result";
import {
  correctTransactionByReplacement,
  correctTransactionMetadata,
  reverseStoredTransaction,
} from "@/lib/ai/apply-chat-transaction-intent";
import type { ChatChannel } from "@/lib/chat-memory/pending-clarification";
import {
  findDuplicateCandidates,
  findUndoTarget,
  loadRecentTransactions,
  type StoredTransaction,
} from "@/lib/financial/transaction-recovery";
import { logChatRoute } from "@/lib/observability/route-telemetry";
import type {
  Account,
  CurrencyCode,
  DebtAccount,
  FinancialCategory,
  FinancialGoal,
} from "@/types/financial";
import type {
  DebtPaymentIntent,
  ExpenseIntent,
  GoalContributionIntent,
  IncomeIntent,
  TransactionIntent,
  TransferIntent,
} from "@/types/transaction-intents";

export interface RecoveryHandlerInput {
  userId: string;
  message: string;
  recentMessages: AdvisoryRecentMessage[];
  accounts: Account[];
  debtAccounts: DebtAccount[];
  goals: FinancialGoal[];
  channel?: ChatChannel;
  chatId?: string | null;
}

// Shape persisted into the assistant chat_messages metadata so the next reply
// ("sí, quítalo") can resolve a recovery we asked the user to confirm — without
// needing a new pending-clarification DB kind.
export interface RecoveryPendingState {
  kind: "recovery_confirmation";
  action: "undo" | "duplicate";
  transactionId: string;
  label: string;
}

function money(amount: number, currency: string): string {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const text = isWhole ? String(Math.round(rounded)) : rounded.toFixed(2);
  return currency === "USD" ? `${text}$` : `${text} ${currency}`;
}

function shortLabel(tx: StoredTransaction): string {
  const amount = money(tx.originalAmount, tx.originalCurrency);
  const desc = tx.description?.trim();
  return desc ? `${desc} (${amount})` : amount;
}

// Resolve a free-text source name to one of the user's own accounts or a
// debt/card. Loose, case/diacritic-insensitive containment match.
function resolveSource(
  name: string,
  accounts: Account[],
  debtAccounts: DebtAccount[],
): { account?: Account; debt?: DebtAccount } {
  const norm = (t: string) =>
    t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const n = norm(name);
  const account = accounts.find(
    (a) => !a.isGoalAccount && (norm(a.name).includes(n) || n.includes(norm(a.name))),
  );
  if (account) return { account };
  const debt = debtAccounts.find(
    (d) => norm(d.name).includes(n) || n.includes(norm(d.name)),
  );
  return debt ? { debt } : {};
}

// Rebuild a same-type intent from the original transaction, applying an amount
// and/or source patch. Returns null when the correction shape is not safely
// supported (caller asks instead of guessing).
function buildCorrectedIntent(
  original: StoredTransaction,
  patch: { newAmount?: number | null; account?: Account; debt?: DebtAccount },
  accounts: Account[],
): TransactionIntent | null {
  const amount = patch.newAmount ?? original.originalAmount;
  const currency = original.originalCurrency as CurrencyCode;
  const base = {
    originalAmount: amount,
    originalCurrency: currency,
    exchangeRateToBase: original.exchangeRateToBase,
    baseCurrency: original.baseCurrency as CurrencyCode,
    confidenceScore: 1,
    status: "ready" as const,
    description: original.description,
  };

  switch (original.type) {
    case "expense": {
      // Source patch: switch between an account and a card.
      let sourceAccountId = original.sourceAccountId ?? undefined;
      let debtAccountId = original.debtAccountId ?? undefined;
      if (patch.account) {
        sourceAccountId = patch.account.id;
        debtAccountId = undefined;
      } else if (patch.debt) {
        debtAccountId = patch.debt.id;
        sourceAccountId = undefined;
      }
      const intent: ExpenseIntent = {
        ...base,
        type: "expense",
        category: original.category as FinancialCategory,
        sourceAccountId,
        debtAccountId,
      };
      return intent;
    }
    case "income": {
      const destinationAccountId = patch.account?.id ?? original.destinationAccountId;
      if (!destinationAccountId) return null;
      const intent: IncomeIntent = {
        ...base,
        type: "income",
        destinationAccountId,
        category: original.category as FinancialCategory,
      };
      return intent;
    }
    case "debt_payment": {
      const sourceAccountId = patch.account?.id ?? original.sourceAccountId;
      if (!sourceAccountId || !original.debtAccountId) return null;
      const intent: DebtPaymentIntent = {
        ...base,
        type: "debt_payment",
        sourceAccountId,
        debtAccountId: original.debtAccountId,
        category: original.category as FinancialCategory,
      };
      return intent;
    }
    case "transfer": {
      const sourceAccountId = patch.account?.id ?? original.sourceAccountId;
      if (!sourceAccountId || !original.destinationAccountId) return null;
      const intent: TransferIntent = {
        ...base,
        type: "transfer",
        sourceAccountId,
        destinationAccountId: original.destinationAccountId,
        category: original.category as FinancialCategory,
      };
      return intent;
    }
    case "goal_contribution": {
      const sourceAccountId = patch.account?.id ?? original.sourceAccountId;
      if (!sourceAccountId || !original.goalId) return null;
      const goalAccount =
        original.destinationAccountId ??
        accounts.find((a) => a.isGoalAccount)?.id ??
        "";
      const intent: GoalContributionIntent = {
        ...base,
        type: "goal_contribution",
        sourceAccountId,
        destinationAccountId: goalAccount,
        goalId: original.goalId,
        category: "savings",
      };
      return intent;
    }
    default:
      return null;
  }
}

async function executeUndo(
  input: RecoveryHandlerInput,
  target: StoredTransaction,
): Promise<ChatTransactionResult> {
  const result = await reverseStoredTransaction({
    userId: input.userId,
    transaction: target,
    message: input.message,
    channel: input.channel,
  });

  if (!result.ok && result.alreadyReversed) {
    logChatRoute({
      route: "transaction_correction_or_undo",
      channel: input.channel,
      outcome: "undo",
      dbWrite: false,
      reversedTransactionId: target.id,
      validationReason: "already_reversed",
    });
    return buildChatActionResult({
      redirectCode: "chat-reversal-created",
      message: `Ese movimiento ya estaba revertido, así que lo dejo como está. Tus saldos no cambian.`,
    });
  }

  logChatRoute({
    route: "transaction_correction_or_undo",
    channel: input.channel,
    outcome: "undo",
    dbWrite: true,
    reversedTransactionId: target.id,
  });
  return buildChatActionResult({
    redirectCode: "chat-reversal-created",
    message: `Listo, deshice ${shortLabel(target)} y te devolví el saldo. Como si no hubiera pasado.`,
  });
}

export async function handleRecoveryMessage(
  input: RecoveryHandlerInput,
): Promise<ChatTransactionResult> {
  const intent = await classifyRecoveryIntent({
    message: input.message,
    recentMessages: input.recentMessages,
  });

  const recent = await loadRecentTransactions(input.userId);

  if (intent.action === "duplicate") {
    return handleDuplicate(input, recent.transactions.length === 0, intent);
  }

  if (intent.action === "correct") {
    return handleCorrection(input, intent);
  }

  // Default to undo for "undo" and as the safe interpretation of an otherwise
  // unclear recovery message (router already said it is a fix request).
  return handleUndo(input, intent);
}

async function handleUndo(
  input: RecoveryHandlerInput,
  intent: RecoveryIntent,
): Promise<ChatTransactionResult> {
  const recent = await loadRecentTransactions(input.userId);
  const found = findUndoTarget(recent, intent.targetHint ?? "");

  if (found.status === "none") {
    logChatRoute({
      route: "transaction_correction_or_undo",
      channel: input.channel,
      outcome: "undo",
      dbWrite: false,
      validationReason: "no_eligible_target",
    });
    return buildChatActionResult({
      redirectCode: "chat-reversal-created",
      message:
        "No encuentro un movimiento reciente que pueda deshacer. Si fue hace un rato o ya lo había revertido, dime cuál era y lo reviso.",
    });
  }

  if (found.status === "ambiguous" && found.candidates && found.candidates.length > 0) {
    const top = found.candidates[0];
    logChatRoute({
      route: "transaction_correction_or_undo",
      channel: input.channel,
      outcome: "undo",
      dbWrite: false,
      validationReason: "ambiguous_target",
    });
    const others = found.candidates
      .slice(0, 3)
      .map((tx) => shortLabel(tx))
      .join(", ");
    const pending: RecoveryPendingState = {
      kind: "recovery_confirmation",
      action: "undo",
      transactionId: top.id,
      label: shortLabel(top),
    };
    return buildChatActionResult({
      redirectCode: "chat-reversal-created",
      message: `Para no borrar lo que no es: ¿quito ${shortLabel(top)}? (lo más reciente). Si era otro, dime cuál: ${others}.`,
      assistantMetadata: { recoveryPending: pending },
    });
  }

  if (!found.target) return buildChatTransactionFailedResult();
  return executeUndo(input, found.target);
}

async function handleDuplicate(
  input: RecoveryHandlerInput,
  noTransactions: boolean,
  _intent: RecoveryIntent,
): Promise<ChatTransactionResult> {
  void _intent;
  const recent = await loadRecentTransactions(input.userId);
  const dup = findDuplicateCandidates(recent);

  if (dup.status === "none") {
    logChatRoute({
      route: "transaction_correction_or_undo",
      channel: input.channel,
      outcome: "duplicate_recovery",
      dbWrite: false,
      validationReason: noTransactions ? "no_transactions" : "no_duplicate_found",
    });
    return buildChatActionResult({
      redirectCode: "chat-reversal-created",
      message:
        "No veo dos movimientos iguales recientes, así que no quito nada para no descuadrarte. Si quieres, dime cuál era el repetido.",
    });
  }

  if (dup.status === "ambiguous" && dup.pairs && dup.pairs.length > 0) {
    const top = dup.pairs[0];
    const pending: RecoveryPendingState = {
      kind: "recovery_confirmation",
      action: "duplicate",
      transactionId: top.remove.id,
      label: shortLabel(top.remove),
    };
    logChatRoute({
      route: "transaction_correction_or_undo",
      channel: input.channel,
      outcome: "duplicate_recovery",
      dbWrite: false,
      validationReason: "ambiguous_duplicate",
    });
    return buildChatActionResult({
      redirectCode: "chat-reversal-created",
      message: `Veo más de un par parecido. ¿Quito la copia más reciente de ${shortLabel(top.remove)} y dejo una? Confírmame.`,
      assistantMetadata: { recoveryPending: pending },
    });
  }

  if (!dup.remove) return buildChatTransactionFailedResult();
  const result = await reverseStoredTransaction({
    userId: input.userId,
    transaction: dup.remove,
    message: input.message,
    channel: input.channel,
  });
  logChatRoute({
    route: "transaction_correction_or_undo",
    channel: input.channel,
    outcome: "duplicate_recovery",
    dbWrite: result.ok,
    reversedTransactionId: dup.remove.id,
    validationReason: result.alreadyReversed ? "already_reversed" : undefined,
  });
  return buildChatActionResult({
    redirectCode: "chat-reversal-created",
    message: result.alreadyReversed
      ? "Esa copia ya estaba quitada, así que queda una sola. Todo en orden."
      : `Quité la copia repetida de ${shortLabel(dup.remove)} y dejé una. Tu saldo ya no la cuenta dos veces.`,
  });
}

async function handleCorrection(
  input: RecoveryHandlerInput,
  intent: RecoveryIntent,
): Promise<ChatTransactionResult> {
  const recent = await loadRecentTransactions(input.userId);
  const found = findUndoTarget(recent, intent.targetHint ?? "");

  if (found.status === "none" || (!found.target && !found.candidates?.length)) {
    return buildChatTransactionClarificationResult({
      clarificationQuestion:
        "¿Cuál movimiento quieres corregir? Dime más o menos cuál era (el monto o qué fue) y lo ajusto.",
    });
  }

  const target =
    found.target ?? (found.candidates ? found.candidates[0] : undefined);
  if (!target) {
    return buildChatTransactionClarificationResult({
      clarificationQuestion:
        "¿Cuál movimiento quieres corregir? Dime el monto o qué fue y lo ajusto.",
    });
  }

  // Metadata-only corrections (category / description) never touch balances.
  if (
    intent.correctionField === "category" ||
    intent.correctionField === "description"
  ) {
    await correctTransactionMetadata({
      userId: input.userId,
      transactionId: target.id,
      category: intent.newCategory ?? undefined,
      description: intent.newDescription ?? undefined,
    });
    logChatRoute({
      route: "transaction_correction_or_undo",
      channel: input.channel,
      outcome: "correction",
      dbWrite: true,
      reversedTransactionId: target.id,
    });
    const what =
      intent.correctionField === "category"
        ? `lo dejé como ${intent.newCategory}`
        : "le cambié la nota";
    return buildChatActionResult({
      redirectCode: "chat-correction-created",
      message: `Listo, ${what}. Tu saldo no cambia, solo ordené cómo queda guardado.`,
    });
  }

  // Balance-impacting corrections (amount / source) = reverse + replace.
  if (intent.correctionField === "amount" || intent.correctionField === "source") {
    let account: Account | undefined;
    let debt: DebtAccount | undefined;
    if (intent.correctionField === "source") {
      if (!intent.newSourceName) {
        return buildChatTransactionClarificationResult({
          clarificationQuestion:
            "¿A qué cuenta o tarjeta lo cambio? Dime el nombre y lo corrijo.",
        });
      }
      const resolved = resolveSource(
        intent.newSourceName,
        input.accounts,
        input.debtAccounts,
      );
      account = resolved.account;
      debt = resolved.debt;
      if (!account && !debt) {
        return buildChatTransactionClarificationResult({
          clarificationQuestion: `No reconozco "${intent.newSourceName}" entre tus cuentas o tarjetas. ¿Cuál es?`,
        });
      }
    }

    const corrected = buildCorrectedIntent(
      target,
      { newAmount: intent.newAmount, account, debt },
      input.accounts,
    );
    if (!corrected) {
      return buildChatTransactionClarificationResult({
        clarificationQuestion:
          "Puedo corregirlo, pero necesito un dato más. ¿Qué quedó mal exactamente: el monto o la cuenta?",
      });
    }

    try {
      const result = await correctTransactionByReplacement({
        userId: input.userId,
        original: target,
        correctedIntent: corrected,
        accounts: input.accounts,
        debtAccounts: input.debtAccounts,
        goals: input.goals,
        message: input.message,
        channel: input.channel,
        chatId: input.chatId,
      });
      logChatRoute({
        route: "transaction_correction_or_undo",
        channel: input.channel,
        outcome: "correction",
        dbWrite: true,
        reversedTransactionId: target.id,
      });
      const newAmountText =
        intent.correctionField === "amount" && intent.newAmount
          ? money(intent.newAmount, target.originalCurrency)
          : null;
      const sourceText =
        intent.correctionField === "source"
          ? account
            ? account.name
            : (debt?.name ?? "la nueva cuenta")
          : null;
      const detail = newAmountText
        ? `Ahora queda en ${newAmountText}`
        : sourceText
          ? `Ahora sale de ${sourceText}`
          : "Ya lo corregí";
      return buildChatActionResult({
        redirectCode: "chat-correction-created",
        message: `${detail}. Ajusté tus saldos para que cuadre.`,
        assistantMetadata: result.assistantMetadata,
      });
    } catch {
      return buildChatTransactionFailedResult();
    }
  }

  // We know it is a correction but not which field — ask once.
  return buildChatTransactionClarificationResult({
    clarificationQuestion:
      "¿Qué corrijo de ese movimiento: el monto, la cuenta, la categoría o la nota?",
  });
}

// Resolve a recovery the assistant asked the user to confirm. Reads the
// recoveryPending state we stored on the prior assistant turn's metadata.
export async function resolveRecoveryConfirmation(input: {
  userId: string;
  message: string;
  pending: RecoveryPendingState;
  channel?: ChatChannel;
}): Promise<ChatTransactionResult | null> {
  if (detectNegation(input.message)) {
    return buildChatActionResult({
      redirectCode: "chat-reversal-created",
      message: "Listo, no toco nada. Si quieres, dime exactamente cuál era.",
    });
  }
  if (!detectAffirmation(input.message)) {
    return null; // not a yes/no — let the normal pipeline handle it.
  }

  const recent = await loadRecentTransactions(input.userId);
  const target = recent.transactions.find((tx) => tx.id === input.pending.transactionId);
  if (!target) {
    return buildChatActionResult({
      redirectCode: "chat-reversal-created",
      message: "Ese movimiento ya no está disponible para deshacer. Tus saldos quedan igual.",
    });
  }

  const result = await reverseStoredTransaction({
    userId: input.userId,
    transaction: target,
    message: input.message,
    channel: input.channel,
  });
  logChatRoute({
    route: "recovery_confirmation",
    channel: input.channel,
    outcome: input.pending.action === "duplicate" ? "duplicate_recovery" : "undo",
    dbWrite: result.ok,
    reversedTransactionId: target.id,
    validationReason: result.alreadyReversed ? "already_reversed" : undefined,
  });
  return buildChatActionResult({
    redirectCode: "chat-reversal-created",
    message: result.alreadyReversed
      ? "Ya estaba deshecho, así que queda igual."
      : `Hecho, quité ${input.pending.label} y te devolví el saldo.`,
  });
}
