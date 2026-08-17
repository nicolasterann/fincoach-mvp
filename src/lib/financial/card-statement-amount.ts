/**
 * Native current-statement amount used by every card-payment boundary.
 *
 * The agent context may expose the remaining statement in base currency for
 * display as well as the original/native amount required by the writer.  A
 * server-owned payment fact must always use the native amount.  Covered is an
 * authoritative zero and must never fall through to an older total.
 */
export function cardNativeStatementExpected(
  card: {
    currency: string;
    statementCovered?: boolean | null;
    fullPaymentDueOriginal?: number | null;
    fullPaymentDue?: number | null;
    statementTotalDue?: number | null;
  },
  baseCurrency: string,
): number | null {
  if (card.statementCovered === true) return 0;
  if (
    card.fullPaymentDueOriginal != null &&
    Number.isFinite(card.fullPaymentDueOriginal)
  ) {
    return card.fullPaymentDueOriginal;
  }
  if (
    String(card.currency).toUpperCase() ===
      String(baseCurrency).toUpperCase() &&
    card.fullPaymentDue != null &&
    Number.isFinite(card.fullPaymentDue)
  ) {
    return card.fullPaymentDue;
  }
  return card.statementTotalDue != null &&
    Number.isFinite(card.statementTotalDue)
    ? card.statementTotalDue
    : null;
}
