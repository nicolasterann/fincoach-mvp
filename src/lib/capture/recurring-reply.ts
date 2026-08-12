const CURRENT_INCOME_ARRIVAL = [
  /\b(?:sueldo|salario|ingreso|pago)\b.{0,45}\b(?:me\s+)?(?:lleg[óo]|entr[óo]|ingres[óo]|depositaron)(?=\s|[.,;:!?]|$).{0,20}\bhoy\b/i,
  /\bhoy\b.{0,25}\b(?:me\s+)?(?:lleg[óo]|entr[óo]|ingres[óo]|depositaron)(?=\s|[.,;:!?]|$).{0,45}\b(?:sueldo|salario|ingreso|pago)\b/i,
];

export function statesIncomeArrivedToday(rawMessage: string): boolean {
  return CURRENT_INCOME_ARRIVAL.some((pattern) =>
    pattern.test(String(rawMessage ?? "")),
  );
}

export type IncomeOccurrenceReplyPlan =
  | { ok: true }
  | { ok: false; occurrenceDate: string; today: string };

/** A late confirmation may legitimately refer to an old cycle, but an explicit
 * "my salary arrived today" is a new calendar fact.  Closing an old occurrence
 * would neither book today's income nor ask its amount. */
export function planIncomeOccurrenceReply(input: {
  rawMessage: string;
  kind: string;
  occurrenceDate: string;
  today: string;
}): IncomeOccurrenceReplyPlan {
  if (
    input.kind !== "income" ||
    input.occurrenceDate === input.today ||
    !statesIncomeArrivedToday(input.rawMessage)
  ) {
    return { ok: true };
  }
  return {
    ok: false,
    occurrenceDate: input.occurrenceDate,
    today: input.today,
  };
}
