const MONEY_KEYS = new Set([
  "amount",
  "amountbase",
  "amountoriginal",
  "cashavailable",
  "contributionamount",
  "currentbalance",
  "essentialmonthlyestimate",
  "extramonthly",
  "maxamount",
  "minamount",
  "minimumamount",
  "minimumpayment",
  "monthlyamount",
  "monthlycontribution",
  "monthlyinvestment",
  "monthlysavings",
  "myweekly",
  "newamount",
  "newbalance",
  "newmonthlyamount",
  "newvalue",
  "partialamount",
  "paidincardcurrency",
  "price",
  "realbalance",
  "receivedamount",
  "reserveamount",
  "sharebase",
  "statementbalance",
  "surcharge",
  "target",
  "targetamount",
  "thresholdamount",
  "total",
  "totalamount",
  "totalduethismonth",
  "value",
  "valuebase",
  "weeklyamount",
  "weeklycontribution",
  "weeklydelta",
]);

const NON_MONEY_KEYS = new Set([
  "anchorday",
  "askcount",
  "cutoffday",
  "dueday",
  "expectedreturnpct",
  "months",
  "percentage",
  "percent",
  "rate",
]);

export interface MonetaryClaim {
  path: string;
  amount: number;
}

interface StatedMoneyMention {
  start: number;
  end: number;
  values: number[];
}

function collect(
  value: unknown,
  path: string[],
  out: MonetaryClaim[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collect(item, [...path, String(index)], out));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    const next = [...path, key];
    if (
      typeof item === "number" &&
      Number.isFinite(item) &&
      MONEY_KEYS.has(lower) &&
      !NON_MONEY_KEYS.has(lower)
    ) {
      out.push({ path: next.join("."), amount: item });
      continue;
    }
    collect(item, next, out);
  }
}

/** Monetary values the model is asking a write tool to persist. Calendar
 * numbers, percentages and rates are deliberately excluded: they have their
 * own validators and are not amounts of user money. */
export function monetaryClaimsFromToolArgs(
  args: Record<string, unknown>,
): MonetaryClaim[] {
  const out: MonetaryClaim[] = [];
  collect(args, [], out);
  return out;
}

function numericVariants(token: string): number[] {
  const clean = token.replace(/\s/g, "");
  const variants = new Set<number>();
  const push = (raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n)) variants.add(n);
  };

  if (clean.includes(".") && clean.includes(",")) {
    const lastDot = clean.lastIndexOf(".");
    const lastComma = clean.lastIndexOf(",");
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? /,/g : /\./g;
    push(clean.replace(thousands, "").replace(decimal, "."));
  } else if (/^\d{1,3}([.,]\d{3})+$/.test(clean)) {
    // LatAm money uses both `33.000` and `33,000` as thousands. Treating the
    // same token ALSO as 33 accepted a 1,000× model error as “user-stated”.
    push(clean.replace(/[.,]/g, ""));
  } else if (clean.includes(",")) {
    // A single separator with 1–2 decimals is decimal; three digits was handled
    // as thousands above. Never keep the contradictory 5,060 alternative for
    // a user who wrote 50,60.
    push(clean.replace(/\./g, "").replace(",", "."));
  } else if (clean.includes(".")) {
    push(clean);
  } else {
    push(clean);
  }
  return [...variants];
}

function isDateToken(message: string, start: number, end: number): boolean {
  const around = message.slice(Math.max(0, start - 5), Math.min(message.length, end + 6));
  return (
    /\d{4}-\d{1,2}-\d{1,2}/.test(around) ||
    /\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/.test(around)
  );
}

