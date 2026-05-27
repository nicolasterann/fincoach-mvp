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

  const matches = findMatchingExpenses(normalizedMessage, fixedExpenses);

  if (matches.length === 0) return { status: "no_match" };

  if (matches.length > 1) {
    const uniqueNames = [...new Set(matches.map((m) => m.name))];

    if (uniqueNames.length > 1) {
      const question =
        uniqueNames.length === 2
          ? `Esto puede ser un gasto fijo. ¿Te refieres a ${uniqueNames[0]} o a ${uniqueNames[1]}?`
          : `Esto puede ser un gasto fijo, pero no sé cuál. ¿Es ${uniqueNames.join(", ")}?`;
      return { status: "ambiguous", clarificationQuestion: question };
    }

    // All matches share the same name (duplicate fixed expense rows)
    const name = uniqueNames[0];
    const uniqueAmounts = [...new Set(matches.map((m) => m.amount))];

    if (uniqueAmounts.length === 1) {
      const currency = matches[0].currency;
      const fixedAmount = uniqueAmounts[0];
      const fixedAmountStr = fixedAmount.toFixed(2);
      if (!amountsMatch(messageAmount, fixedAmount)) {
        return {
          status: "ambiguous",
          clarificationQuestion: `Tengo ${name} como gasto fijo de ${currency} ${fixedAmountStr}, pero escribiste ${currency} ${messageAmount.toFixed(2)}. ¿Fue el pago normal con otro monto o un cargo aparte?`,
        };
      }
      return {
        status: "ambiguous",
        clarificationQuestion: `Esto parece tu pago de ${name} de ${currency} ${fixedAmountStr} que ya tengo como gasto fijo. ¿Lo registro como ese pago o fue otro cargo aparte?`,
      };
    }

    return {
      status: "ambiguous",
      clarificationQuestion: `Tengo ${name} como gasto fijo, pero el monto no me cuadra. ¿Fue el pago normal o un cargo aparte?`,
    };
  }

  const expense = matches[0];
  const resolvedAccount = resolveAccount(normalizedMessage, accounts);

  if (!amountsMatch(messageAmount, expense.amount)) {
    const fixed = `${expense.currency} ${expense.amount.toFixed(2)}`;
    const sent = `${expense.currency} ${messageAmount.toFixed(2)}`;
    return {
      status: "amount_mismatch",
      matchedExpense: expense,
      resolvedAccount,
      messageAmount,
      clarificationQuestion: `Tenía ${expense.name} en ${fixed}, pero escribiste ${sent}. ¿Fue aumento mensual o un cargo extra puntual? Mándamelo de nuevo con el monto correcto.`,
    };
  }

  return {
    status: "confident_match",
    matchedExpense: expense,
    resolvedAccount,
    messageAmount,
  };
}
