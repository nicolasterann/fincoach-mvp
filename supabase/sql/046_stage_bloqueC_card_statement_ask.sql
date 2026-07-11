-- Migration 046 — Bloque C: the credit-card CORTE (statement-arrival) ask.
-- Additive only. RLS + grants inherited from 044/045. Human/authorized-agent applies this.
--
-- A credit card now runs TWO Bloque C occurrences per cycle, both keyed on debt_account_id:
--   - CORTE  (kind='card_statement') on the card's cutoff_day → "¿llegó tu corte de X? ¿de
--     cuánto?". On confirm it SETS full_payment_due (the "pago del mes") + statement_date. It is
--     NOT a ledger movement (no cash moves when the statement arrives).
--   - PAGO   (kind='debt_payment')  on the card's due_day → "¿pagaste la tarjeta y cuánto?". On
--     confirm it books the payment (cash ↓ + debt ↓) and reduces full_payment_due (F2).
-- The two live on different occurrence_dates (cutoff vs due) so the existing partial unique index
-- on (user_id, debt_account_id, occurrence_date) already keeps them distinct.

alter table public.recurring_occurrences drop constraint if exists recurring_occurrences_kind_check;
alter table public.recurring_occurrences
  add constraint recurring_occurrences_kind_check
  check (kind in ('income', 'expense', 'debt_payment', 'savings', 'investment', 'card_statement'));
