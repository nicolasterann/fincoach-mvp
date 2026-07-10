-- Migration 041 — day-to-day F3: bank-realistic card interest accrual.
-- Additive only. Tracks the last date interest was capitalized onto a card so the
-- monthly accrual is idempotent (never double-charges interest within a cycle).
-- current_balance itself is updated by the typed accrueCardInterest store (same
-- pattern as update_card_obligations, which already writes current_balance directly).

alter table public.debt_accounts
  add column if not exists last_interest_accrued_on date;