function isNonMoneyToken(message: string, start: number, end: number): boolean {
  const normalize = (text: string) =>
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
  const before = normalize(message.slice(Math.max(0, start - 40), start));
  const after = normalize(message.slice(end, Math.min(message.length, end + 40)));
  const around = `${before.slice(-18)} ${after.slice(0, 20)}`;
  const hasCurrency =
    /[$€£¥]\s*$|\b(?:ars|usd|eur|cop|pen|clp|uyu|brl|mxn)\s*$/.test(before) ||
    /^\s*(?:[$€£¥]|\b(?:ars|usd|eur|cop|pen|clp|uyu|brl|mxn)\b)/.test(after);
  if (hasCurrency) return false;
  const token = message.slice(start, end).replace(/\s/g, "");
  const instrumentIdentifier =
    /^\d{3,8}$/.test(token) &&
    /\b(?:visa|master\s*card|mastercard|amex|american\s+express|diners|tarjeta|cuenta|cta)\s*(?:nro|numero|#)?\s*$/.test(
      before,
    );
  return (
    // Natural-language dates that are not formatted as ISO/slash dates.
    /\b(?:vence|vencia|vencimiento|corta|corte|fecha|dia|hasta\s+el|el)\s*$/.test(
      before,
    ) ||
    /^\s*(?:de\s+cada\s+mes|del?\s+mes|de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))\b/.test(
      after,
    ) ||
    // Card/account suffixes and reference numbers are identifiers, not money.
    /\b(?:termin(?:a|ad[ao])|ultimos?|final|numero|nro|ref(?:erencia)?|#)\s*(?:en|:)?\s*$/.test(
      before,
    ) ||
    // Counts/durations cannot authorize an amount merely because the number
    // happens to equal what the model proposed.
    /^\s*(?:%|dias?|mes(?:es)?|cuotas?|anos?|veces|digitos?)\b/.test(after) ||
    /\b(?:dias?|mes(?:es)?|cuotas?|anos?|veces|digitos?)\s*$/.test(before) ||
    // "Visa 5527" / "cuenta 1234" is an instrument identifier unless the
    // number carries its own currency marker. Treating it as money let a model
    // turn the last digits into an expense/payment amount. Ambiguity asks for
    // the amount; it never authorizes a write.
    instrumentIdentifier ||
    /\b(?:vence|corte|fecha|termin(?:a|ad[ao])|ultimos?|numero|nro|referencia)\b/.test(
      around,
    ) &&
      !/\b(?:gaste|pague|costo|cobro|monto|total|saldo|deuda)\b/.test(around)
  );
}

/** Returns the amounts explicitly present in the current user delivery. It is
 * intentionally permissive about LatAm separators (33.000 / 33,000) but
 * excludes calendar dates and plain percentages. */
export function statedAmounts(rawMessage: string): number[] {
  const message = rawMessage ?? "";
  const values = new Set<number>();
  for (const mention of statedMoneyMentions(message)) {
    mention.values.forEach((value) => values.add(value));
  }
  return [...values];
}

/** Money tokens plus their position in the current delivery. Keeping the
 * position is what lets a domain adapter prove amount↔row association instead
 * of merely proving that all numbers occur somewhere in the sentence. */
function statedMoneyMentions(rawMessage: string): StatedMoneyMention[] {
  const message = rawMessage ?? "";
  const mentions: StatedMoneyMention[] = [];
  const re = /[-+]?\d[\d.,\s]*\d|[-+]?\d/g;
  for (const match of message.matchAll(re)) {
    const token = match[0].trim();
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (
      isDateToken(message, start, end) ||
      isNonMoneyToken(message, start, end)
    ) {
      continue;
    }
    const around = message.slice(
      Math.max(0, start - 10),
      Math.min(message.length, end + 14),
    );
    if (
      /%\s*$/.test(message.slice(start, end + 2)) ||
      /^\s*%/.test(message.slice(end, end + 3)) ||
      /\b(d[ií]a|mes(?:es)?|cuota(?:s)?|año(?:s)?)\b/i.test(around) &&
        !/[$€£¥]|\b(?:ars|usd|eur|cop|pen|clp|uyu|brl|mxn)\b/i.test(around)
    ) {
      continue;
    }
    const values = numericVariants(token);
    if (values.length > 0) {
      mentions.push({ start, end, values });
    }
  }
  return mentions;
}

function normalizedAssociationText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameMoney(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.005, Math.abs(b) * 1e-8);
}

/** Proves the one multi-money shape whose associations are structurally
 * present in ordinary language: each row of log_movements_batch has its own
 * amount and description in the same user-authored clause. Clauses are split
 * only on explicit list/conjunction boundaries, so
 * "10 en compra A y 20 en compra B" cannot authorize the swapped payload.
 *
 * This is deliberately not a generic "all numbers were stated" escape hatch.
 * A card statement with minimum=10 and balance=500, an unlabelled split or a
 * batch whose descriptions were invented still requires the durable exact
 * proposal. */
