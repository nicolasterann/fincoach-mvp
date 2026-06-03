import type { Account, FixedExpense } from "@/types/financial";

export type FixedExpenseMatchStatus =
  | "confident_match"
  | "amount_mismatch"
  | "ambiguous"
  | "no_match";

export interface FixedExpenseMatchResult {
  status: FixedExpenseMatchStatus;
  matchedExpense?: FixedExpense;
  resolvedAccount?: Account;
  messageAmount?: number;
  clarificationQuestion?: string;
}

const GENERIC_TOKENS = new Set([
  "cuenta", "cuentas", "ahorro", "ahorros", "corriente", "banco", "bancos",
  "de", "del", "la", "el", "mi", "tu", "una", "uno", "en", "para", "con",
  "pague", "pago", "pagué",
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

// Word-boundary-aware containment check. Short names (< 4 chars) get a
// proper \b boundary to avoid "bus" matching inside "autobus". Longer
// names use substring because boundary semantics break on punctuation.
function normNameInMessage(normalizedMessage: string, normName: string): boolean {
  if (normName.length < 4) {
    return new RegExp(`\\b${normName}\\b`).test(normalizedMessage);
  }
  return normalizedMessage.includes(normName);
}

function extractFirstAmount(normalizedMessage: string): number | null {
  const match = normalizedMessage.match(/(?:\$|\busd\s*)?(\d+(?:[.,]\d{1,2})?)/);
  if (!match?.[1]) return null;
  return Number(match[1].replace(",", "."));
}

function findMatchingExpenses(
  normalizedMessage: string,
  fixedExpenses: FixedExpense[],
): FixedExpense[] {
  return fixedExpenses.filter((expense) => {
    if (!expense.isActive) return false;
    const normName = normalize(expense.name);
    if (normNameInMessage(normalizedMessage, normName)) return true;
    // Fallback: check distinctive tokens so "Plan celular Movistar" matches
    // on "movistar" alone.
    const tokens = normName
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t));
    return tokens.length > 0 && tokens.some((t) => normalizedMessage.includes(t));
  });
}

function resolveAccount(normalizedMessage: string, accounts: Account[]): Account | undefined {
  const candidates = accounts.filter((a) => !a.isGoalAccount);
  const fullMatch = candidates.find((a) => normalizedMessage.includes(normalize(a.name)));
  if (fullMatch) return fullMatch;
  return candidates.find((a) => {
    const tokens = normalize(a.name)
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t));
    return tokens.some((t) => normalizedMessage.includes(t));
  });
}

// Amounts are considered matching when they are within 2 % of each other
// OR within 0.50 units — handles display rounding (8 vs 7.99, 13.40 vs 13).
function amountsMatch(messageAmount: number, fixedAmount: number): boolean {
  if (fixedAmount <= 0) return false;
  const absDiff = Math.abs(messageAmount - fixedAmount);
  return absDiff / fixedAmount <= 0.02 || absDiff <= 0.5;
}

// Override phrases the user can append to a follow-up message to
// resolve an amount-mismatch / ambiguous clarification deterministically:
//   • "como gasto fijo" / "como pago fijo" / "como fijo"
//     → confirm this IS the recurring payment, with whatever amount the
//       user typed (overrides the stored fixed amount).
//   • "aparte" / "cargo aparte" / "como aparte" / "como gasto aparte"
//     → this is NOT a recurring payment; treat as an ordinary expense
//       and let the standard parser handle it.
//
// These exist because we don't currently persist pending-clarification
// state between Telegram messages, so the user needs an explicit, short
// follow-up phrase that the next message can carry on its own.
const FIXED_EXPENSE_CONFIRMATION_RE =
  /\bcomo\s+(?:gasto|pago)?\s*fijo\b|\bfijo\b/;
const SEPARATE_EXPENSE_CONFIRMATION_RE =
  /\b(?:aparte|cargo\s+aparte|como\s+(?:gasto\s+)?aparte)\b/;

function hasFixedConfirmation(normalizedMessage: string): boolean {
  if (SEPARATE_EXPENSE_CONFIRMATION_RE.test(normalizedMessage)) return false;
  return FIXED_EXPENSE_CONFIRMATION_RE.test(normalizedMessage);
}

function hasSeparateConfirmation(normalizedMessage: string): boolean {
  return SEPARATE_EXPENSE_CONFIRMATION_RE.test(normalizedMessage);
}

// Money in Kipu voice for the clarification copy: "25$" / "3.50$" (sign after
// the number, decimals only when there are cents). Never "USD 25.00".
function formatKipuMoney(amount: number, currency: string): string {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const text = isWhole ? String(Math.round(rounded)) : rounded.toFixed(2);
  return currency === "USD" ? `${text}$` : `${text} ${currency}`;
}

