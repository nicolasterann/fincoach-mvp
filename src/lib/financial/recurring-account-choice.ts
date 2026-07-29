export interface RecurringAccountCandidate {
  id: string;
  isPrimary: boolean;
}

/**
 * Resolve the real cash leg of an automatic recurring movement.
 *
 * A persisted account id is an explicit instruction: if that row disappeared,
 * falling back to another account would move money somewhere the user never
 * chose. Without a persisted choice, one structured primary or one sole
 * account is usable; multiple ordinary accounts without a primary are
 * ambiguous and must stay pending.
 */
export function recurringAccountChoiceId(
  rows: RecurringAccountCandidate[],
  preferredId: string | null | undefined,
): string | null {
  if (preferredId) {
    return rows.find((row) => row.id === preferredId)?.id ?? null;
  }
  const primaries = rows.filter((row) => row.isPrimary);
  if (primaries.length === 1) return primaries[0].id;
  return rows.length === 1 ? rows[0].id : null;
}
