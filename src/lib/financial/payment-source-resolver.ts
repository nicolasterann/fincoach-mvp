import type { Account, DebtAccount } from "@/types/financial";

// Shared payment-source matching helpers. Used by both the basic
// parser (to PICK a source) and by the chat handler's post-parser
// guard (to VERIFY the parser's pick — including AI parser results —
// against the user's explicit phrasing in the raw message).

const GENERIC_ACCOUNT_TOKENS = new Set([
  "cuenta",
  "cuentas",
  "ahorro",
  "ahorros",
  "corriente",
  "corrientes",
  "banco",
  "bancos",
  "de",
  "del",
  "la",
  "el",
  "mi",
  "tu",
  "una",
  "uno",
  "en",
  "para",
]);

const DEBT_SIGNAL_TOKENS = [
  "visa",
  "mastercard",
  "amex",
  "diners",
  "discover",
  "tarjeta",
  "credito",
  "tc",
];

export function normalizeForSourceMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

export function findExplicitAccount(
  normalizedMessage: string,
  accounts: Account[],
): Account | undefined {
  const fullMatch = accounts.find((account) =>
    normalizedMessage.includes(normalizeForSourceMatch(account.name)),
  );
  if (fullMatch) return fullMatch;

  return accounts.find((account) => {
    const tokens = normalizeForSourceMatch(account.name)
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !GENERIC_ACCOUNT_TOKENS.has(token));
    return tokens.some((token) => normalizedMessage.includes(token));
  });
}

export function findExplicitDebtAccount(
  normalizedMessage: string,
  debtAccounts: DebtAccount[],
): DebtAccount | undefined {
  return debtAccounts.find((debtAccount) => {
    const debtName = normalizeForSourceMatch(debtAccount.name);
    const tokens = debtName.split(/\s+/);
    return (
      normalizedMessage.includes(debtName) ||
      tokens.some((token) => normalizedMessage.includes(token))
    );
  });
}

// Whether the user mentioned a card/credit signal independent of the
// debt account's name. "visa pichincha" → true via "visa"; "pichincha"
// alone → false.
export function hasDebtSignal(normalizedMessage: string): boolean {
  return DEBT_SIGNAL_TOKENS.some((signal) => normalizedMessage.includes(signal));
}

export type ExpectedPaymentSourceKind =
  | "none"           // user did not name any source
  | "account"        // user clearly named an account
  | "debt"           // user clearly named a card / used a debt signal
  | "ambiguous";     // both an account and a card name match; we can't pick safely

export interface ExpectedPaymentSource {
  kind: ExpectedPaymentSourceKind;
  account?: Account;
  debtAccount?: DebtAccount;
}

// Mirrors the basic parser's source-resolution logic so the post-parser
// guard reaches the same conclusion when the user wrote an explicit
// source.
//
// Rules:
//   • If only an account is named, expect that account.
//   • If only a debt is named (or any debt signal like "visa"/"tarjeta"
//     is present), expect that debt account.
//   • If both are named but no debt signal is present, prefer the
//     account (the safe default — "pichincha" alone should not silently
//     become Visa Pichincha).
//   • If both are named AND a debt signal is present (e.g. "visa
//     pichincha"), expect the debt account.
//   • If nothing is named, return "none" (let the parser use defaults).
export function inferExpectedPaymentSource(
  rawMessage: string,
  accounts: Account[],
  debtAccounts: DebtAccount[],
): ExpectedPaymentSource {
  const normalizedMessage = normalizeForSourceMatch(rawMessage);
  const account = findExplicitAccount(normalizedMessage, accounts);
  const debtAccount = findExplicitDebtAccount(normalizedMessage, debtAccounts);
  const debtSignal = hasDebtSignal(normalizedMessage);

  if (!account && !debtAccount) {
    return { kind: "none" };
  }

  if (debtSignal) {
    return debtAccount
      ? { kind: "debt", debtAccount }
      : account
        ? { kind: "ambiguous", account }
        : { kind: "none" };
  }

  if (account && !debtAccount) {
    return { kind: "account", account };
  }

  if (!account && debtAccount) {
    return { kind: "debt", debtAccount };
  }

  // Both matched (likely via a shared token like "pichincha") and the
  // user did not use a debt signal. Prefer the account.
  return { kind: "account", account, debtAccount };
}