// Pure deterministic matcher. No DB calls; call with already-loaded data.
//
// Returns:
//   no_match        — no active fixed expense mentioned; fall through to parser.
//   ambiguous       — multiple fixed expenses match; ask user to clarify.
//   amount_mismatch — one match but amount differs; ask if change or extra charge.
//   confident_match — one match with matching amount; safe to apply.
export function matchFixedExpense(
  rawMessage: string,
  fixedExpenses: FixedExpense[],
  accounts: Account[],
): FixedExpenseMatchResult {
  if (fixedExpenses.length === 0) return { status: "no_match" };

  const normalizedMessage = normalize(rawMessage);
  const messageAmount = extractFirstAmount(normalizedMessage);

  if (messageAmount === null) return { status: "no_match" };

  // User explicitly said "aparte" — never link to a fixed expense.
  // Let the regular parser handle it as an ordinary expense.
  if (hasSeparateConfirmation(normalizedMessage)) {
    return { status: "no_match" };
  }

  const matches = findMatchingExpenses(normalizedMessage, fixedExpenses);

  if (matches.length === 0) return { status: "no_match" };

  const explicitlyConfirmedFixed = hasFixedConfirmation(normalizedMessage);
  const resolvedAccount = resolveAccount(normalizedMessage, accounts);

  if (matches.length > 1) {
    const uniqueNames = [...new Set(matches.map((m) => normalize(m.name)))];

    if (uniqueNames.length > 1) {
      // Distinct fixed expense names match — cannot safely pick one
      // even with explicit "como gasto fijo" confirmation, because we
      // do not know which name the user meant.
      const displayNames = [...new Set(matches.map((m) => m.name))];
      const question =
        displayNames.length === 2
          ? `Esto puede ser un gasto fijo. ¿Te refieres a ${displayNames[0]} o a ${displayNames[1]}?`
          : `Esto puede ser un gasto fijo, pero no sé cuál. ¿Es ${displayNames.join(", ")}?`;
      return { status: "ambiguous", clarificationQuestion: question };
    }

    // All matches share the same normalized name (duplicate fixed
    // expense rows). With explicit "como gasto fijo" confirmation, it
    // is safe to apply against one of the duplicates as long as we
    // pick a unique amount: either all duplicates share an amount, or
    // exactly one duplicate matches the amount the user typed.
    const name = matches[0].name;
    const currency = matches[0].currency;
    const uniqueAmounts = [...new Set(matches.map((m) => m.amount))];

    if (explicitlyConfirmedFixed) {
      if (uniqueAmounts.length === 1) {
        return {
          status: "confident_match",
          matchedExpense: matches[0],
          resolvedAccount,
          messageAmount,
        };
      }
      const closest = matches.find((m) => amountsMatch(messageAmount, m.amount));
      if (closest) {
        return {
          status: "confident_match",
          matchedExpense: closest,
          resolvedAccount,
          messageAmount,
        };
      }
      // Different stored amounts and the user's amount matches none —
      // stay ambiguous so we don't pick the wrong row.
    }

    const amountText = formatKipuMoney(messageAmount, currency);

    if (uniqueAmounts.length === 1) {
      const fixedAmount = uniqueAmounts[0];
      const fixedAmountStr = formatKipuMoney(fixedAmount, currency);
      if (!amountsMatch(messageAmount, fixedAmount)) {
        // Duplicate rows for the same fixed expense (same name + same
        // stored amount) but the user typed a different amount. The
        // clarification is the same normal-vs-aparte question we ask
        // in the single-match amount_mismatch branch — expose a
        // candidate so the caller can persist a pending clarification
        // and resolve the next reply. Picking matches[0] mirrors the
        // "como gasto fijo" override branch above.
        return {
          status: "ambiguous",
          matchedExpense: matches[0],
          resolvedAccount,
          messageAmount,
          clarificationQuestion: `${name} normalmente está en ${fixedAmountStr}, pero esta vez pusiste ${amountText}. ¿Lo dejo como el pago normal o como un cargo aparte?`,
        };
      }
      return {
        status: "ambiguous",
        matchedExpense: matches[0],
        resolvedAccount,
        messageAmount,
        clarificationQuestion: `${name} normalmente está en ${fixedAmountStr}. ¿Lo dejo como el pago normal o como un cargo aparte?`,
      };
    }

    // Different stored amounts across duplicate rows and none match the
    // user's amount. Picking matches[0].amount for the reference value
    // mirrors the candidate we expose for pending payload purposes.
    const referenceAmountStr = formatKipuMoney(matches[0].amount, currency);
    return {
      status: "ambiguous",
      matchedExpense: matches[0],
      resolvedAccount,
      messageAmount,
      clarificationQuestion: `${name} normalmente está en ${referenceAmountStr}, pero esta vez pusiste ${amountText}. ¿Lo dejo como el pago normal o como un cargo aparte?`,
    };
  }

  const expense = matches[0];

  if (!amountsMatch(messageAmount, expense.amount)) {
    // Explicit one-shot confirmation: the user already saw the prompt
    // for an amount mismatch and re-sent the message with "como gasto
    // fijo". Apply with the user-provided amount, linked to the fixed
    // expense row, so the next month's matcher still recognizes it.
    if (explicitlyConfirmedFixed) {
      return {
        status: "confident_match",
        matchedExpense: expense,
        resolvedAccount,
        messageAmount,
      };
    }

    const fixed = formatKipuMoney(expense.amount, expense.currency);
    const sent = formatKipuMoney(messageAmount, expense.currency);
    return {
      status: "amount_mismatch",
      matchedExpense: expense,
      resolvedAccount,
      messageAmount,
      clarificationQuestion: `${expense.name} normalmente está en ${fixed}, pero esta vez pusiste ${sent}. ¿Lo dejo como el pago normal o como un cargo aparte?`,
    };
  }

  return {
    status: "confident_match",
    matchedExpense: expense,
    resolvedAccount,
    messageAmount,
  };
}
