-- Stage 30 — money truth v2 + real-life data model. Additive only.
-- Enables: (a) fixed expenses that vary month to month (utilities) so the engine
-- treats them with lower confidence and confirms them; (b) per-row notes to the
-- AI on the entities that lacked them (accounts, cards/debts, goals) — Kipu reads
-- them as memory and can schedule reminders ("el arriendo sube en agosto"); and
-- (c) a card-cycle paid signal (last_payment_date) so the Margen knows whether a
-- past-due statement was already covered, instead of relying on a manual "0".
-- Assets already exist as public.investment_accounts (Stage 17) — Stage 30 only
-- EXPOSES them in onboarding/chat; no new assets table is created.
-- RLS unchanged: every column added to an already-RLS'd, user-scoped table.

-- (a) Variable fixed expenses (gas, luz) — distinct from truly-fixed (arriendo).
alter table public.fixed_expenses add column if not exists is_variable boolean not null default false;

-- (b) Per-row notes to the coach (fixed_expenses + income_sources already have it).
alter table public.accounts add column if not exists notes text;
alter table public.debt_accounts add column if not exists notes text;
alter table public.goals add column if not exists notes text;

-- (c) Card billing-cycle: when a card's statement payment was last made, so the
-- engine can tell "paid this cycle" from "still owed" without a manual entry.
alter table public.debt_accounts add column if not exists last_payment_date date;