export function batchMovementAmountAssociationsProven(
  rawMessage: string,
  args: Record<string, unknown>,
): boolean {
  const rawMovements = Array.isArray(args.movements) ? args.movements : [];
  const rows = rawMovements
    .filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object" && !Array.isArray(row),
      );
  if (rows.length < 2 || rows.length !== rawMovements.length) return false;

  const descriptors = rows.map((row) =>
    normalizedAssociationText(row.description),
  );
  if (
    descriptors.some((description) => description.length < 3) ||
    new Set(descriptors).size !== descriptors.length
  ) {
    return false;
  }
  const amounts = rows.map((row) => Number(row.amount));
  if (amounts.some((amount) => !Number.isFinite(amount) || amount <= 0)) {
    return false;
  }

  const mentions = statedMoneyMentions(rawMessage);
  if (mentions.length < rows.length) return false;
  const boundaries = [...rawMessage.matchAll(
    /[,;]|\b(?:y|e|adem[aá]s|tambi[eé]n|luego)\b/giu,
  )].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  const segments = mentions.map((mention) => {
    const start = boundaries
      .filter((boundary) => boundary.end <= mention.start)
      .at(-1)?.end ?? 0;
    const end = boundaries.find(
      (boundary) => boundary.start >= mention.end,
    )?.start ?? rawMessage.length;
    return normalizedAssociationText(rawMessage.slice(start, end));
  });

  const candidates = rows.map((_, rowIndex) =>
    mentions.flatMap((mention, mentionIndex) =>
      mention.values.some((value) => sameMoney(value, amounts[rowIndex]!)) &&
      segments[mentionIndex]!.includes(descriptors[rowIndex]!)
        ? [mentionIndex]
        : [],
    ),
  );
  if (candidates.some((row) => row.length === 0)) return false;

  // A small bipartite match handles equal-valued rows without accepting one
  // token as evidence for two different movements.
  const assigned = new Set<number>();
  const match = (rowIndex: number): boolean => {
    if (rowIndex >= candidates.length) return true;
    for (const mentionIndex of candidates[rowIndex]!) {
      if (assigned.has(mentionIndex)) continue;
      assigned.add(mentionIndex);
      if (match(rowIndex + 1)) return true;
      assigned.delete(mentionIndex);
    }
    return false;
  };
  return match(0);
}

export function amountWasStated(
  rawMessage: string,
  expected: number,
  tolerance = 0.005,
): boolean {
  if (!Number.isFinite(expected)) return false;
  if (
    Math.abs(expected) <= tolerance &&
    /\b(?:cero|zero|nada|ningun[oa]?|sin\s+(?:saldo|deuda|monto|pago))\b/i.test(
      rawMessage,
    )
  ) {
    return true;
  }
  return statedAmounts(rawMessage).some(
    (value) => Math.abs(value - expected) <= Math.max(tolerance, Math.abs(expected) * 1e-8),
  );
}

/** Numeric evidence for persisted rates/percentages. Unlike money extraction,
 * percentages are valid evidence here. Calendar tokens are still excluded so
 * a due date cannot authorize an invented interest or FX rate. */
export function numericValueWasStated(
  rawMessage: string,
  expected: number,
  tolerance = 0.0000005,
): boolean {
  if (!Number.isFinite(expected)) return false;
  const values = new Set<number>();
  const re = /[-+]?\d[\d.,\s]*\d|[-+]?\d/g;
  for (const match of rawMessage.matchAll(re)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (isDateToken(rawMessage, start, end)) continue;
    const around = rawMessage
      .slice(Math.max(0, start - 24), Math.min(rawMessage.length, end + 24))
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
    const explicitlyScalar =
      /%|\btasa\b|\bcotizacion\b|\btipo\s+de\s+cambio\b|\b(?:ars|usd|eur|cop|pen|clp|uyu|brl|mxn)\b/.test(
        around,
      );
    if (isNonMoneyToken(rawMessage, start, end) && !explicitlyScalar) continue;
    numericVariants(match[0].trim()).forEach((n) => values.add(n));
  }
  return [...values].some(
    (value) =>
      Math.abs(value - expected) <=
      Math.max(tolerance, Math.abs(expected) * 1e-8),
  );
}

export function unstatedMonetaryClaims(
  rawMessage: string,
  args: Record<string, unknown>,
): MonetaryClaim[] {
  return monetaryClaimsFromToolArgs(args).filter(
    (claim) => !amountWasStated(rawMessage, claim.amount),
  );
}
