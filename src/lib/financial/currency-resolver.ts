import type { CurrencyCode } from "@/types/financial";

// Stage 12 — canonical currency resolver. ONE deterministic place that decides
// the ORIGINAL currency of a movement and how it maps to the user's base/
// reporting (primary) currency. Replaces scattered `?? "USD"` fallbacks.
//
// Trusted precedence for the ORIGINAL currency:
//   1. an explicit currency stated by the user or present in trusted evidence;
//   2. the actual currency of the selected owned instrument (account/card/debt);
//   3. the user's primary/default currency (profile.base_currency);
//   4. otherwise UNRESOLVED → the caller must ask (never a silent USD).
//
// A secondary currency never becomes the silent default: it is used only when
// explicit, evidenced, or the selected instrument is denominated in it.
//
// FX safety: the base/reporting amount is derived ONLY with a trusted rate. When
// the original currency equals the primary, the rate is genuinely 1 (not
// invented). When it differs and no trusted rate is available, the result is
// `fx_unavailable` — the caller must ask, never fabricate a rate or copy the
// original amount into base.

function normalizeCurrency(c?: string | null): CurrencyCode | undefined {
  if (typeof c !== "string") return undefined;
  const t = c.trim();
  return /^[A-Za-z]{3}$/.test(t) ? (t.toUpperCase() as CurrencyCode) : undefined;
}

export interface CurrencyResolution {
  original: CurrencyCode;
  base: CurrencyCode;
  /** 1 ONLY when original === base (a real rate, not invented). */
  exchangeRateToBase: number;
}

export type CurrencyResolveResult =
  | { ok: true; resolution: CurrencyResolution }
  | { ok: false; reason: "unresolved" }
  | { ok: false; reason: "fx_unavailable"; original: CurrencyCode; base: CurrencyCode };

export function resolveMovementCurrency(input: {
  /** Currency explicitly stated by the user or clearly present in evidence. */
  explicit?: string | null;
  /** Currencies of the selected instruments, in preference order (source, card, dest). */
  instruments?: (string | null | undefined)[];
  /** The user's primary/default currency (profile.base_currency). */
  primary?: string | null;
}): CurrencyResolveResult {
  const explicit = normalizeCurrency(input.explicit);
  const instrument = (input.instruments ?? []).map(normalizeCurrency).find((c): c is CurrencyCode => !!c);
  const primary = normalizeCurrency(input.primary);

  const original = explicit ?? instrument ?? primary;
  // The primary/base currency is required to represent the movement; if it is
  // genuinely missing (and nothing resolved the original), ask — never USD.
  if (!original || !primary) return { ok: false, reason: "unresolved" };

  if (original === primary) {
    return { ok: true, resolution: { original, base: primary, exchangeRateToBase: 1 } };
  }
  // original ≠ base and no trusted rate is available here.
  return { ok: false, reason: "fx_unavailable", original, base: primary };
}
