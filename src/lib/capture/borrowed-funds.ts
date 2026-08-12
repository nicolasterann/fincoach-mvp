// M0 deliberately contains no phrase classifier for who owes whom. “Me
// transfirieron de un préstamo” can mean debt proceeds, repayment of a
// receivable, or capital returned from an original Kipu never saw. The planner
// must state the two balance effects; the executor validates that algebra.
// This module keeps only the deterministic entity-quality check used after the
// economic direction is already known.

const GENERIC_LENDER =
  /^(?:alguien|persona|prestamo|pr[ée]stamo|banco|financiera|no\s+s[ée]|desconocid[oa])$/i;

export function isConcreteLenderName(person: string): boolean {
  const value = String(person ?? "").trim();
  return value.length >= 2 && !GENERIC_LENDER.test(value);
}
